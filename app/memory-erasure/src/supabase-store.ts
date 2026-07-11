// ISSUE-029 — the live pg adapter for the compliance-erasure walk.
//
//   • SupabaseErasureStore — the ErasureStore over the real memories / access_audit schema (baseline 0001 +
//     memories.derived_from from migration 0045). Every read mirrors the InMemory fake 1:1 (R10). It carries the ONE
//     sanctioned destructive statement against memories (`delete from memories`) — the first + only true delete in
//     the whole system, gated + audited + verified upstream in erase.ts.
//   • SupabaseErasureEventSink — the loud observability sink; emits the additive erasure event_type values (0046).
//
// The fan-out legs (backup-purge flag, C7 log redaction) are NOT implemented here — they are injected ports
// (BackupPurgePort / LogRedactionPort) the live wiring binds to the already-built app/backup-dr + app/log-retention
// adapters (§2 — this slice raises/triggers; those slices own the mechanism). Keeping them as ports keeps this
// adapter's blast radius exactly the memory-side delete + the audit tombstone.

import pg from 'pg';
import type { MemoryRow } from '../../memory/src/store.ts';
import type { AuditEntry, ErasureRow, ErasureStore } from './store.ts';

export type QueryExec = <R extends pg.QueryResultRow>(text: string, params?: unknown[]) => Promise<{ rows: R[]; rowCount?: number | null }>;

// ── Additive event_type values this slice emits (migration 0046). No baseline value fits — an erasure and, above
//    all, a PARTIAL erasure must be loudly + distinctly observable (#3). ──────────────────────────────────────────
export const EVT_MEMORY_ERASED = 'memory_erased';
export const EVT_MEMORY_ERASURE_INCOMPLETE = 'memory_erasure_incomplete';
export const MEMORY_ERASURE_EVENT_TYPES: readonly string[] = [EVT_MEMORY_ERASED, EVT_MEMORY_ERASURE_INCOMPLETE];

/** The columns the walk reads + the OD-204 provenance edge. embedding is selected for row-shape parity (opaque). */
const ERASURE_COLS = `id, type, content, embedding, embedding_model, entity_ids, source, source_ref, confidence,
  visibility, sensitivity, superseded_by, content_hash, idempotency_key, expires_at, created_at, updated_at,
  coalesce(derived_from, '{}'::uuid[]) as derived_from`;

interface ErasureDbRow {
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
  derived_from: string[] | null;
}

function parseVector(v: string | null): number[] {
  if (!v) return [];
  const inner = v.trim().replace(/^\[/, '').replace(/\]$/, '');
  if (inner.length === 0) return [];
  return inner.split(',').map(Number);
}

function toErasureRow(r: ErasureDbRow): ErasureRow {
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
    derived_from: r.derived_from ?? [],
  };
}

export class SupabaseErasureStore implements ErasureStore {
  constructor(private readonly exec: QueryExec) {}

  async resolveTargetMemories(targetEntityId: string): Promise<ErasureRow[]> {
    // the target's Personal rows (any memory_type — episodic evidence + semantic + procedural). $1 = any(entity_ids)
    // mirrors the fake's entity_ids.includes; sensitivity = 'personal' mirrors the tier filter.
    const { rows } = await this.exec<ErasureDbRow>(
      `select ${ERASURE_COLS} from memories where $1::uuid = any(entity_ids) and sensitivity = 'personal'`,
      [targetEntityId],
    );
    return rows.map(toErasureRow);
  }

  async walkSupersededChain(ids: string[]): Promise<ErasureRow[]> {
    if (ids.length === 0) return [];
    // a recursive CTE walking superseded_by in BOTH directions (older ← → newer) to the transitive closure — mirrors
    // the fake's forward+backward BFS. `union` dedupes + terminates; the join follows EITHER edge direction:
    //   forward  (m.id = w.sup): the row w was superseded BY — i.e. w's newer version.
    //   backward (m.superseded_by = w.id): a row that was superseded BY w — i.e. an older version of w.
    const { rows } = await this.exec<ErasureDbRow>(
      `with recursive walk(id, sup) as (
         select id, superseded_by from memories where id = any($1::uuid[])
         union
         select m.id, m.superseded_by from memories m join walk w on (m.id = w.sup or m.superseded_by = w.id)
       )
       select ${ERASURE_COLS} from memories where id in (select id from walk)`,
      [ids],
    );
    return rows.map(toErasureRow);
  }

