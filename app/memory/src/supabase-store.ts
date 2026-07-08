// ISSUE-022 — the LIVE pg adapter for the MemoryStore port. Authored to the schema.md §3 DDL (0001 baseline +
// the 0029 Internal-Org singleton guard + the 0030 entity_types seed); it is the reference model
// (InMemoryMemoryStore) realised against the real silo. NOT exercised by the offline suite — its behaviour is
// proven by the R10 live-adapter smoke (results/live-smoke.sql, rolled back). Every method mirrors an InMemory
// method 1:1, and both call the SHARED validateMemoryRow so offline + live reject an ill-formed row identically.
//
// Two invariants are DB-enforced (not re-implemented here): the Internal-Org singleton (0029 partial-unique →
// a 2nd true row raises unique_violation, mapped to MemoryError(internal_org_exists)) and the idempotency dedup
// (unique(idempotency_key) → ON CONFLICT DO NOTHING makes a retried write a no-op). Entity-type validation is
// app-level (OD-178 — entities.type is plain text) so it is checked here against the live config, matching the fake.

import type { Pool } from 'pg';
import {
  type MemoryStore,
  type EntityRow,
  type EntityInput,
  type MemoryRow,
  type ExternalRefs,
  MemoryError,
  ERR_UNKNOWN_ENTITY_TYPE,
  ERR_INTERNAL_ORG_EXISTS,
  validateMemoryRow,
} from './store.ts';
import { INTERNAL_ORG_TYPE } from './entity-types.ts';

const PG_UNIQUE_VIOLATION = '23505';

interface EntityDbRow {
  id: string;
  type: string;
  name: string;
  external_refs: ExternalRefs;
  is_internal_org: boolean;
  maturity: string | null; // numeric comes back as string from pg
  maturity_updated_at: Date | null;
  created_at: Date;
}

function toEntityRow(r: EntityDbRow): EntityRow {
  return {
    id: r.id,
    type: r.type,
    name: r.name,
    external_refs: r.external_refs ?? {},
    is_internal_org: r.is_internal_org,
    maturity: r.maturity === null ? null : Number(r.maturity),
    maturity_updated_at: r.maturity_updated_at ? r.maturity_updated_at.toISOString() : null,
    created_at: r.created_at.toISOString(),
  };
}

/** Format a JS number[] as a pgvector literal ('[a,b,...]') for a `$n::vector` cast. */
function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

export class SupabaseMemoryStore implements MemoryStore {
  constructor(private pool: Pool) {}

  async listEntityTypes(): Promise<string[]> {
    const { rows } = await this.pool.query<{ value: unknown }>(`select value from config_values where key = 'entity_types' limit 1`);
    const v = rows[0]?.value;
    return Array.isArray(v) ? (v as string[]) : [];
  }

  async listEntities(): Promise<EntityRow[]> {
    const { rows } = await this.pool.query<EntityDbRow>(
      `select id, type, name, external_refs, is_internal_org, maturity, maturity_updated_at, created_at from entities`,
    );
    return rows.map(toEntityRow);
  }
  async getEntity(id: string): Promise<EntityRow | null> {
    const { rows } = await this.pool.query<EntityDbRow>(
      `select id, type, name, external_refs, is_internal_org, maturity, maturity_updated_at, created_at from entities where id = $1`,
      [id],
    );
    return rows[0] ? toEntityRow(rows[0]) : null;
  }
  async internalOrg(): Promise<EntityRow | null> {
    const { rows } = await this.pool.query<EntityDbRow>(
      `select id, type, name, external_refs, is_internal_org, maturity, maturity_updated_at, created_at from entities where is_internal_org limit 1`,
    );
    return rows[0] ? toEntityRow(rows[0]) : null;
  }

