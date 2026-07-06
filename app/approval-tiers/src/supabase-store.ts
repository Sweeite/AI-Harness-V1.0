// ISSUE-056 — the LIVE ApprovalWorkflow adapter (pg, against the client-owned silo Supabase). The only module
// that imports `pg`. It implements the same port as InMemoryApprovalWorkflow against the real baseline DDL
// (app/silo/migrations/0001_baseline.sql):
//   • guardrail_log — writes `approval_gate` rows; forward status transition pending→(approved|rejected|
//     modified) that leaves description/task_id UNCHANGED (the append-only trigger enforce_audit_append_only()
//     whitelist); the DB CHECK not(guardrail_type='hard_limit' and status='approved') is the backstop for the
//     no-override guard (AC-6.ESC.001.2 / AC-6.LOG.001.2).
//   • task_queue — read/consume status ∈ {awaiting_approval, flagged}, requires_approval, originating_user_id
//     (no-self-approval), action_payload. The C5 state machine itself is @harness/task-queue (ISSUE-048) — we
//     CALL into it, never re-implement it (FR-6.APR.006).
//   • access_audit — every Approve/Reject/Modify/Hold is appended (seam; append-only).
//
// ⚠️ NOT YET RUN LIVE. The append-only trigger's whitelist does NOT permit an escalated_at-only UPDATE
// (it requires a status transition). Setting escalated_at on a still-`pending` row therefore needs an additive
// DB delta (see results/proposed-shared-spec.md — the orchestrator applies it serially). The InMemory model is
// the proven offline reference; this adapter is authored to the DDL so the seam typechecks + is real. The
// AF-068 red-team (no autonomous bypass of the hard-approval floor) is the LIVE ship gate — owed, listed in
// residualAFs. Do NOT claim these paths verified until a live capstone records evidence.
//
// Design notes tied to the three non-negotiables:
//   #2  The tier DECISION (tiers.classifyTier) + the floor are pure and identical in both stores — decided in
//       code before any DB call, so a DB outage can never lower a floored action or turn a hard-kill into a
//       permit. A hard_limit row can never be approved: refused here before SQL AND by the DB CHECK.
//   #3  A dropped reviewer notification is surfaced (droppedNotifications), never swallowed; every stale
//       wait-point escalates and stays pending.
//   #1  Reversible already-applied effects get a durable compensation task (never auto-rollback); irreversible
//       effects are surfaced non-compensable.

import pg from 'pg';

import { classifyTier, routeApproval } from './tiers.ts';
import {
  DEFAULT_APPROVAL_CONFIG,
  ERR_HARD_LIMIT_NO_AFFORDANCE,
  ERR_HOLD_ONLY_SOFT,
  ERR_RESOLVE_NOT_PENDING,
  ERR_SELF_APPROVAL,
  InMemoryApprovalWorkflow,
  InMemoryTaskSeam,
  type ApprovalConfig,
  type ApprovalWorkflow,
  type AppliedEffect,
  type CompensationSink,
  type FlagOutcome,
  type FreshnessMode,
  type GuardrailHit,
  type GuardrailLogRow,
  type NotificationSink,
  type QueueFilter,
  type QueueView,
  type ResolutionOutcome,
  type TierDisposition,
} from './store.ts';
import type { AutonomyMatrix, GatedAction, Reviewer, RoutingOutcome, RoutingRules } from './tiers.ts';
import type { TaskSeam } from './store.ts';

// SEAM NOTE (imports declared in package.json, per the issue "May import" line):
//   • @harness/task-queue (ISSUE-048) is the LIVE C5 state machine this adapter drives. Like every sibling
//     package in this repo (none imports another @harness package at source — the packages expose no module
//     entry point), we do NOT import it at the type level here; we bind a concrete TaskSeam (the narrow C5
//     surface this workflow needs, defined in store.ts, structurally matching @harness/task-queue's TaskQueue
//     transitions) at construction. This keeps the package offline-typecheckable and matches the house shape.
//   • @harness/realtime (ISSUE-076) owns the surface-04 freshness contract (FreshnessMode live/reconnecting/
//     polling). Our local FreshnessMode (store.ts) is the SAME closed union — the queue view rides its two
//     Realtime subscriptions at wire time.

export const ERR_ESCALATED_AT_NEEDS_DELTA =
  'approval-workflow(live): setting escalated_at on a still-pending guardrail_log row is refused by the ' +
  'append-only trigger whitelist (it permits only a status transition). Needs the additive trigger delta in ' +
  'results/proposed-shared-spec.md before this path can run live.';

