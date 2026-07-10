// ISSUE-026 (C2 ING) — the LIVE pg adapter for the IngestionStore + ObservabilitySink + MemoryVerificationSink ports,
// against the REAL silo DDL (0001 baseline):
//   • ingestion_queue — enqueue / read / the SINGLE logged state-transition / deferred auto-resurface. `state` is the
//     ingestion_state enum {pending,deferred,included,excluded,shadow_dropped}; there is no other mutation path (the
//     queue-exit-only-via-a-logged-decision invariant is realised by `transition` being the only UPDATE, AC-2.ING.003.2).
//   • entities — Pipeline 1 creates entities with external_refs (points, never copies).
//   • access_audit (append-only) — every Include/Exclude/Defer + sensitive view (who/when/why, FR-2.ING.003).
//   • event_log (append-only) — Filter-1/2 decisions + the sampled-drop audit run (Haiku decision log / FR-2.MNT.015),
//     and the un-actioned escalation signal.
//   • memories — the human-verify bump to confidence 1.0 / human_verified (AC-2.ING.009.2): an UPDATE of an EXISTING
//     row (a human confirming already-written knowledge — reconciliation #3's carve-out), never an insert. Ingestion
//     NEVER inserts a memory — that is the sole writer's job; an Include hands off to it (no-backdoor, FR-2.ING.010).
//
// ⚠️ MIGRATION DEPENDENCY (report to the orchestrator; the offline fake is unaffected): the event_type enum in the
// 0001 baseline does NOT yet carry 'ingestion_filtered'. The escalation signal reuses the EXISTING
// 'approval_queue_stale' value (a stale review queue). Until the additive 'ingestion_filtered' value is applied, a
// live filterDecision/auditRun insert would throw 22P02 — the `check` gate asserts 'approval_queue_stale' is present
// (it is) and documents 'ingestion_filtered' as the pending additive migration (R10: authored+applied serially).
//
// ⚠️ Verify with the R10 live-adapter smoke before claiming these paths proven — the in-memory reference model
// (store.ts) is the proven contract; this adapter must AGREE with the real schema.

import pg from 'pg';
import type { EntityInput, EntityRow } from '../../memory/src/store.ts';
import type {
  AuditRunSample,
  DecisionPatch,
  EscalationSample,
  FilterDecisionSample,
  IngestionAudit,
  IngestionStore,
  MemoryVerificationSink,
  NewQueueRow,
  ObservabilitySink,
  QueueRow,
} from './store.ts';

/** NEW event_type value this adapter writes for Filter-1/2 decisions + the sampled-drop audit run (pending additive
 *  migration — see the header note; the offline fake needs no enum). */
export const EVT_INGESTION_FILTERED = 'ingestion_filtered' as const;
/** EXISTING event_type reused for the un-actioned-escalation signal (a stale review queue — 0001 baseline enum). */
export const EVT_QUEUE_STALE = 'approval_queue_stale' as const;
/** The access_audit audit_type conventions for the human queue decisions + sensitive views (free-text column). */
export const AUDIT_INGESTION_DECISION = 'ingestion_decision' as const;

export type QueryExec = <R extends pg.QueryResultRow>(text: string, params?: unknown[]) => Promise<{ rows: R[]; rowCount?: number | null }>;

interface QueueDbRow {
  id: string;
  content: string;
  source_ref: string | null;
  flag_reason: string | null;
  suggested_tier: QueueRow['suggested_tier'];
  target_entity_id: string | null;
  state: QueueRow['state'];
  deferred_until: Date | null;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  decision_reason: string | null;
  created_at: Date;
}

const QUEUE_COLS = `id, content, source_ref, flag_reason, suggested_tier, target_entity_id, state, deferred_until,
  reviewed_by, reviewed_at, decision_reason, created_at`;

