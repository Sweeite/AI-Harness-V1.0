// ISSUE-025 (C2 RET) — the LIVE pg adapter for the RetrievalStore port, against the REAL silo DDL:
//   • memories (baseline 0001) — the two arms read here; the vector arm runs `order by embedding <=> $probe limit k`
//     UNDER the ISSUE-023 retrieval-session index-usage contract (applyRetrievalSession) so the planner uses the HNSW
//     index, not a 19s seqscan (AF-019 / AF-067). The keyword arm reads by entity_ids array-overlap.
//   • entities (baseline 0001) — the resolution snapshot + entity-type lookup + the primary entity's Maturity.
//   • event_log (0001) — the 'memory_read' observability sample (established retrieval read signal; agent-health reads it).
//   • access_audit (0001) — the 'sensitive_view' audit for a Personal/Restricted candidate the caller was cleared to see.
//
// NO new migration — this slice is read-path only; both event/audit sinks + the 'memory_read' event_type + the
// answer_mode enum all pre-exist in the 0001 baseline (the `check` gate verifies present, Rule 0).
//
// ⚠️ Verify with the R10 live-adapter smoke before claiming these paths proven. The in-memory reference model (store.ts)
// is the proven contract; this adapter must AGREE with the real schema + the live 0031 clearance policy (the fake-passes-
// offline / live-throws class R10 exists to catch). CLEARANCE IS APPLIED IN-PROCESS by the pipeline (clearance.ts) — the
// adapter deliberately returns RAW rows (the agent service_role path bypasses RLS, so retrieval is the authoritative
// filter); the human path is additionally behind the live 0031 policy (defence in depth), and applyRetrievalSession's
// iterative_scan keeps the index returning cleared rows under that RLS predicate (AF-019).

import pg from 'pg';
import { applyRetrievalSession } from '../../embeddings/src/retrieval-session.ts';
import type { EntityRow, MemoryRow } from '../../memory/src/store.ts';
import { admitsCandidate } from './candidate-filters.ts';
import type {
  DualSearchQuery,
  RetrievalEventSample,
  RetrievalStore,
  SensitiveAccessAudit,
} from './store.ts';

/** The event_type this slice writes (pre-exists in the 0001 baseline enum — the established retrieval read signal). */
export const EVT_MEMORY_READ = 'memory_read' as const;
/** The access_audit audit_type for a sensitive candidate access (free-text column; 'sensitive_view' convention). */
export const AUDIT_SENSITIVE_VIEW = 'sensitive_view' as const;

export type QueryExec = <R extends pg.QueryResultRow>(text: string, params?: unknown[]) => Promise<{ rows: R[]; rowCount?: number | null }>;

function toVectorLiteral(embedding: readonly number[]): string {
  return `[${embedding.join(',')}]`;
}

function parseVector(v: string): number[] {
  const inner = v.trim().replace(/^\[/, '').replace(/\]$/, '');
  if (inner.length === 0) return [];
  return inner.split(',').map(Number);
}

interface MemoryDbRow {
  id: string;
  type: MemoryRow['type'];
  content: string;
  embedding: string;
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

const MEMORY_COLS = `id, type, content, embedding, embedding_model, entity_ids, source, source_ref, confidence,
  visibility, sensitivity, superseded_by, content_hash, idempotency_key, expires_at, created_at, updated_at`;

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

interface EntityDbRow {
  id: string;
  type: string;
  name: string;
  external_refs: Record<string, string> | null;
  is_internal_org: boolean;
  maturity: string | null;
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

export class SupabaseRetrievalStore implements RetrievalStore {
  private pool: pg.Pool | null = null;
  private readonly exec: QueryExec;
  /** A pool handle is required for the vector arm's transaction (set local GUCs must scope one connection). When an
   *  exec seam is injected (tests) without a pool, the vector arm falls back to applying the GUCs on the same exec —
   *  correct for a single-connection test seam. */
  constructor(connectionString: string, queryExec?: QueryExec) {
    if (queryExec) {
      this.exec = queryExec;
    } else {
      const ssl = /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: false };
      const pool = new pg.Pool({ connectionString, ssl });
      this.pool = pool;
      this.exec = (text, params) => pool.query(text, params);
    }
  }

  async end(): Promise<void> {
    await this.pool?.end();
  }

