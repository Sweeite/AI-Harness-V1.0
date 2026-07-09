// ISSUE-030 (C2 MAT) — the LIVE pg adapter for the MaturityStore port. Authored to schema.md §3 (entities.maturity
// numeric(4,3) + maturity_updated_at timestamptz, verify-present from 0001) + §12 config_values + event_log. It is
// the reference model (InMemoryMaturityStore) realised against the real silo. NOT exercised by the offline suite —
// its behaviour is proven by the R10 live-adapter smoke (results/live-smoke.sql, rolled back). Every method mirrors
// an InMemory method 1:1 and both apply the SHARED pure logic (isLiveMemory / computeMaturity / advanceColdStart /
// validateMaturityConfig) so offline + live agree.
//
// LIVE side effects: UPDATE entities.maturity (+ stamp), read entities + their live memories, read/write the
// cold-start latch in config_values['cold_start_mode_deactivated'], and INSERT the loud maturity_recomputed event.
// The maturity_recomputed event_type value is ADDITIVE — it is NOT in the 0001 baseline enum, so a live insert would
// throw '22P02 invalid input value for enum event_type' until the additive migration lands (see index.ts check +
// the manifest). That fake-passes-offline / live-throws class is exactly what R10 + the check gate catch.

import type { Pool } from 'pg';
import type { EntityRow, MemoryRow, ExternalRefs } from '../../memory/src/store.ts';
import {
  type MaturityStore,
  type MaturityConfig,
  type MaturityRecomputed,
  DEFAULT_COLD_START_BASIC,
  DEFAULT_COLD_START_PROACTIVE,
  DEFAULT_COLD_START_FULL,
  DEFAULT_RETRIEVAL_SUFFICIENCY_THRESHOLD,
  validateMaturityConfig,
} from './store.ts';
import { type ColdStartState, INITIAL_COLD_START_STATE, COLD_START_PHASES, ColdStartLatchError, isColdStartPhase } from './coldstart.ts';

/** The additive event_type this adapter emits (see the manifest migration). Kept as a named const so the offline
 *  check gate asserts it exists in the migration corpus before a live write can throw on it. */
export const EVT_MATURITY_RECOMPUTED = 'maturity_recomputed' as const;
export const MATURITY_EVENT_TYPES: readonly string[] = [EVT_MATURITY_RECOMPUTED] as const;

/** The config_values key that persists the cold-start ONE-WAY LATCH across restarts (#1: never forget the latch). */
export const COLD_START_LATCH_KEY = 'cold_start_mode_deactivated' as const;

interface EntityDbRow {
  id: string;
  type: string;
  name: string;
  external_refs: ExternalRefs;
  is_internal_org: boolean;
  maturity: string | null; // numeric → string from pg
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

const ENTITY_COLS = `id, type, name, external_refs, is_internal_org, maturity, maturity_updated_at, created_at`;

export class SupabaseMaturityStore implements MaturityStore {
  constructor(private pool: Pool) {}

  async loadConfig(): Promise<MaturityConfig> {
    const { rows } = await this.pool.query<{ key: string; value: unknown }>(
      `select key, value from config_values where key = any($1)`,
      [['expected_slots', 'cold_start_basic_threshold', 'cold_start_proactive_threshold', 'cold_start_full_threshold', 'retrieval_sufficiency_threshold']],
    );
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    const cfg: MaturityConfig = {
      expectedSlots: (byKey.get('expected_slots') as MaturityConfig['expectedSlots']) ?? {},
      coldStartBasicThreshold: asNumber(byKey.get('cold_start_basic_threshold'), DEFAULT_COLD_START_BASIC),
      coldStartProactiveThreshold: asNumber(byKey.get('cold_start_proactive_threshold'), DEFAULT_COLD_START_PROACTIVE),
      coldStartFullThreshold: asNumber(byKey.get('cold_start_full_threshold'), DEFAULT_COLD_START_FULL),
      retrievalSufficiencyThreshold: asNumber(byKey.get('retrieval_sufficiency_threshold'), DEFAULT_RETRIEVAL_SUFFICIENCY_THRESHOLD),
    };
    validateMaturityConfig(cfg); // reject a drifted/ill-ordered live config LOUD, same guard as the fake
    return cfg;
  }

  async listEntities(): Promise<EntityRow[]> {
    const { rows } = await this.pool.query<EntityDbRow>(`select ${ENTITY_COLS} from entities`);
    return rows.map(toEntityRow);
  }
  async getEntity(id: string): Promise<EntityRow | null> {
    const { rows } = await this.pool.query<EntityDbRow>(`select ${ENTITY_COLS} from entities where id = $1`, [id]);
    return rows[0] ? toEntityRow(rows[0]) : null;
  }