function toQueueRow(r: QueueDbRow): QueueRow {
  return {
    id: r.id,
    content: r.content,
    source_ref: r.source_ref,
    flag_reason: r.flag_reason,
    suggested_tier: r.suggested_tier,
    target_entity_id: r.target_entity_id,
    state: r.state,
    deferred_until: r.deferred_until ? r.deferred_until.toISOString() : null,
    reviewed_by: r.reviewed_by,
    reviewed_at: r.reviewed_at ? r.reviewed_at.toISOString() : null,
    decision_reason: r.decision_reason,
    created_at: r.created_at.toISOString(),
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

export class SupabaseIngestionStore implements IngestionStore, ObservabilitySink, MemoryVerificationSink {
  private pool: pg.Pool | null = null;
  private readonly exec: QueryExec;

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

  // ── ingestion_queue ─────────────────────────────────────────────────────────────────────────────────────────────
  async enqueue(row: NewQueueRow): Promise<QueueRow> {
    const { rows } = await this.exec<QueueDbRow>(
      `insert into public.ingestion_queue (content, source_ref, flag_reason, suggested_tier, target_entity_id, state, deferred_until, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, coalesce($8::timestamptz, now()))
       returning ${QUEUE_COLS}`,
      [row.content, row.source_ref, row.flag_reason, row.suggested_tier, row.target_entity_id, row.state, row.deferred_until ?? null, row.created_at ?? null],
    );
    return toQueueRow(rows[0]!);
  }

  async getQueueRow(id: string): Promise<QueueRow | null> {
    const { rows } = await this.exec<QueueDbRow>(`select ${QUEUE_COLS} from public.ingestion_queue where id = $1`, [id]);
    return rows[0] ? toQueueRow(rows[0]) : null;
  }

  async listActionable(): Promise<QueueRow[]> {
    const { rows } = await this.exec<QueueDbRow>(
      `select ${QUEUE_COLS} from public.ingestion_queue where state in ('pending','deferred') order by created_at asc, id asc`,
    );
    return rows.map(toQueueRow);
  }

  async listAll(): Promise<QueueRow[]> {
    const { rows } = await this.exec<QueueDbRow>(`select ${QUEUE_COLS} from public.ingestion_queue`);
    return rows.map(toQueueRow);
  }

  /** The SINGLE state-transition. The `where state in ('pending','deferred')` clause makes the queue-exit invariant a
   *  DB-level guard: a terminal row updates 0 rows (never silently re-decided). A 0-row update throws LOUD (#3). */
  async transition(id: string, patch: DecisionPatch): Promise<QueueRow> {
    const { rows } = await this.exec<QueueDbRow>(
      `update public.ingestion_queue
          set state = $2, reviewed_by = $3, reviewed_at = $4::timestamptz, decision_reason = $5,
              deferred_until = case when $2 = 'deferred' then $6::timestamptz else null end
        where id = $1 and state in ('pending','deferred')
        returning ${QUEUE_COLS}`,
      [id, patch.state, patch.reviewedBy, patch.reviewedAt, patch.decisionReason, patch.deferredUntil ?? null],
    );
    if (!rows[0]) {
      throw new Error(`ingestion_queue ${id}: transition matched 0 rows — row missing or terminal (queue-exit invariant, AC-2.ING.003.2)`);
    }
    return toQueueRow(rows[0]);
  }

  async resurfaceDeferred(nowIso: string): Promise<string[]> {
    const { rows } = await this.exec<{ id: string }>(
      `update public.ingestion_queue set state = 'pending', deferred_until = null
        where state = 'deferred' and deferred_until is not null and deferred_until <= $1::timestamptz
        returning id`,
      [nowIso],
    );
    return rows.map((r) => r.id);
  }

  // ── entities (Pipeline 1) ───────────────────────────────────────────────────────────────────────────────────────
  async insertEntity(input: EntityInput): Promise<EntityRow> {
    const { rows } = await this.exec<EntityDbRow>(
      `insert into public.entities (type, name, external_refs, is_internal_org)
       values ($1, $2, $3::jsonb, $4)
       returning id, type, name, external_refs, is_internal_org, maturity, maturity_updated_at, created_at`,
      [input.type, input.name, JSON.stringify(input.external_refs ?? {}), input.is_internal_org ?? false],
    );
    return toEntityRow(rows[0]!);
  }

  // ── access_audit (append-only) ──────────────────────────────────────────────────────────────────────────────────
  async appendAudit(a: IngestionAudit): Promise<void> {
    await this.exec(
      `insert into public.access_audit (audit_type, actor_identity, actor_type, target_entity_id, action, reason, originating_user_id, path_context)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        a.auditType,
        a.actorIdentity,
        a.actorType,
        a.targetEntityId,
        a.action,
        a.reason,
        a.reviewerUserId,
        a.tier != null ? `tier=${a.tier}` : null,
      ],
    );
  }

  // ── ObservabilitySink (event_log, append-only) ──────────────────────────────────────────────────────────────────
  async filterDecision(s: FilterDecisionSample): Promise<void> {
    await this.exec(
      `insert into public.event_log (event_type, entity_ids, summary, payload) values ($1, $2, $3, $4::jsonb)`,
      [
        EVT_INGESTION_FILTERED,
        s.targetEntityId ? [s.targetEntityId] : [],
        `filter ${s.filter}: ${s.verdict}`,
        JSON.stringify({ kind: 'filter_decision', filter: s.filter, verdict: s.verdict, reason: s.reason }),
      ],
    );
  }

  async auditRun(s: AuditRunSample): Promise<void> {
    await this.exec(
      `insert into public.event_log (event_type, entity_ids, summary, payload) values ($1, $2, $3, $4::jsonb)`,
      [
        EVT_INGESTION_FILTERED,
        [],
        `filter-1 sampled-drop audit ${s.window}: ${s.reviewed}/${s.totalDrops} reviewed${s.missed ? ' (MISSED)' : ''}`,
        JSON.stringify({ kind: 'audit_run', ...s }),
      ],
    );
  }

  async escalation(s: EscalationSample): Promise<void> {
    await this.exec(
      `insert into public.event_log (event_type, entity_ids, summary, payload) values ($1, $2, $3, $4::jsonb)`,
      [
        EVT_QUEUE_STALE,
        [],
        `ingestion_queue ${s.queueId} un-actioned ${s.ageDays}d — escalated`,
        JSON.stringify({ kind: 'ingestion_escalation', queue_id: s.queueId, age_days: s.ageDays, created_at: s.createdAt }),
      ],
    );
  }

  // ── MemoryVerificationSink (the audited human-verify bump — reconciliation #3) ──────────────────────────────────
  async markVerified(memoryId: string, reviewer: string): Promise<{ memoryId: string; confidence: number; source: string }> {
    // UPDATE of an EXISTING memory (a human confirming already-written knowledge) — NOT an insert. Ingestion never
    // creates a memory. WHERE id + returning proves the row existed; a 0-row match throws LOUD (never a silent no-op, #3).
    const { rows } = await this.exec<{ id: string; confidence: string | null; source: string }>(
      `update public.memories set confidence = 1.0, source = 'human_verified', updated_at = now()
        where id = $1 returning id, confidence, source`,
      [memoryId],
    );
    if (!rows[0]) throw new Error(`memories ${memoryId}: verification matched 0 rows (memory missing) — cannot confirm a non-existent memory`);
    await this.exec(
      `insert into public.access_audit (audit_type, actor_identity, actor_type, action, reason)
       values ('ingestion_decision', $1, 'user', 'verify', $2)`,
      [reviewer, `human_verified memory ${memoryId} → confidence 1.0`],
    );
    return { memoryId: rows[0].id, confidence: Number(rows[0].confidence), source: rows[0].source };
  }
}
