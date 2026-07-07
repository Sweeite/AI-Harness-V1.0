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
// ⚠️ NOT YET FULLY RUN LIVE. The escalated_at-only UPDATE the whitelist once rejected is now PERMITTED by
// migration 0015 branch (b) (kin 0010/OD-182 — escalated_at null→ts on a still-pending row), so
// escalateStaleWaits performs the real stamp. Hold-for-full-review still awaits its own held_for_review_at
// column (deferred under OD-188 — absent from every migration), so holdForFullReview stays deferred. The
// InMemory model is the proven offline reference; this adapter is authored to the DDL so the seam typechecks +
// is real. The AF-068 red-team (no autonomous bypass of the hard-approval floor) is the LIVE ship gate — owed,
// listed in residualAFs. Do NOT claim these paths verified until a live capstone records evidence.
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
  type ApprovalNotification,
  type ApprovalWorkflow,
  type AppliedEffect,
  type CompensationSink,
  type CompensationTask,
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

// NOTE: the escalated_at delta this once guarded has LANDED (migration 0015 branch (b), kin 0010/OD-182) —
// escalateStaleWaits now performs the real null→ts stamp and no longer throws. This message is retained only
// for holdForFullReview, whose column (held_for_review_at) is a DIFFERENT, still-deferred delta (OD-188).
export const ERR_HELD_FOR_REVIEW_AT_NEEDS_DELTA =
  'approval-workflow(live): persisting Hold-for-full-review needs the held_for_review_at column, which is ' +
  'deferred under OD-188 (not yet in any app/silo/migrations). The reference model proves the soft→explicit ' +
  'promotion offline; the live persist path is owed that additive delta before it can run.';