  async findDerivedFrom(sourceIds: string[]): Promise<ErasureRow[]> {
    if (sourceIds.length === 0) return [];
    // the OD-204 provenance edge — GIN-indexed overlap (memories_derived_from_gin). Mirrors the fake's some(intersect).
    const { rows } = await this.exec<ErasureDbRow>(
      `select ${ERASURE_COLS} from memories where derived_from && $1::uuid[]`,
      [sourceIds],
    );
    return rows.map(toErasureRow);
  }

  async danglingSupersedeRefs(deleteSet: string[]): Promise<string[]> {
    if (deleteSet.length === 0) return [];
    // rows OUTSIDE the delete set whose superseded_by points INTO it — a bulk delete would FK-violate on these.
    const { rows } = await this.exec<{ id: string }>(
      `select id::text as id from memories where superseded_by = any($1::uuid[]) and id <> all($1::uuid[])`,
      [deleteSet],
    );
    return rows.map((r) => r.id);
  }

  async clearSupersededByRefs(deleteSet: string[]): Promise<string[]> {
    if (deleteSet.length === 0) return [];
    // restore-live any row OUTSIDE the delete set whose superseded_by points INTO it — so the bulk delete does not
    // FK-violate AND another subject's source (CAS-superseded into a now-erased shared merge) is not lost (#1).
    const { rows } = await this.exec<{ id: string }>(
      `update memories set superseded_by = null, updated_at = now()
         where superseded_by = any($1::uuid[]) and id <> all($1::uuid[])
         returning id::text as id`,
      [deleteSet],
    );
    return rows.map((r) => r.id);
  }

  async hardDeleteMemories(ids: string[]): Promise<{ deleted: string[] }> {
    if (ids.length === 0) return { deleted: [] };
    // THE sole sanctioned destructive statement against memories in the entire system. A single DELETE removes every
    // matching row (incl. self-referential supersede-chain members) in one statement; embeddings are columns of the
    // row and go with it. `returning id` gives the exact set removed (completeness re-read confirms residual === 0).
    const { rows } = await this.exec<{ id: string }>(
      `delete from memories where id = any($1::uuid[]) returning id::text as id`,
      [ids],
    );
    return { deleted: rows.map((r) => r.id) };
  }

  async countResidual(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const { rows } = await this.exec<{ n: string }>(`select count(*)::text as n from memories where id = any($1::uuid[])`, [ids]);
    return Number(rows[0]?.n ?? 0);
  }

  async writeTombstone(entry: AuditEntry): Promise<void> {
    // the immutable erasure tombstone (schema §2, append-only). after_value carries counts + per-leg status — NO
    // erased PII (AC-7.LOG.006.3). target_entity_id links it to the erased subject; reason is mandatory (Personal).
    await this.exec(
      `insert into access_audit (audit_type, actor_identity, actor_type, action, target_type, target_entity_id, reason, path_context, originating_user_id, after_value)
         values ($1, $2, $3::actor_type, $4, $5, $6::uuid, $7, $8, $9::uuid, $10::jsonb)`,
      [entry.auditType, entry.actorIdentity, entry.actorType, entry.action, entry.targetType, entry.targetEntityId, entry.reason, entry.pathContext, entry.originatingUserId, JSON.stringify(entry.afterValue ?? {})],
    );
  }
}

// ── The loud observability sink — emits event_log with the additive erasure event_type casts. ────────────────────
export class SupabaseErasureEventSink {
  constructor(private readonly exec: QueryExec) {}

  async erasureCompleted(payload: Record<string, unknown>): Promise<void> {
    await this.emit(EVT_MEMORY_ERASED, [String(payload.target ?? '')].filter(Boolean), 'compliance erasure completed', payload);
  }
  async erasureIncomplete(payload: Record<string, unknown>): Promise<void> {
    await this.emit(EVT_MEMORY_ERASURE_INCOMPLETE, [String(payload.target ?? '')].filter(Boolean), 'compliance erasure INCOMPLETE — escalated (partial/failed leg)', payload);
  }
  private async emit(eventType: string, entityIds: string[], summary: string, payload: Record<string, unknown>): Promise<void> {
    await this.exec(
      `insert into event_log (event_type, entity_ids, summary, payload, created_at)
         values ($1::event_type, $2::uuid[], $3, $4::jsonb, now())`,
      [eventType, entityIds, summary, JSON.stringify(payload)],
    );
  }
}