  async liveMemoriesForEntity(id: string, nowMs: number): Promise<MemoryRow[]> {
    // LIVE filter mirrors isLiveMemory exactly: not superseded AND not expired at now. Kept in SQL for efficiency;
    // the pure engine re-applies isLiveMemory (idempotent) so a schema/logic drift is caught, never silently passed.
    const nowIso = new Date(nowMs).toISOString();
    const { rows } = await this.pool.query<MemoryDbRow>(
      `${MEMORY_SELECT} where $1 = any(entity_ids) and superseded_by is null and (expires_at is null or expires_at > $2::timestamptz)`,
      [id, nowIso],
    );
    return rows.map(toMemoryRow);
  }

  async setMaturity(id: string, maturity: number | null, updatedAtIso: string): Promise<void> {
    const { rowCount } = await this.pool.query(
      `update entities set maturity = $2, maturity_updated_at = $3::timestamptz where id = $1`,
      [id, maturity, updatedAtIso],
    );
    if (rowCount === 0) throw new Error(`setMaturity: entity '${id}' not found (0 rows updated)`); // loud, never silent (#3)
  }

  async readColdStartState(): Promise<ColdStartState> {
    const { rows } = await this.pool.query<{ value: unknown }>(`select value from config_values where key = $1 limit 1`, [COLD_START_LATCH_KEY]);
    // NO row → legitimate fresh-deployment default (mode active, nothing learned). A row that EXISTS but is malformed
    // is a CORRUPT latch: fail LOUD + CLOSED rather than silently degrading to 'mode active', which would re-arm the
    // apparatus ADR-002 §2 guarantees never returns (#1 lost decision / #3 silent failure).
    if (rows.length === 0) return { ...INITIAL_COLD_START_STATE };
    const v = rows[0]?.value as Partial<ColdStartState> | null | undefined;
    if (!v || typeof v !== 'object' || typeof v.deactivated !== 'boolean') {
      throw new ColdStartLatchError(
        `persisted cold-start latch '${COLD_START_LATCH_KEY}' is malformed (expected { deactivated: boolean, phase }, got ${JSON.stringify(v)}) — refusing to silently re-arm the one-way latch`,
      );
    }
    if (!isColdStartPhase(v.phase)) {
      throw new ColdStartLatchError(
        `persisted cold-start latch '${COLD_START_LATCH_KEY}' has an invalid phase ${JSON.stringify(v.phase)} — must be one of ${COLD_START_PHASES.join('/')}`,
      );
    }
    return { deactivated: v.deactivated, phase: v.phase };
  }
  async writeColdStartState(state: ColdStartState): Promise<void> {
    // Upsert the latch with a SQL-level ONE-WAY guard: on conflict, `deactivated` is OR'd with the already-persisted
    // value, so a write can NEVER clear it. This defends against a lost update from two INTERLEAVED recomputes (the
    // daily slow loop + the on-write path are independent, ISSUE-030 §8) where one carries a stale `false` computed
    // off a threshold dip — without this guard that write would clobber a committed `true` and re-arm the mode
    // (AC-2.MAT.002.1 / #1). The upsert serialises on the row lock, so the read of the current value is committed.
    // `phase` still takes the incoming value (informational for ISSUE-071).
    await this.pool.query(
      `insert into config_values (key, value) values ($1, $2::jsonb)
       on conflict (key) do update set value = jsonb_set(
         excluded.value,
         '{deactivated}',
         to_jsonb(coalesce((config_values.value->>'deactivated')::bool, false) or (excluded.value->>'deactivated')::bool)
       ), updated_at = now()`,
      [COLD_START_LATCH_KEY, JSON.stringify(state)],
    );
  }

  async emitRecomputed(rec: MaturityRecomputed): Promise<void> {
    // Loud, durable observability (#3). The event_type is the ADDITIVE 'maturity_recomputed' value; a live insert
    // throws 22P02 until the additive migration lands (the check gate + R10 smoke guard this).
    await this.pool.query(
      `insert into event_log (event_type, entity_ids, summary, payload, created_at)
       values ($1::event_type, $2::uuid[], $3, $4::jsonb, now())`,
      [
        EVT_MATURITY_RECOMPUTED,
        [rec.entityId],
        `maturity recomputed (${rec.trigger}) for entity ${rec.entityId}: ${rec.filledCount}/${rec.expectedCount} slots → ${rec.maturity ?? 'n/a'}; aggregate ${rec.aggregate ?? 'n/a'}${rec.coldStartDeactivated ? ' (cold-start off)' : ''}`,
        JSON.stringify(rec),
      ],
    );
  }
}

function asNumber(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^0-9.\-]/g, '')); // tolerate a "20%"-style stored string; strip the unit
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

// ── memories read mapping (mirrors app/memory's toMemoryRow; the classifier needs content, liveness needs
//    superseded_by + expires_at — the full row is mapped so the port's MemoryRow contract holds) ─────────────
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

function parseVector(v: string | null): number[] {
  if (!v) return [];
  const inner = v.trim().replace(/^\[/, '').replace(/\]$/, '');
  if (inner.length === 0) return [];
  return inner.split(',').map(Number);
}