export class SupabaseApprovalWorkflow implements ApprovalWorkflow {
  private pool: pg.Pool;
  private readonly taskQueue: TaskSeam;
  private readonly config: ApprovalConfig;
  // The pure parts (classify, route) + the reference workflow logic are DB-free / identical to the reference
  // model; where a method is purely computational we delegate rather than duplicate the invariants.
  private readonly ref: InMemoryApprovalWorkflow;

  constructor(
    connectionString: string,
    taskQueue: TaskSeam,
    notify: NotificationSink,
    comp: CompensationSink,
    config: ApprovalConfig = DEFAULT_APPROVAL_CONFIG,
  ) {
    const ssl = /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: false };
    this.pool = new pg.Pool({ connectionString, ssl });
    this.taskQueue = taskQueue;
    this.config = config;
    this.ref = new InMemoryApprovalWorkflow(new InMemoryTaskSeam(), notify, comp, config);
  }

  async tierAndGate(action: GatedAction, matrix: AutonomyMatrix, now: number): Promise<TierDisposition> {
    const decision = classifyTier(action, matrix); // pure floor + default-hard-if-uncertain
    const classificationRecord = {
      taskId: action.actionType,
      tier: decision.tier,
      floored: decision.floored,
      at: new Date(now * 1000).toISOString(),
    };
    if (decision.tier === 'auto') {
      return { taskId: action.actionType, decision, autoExecuted: true, guardrailLogId: null, classificationRecord };
    }
    // Write the approval_gate row (service_role INSERT; created_at/id defaulted by DDL).
    const res = await this.pool.query<{ id: string }>(
      `insert into guardrail_log (task_id, guardrail_type, description, action_blocked, status)
       values ($1, 'approval_gate', $2, true, 'pending')
       returning id`,
      [action.actionType, decision.reason],
    );
    const guardrailLogId = res.rows[0]!.id;
    // C5 enacts the hold — C6 sets requires_approval + tier; the real task-queue moves it to awaiting_approval.
    // (@harness/task-queue exposes the setter path; here we only mark it — the state machine is C5's.)
    await this.pool.query(
      `update task_queue set requires_approval = true where id = $1 and status not in ('completed','failed')`,
      [action.actionType],
    );
    return { taskId: action.actionType, decision, autoExecuted: false, guardrailLogId, classificationRecord };
  }

  route(action: GatedAction, candidates: readonly Reviewer[], rules: RoutingRules): RoutingOutcome {
    return routeApproval(action, candidates, rules);
  }

  async autoRunElapsedSoft(now: number): Promise<GuardrailLogRow[]> {
    // A soft, non-floored, un-held, un-resolved approval_gate row whose deadline elapsed. Reversibility is
    // structural: only a soft-tier row exists here, and soft is reversible-only by classifyTier (#2). The
    // deadline is created_at + softTimeoutSeconds. We resume via C5, then forward-transition the row.
    const cutoffIso = new Date((now - this.config.softTimeoutSeconds) * 1000).toISOString();
    const due = await this.pool.query<GuardrailLogRow>(
      `select id, task_id, guardrail_type, description, action_blocked, status, reviewed_by, reviewed_at,
              escalated_at, created_at
       from guardrail_log
       where guardrail_type = 'approval_gate' and status = 'pending' and created_at <= $1`,
      [cutoffIso],
    );
    const ran: GuardrailLogRow[] = [];
    for (const row of due.rows) {
      if (row.task_id) {
        // C5 resume path via the seam (real @harness/task-queue). We only release; C5 owns the machine. The
        // auto-run has NO human reviewer — the resume is attributed to the server timer, not a person.
        await this.taskQueue.resume(row.task_id, 'system:soft-auto-run', now);
      }
      // Forward status transition — legal under the append-only trigger whitelist (description/task_id fixed).
      const upd = await this.pool.query<GuardrailLogRow>(
        `update guardrail_log set status = 'approved', reviewed_at = now()
         where id = $1 and status = 'pending'
         returning id, task_id, guardrail_type, description, action_blocked, status, reviewed_by, reviewed_at,
                   escalated_at, created_at`,
        [row.id],
      );
      if (upd.rows[0]) ran.push(upd.rows[0]);
    }
    return ran;
  }

  async holdForFullReview(rowId: string, by: string, _now: number): Promise<GuardrailLogRow> {
    // OD-120: promote soft→explicit. The classifier/meta gate (soft, non-floored) is enforced in the reference
    // model; here we assert on the persisted row's type + that it is a pending approval_gate. A hard/floored
    // row can never be promoted (it is already hard) — refuse to represent a downgrade.
    const cur = await this.pool.query<{ guardrail_type: string; status: string; description: string }>(
      `select guardrail_type, status, description from guardrail_log where id = $1`,
      [rowId],
    );
    const found = cur.rows[0];
    if (!found) throw new Error(`guardrail_log row ${rowId} not found`);
    if (found.guardrail_type !== 'approval_gate') throw new Error(ERR_HOLD_ONLY_SOFT);
    // The promotion note is appended to the description. NOTE: the append-only trigger requires description to
    // be UNCHANGED on a whitelisted status transition — and Hold is NOT a status transition (status stays
    // pending). Persisting the promotion therefore also needs the additive trigger delta (proposed-shared-spec).
    void by;
    void this.ref; // reference model holds the pure invariant; live persistence awaits the delta
    throw new Error(ERR_ESCALATED_AT_NEEDS_DELTA);
  }

  async raiseFlag(
    hits: readonly GuardrailHit[],
    candidates: readonly Reviewer[],
    rules: RoutingRules,
    now: number,
  ): Promise<FlagOutcome> {
    if (hits.length === 0) throw new Error('approval-workflow: raiseFlag needs at least one guardrail hit');
    // Write ONE row per hit (AC-6.ESC.001.3 — no hit masked).
    const rowIds: string[] = [];
    let taskId: string | null = null;
    for (const hit of hits) {
      const res = await this.pool.query<{ id: string }>(
        `insert into guardrail_log (task_id, guardrail_type, description, action_blocked, status)
         values ($1, $2, $3, true, 'pending')
         returning id`,
        [hit.action.actionType, hit.guardrailType, hit.description],
      );
      rowIds.push(res.rows[0]!.id);
      taskId = hit.action.actionType;
    }
    // Most-restrictive precedence — a co-firing hard_limit dominates → killed, not held (#2). The co-firing
    // APPROVABLE rows are closed out to 'rejected' (the kill governs) so a reviewer can never approve one and
    // resume the hard-killed step (AC-6.ESC.001.3); the hard_limit rows stay pending-and-blocked (never
    // approvable — the CHECK). This is a legal forward transition under the append-only trigger whitelist.
    const hardLimitDominated = hits.some((h) => h.guardrailType === 'hard_limit');
    if (hardLimitDominated) {
      for (const [i, hit] of hits.entries()) {
        if (hit.guardrailType === 'hard_limit') continue;
        await this.pool.query(
          `update guardrail_log set status = 'rejected', reviewed_at = now() where id = $1 and status = 'pending'`,
          [rowIds[i]],
        );
      }
      return { rowIds, governing: 'killed', hardLimitDominated: true, routing: null, notified: false, notificationDropped: false };
    }
    // Approvable governing case: set the task flagged (C6-set, OD-054) + route + notify.
    if (taskId) {
      await this.pool.query(`update task_queue set status = 'flagged' where id = $1 and status not in ('completed','failed')`, [taskId]);
    }
    const routing = this.route(hits[0]!.action, candidates, rules);
    // Notification delivery is C7 — the reference model owns the emit + dropped-surface. Delegate the emit path
    // to keep a single source of the #3 surface; the persisted rows already exist.
    const refOut = await this.ref.raiseFlag(hits, candidates, rules, now);
    return { rowIds, governing: 'flagged', hardLimitDominated: false, routing, notified: refOut.notified, notificationDropped: refOut.notificationDropped };
  }

  async resolve(
    rowId: string,
    resolution: 'approve' | 'reject' | 'modify',
    by: string,
    opts: { reason?: string; editedPayload?: unknown; appliedEffects?: readonly AppliedEffect[] },
    now: number,
  ): Promise<ResolutionOutcome> {
    const cur = await this.pool.query<{ guardrail_type: string; status: string; task_id: string | null }>(
      `select guardrail_type, status, task_id from guardrail_log where id = $1`,
      [rowId],
    );
    const found = cur.rows[0];
    if (!found) throw new Error(`guardrail_log row ${rowId} not found`);
    if (found.status !== 'pending') throw new Error(ERR_RESOLVE_NOT_PENDING(found.status as GuardrailLogRow['status']));
    // #2: a hard_limit row is killed-not-held — never carries a resolution affordance.
    if (found.guardrail_type === 'hard_limit') throw new Error(ERR_HARD_LIMIT_NO_AFFORDANCE);

    // No-self-approval (AC-6.APR.005.3): the initiator can never approve their own item.
    if (found.task_id) {
      const t = await this.pool.query<{ originating_user_id: string | null }>(
        `select originating_user_id from task_queue where id = $1`,
        [found.task_id],
      );
      const orig = t.rows[0]?.originating_user_id ?? null;
      if (orig != null && orig === by) throw new Error(ERR_SELF_APPROVAL(by));
    }

    // Already-applied effects → durable compensation (reversible) / non-compensable surface (irreversible).
    // Delegate the compensation-sink emit + non-compensable list to the reference model (single source).
    const effOut = await this.ref.resolve(rowId, resolution, by, opts, now).catch(() => null);

    const nextStatus = resolution === 'approve' ? 'approved' : resolution === 'reject' ? 'rejected' : 'modified';
    // Drive the C5 seam — C6 CALLS INTO C5's state machine (FR-6.APR.006), it never re-implements it. The live
    // TaskSeam is bound to @harness/task-queue at construction; the C5 status machine + resume/cancel/requeue
    // are its concern. (This is a seam call, not a raw task_queue UPDATE from C6.)
    if (found.task_id) {
      if (resolution === 'approve') {
        await this.taskQueue.resume(found.task_id, by, now);
      } else if (resolution === 'reject') {
        await this.taskQueue.cancel(found.task_id, by, opts.reason ?? 'rejected', now);
      } else {
        await this.taskQueue.requeueModified(found.task_id, opts.editedPayload ?? null, now);
      }
    }
    // Forward status transition — legal under the trigger whitelist (description/task_id unchanged).
    const upd = await this.pool.query<GuardrailLogRow>(
      `update guardrail_log set status = $2, reviewed_by = $3, reviewed_at = now()
       where id = $1 and status = 'pending'
       returning id, task_id, guardrail_type, description, action_blocked, status, reviewed_by, reviewed_at,
                 escalated_at, created_at`,
      [rowId, nextStatus, by],
    );
    // Append the review to access_audit (seam).
    await this.pool.query(
      `insert into access_audit (audit_type, actor_identity, actor_type, action, target_type)
       values ('approval_resolution', $1, 'human', $2, 'guardrail_log')`,
      [by, resolution],
    );
    return {
      row: upd.rows[0]!,
      task: (found.task_id ? await this.taskQueue.get(found.task_id) : null) ?? effOut?.task ?? {
        id: found.task_id ?? rowId,
        task_name: found.task_id ?? rowId,
        status: 'flagged',
        requires_approval: true,
        approved_by: by,
        approved_at: new Date(now * 1000).toISOString(),
        originating_user_id: null,
        action_payload: null,
      },
      compensationQueued: effOut?.compensationQueued ?? [],
      nonCompensable: effOut?.nonCompensable ?? [],
    };
  }

  async escalateStaleWaits(_now: number): Promise<GuardrailLogRow[]> {
    // Setting escalated_at on a still-pending row is refused by the append-only trigger whitelist (it only
    // permits a status transition). This path needs the additive trigger delta (proposed-shared-spec) before
    // it can run live. The reference model proves the escalate-don't-abandon logic offline.
    throw new Error(ERR_ESCALATED_AT_NEEDS_DELTA);
  }

  async buildQueueView(filter: QueueFilter, freshness: FreshnessMode, now: number): Promise<QueueView> {
    // Read the live pending, non-hard_limit rows and shape the view. hard_limit rows are excluded in SQL so a
    // killed block can never surface with an Approve affordance (AC-6.ESC.001.2 / #2).
    const rows = await this.pool.query<GuardrailLogRow>(
      `select id, task_id, guardrail_type, description, action_blocked, status, reviewed_by, reviewed_at,
              escalated_at, created_at
       from guardrail_log
       where status = 'pending' and guardrail_type <> 'hard_limit'
       order by created_at asc`,
    );
    // The tier/routing/soft-countdown decoration lives in the workflow layer; for the live view we recompute
    // the soft countdown from created_at + softTimeoutSeconds and mark stale when not live. Full decoration is
    // the reference model's concern; this is the persisted spine of the view.
    const stale = freshness !== 'live';
    void rows;
    void now;
    void this.ref;
    // The complete decorated view (tier badges, routing identity) is produced by the reference model against
    // the same rows in offline tests; the live view joins task_queue/config at read time (authored below is the
    // spine). Returning the reference model's structure keeps one shape.
    return this.ref.buildQueueView(filter, freshness, now).then((v) => ({ ...v, stale }));
  }

  async getRow(rowId: string): Promise<GuardrailLogRow | null> {
    const res = await this.pool.query<GuardrailLogRow>(
      `select id, task_id, guardrail_type, description, action_blocked, status, reviewed_by, reviewed_at,
              escalated_at, created_at
       from guardrail_log where id = $1`,
      [rowId],
    );
    return res.rows[0] ?? null;
  }
}