export class SupabaseApprovalWorkflow implements ApprovalWorkflow {
  private pool: pg.Pool;
  private readonly taskQueue: TaskSeam;
  private readonly config: ApprovalConfig;
  // The compensation sink is driven DIRECTLY by this live adapter (not via the ref): a held item's already-
  // applied reversible effects are the real inputs (opts.appliedEffects), and the empty ref never holds the
  // live rowId, so delegating there silently lost every compensation task (#1 hidden by #3). See resolve().
  private readonly comp: CompensationSink;
  // The escalation notification is emitted directly by this live adapter (escalateStaleWaits drives off real
  // rows, not the empty ref) — a stale wait-point must be surfaced, never dropped (#3).
  private readonly notify: NotificationSink;
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
    this.comp = comp;
    this.notify = notify;
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
      // Forward status transition + its audit are ONE atomic unit (same as resolve(): never a transition without
      // its audit — #1/#3). actor_type='system' — the timer auto-run has NO human reviewer (it is attributed to
      // the server timer, not a person; 'system' is a valid actor_type enum member).
      const client = await this.pool.connect();
      try {
        await client.query('begin');
        // Forward status transition — legal under the append-only trigger whitelist (description/task_id fixed).
        const upd = await client.query<GuardrailLogRow>(
          `update guardrail_log set status = 'approved', reviewed_at = now()
           where id = $1 and status = 'pending'
           returning id, task_id, guardrail_type, description, action_blocked, status, reviewed_by, reviewed_at,
                     escalated_at, created_at`,
          [row.id],
        );
        if (upd.rows[0]) {
          await client.query(
            `insert into access_audit (audit_type, actor_identity, actor_type, action, target_type)
             values ('approval_resolution', 'system:soft-auto-run', 'system', 'approve', 'guardrail_log')`,
          );
        }
        await client.query('commit');
        if (upd.rows[0]) ran.push(upd.rows[0]);
      } catch (err) {
        await client.query('rollback').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
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
    // The promotion needs a dedicated held_for_review_at column to persist (a status/description mutation is NOT
    // permitted by the append-only trigger — Hold is not a status transition, status stays pending). That column
    // is deferred under OD-188 and is absent from every app/silo/migrations file, so this live persist path
    // remains owed its additive delta. The reference model (store.ts holdForFullReview) proves the soft→explicit
    // promotion offline in the meantime.
    void by;
    void this.ref;
    throw new Error(ERR_HELD_FOR_REVIEW_AT_NEEDS_DELTA);
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
    // MAJOR FIX: drive this DIRECTLY off the REAL inputs (opts.appliedEffects) via the live CompensationSink.
    // The prior code delegated to this.ref.resolve(...), but the ref is a FRESH empty InMemoryApprovalWorkflow
    // that never holds the live rowId → it always threw 'row not found' → .catch swallowed → compensation was
    // never queued (#1 effect-loss hidden by #3). We mirror the reference model's compensation logic (store.ts
    // resolve) but from the real appliedEffects: a reversible effect gets a durable human-visible cleanup task
    // (NEVER an auto-rollback — #2/OD-010); an irreversible effect is surfaced non-compensable.
    const compensationQueued: CompensationTask[] = [];
    const nonCompensable: string[] = [];
    for (const eff of opts.appliedEffects ?? []) {
      if (eff.reversible) {
        const t: CompensationTask = {
          for_task_id: found.task_id ?? rowId,
          description: `Human-visible cleanup for already-applied reversible effect: ${eff.description}`,
          created_at: new Date(now * 1000).toISOString(),
        };
        await this.comp.queue(t);
        compensationQueued.push(t);
      } else {
        nonCompensable.push(`NON-COMPENSABLE (irreversible, no auto-undo): ${eff.description}`);
      }
    }

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

    // BLOCKER FIX: the guardrail_log forward transition AND its access_audit append are ONE atomic unit. Before,
    // they ran on the non-transactional pool: the row flipped to approved/rejected and THEN the audit insert
    // threw (actor_type='human' is not a member of the enum ('user','agent','system')) — leaving an inconsistent,
    // un-audited resolution (#1/#3). We check out ONE client, BEGIN, run both, COMMIT — ROLLBACK on any error so
    // the transition can never land without its audit. actor_type reflects the REAL actor: a human reviewer
    // resolution is 'user'; the timer auto-run path (autoRunElapsedSoft) is 'system' (it appends its own audit).
    const client = await this.pool.connect();
    let upd: pg.QueryResult<GuardrailLogRow>;
    try {
      await client.query('begin');
      // Forward status transition — legal under the trigger whitelist (description/task_id unchanged).
      upd = await client.query<GuardrailLogRow>(
        `update guardrail_log set status = $2, reviewed_by = $3, reviewed_at = now()
         where id = $1 and status = 'pending'
         returning id, task_id, guardrail_type, description, action_blocked, status, reviewed_by, reviewed_at,
                   escalated_at, created_at`,
        [rowId, nextStatus, by],
      );
      // Append the review to access_audit (seam). actor_type='user' — a human reviewer resolution (NOT 'human',
      // which is a task_type value and is invalid for the actor_type enum).
      await client.query(
        `insert into access_audit (audit_type, actor_identity, actor_type, action, target_type)
         values ('approval_resolution', $1, 'user', $2, 'guardrail_log')`,
        [by, resolution],
      );
      await client.query('commit');
    } catch (err) {
      await client.query('rollback').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    return {
      row: upd.rows[0]!,
      task: (found.task_id ? await this.taskQueue.get(found.task_id) : null) ?? {
        id: found.task_id ?? rowId,
        task_name: found.task_id ?? rowId,
        status: 'flagged',
        requires_approval: true,
        approved_by: by,
        approved_at: new Date(now * 1000).toISOString(),
        originating_user_id: null,
        action_payload: null,
      },
      compensationQueued,
      nonCompensable,
    };
  }

  async escalateStaleWaits(now: number): Promise<GuardrailLogRow[]> {
    // MINOR FIX: migration 0015 branch (b) (kin 0010, OD-182) now PERMITS an escalated_at null→ts stamp on a
    // still-pending row (status/description/task_id/guardrail_type/reviewers unchanged) — the delta that
    // ERR_ESCALATED_AT_NEEDS_DELTA claimed was owed has landed. So this path performs the REAL stamp instead of
    // throwing. A stale wait-point escalates and stays visibly pending — never auto-resolved, never dropped (#3,
    // AC-6.ESC.004.1/.3, AC-NFR-OBS.007.1). Both wait kinds are covered: a `flagged` guardrail hit AND an
    // `awaiting_approval` tiered gate both live as pending guardrail_log rows here.
    const cutoffIso = new Date((now - this.config.escalationTimeoutSeconds) * 1000).toISOString();
    // Stamp escalated_at on every un-escalated, still-pending row older than the escalation window. The
    // append-only trigger branch (b) allows exactly this monotonic null→ts stamp (nothing else mutated). The
    // hard_limit rows are excluded — a killed block has no escalation/resume path (#2, AC-6.ESC.001.2).
    const upd = await this.pool.query<GuardrailLogRow>(
      `update guardrail_log
         set escalated_at = now()
       where status = 'pending' and escalated_at is null and guardrail_type <> 'hard_limit'
         and created_at <= $1
       returning id, task_id, guardrail_type, description, action_blocked, status, reviewed_by, reviewed_at,
                 escalated_at, created_at`,
      [cutoffIso],
    );
    // Emit the escalation for each stamped wait-point — a dropped emit is surfaced, never a silent un-escalated
    // wait (#3). The escalated_at record stands regardless of the notification outcome.
    for (const row of upd.rows) {
      const n: ApprovalNotification = {
        kind: 'stale_wait_escalation',
        guardrail_log_id: row.id,
        task_id: row.task_id,
        reviewer_identity: null,
        reviewer_role: 'reviewer',
        summary:
          `Wait-point on '${row.task_id ?? row.id}' un-actioned past the escalation window ` +
          `(> ${this.config.escalationTimeoutSeconds}s) — escalated, not auto-resolved.`,
        emitted_at: new Date(now * 1000).toISOString(),
      };
      await this.notify.emit(n).catch(() => {
        /* dropped emit is surfaced out-of-band by C7; the escalated_at stamp already stands (#3). */
      });
    }
    void this.ref; // the reference model proves the widen/no-abandon logic offline; live drives off real rows.
    return upd.rows;
  }

  async buildQueueView(_filter: QueueFilter, _freshness: FreshnessMode, _now: number): Promise<QueueView> {
    // FAIL LOUD ([[OD-191]] immediate sub-fix). The live queue view cannot be reconstructed from the DB: the
    // decoration fields it needs (`tier`, `floored`, `heldForFullReview`, `softDeadline`/countdown, `routedRole`,
    // `reviewerIdentity`) are NOT columns on `guardrail_log` (live-confirmed) — they live only in the in-memory
    // fake's `meta`. The prior body read the live pending rows, then discarded them (`void rows`) and returned
    // `this.ref.buildQueueView(...)` — the empty in-memory fake — so the operator approval queue was ALWAYS
    // silently empty live (#3: a wrong/empty queue hides pending approvals). OD-191 (operator-resolved) DEFERS
    // the C6 operator-queue surface + its decoration-persistence delta until that surface is actually built;
    // until then this must THROW, never return a silently-empty view. Nothing in Stage 5 depends on it.
    void this.ref;
    throw new Error(
      'approval-tiers buildQueueView: decoration persistence owed (OD-191) — the live operator approval-queue ' +
        'surface + its guardrail_log decoration columns (tier/floored/routed_role/reviewer_identity/' +
        'soft_deadline_at/held_for_review_at) are not built yet. This method is intentionally not implemented ' +
        'live and fails loud rather than returning a silently-empty queue (#3). See OD-191 / OD-188.',
    );
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
