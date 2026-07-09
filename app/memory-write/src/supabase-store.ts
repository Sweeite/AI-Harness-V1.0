// ISSUE-024 (C2 WRT) — the LIVE pg adapters for the sole-writer path, against the REAL silo DDL:
//   • memories (baseline 0001) — the exclusive write target. Insert is idempotency-keyed (ON CONFLICT DO
//     NOTHING); soft-supersede is CAS (WHERE superseded_by IS NULL); the write runs inside a short txn holding
//     SORTED per-entity advisory locks (pg_advisory_xact_lock(hashtext(eid)) over sorted entity_ids — ADR-004 §2).
//   • memory_conflicts (baseline 0001) — the hard-conflict / mid-task-halt quarantine (state 'pending').
//   • profiles / sensitivity_clearances / restricted_grants — the mid-task authz re-check at the commit boundary
//     (via the injected AuthzReader — SupabaseRlsEnforcementStore, FR-1.RLS.007 / AC-2.WRT.006.3).
//   • event_log / access_audit (baseline 0001) — the loud WRT observability; the write event_types
//     (memory_write_superseded / _conflict / _embed_failed) ship additively in 0039 (a live insert of an
//     unlisted value throws 22P02, which the check gate forbids silently). memory_written + authz_revoked_midtask
//     are baseline.
//
// ⚠️ Verify with the R10 live-adapter smoke (results/live-smoke.sql) before claiming these paths proven. The
// in-memory reference model (commit.ts InMemoryCommitStore) is the proven contract; this adapter must AGREE with
// the real schema (the fake-passes-offline / live-throws class R10 exists to catch).
//
// TOCTOU (#1): the LLM writer runs UNLOCKED; this adapter's commit() is the SINGLE short locked txn where the
// per-entity watermark, idempotency, CAS-supersede, and mid-task authorization are re-validated TOGETHER — the
// only point a write becomes durable, and never on a stale/unauthorized snapshot.

import pg from 'pg';
import {
  buildMemoryRow,
  type CommitStore,
  type CommitInput,
  type CommitResult,
  type WriteEventSink,
  type AuthzReader,
  type SimilarMemoryReader,
} from './commit.ts';
import { classifyConflict, decisionStale } from './contradiction.ts';
import { reevaluate } from '../../rls-enforcement/src/recheck.ts';
import type { MemoryRow } from '../../memory/src/store.ts';
import type { MemoryType } from '../../memory/src/entity-types.ts';

export type QueryExec = <R extends pg.QueryResultRow>(text: string, params?: unknown[]) => Promise<{ rows: R[]; rowCount?: number | null }>;

// ── the WRT event_type values (added additively in migration 0039). The check gate verifies they exist. ──────
export const EVT_MEMORY_WRITTEN = 'memory_written' as const; // baseline
export const EVT_AUTHZ_REVOKED_MIDTASK = 'authz_revoked_midtask' as const; // baseline (OD-170)
export const EVT_WRITE_SUPERSEDED = 'memory_write_superseded' as const; // 0039
export const EVT_WRITE_CONFLICT = 'memory_write_conflict' as const; // 0039
export const EVT_WRITE_EMBED_FAILED = 'memory_write_embed_failed' as const; // 0039
/** Only the ADDITIVE values this slice introduces (the check gate asserts these are in the migration corpus). */
export const WRITE_EVENT_TYPES: readonly string[] = [EVT_WRITE_SUPERSEDED, EVT_WRITE_CONFLICT, EVT_WRITE_EMBED_FAILED] as const;

const LIVE_PRED = `superseded_by is null and (expires_at is null or expires_at > now())`;

/** Serialize a JS number[] embedding into the pgvector literal `[a,b,c]`. */
function vecLiteral(v: number[]): string {
  return `[${v.join(',')}]`;
}