  async resolutionSnapshot(): Promise<EntityRow[]> {
    const { rows } = await this.exec<EntityDbRow>(
      `select id, type, name, external_refs, is_internal_org, maturity, maturity_updated_at, created_at from entities`,
    );
    return rows.map(toEntityRow);
  }

  async keywordArm(q: DualSearchQuery): Promise<MemoryRow[]> {
    if (q.entityIds.length === 0) return [];
    // entity_ids && $1 = array overlap (the memories_entity_ids_gin index serves this). RAW — no candidate-filter
    // push-down: the pipeline is the SINGLE candidate-filter authority (candidate-filters.ts with the request's nowIso +
    // the live CFG floor). Pushing an expiry/floor predicate here would introduce a second clock/threshold that could
    // disagree with the pipeline's — a fake-vs-live divergence (R10). The keyword set is entity-scoped + small, so
    // returning the few extra superseded/expired rows the pipeline then drops costs nothing.
    const { rows } = await this.exec<MemoryDbRow>(`select ${MEMORY_COLS} from memories where entity_ids && $1`, [q.entityIds]);
    return rows.map(toMemoryRow);
  }

  async vectorArm(q: DualSearchQuery): Promise<Array<{ memory: MemoryRow; similarity: number }>> {
    const probe = toVectorLiteral(q.queryEmbedding);
    // The vector arm MUST run under the retrieval-session index-usage contract (set local ef_search / iterative_scan /
    // enable_seqscan=off) — those are txn-scoped, so acquire ONE connection, BEGIN, apply the contract, query, COMMIT.
    const client = this.pool ? await this.pool.connect() : null;
    const exec: QueryExec = client ? ((t, p) => client.query(t as string, p)) : this.exec;
    try {
      if (client) await client.query('begin');
      await applyRetrievalSession((sql) => exec(sql), q.efSearch);
      const { rows } = await exec<MemoryDbRow & { similarity: string }>(
        `select ${MEMORY_COLS}, (1 - (embedding <=> $1::vector)) as similarity
           from memories
          order by embedding <=> $1::vector
          limit $2`,
        [probe, q.vectorTopK],
      );
      if (client) await client.query('commit');
      return rows.map((r) => ({ memory: toMemoryRow(r), similarity: Number(r.similarity) }));
    } catch (e) {
      if (client) await client.query('rollback').catch(() => {});
      throw e;
    } finally {
      client?.release();
    }
  }

  async similarityOf(memoryIds: readonly string[], queryEmbedding: readonly number[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (memoryIds.length === 0) return out;
    const { rows } = await this.exec<{ id: string; similarity: string }>(
      `select id, (1 - (embedding <=> $2::vector)) as similarity from memories where id = any($1)`,
      [memoryIds, toVectorLiteral(queryEmbedding)],
    );
    for (const r of rows) out.set(r.id, Number(r.similarity));
    return out;
  }

  async entityTypes(entityIds: readonly string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (entityIds.length === 0) return out;
    const { rows } = await this.exec<{ id: string; type: string }>(`select id, type from entities where id = any($1)`, [entityIds]);
    for (const r of rows) out.set(r.id, r.type);
    return out;
  }

  async entityMaturity(entityId: string): Promise<number | null> {
    const { rows } = await this.exec<{ maturity: string | null }>(`select maturity from entities where id = $1`, [entityId]);
    const v = rows[0]?.maturity;
    return v === undefined || v === null ? null : Number(v);
  }

  async appendReadEvent(e: RetrievalEventSample): Promise<void> {
    await this.exec(
      `insert into public.event_log (event_type, entity_ids, summary, payload) values ($1, $2, $3, $4)`,
      [EVT_MEMORY_READ, e.entityIds, e.summary, JSON.stringify(e.payload)],
    );
  }

  async appendSensitiveAudit(a: SensitiveAccessAudit): Promise<void> {
    await this.exec(
      `insert into public.access_audit (audit_type, actor_identity, actor_type, action, originating_user_id, reason, path_context)
       values ($1, $2, $3, 'retrieval_candidate', $4, $5, $6)`,
      [AUDIT_SENSITIVE_VIEW, a.actorIdentity, a.actorType, a.originatingUserId, `${a.sensitivity} memory ${a.memoryId} surfaced as a retrieval candidate`, a.pathContext],
    );
  }
}

/** Re-export the candidate admission so the smoke can assert the live keyword-arm push-down agrees with the pipeline. */
export { admitsCandidate };