  async insertEntity(input: EntityInput): Promise<EntityRow> {
    // App-level type validation against the live config (matches the fake). The locked Internal-Org type is
    // always valid (it is seeded in the default list).
    if (input.type !== INTERNAL_ORG_TYPE) {
      const types = await this.listEntityTypes();
      if (!types.includes(input.type)) {
        throw new MemoryError(ERR_UNKNOWN_ENTITY_TYPE, `entity type '${input.type}' is not in the configured entity_types list`);
      }
    }
    try {
      const { rows } = await this.pool.query<EntityDbRow>(
        `insert into entities (type, name, external_refs, is_internal_org)
         values ($1, $2, $3::jsonb, $4)
         returning id, type, name, external_refs, is_internal_org, maturity, maturity_updated_at, created_at`,
        [input.type, input.name, JSON.stringify(input.external_refs ?? {}), input.is_internal_org === true],
      );
      return toEntityRow(rows[0]!);
    } catch (e) {
      // The 0029 partial-unique guard fired: a 2nd is_internal_org=true row (FR-2.ENT.003 singleton).
      if (isUniqueViolation(e)) {
        throw new MemoryError(ERR_INTERNAL_ORG_EXISTS, 'an Internal Org entity already exists (singleton, FR-2.ENT.003)');
      }
      throw e;
    }
  }

  async insertMemory(row: MemoryRow): Promise<{ inserted: boolean; id: string }> {
    validateMemoryRow(row); // same guard as the fake — offline + live reject an ill-formed row identically
    const { rows } = await this.pool.query<{ id: string }>(
      `insert into memories
         (type, content, embedding, embedding_model, entity_ids, source, source_ref, confidence,
          visibility, sensitivity, superseded_by, content_hash, idempotency_key, expires_at)
       values ($1, $2, $3::vector, $4, $5::uuid[], $6, $7, $8, $9, $10, $11, $12, $13, $14)
       on conflict (idempotency_key) do nothing
       returning id`,
      [
        row.type,
        row.content,
        toVectorLiteral(row.embedding),
        row.embedding_model,
        row.entity_ids,
        row.source,
        row.source_ref,
        row.confidence,
        row.visibility,
        row.sensitivity,
        row.superseded_by,
        row.content_hash,
        row.idempotency_key,
        row.expires_at,
      ],
    );
    if (rows[0]) return { inserted: true, id: rows[0].id };
    // Conflict → the idempotency_key already exists: a retried write is a no-op (ADR-004 §4). Fetch the id.
    const existing = await this.pool.query<{ id: string }>(`select id from memories where idempotency_key = $1 limit 1`, [row.idempotency_key]);
    return { inserted: false, id: existing.rows[0]!.id };
  }

  async getMemory(id: string): Promise<MemoryRow | null> {
    const { rows } = await this.pool.query<MemoryDbRow>(MEMORY_SELECT + ` where id = $1`, [id]);
    return rows[0] ? toMemoryRow(rows[0]) : null;
  }
  async listMemories(): Promise<MemoryRow[]> {
    const { rows } = await this.pool.query<MemoryDbRow>(MEMORY_SELECT);
    return rows.map(toMemoryRow);
  }
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'code' in e && (e as { code?: string }).code === PG_UNIQUE_VIOLATION;
}

// ── memories read mapping ──────────────────────────────────────────────────────────────────────
interface MemoryDbRow {
  id: string;
  type: MemoryRow['type'];
  content: string;
  embedding: string; // pgvector comes back as a '[a,b,...]' string
  embedding_model: string;
  entity_ids: string[];
  source: MemoryRow['source'];
  source_ref: string | null;
  confidence: string | null;
  visibility: MemoryRow['visibility'];
  sensitivity: MemoryRow['sensitivity'];
  superseded_by: string | null;
  content_hash: string;
  idempotency_key: string;
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const MEMORY_SELECT = `select id, type, content, embedding, embedding_model, entity_ids, source, source_ref, confidence,
  visibility, sensitivity, superseded_by, content_hash, idempotency_key, expires_at, created_at, updated_at from memories`;

function toMemoryRow(r: MemoryDbRow): MemoryRow {
  return {
    id: r.id,
    type: r.type,
    content: r.content,
    embedding: parseVector(r.embedding),
    embedding_model: r.embedding_model,
    entity_ids: r.entity_ids,
    source: r.source,
    source_ref: r.source_ref,
    confidence: r.confidence === null ? null : Number(r.confidence),
    visibility: r.visibility,
    sensitivity: r.sensitivity,
    superseded_by: r.superseded_by,
    content_hash: r.content_hash,
    idempotency_key: r.idempotency_key,
    expires_at: r.expires_at ? r.expires_at.toISOString() : null,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

function parseVector(v: string): number[] {
  const inner = v.trim().replace(/^\[/, '').replace(/\]$/, '');
  if (inner.length === 0) return [];
  return inner.split(',').map(Number);
}