function mapRow(r: Record<string, unknown>): MemoryRow {
  return {
    id: String(r.id),
    type: r.type as MemoryRow['type'],
    content: String(r.content),
    embedding: [], // not read back on the write path (large; the classifier keys on type/entity_ids/content_hash)
    embedding_model: String(r.embedding_model ?? ''),
    entity_ids: (r.entity_ids as string[]) ?? [],
    source: r.source as MemoryRow['source'],
    source_ref: (r.source_ref as string | null) ?? null,
    confidence: r.confidence == null ? null : Number(r.confidence),
    visibility: r.visibility as MemoryRow['visibility'],
    sensitivity: r.sensitivity as MemoryRow['sensitivity'],
    superseded_by: (r.superseded_by as string | null) ?? null,
    content_hash: String(r.content_hash),
    idempotency_key: String(r.idempotency_key),
    expires_at: (r.expires_at as string | null) ?? null,
    created_at: String(r.created_at ?? ''),
    updated_at: String(r.updated_at ?? ''),
  };
}

/** Live "3–5 most similar" reader for the write-path contradiction check: LIVE same-type memories overlapping the
 *  entity set, recent-first, bounded to k. The write-path conflict is same-entity-set/same-type (the classifier
 *  filters to sameEntitySet); vector-nearest ordering is a retrieval (ISSUE-025) refinement, not needed to detect
 *  the supersede/quarantine targets — so this reader is embedding-free + R10-safe. */
const SIMILAR_COLS = `id::text, type::text, content, embedding_model, entity_ids::text[] as entity_ids, source::text, source_ref,
              confidence, visibility::text, sensitivity::text, superseded_by::text, content_hash, idempotency_key,
              expires_at, created_at, updated_at`;

export class SupabaseSimilarReader implements SimilarMemoryReader {
  constructor(private readonly exec: QueryExec) {}
  async findSimilar(entityIds: string[], type: MemoryType, k: number): Promise<MemoryRow[]> {
    const res = await this.exec<Record<string, unknown>>(
      `select ${SIMILAR_COLS} from memories
        where entity_ids && $1::uuid[] and type = $2::memory_type and ${LIVE_PRED}
        order by updated_at desc limit $3`,
      [entityIds, type, k],
    );
    return res.rows.map(mapRow);
  }
  /** Type-agnostic prior context for the Sonnet writer's contradiction judgement (M1) — all live memory types
   *  overlapping the event's context entities, recent-first, bounded to k. */
  async findSimilarForContext(entityIds: string[], k: number): Promise<MemoryRow[]> {
    const res = await this.exec<Record<string, unknown>>(
      `select ${SIMILAR_COLS} from memories
        where entity_ids && $1::uuid[] and ${LIVE_PRED}
        order by updated_at desc limit $2`,
      [entityIds, k],
    );
    return res.rows.map(mapRow);
  }
}

/** Live WriteEventSink for the OUTSIDE-txn writer events (rate-limit defer, embed-failure). The in-txn commit
 *  events are written inline by SupabaseCommitStore. */
export class SupabaseWriteEventSink implements WriteEventSink {
  constructor(private readonly exec: QueryExec) {}
  private async emit(eventType: string, entityIds: string[], summary: string, payload: Record<string, unknown>): Promise<void> {
    await this.exec(
      `insert into event_log (event_type, entity_ids, summary, payload, created_at)
       values ($1::event_type, $2::uuid[], $3, $4::jsonb, now())`,
      [eventType, entityIds, summary, JSON.stringify(payload)],
    );
  }
  async memoryWritten(p: Record<string, unknown>): Promise<void> {
    const evt = p.embed_failed ? EVT_WRITE_EMBED_FAILED : EVT_MEMORY_WRITTEN;
    await this.emit(evt, [], p.embed_failed ? 'memory write halted — embedding failure' : 'memory written', p);
  }
  async superseded(p: Record<string, unknown>): Promise<void> {
    await this.emit(EVT_WRITE_SUPERSEDED, [], 'memory soft-superseded', p);
  }
  async conflictQuarantined(p: Record<string, unknown>): Promise<void> {
    await this.emit(EVT_WRITE_CONFLICT, [], 'memory hard-conflict quarantined', p);
  }
  async authzHalted(p: Record<string, unknown>): Promise<void> {
    await this.emit(EVT_AUTHZ_REVOKED_MIDTASK, [], 'memory write halted — mid-task authorization revoked', p);
  }
}

export interface SupabaseCommitDeps {
  authz: AuthzReader;
  reviewEscalationDays?: number;
  similarK?: number;
}

/** The live CommitStore — the ADR-004 §3 validate-and-commit against the real memories/memory_conflicts schema. */
export class SupabaseCommitStore implements CommitStore {
  private pool: pg.Pool | null = null;
  private readonly exec: QueryExec;
  private readonly reviewEscalationDays: number;
  private readonly similarK: number;

  constructor(
    connectionString: string,
    private readonly deps: SupabaseCommitDeps,
    execOverride?: QueryExec,
  ) {
    this.reviewEscalationDays = deps.reviewEscalationDays ?? 7;
    this.similarK = deps.similarK ?? 5;
    if (execOverride) {
      this.exec = execOverride;
    } else {
      const ssl = /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: false };
      const pool = new pg.Pool({ connectionString, ssl });
      this.pool = pool;
      this.exec = (text, params) => pool.query(text, params);
    }
  }

  async readWatermark(entityIds: string[]): Promise<number> {
    const r = await this.exec<{ w: string | null }>(
      `select coalesce(extract(epoch from max(updated_at)), 0)::text as w from memories where entity_ids && $1::uuid[]`,
      [entityIds],
    );
    return Number(r.rows[0]?.w ?? 0);
  }

  /** Run fn in a real single-client txn (pool.query would spread statements across connections, breaking both the
   *  advisory-lock scope and atomicity). Against an injected exec (tests) it emits begin/commit/rollback so the
   *  wrapping is observable. */
  private async withTx<T>(fn: (tx: QueryExec) => Promise<T>): Promise<T> {
    if (this.pool) {
      const client = await this.pool.connect();
      try {
        await client.query('begin');
        const bound: QueryExec = (text, params) => client.query(text, params);
        const r = await fn(bound);
        await client.query('commit');
        return r;
      } catch (e) {
        await client.query('rollback').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    }
    await this.exec('begin');
    try {
      const r = await fn(this.exec);
      await this.exec('commit');
      return r;
    } catch (e) {
      await this.exec('rollback').catch(() => {});
      throw e;
    }
  }

  async commit(input: CommitInput): Promise<CommitResult> {
    const { draft, task } = input;
    return this.withTx(async (tx) => {
      // [1] SORTED per-entity advisory locks (deadlock-free — every txn acquires in the same order, ADR-004 §2).
      const sorted = [...new Set(draft.entity_ids)].sort();
      for (const eid of sorted) {
        await tx(`select pg_advisory_xact_lock(hashtext($1)::int8)`, [eid]);
      }

      // [2] mid-task authz re-check at the commit boundary (FR-1.RLS.007 / AC-2.WRT.006.3). The commit IS the
      //     consequential side effect. Read LIVE authz (via the injected reader) → reevaluate → halt+quarantine if
      //     revoked/deactivated; a benign session-expiry (still active, grants held) does NOT halt.
      const current = await this.deps.authz.loadOriginatingAuthz(task.originatingUserId);
      const reeval = reevaluate(current, task.reliedOn);
      if (!reeval.authorized) {
        const conflictId = await this.quarantine(tx, draft, [], `authz_revoked_midtask:${reeval.stopReason}`);
        await this.emit(tx, EVT_AUTHZ_REVOKED_MIDTASK, draft.entity_ids, 'memory write halted — mid-task authorization revoked', {
          task_id: task.taskId, originating_user_id: task.originatingUserId, stop_reason: reeval.stopReason, detail: reeval.detail, quarantine_id: conflictId,
        });
        // M4: if the user is unauthorized because the profile is GONE (reader returned null), the FK insert with
        // a dangling id would throw + roll back the quarantine. Deactivation ≠ delete (FR-1.USR.002), so this is an
        // edge — but audit with a NULL originating_user_id (nullable column; the id survives in the event payload).
        const auditOriginating = current ? task.originatingUserId : null;
        await this.audit(tx, 'authz_revoked_midtask', task.serviceRoleIdentity, `halt_and_quarantine:memory_write`, auditOriginating, reeval.detail, task.taskId);
        return { status: 'halted', memoryId: null, superseded: [], conflictId, reeval, rewrote: false } as CommitResult;
      }

      // [3] re-read the watermark; re-check the decision only if it moved (ADR-004 §3 — cheap DB re-check, no LLM).
      let decision = input.decision;
      let rewrote = false;
      const v1 = await this.readWatermarkTx(tx, draft.entity_ids);
      if (v1 !== input.watermarkV0) {
        const currentSimilar = await new SupabaseSimilarReader(tx).findSimilar(draft.entity_ids, draft.type, this.similarK);
        if (decisionStale(input.candidate, currentSimilar, decision.targetIds)) {
          decision = classifyConflict(input.candidate, currentSimilar);
          rewrote = true;
        }
      }

      // [3b] HARD conflict → quarantine, never write to the live set (AC-2.WRT.002.2).
      if (decision.kind === 'hard') {
        const conflictId = await this.quarantine(tx, draft, decision.targetIds, decision.reason);
        await this.emit(tx, EVT_WRITE_CONFLICT, draft.entity_ids, 'memory hard-conflict quarantined', {
          task_id: task.taskId, conflict_id: conflictId, conflicting_memory_ids: decision.targetIds, reason: decision.reason, on_race: rewrote,
        });
        return { status: 'quarantined', memoryId: null, superseded: [], conflictId, rewrote } as CommitResult;
      }

      // [4] idempotency-keyed insert (ON CONFLICT DO NOTHING). A retried step is a no-op, never a duplicate.
      const row = buildMemoryRow(draft, '00000000-0000-0000-0000-000000000000', new Date().toISOString());
      const ins = await tx<{ id: string }>(
        `insert into memories (type, content, embedding, embedding_model, entity_ids, source, source_ref, confidence,
                               visibility, sensitivity, content_hash, idempotency_key, expires_at)
         values ($1::memory_type, $2, $3::vector, $4, $5::uuid[], $6::memory_source, $7, $8, $9::visibility_tier,
                 $10::sensitivity_tier, $11, $12, $13)
         on conflict (idempotency_key) do nothing
         returning id::text as id`,
        [row.type, row.content, vecLiteral(row.embedding), row.embedding_model, row.entity_ids, row.source, row.source_ref,
         row.confidence, row.visibility, row.sensitivity, row.content_hash, row.idempotency_key, row.expires_at],
      );
      if (ins.rowCount === 0) {
        // idempotent retry — the key already existed. Fetch the existing id (the winner's row).
        const existing = await tx<{ id: string }>(`select id::text as id from memories where idempotency_key = $1`, [row.idempotency_key]);
        return { status: 'noop', memoryId: existing.rows[0]?.id ?? null, superseded: [], conflictId: null, rewrote } as CommitResult;
      }
      const memoryId = ins.rows[0]!.id;

      // [4b] CAS-supersede soft targets WHERE superseded_by IS NULL (a lost race affects 0 rows → dropped).
      const superseded: string[] = [];
      if (decision.kind === 'soft' && decision.targetIds.length > 0) {
        const upd = await tx<{ id: string }>(
          `update memories set superseded_by = $1::uuid, updated_at = now()
            where id = any($2::uuid[]) and superseded_by is null
            returning id::text as id`,
          [memoryId, decision.targetIds],
        );
        for (const r of upd.rows) superseded.push(r.id);
        if (superseded.length > 0) {
          await this.emit(tx, EVT_WRITE_SUPERSEDED, draft.entity_ids, 'memory soft-superseded', { task_id: task.taskId, memory_id: memoryId, superseded, on_race: rewrote });
        }
      }

      // [4c] agent-path access audit for Personal/Restricted-sensitivity writes (FR-1.AUD.001 / AF-081 coverage).
      if (draft.sensitivity === 'personal' || draft.sensitivity === 'restricted') {
        await this.audit(tx, 'memory_write', task.serviceRoleIdentity, `write:${draft.sensitivity}`, task.originatingUserId, null, task.taskId);
      }
      await this.emit(tx, EVT_MEMORY_WRITTEN, draft.entity_ids, 'memory written', { task_id: task.taskId, memory_id: memoryId, type: row.type, source: row.source, superseded_count: superseded.length });
      return { status: 'committed', memoryId, superseded, conflictId: null, rewrote } as CommitResult;
    });
  }

  private async readWatermarkTx(tx: QueryExec, entityIds: string[]): Promise<number> {
    const r = await tx<{ w: string | null }>(
      `select coalesce(extract(epoch from max(updated_at)), 0)::text as w from memories where entity_ids && $1::uuid[]`,
      [entityIds],
    );
    return Number(r.rows[0]?.w ?? 0);
  }

  private async quarantine(tx: QueryExec, draft: CommitInput['draft'], conflictingIds: string[], _reason: string): Promise<string> {
    const { embedding: _omit, ...pending } = draft;
    const r = await tx<{ id: string }>(
      `insert into memory_conflicts (new_memory, conflicting_memory_ids, state)
       values ($1::jsonb, $2::uuid[], 'pending') returning id::text as id`,
      [JSON.stringify(pending), conflictingIds],
    );
    return r.rows[0]!.id;
  }

  private async emit(tx: QueryExec, eventType: string, entityIds: string[], summary: string, payload: Record<string, unknown>): Promise<void> {
    await tx(
      `insert into event_log (event_type, entity_ids, summary, payload, created_at)
       values ($1::event_type, $2::uuid[], $3, $4::jsonb, now())`,
      [eventType, entityIds, summary, JSON.stringify(payload)],
    );
  }

  private async audit(tx: QueryExec, auditType: string, actorIdentity: string, action: string, originatingUserId: string | null, reason: string | null, pathContext: string): Promise<void> {
    await tx(
      `insert into access_audit (audit_type, actor_identity, actor_type, action, originating_user_id, reason, path_context)
       values ($1, $2, 'agent', $3, $4, $5, $6)`,
      [auditType, actorIdentity, action, originatingUserId, reason, pathContext],
    );
  }

  async escalateOverdueConflicts(now: number = Date.now()): Promise<string[]> {
    // AC-2.WRT.002.3 — escalate hard conflicts un-actioned past CFG-review_escalation_days (alert + badge), never
    // auto-resolving. state 'pending' → 'escalated' + stamp escalated_at. (ISSUE-028 drives + renders this.)
    // M3: the state change AND its loud events run in ONE txn — a crash between them must never escalate silently
    // (#3) nor split statements across pooled connections.
    void now;
    return this.withTx(async (tx) => {
      const r = await tx<{ id: string }>(
        `update memory_conflicts set state = 'escalated', escalated_at = now()
          where state = 'pending' and created_at <= now() - ($1 || ' days')::interval
          returning id::text as id`,
        [String(this.reviewEscalationDays)],
      );
      const ids = r.rows.map((x) => x.id);
      for (const id of ids) {
        await this.emit(tx, EVT_WRITE_CONFLICT, [], 'hard conflict escalated (overdue past review_escalation_days)', { conflict_id: id, escalated: true });
      }
      return ids;
    });
  }

  async close(): Promise<void> {
    await this.pool?.end();
  }
}
