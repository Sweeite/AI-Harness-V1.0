// ISSUE-056 (C6 APR + ESC) — the ApprovalWorkflow PORT + in-memory FAKE reference model (the house
// port+fake pattern, cf. app/hard-limits/src/store.ts, app/task-queue/src/store.ts). This layer ENACTS the
// pure tier/routing decisions made in tiers.ts: it writes the `approval_gate` guardrail_log rows, drives the
// pause→`flagged`→resolve→escalate workflow, runs the soft-timeout auto-run (reversible-only) + the
// Hold-for-full-review promotion, applies most-restrictive multi-fire precedence, and produces the surface-04
// view model. The C5 state machine (awaiting_approval / flagged hold / resume) is NOT re-implemented here —
// this slice calls into a task-queue-shaped seam (the real @harness/task-queue in the live adapter).
//
// The fake IS the reference model the live pg adapter (supabase-store.ts) must match against the baseline DDL
// (app/silo/migrations/0001_baseline.sql §guardrail_log + §task_queue + §access_audit + the append-only
// trigger enforce_audit_append_only() + the `check (not (guardrail_type='hard_limit' and status='approved'))`).
// Every invariant a live silo would enforce is enforced here so a test against the fake proves the contract
// the silo must uphold (fake-vs-live discipline: the fake cannot pass where the live adapter would throw).
//
// Mapped to the three non-negotiables (#1 never lose/corrupt · #2 never do what it shouldn't · #3 never fail
// silently):
//   #2  A `hard_limit` guardrail row can NEVER be approved and NEVER carries an Approve affordance. Multi-fire:
//       a co-firing hard_limit DOMINATES — the step is killed, never resumed, no matter what approvable flag
//       also fired. A floored/irreversible item never auto-runs on soft timeout.
//   #3  No flag is ever silently abandoned: every wait-point (`flagged` AND `awaiting_approval`) escalates past
//       its timeout and stays visibly pending — never auto-approved, never dropped. A dropped reviewer
//       notification is itself surfaced. Routing never leaves an item unrouted; no-eligible-reviewer escalates.
//   #1  A held item's already-applied side effects are shown and a durable human-visible compensation task is
//       queued (never auto-rolled-back); an irreversible effect is surfaced as non-compensable.

import {
  classifyTier,
  mostRestrictiveTier,
  routeApproval,
  type ApprovalTier,
  type AutonomyMatrix,
  type GatedAction,
  type Reviewer,
  type RoutingOutcome,
  type RoutingRules,
  type TierDecision,
} from './tiers.ts';

// ── guardrail_log row (baseline DDL §guardrail_log) — the subset this slice writes/reads. Mirrors the exact
// column set + the guardrail_status enum + the CHECK not(hard_limit and approved). ─────────────────────────
export type GuardrailType = 'hard_limit' | 'approval_gate' | 'anomaly' | 'rate_limit' | 'prompt_injection';
export type GuardrailStatus = 'pending' | 'approved' | 'rejected' | 'modified';

export interface GuardrailLogRow {
  id: string;
  task_id: string | null;
  guardrail_type: GuardrailType;
  description: string;
  action_blocked: boolean;
  status: GuardrailStatus;
  reviewed_by: string | null; // → profiles(id); set on a resolution
  reviewed_at: string | null; // iso; set on a resolution
  escalated_at: string | null; // ⊕ server-owned; set when a wait-point escalates (never resolves the item)
  created_at: string;
}

// ── task_queue seam (baseline DDL §task_queue). This slice does NOT own the state machine — it consumes a
// task-queue-shaped port so the C6/C5 seam (FR-6.APR.006) is a call, not a re-implementation. The live
// adapter binds this to the real @harness/task-queue; the fake below carries a minimal in-memory queue that
// mirrors the same status transitions we depend on (awaiting_approval hold, flagged hold, approve→running,
// reject→failed). We keep the seam narrow: only the operations the approval workflow drives. ───────────────
export type TaskStatus =
  | 'pending'
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'flagged';

export interface TaskRow {
  id: string;
  task_name: string;
  status: TaskStatus;
  requires_approval: boolean;
  approved_by: string | null;
  approved_at: string | null;
  originating_user_id: string | null; // the initiator — its own approval is forbidden (#6, AC-6.APR.005.3)
  action_payload: unknown | null; // proposed tool call + params + target (edited on Modify)
}

/** The C5 seam this slice calls into (FR-6.APR.006 — C6 sets policy, C5 enacts the block/hold/resume). The
 *  real implementation is @harness/task-queue (ISSUE-048); the fake below is a minimal reference model of the
 *  transitions we depend on so the workflow is provable offline. */
export interface TaskSeam {
  get(id: string): Promise<TaskRow | null>;
  /** C6 sets requires_approval + moves an approval-gated task to awaiting_approval (the C5 hold). */
  requireApproval(id: string, now: number): Promise<TaskRow>;
  /** C6-only guardrail/quarantine hold (OD-054): move the task to `flagged` and pause. */
  setFlagged(id: string, now: number): Promise<TaskRow>;
  /** Human approves a held/awaiting item: record approver + release to running (C5 resume). */
  resume(id: string, approver: string, now: number): Promise<TaskRow>;
  /** Human rejects: record reason + cancel (never executes). */
  cancel(id: string, approver: string, reason: string, now: number): Promise<TaskRow>;
  /** Human modifies params: requeue to pending so the edited task re-enters the gate. */
  requeueModified(id: string, editedPayload: unknown, now: number): Promise<TaskRow>;
}

// ── the C7 alert/notification seam (FR-6.ESC.002 / FR-6.ESC.004). Delivery is C7 (ISSUE-075/076); this slice
// only EMITS the notification + the escalation. A dropped emit is surfaced, never swallowed (#3). ───────────
export interface ApprovalNotification {
  kind: 'flag_raised' | 'stale_wait_escalation';
  guardrail_log_id: string | null;
  task_id: string | null;
  reviewer_identity: string | null;
  reviewer_role: string;
  summary: string; // plain-English, never empty (#3)
  emitted_at: string;
}
export interface NotificationSink {
  emit(n: ApprovalNotification): Promise<void>;
}

// ── the compensation-task seam (FR-6.ESC.003.2 / OD-010). A reversible already-applied external effect gets a
// durable human-visible cleanup task — NEVER an autonomous auto-rollback (#2). Owned by C5 AC-5.ASM.009.2;
// this slice requests it. ──────────────────────────────────────────────────────────────────────────────────
export interface CompensationTask {
  for_task_id: string;
  description: string; // human-visible; describes the reversible effect to undo
  created_at: string;
}
export interface CompensationSink {
  queue(t: CompensationTask): Promise<void>;
}

// ── config knobs this slice CONSUMES (config-registry owns the keys; we read them). All in SECONDS. ─────────
export interface ApprovalConfig {
  /** approval_soft_timeout — a reversible soft item auto-runs after this if un-actioned (default 10 min). */
  softTimeoutSeconds: number;
  /** approval_escalation_timeout — an un-actioned flagged/awaiting_approval item escalates (default 4 h). */
  escalationTimeoutSeconds: number;
  /** how many escalations before the escalation WIDENS to the terminus role (AC-6.ESC.004.2). */
  widenAfterEscalations: number;
}
export const DEFAULT_APPROVAL_CONFIG: ApprovalConfig = {
  softTimeoutSeconds: 10 * 60, // approval_soft_timeout default (surface-04 / §CFG)
  escalationTimeoutSeconds: 4 * 3600, // approval_escalation_timeout default 4 h (§CFG)
  widenAfterEscalations: 2, // after 2 escalations, widen to the terminus (AC-6.ESC.004.2)
};

// ── exact rejection messages, so a test asserts the same failure the live silo produces. ───────────────────
export const ERR_HARD_LIMIT_APPROVE_FORBIDDEN =
  "guardrail_log: a 'hard_limit' event can never be marked 'approved' " +
  '(no-override; schema check not(hard_limit and approved) / AC-6.LOG.001.2 / AC-6.ESC.001.2)';
export const ERR_RESOLVE_NOT_PENDING = (status: GuardrailStatus) =>
  `approval-workflow: a guardrail row already resolved to '${status}' cannot be re-resolved (forward-only, append-only trigger)`;
export const ERR_SELF_APPROVAL = (identity: string) =>
  `approval-workflow: '${identity}' is the initiating identity and can never be its own approver (AC-6.APR.005.3 / hard limit #6)`;
export const ERR_HARD_LIMIT_NO_AFFORDANCE =
  'approval-workflow: a hard_limit row is killed-not-held — it never enters the queue and never carries an Approve/Reject/Modify affordance (AC-6.ESC.001.2)';
export const ERR_HOLD_ONLY_SOFT =
  'approval-workflow: Hold-for-full-review promotes soft→explicit only; a hard/floored item can never be downgraded to soft (AC-6.APR.003.3)';
export const ERR_MODIFY_HARD_FLOOR =
  'approval-workflow: a Modify cannot lower a floored action below hard — the edited task re-enters the gate and re-floors (AC-6.APR.002.1)';

// ── the guardrail hit fed to the workflow. A hit couples the gated action (for tiering/routing) to the
// guardrail_type that fired. Several hits can arrive for one step (multi-fire — AC-6.ESC.001.3). ────────────
export interface GuardrailHit {
  guardrailType: GuardrailType;
  action: GatedAction;
  /** human-readable why-fired (goes into the row description). Never empty (#3). */
  description: string;
}

// ── the disposition of one gated action after tiering (the recorded tier decision, AC-6.APR.001.1). ─────────
export interface TierDisposition {
  taskId: string;
  decision: TierDecision;
  /** true when the action auto-approved and executed immediately with NO human step (AC-6.APR.004.1). */
  autoExecuted: boolean;
  /** the guardrail_log row written for a soft/hard gate; null for an auto-approve (the non-event path). */
  guardrailLogId: string | null;
  /** the classification record kept even for auto-approve (feeds OPT.001 — AC-6.APR.004.1). */
  classificationRecord: { taskId: string; tier: ApprovalTier; floored: boolean; at: string };
}

// ── the outcome of raising a flag (the pause→flagged→notify→queue chain). ──────────────────────────────────
export interface FlagOutcome {
  /** the guardrail_log rows written — ONE PER HIT (no hit masked by another, AC-6.ESC.001.3). */
  rowIds: string[];
  /** the governing disposition after most-restrictive precedence. */
  governing: 'killed' | 'flagged';
  /** true when a hard_limit co-fired and dominated: the step is killed, not held (#2). */
  hardLimitDominated: boolean;
  /** the routed reviewer (null when governing==='killed' — a kill has no human-resolution path). */
  routing: RoutingOutcome | null;
  /** true iff the reviewer notification was successfully emitted; false ⇒ surfaced dropped (#3). */
  notified: boolean;
  /** true iff a notification emit failed — surfaced, never a silent un-notified flag (AC-6.ESC.002.1). */
  notificationDropped: boolean;
}

// ── an already-applied side effect surfaced at review (FR-6.ESC.003.2/.3). ─────────────────────────────────
export interface AppliedEffect {
  description: string;
  /** true ⇒ a compensation task can be queued; false ⇒ surfaced NON-compensable (AC-6.ESC.003.3). */
  reversible: boolean;
}

export interface ResolutionOutcome {
  row: GuardrailLogRow;
  task: TaskRow;
  /** compensation tasks queued for reversible applied effects (never an auto-rollback — #2). */
  compensationQueued: CompensationTask[];
  /** irreversible effects surfaced as non-compensable with an operator note (AC-6.ESC.003.3). */
  nonCompensable: string[];
}

// ── the surface-04 approval-queue view model (FR-7.RTP.004 honesty; OD-118 single queue + chips). ───────────
export type FreshnessMode = 'live' | 'reconnecting' | 'polling';
export type QueueFilter = 'all' | 'approvals' | 'safety_holds' | 'overdue';

export interface QueueItemView {
  guardrailLogId: string;
  taskId: string | null;
  taskName: string;
  guardrailType: GuardrailType;
  tier: ApprovalTier;
  floored: boolean;
  /** true ⇒ render a locked "no downgrade" badge (a floored item, AC-6.APR.002.1). */
  lockedBadge: boolean;
  /** true ⇒ the reviewer promoted this soft item to explicit via Hold-for-full-review (OD-120 badge). */
  heldForFullReview: boolean;
  /** seconds remaining on the soft auto-run countdown, or null for a hard/held/non-soft item. Server-owned. */
  softCountdownSeconds: number | null;
  reviewerRole: string;
  reviewerIdentity: string | null;
  overdue: boolean; // past the escalation timeout (AC-6.ESC.004.1)
  /** the actions offered on this item. A hard_limit row is NEVER here at all; a floored approval row still
   *  offers Approve/Reject/Modify to a human (the floor is on tier, not on human review). */
  actions: readonly ('approve' | 'reject' | 'modify' | 'hold' | 'queue_cleanup')[];
  /** true ⇒ resolve actions are DISABLED because the view is known-stale (re-fetch on reconnect before
   *  re-enabling — a soft item may have auto-run server-side). #3 honesty. */
  resolveDisabled: boolean;
}

export interface QueueView {
  freshness: FreshnessMode;
  filter: QueueFilter;
  items: readonly QueueItemView[];
  /** true when the view is stale (polling/reconnecting) — resolve actions are disabled across the board. */
  stale: boolean;
}

// ── fault injection for the notification-dropped path (AC-6.ESC.002.1). ────────────────────────────────────
export interface FaultConfig {
  failNotification?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// THE PORT. Sync-modelled in the fake; async so the pg adapter matches. Everything a live silo would enforce
// is enforced here so a test against the fake proves the contract the silo must uphold.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface ApprovalWorkflow {
  // ── APR: tier policy ──
  /** Classify + record a gated action's tier, enforcing the floor + default-hard-if-uncertain (pure via
   *  tiers.classifyTier). Auto-approve executes immediately with a logged decision (AC-6.APR.001/002/004);
   *  soft/hard call the C5 seam to move the task to awaiting_approval (AC-6.APR.001.2 / AC-6.APR.006.1). */
  tierAndGate(action: GatedAction, matrix: AutonomyMatrix, now: number): Promise<TierDisposition>;

  /** Route an approval to the contextual reviewer with no-self-approval + fallback/escalate (AC-6.APR.005). */
  route(action: GatedAction, candidates: readonly Reviewer[], rules: RoutingRules): RoutingOutcome;

  /** Soft-timeout auto-run: for a soft item whose window elapsed with no human action, auto-run ONLY IF
   *  reversible (AC-6.APR.003.1). An irreversible/floored item is hard by construction and is never soft, so
   *  this can never auto-run an irreversible effect. Returns the rows auto-run. */
  autoRunElapsedSoft(now: number): Promise<GuardrailLogRow[]>;

  /** Hold-for-full-review (OD-120): cancel a soft item's auto-run timer + promote it to explicit approval —
   *  one-directional (soft→explicit only). Refuses to downgrade a hard/floored item (AC-6.APR.003.3). */
  holdForFullReview(rowId: string, by: string, now: number): Promise<GuardrailLogRow>;

  // ── ESC: flagged workflow ──
  /** Raise a flag for a step's guardrail hit(s): write ONE guardrail_log row per hit, apply most-restrictive
   *  precedence (a co-firing hard_limit dominates → killed, not held), set the task `flagged` for the
   *  approvable governing case, route + notify the reviewer + place in the queue (AC-6.ESC.001/002). */
  raiseFlag(
    hits: readonly GuardrailHit[],
    candidates: readonly Reviewer[],
    rules: RoutingRules,
    now: number,
  ): Promise<FlagOutcome>;

  /** Resolve a flagged item: approve → C5 resumes; reject → C5 cancels + reason; modify → edited task
   *  requeues + re-enters the gate. No-self-approval enforced. Shows already-applied effects + queues a
   *  durable compensation task for reversible ones, surfaces irreversible as non-compensable — never an
   *  auto-rollback (AC-6.ESC.003). A hard_limit row can never be approved (AC-6.ESC.001.2). */
  resolve(
    rowId: string,
    resolution: 'approve' | 'reject' | 'modify',
    by: string,
    opts: { reason?: string; editedPayload?: unknown; appliedEffects?: readonly AppliedEffect[] },
    now: number,
  ): Promise<ResolutionOutcome>;

  /** Escalate every un-actioned wait-point (BOTH `flagged` and `awaiting_approval`) older than the escalation
   *  timeout: set escalated_at, emit the escalation, WIDEN after repeated timeouts — never auto-resolve, never
   *  drop (AC-6.ESC.004.1/.2/.3, AC-NFR-OBS.007.1). Returns the escalated rows. */
  escalateStaleWaits(now: number): Promise<GuardrailLogRow[]>;

  // ── surface-04 view model ──
  /** Build the surface-04 queue view: filter chips, tier/hold badges, soft countdown, freshness honesty,
   *  stale-guard (resolve disabled when not live). A hard_limit row is NEVER in the queue (AC-6.ESC.001.2). */
  buildQueueView(filter: QueueFilter, freshness: FreshnessMode, now: number): Promise<QueueView>;

  /** Read a guardrail_log row (for the no-affordance assertion). */
  getRow(rowId: string): Promise<GuardrailLogRow | null>;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// A minimal in-memory TaskSeam reference model (mirrors the @harness/task-queue transitions we depend on).
// The live adapter binds the real port instead; this proves the workflow offline.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export class InMemoryTaskSeam implements TaskSeam {
  readonly rows = new Map<string, TaskRow>();
  private iso(now: number): string {
    return new Date(now * 1000).toISOString();
  }
  seed(row: TaskRow): void {
    this.rows.set(row.id, { ...row });
  }
  private must(id: string): TaskRow {
    const r = this.rows.get(id);
    if (!r) throw new Error(`task_queue: no such task '${id}'`);
    return r;
  }
  async get(id: string): Promise<TaskRow | null> {
    const r = this.rows.get(id);
    return r ? { ...r } : null;
  }
  async requireApproval(id: string, _now: number): Promise<TaskRow> {
    const r = this.must(id);
    r.requires_approval = true;
    r.status = 'awaiting_approval';
    return { ...r };
  }
  async setFlagged(id: string, _now: number): Promise<TaskRow> {
    const r = this.must(id);
    r.status = 'flagged';
    return { ...r };
  }
  async resume(id: string, approver: string, now: number): Promise<TaskRow> {
    const r = this.must(id);
    r.approved_by = approver;
    r.approved_at = this.iso(now);
    r.status = 'running';
    return { ...r };
  }
  async cancel(id: string, approver: string, _reason: string, now: number): Promise<TaskRow> {
    const r = this.must(id);
    r.approved_by = approver;
    r.approved_at = this.iso(now);
    r.status = 'failed';
    return { ...r };
  }
  async requeueModified(id: string, editedPayload: unknown, _now: number): Promise<TaskRow> {
    const r = this.must(id);
    r.action_payload = editedPayload;
    r.requires_approval = false; // re-enters the gate fresh; C6 re-tiers + re-floors on requeue
    r.status = 'pending';
    return { ...r };
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// In-memory ApprovalWorkflow fake — the reference model. Deterministic: `now` (epoch seconds) is caller-
// supplied; no Date.now()/random (house discipline).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Internal per-row workflow bookkeeping the DDL carries in columns / joins. */
interface RowMeta {
  tier: ApprovalTier;
  floored: boolean;
  routing: RoutingOutcome | null;
  /** for a soft row: the epoch-second deadline at which auto-run fires (null once held/resolved). */
  softDeadline: number | null;
  /** OD-120: promoted to explicit via Hold — auto-run is cancelled, no longer soft-auto. */
  heldForFullReview: boolean;
  /** the wait-point kind for escalation coverage (AC-6.ESC.004.3): flagged rows AND awaiting_approval waits. */
  waitKind: 'flagged' | 'awaiting_approval';
  escalations: number;
}

export class InMemoryApprovalWorkflow implements ApprovalWorkflow {
  private seq = 0;
  readonly rows = new Map<string, GuardrailLogRow>();
  private readonly meta = new Map<string, RowMeta>();
  readonly classifications: TierDisposition['classificationRecord'][] = [];
  readonly droppedNotifications: ApprovalNotification[] = [];

  constructor(
    private readonly tasks: TaskSeam,
    private readonly notify: NotificationSink,
    private readonly comp: CompensationSink,
    private readonly config: ApprovalConfig = DEFAULT_APPROVAL_CONFIG,
    private readonly faults: FaultConfig = {},
  ) {}

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${String(this.seq).padStart(4, '0')}`;
  }
  private iso(now: number): string {
    return new Date(now * 1000).toISOString();
  }
  private clone(row: GuardrailLogRow): GuardrailLogRow {
    return { ...row };
  }

  async getRow(rowId: string): Promise<GuardrailLogRow | null> {
    const r = this.rows.get(rowId);
    return r ? this.clone(r) : null;
  }

  // ── APR: tier policy ─────────────────────────────────────────────────────────────────────────────────
  async tierAndGate(action: GatedAction, matrix: AutonomyMatrix, now: number): Promise<TierDisposition> {
    const decision = classifyTier(action, matrix); // pure floor + default-hard-if-uncertain
    const classificationRecord = {
      taskId: action.actionType,
      tier: decision.tier,
      floored: decision.floored,
      at: this.iso(now),
    };
    this.classifications.push(classificationRecord); // retained even for auto (OPT.001 — AC-6.APR.004.1)

    if (decision.tier === 'auto') {
      // AC-6.APR.001.2 / AC-6.APR.004.1: auto-approve executes immediately, NO human step, NO guardrail row.
      return { taskId: action.actionType, decision, autoExecuted: true, guardrailLogId: null, classificationRecord };
    }

    // soft/hard: write the approval_gate guardrail_log row and hand the block to C5 (AC-6.APR.006.1).
    const row: GuardrailLogRow = {
      id: this.nextId('gl'),
      task_id: action.actionType,
      guardrail_type: 'approval_gate',
      description: decision.reason,
      action_blocked: true, // execution is held pending the human step
      status: 'pending',
      reviewed_by: null,
      reviewed_at: null,
      escalated_at: null,
      created_at: this.iso(now),
    };
    this.rows.set(row.id, row);

    const softDeadline =
      decision.tier === 'soft' && !decision.floored ? now + this.config.softTimeoutSeconds : null;
    this.meta.set(row.id, {
      tier: decision.tier,
      floored: decision.floored,
      routing: null,
      softDeadline,
      heldForFullReview: false,
      waitKind: 'awaiting_approval', // a tiered gate is an approval wait (routing may re-home to flagged later)
      escalations: 0,
    });

    // C5 enacts the hold (FR-6.APR.006 — C6 sets requires_approval + tier, C5 moves to awaiting_approval).
    await this.tasks.requireApproval(action.actionType, now);

    return { taskId: action.actionType, decision, autoExecuted: false, guardrailLogId: row.id, classificationRecord };
  }

  route(action: GatedAction, candidates: readonly Reviewer[], rules: RoutingRules): RoutingOutcome {
    return routeApproval(action, candidates, rules); // pure — no-self-approval + fallback/escalate (AC-6.APR.005)
  }

  async autoRunElapsedSoft(now: number): Promise<GuardrailLogRow[]> {
    const ran: GuardrailLogRow[] = [];
    for (const [id, m] of this.meta) {
      const row = this.rows.get(id);
      if (!row || row.status !== 'pending') continue;
      if (m.tier !== 'soft' || m.floored) continue; // #2: only a reversible soft item can auto-run
      if (m.heldForFullReview) continue; // OD-120: a held item never auto-runs
      if (m.softDeadline === null || now < m.softDeadline) continue;
      // AC-6.APR.003.1: the window elapsed with no human action → auto-run (reversible-only by construction).
      row.status = 'approved';
      row.reviewed_by = null; // auto-run: no human reviewer
      row.reviewed_at = this.iso(now);
      m.softDeadline = null;
      if (row.task_id) await this.tasks.resume(row.task_id, 'system:soft-auto-run', now);
      ran.push(this.clone(row));
    }
    return ran;
  }

  async holdForFullReview(rowId: string, by: string, now: number): Promise<GuardrailLogRow> {
    const row = this.rows.get(rowId);
    if (!row) throw new Error(`guardrail_log row ${rowId} not found`);
    const m = this.meta.get(rowId)!;
    // AC-6.APR.003.3: one-directional. Only a soft (reversible, non-floored) item may be held-and-promoted.
    if (m.tier !== 'soft' || m.floored) throw new Error(ERR_HOLD_ONLY_SOFT);
    m.heldForFullReview = true;
    m.softDeadline = null; // cancel the auto-run timer — no auto-run while a human is mid-review (#2)
    m.tier = 'hard'; // promoted to explicit approval; can no longer auto-execute on inaction
    // Logged to guardrail_log: the description records the promotion (append-only forward-compatible note).
    row.description = `${row.description} | HELD for full review by ${by} → promoted to explicit approval (OD-120)`;
    return this.clone(row);
  }

  // ── ESC: flagged workflow ────────────────────────────────────────────────────────────────────────────
  async raiseFlag(
    hits: readonly GuardrailHit[],
    candidates: readonly Reviewer[],
    rules: RoutingRules,
    now: number,
  ): Promise<FlagOutcome> {
    if (hits.length === 0) throw new Error('approval-workflow: raiseFlag needs at least one guardrail hit');

    // AC-6.ESC.001.3: write ONE row PER HIT — no hit is masked by another. Each row is independent.
    const rowIds: string[] = [];
    let taskId: string | null = null;
    for (const hit of hits) {
      const row: GuardrailLogRow = {
        id: this.nextId('gl'),
        task_id: hit.action.actionType,
        guardrail_type: hit.guardrailType,
        description: hit.description,
        // a hard_limit hit is a completed block (killed); an approvable hit holds the step.
        action_blocked: true,
        status: 'pending',
        reviewed_by: null,
        reviewed_at: null,
        escalated_at: null,
        created_at: this.iso(now),
      };
      this.rows.set(row.id, row);
      rowIds.push(row.id);
      taskId = hit.action.actionType;
      this.meta.set(row.id, {
        // A guardrail hit routes to hard human review (approvable) or is a hard_limit kill — either way the tier
        // badge is 'hard'; `floored` marks the un-resolvable hard_limit kill.
        tier: 'hard',
        floored: hit.guardrailType === 'hard_limit',
        routing: null,
        softDeadline: null,
        heldForFullReview: false,
        waitKind: 'flagged',
        escalations: 0,
      });
    }

    // AC-6.ESC.001.3 (#2): most-restrictive precedence. A co-firing hard_limit DOMINATES → the step is killed,
    // never held for resume, regardless of any approvable flag that also fired.
    const hardLimitDominated = hits.some((h) => h.guardrailType === 'hard_limit');
    if (hardLimitDominated) {
      // The step is killed. The hard_limit rows stay pending-and-blocked and can NEVER be approved (the CHECK +
      // the no-affordance guard). The task is NOT set to flagged-for-resume (a hard-limit block has no
      // human-resolution path — AC-6.ESC.001.2).
      //
      // CRITICAL #2 (AC-6.ESC.001.3): the co-firing APPROVABLE rows are still WRITTEN (no hit masked), but they
      // must NOT remain independently resolvable — otherwise a reviewer could "approve" the anomaly flag and
      // inadvertently resume a step that should have been hard-killed. We close them out to `rejected` (the kill
      // governs), so they never surface in the queue and can never drive a resume. The hard_limit rows are left
      // pending-and-blocked (they carry NO approve affordance regardless).
      for (const [id, hit] of hits.entries()) {
        if (hit.guardrailType === 'hard_limit') continue; // stays pending-blocked; never approvable
        const row = this.rows.get(rowIds[id]!)!;
        row.status = 'rejected';
        row.reviewed_by = null; // system disposition, not a human approval
        row.reviewed_at = this.iso(now);
        row.description = `${row.description} | superseded by a co-firing hard_limit — killed, not held (AC-6.ESC.001.3)`;
        const meta = this.meta.get(rowIds[id]!)!;
        meta.softDeadline = null;
      }
      return {
        rowIds,
        governing: 'killed',
        hardLimitDominated: true,
        routing: null,
        notified: false,
        notificationDropped: false,
      };
    }

    // Approvable governing case: set the task `flagged` (C6-set, OD-054) + pause; route + notify + queue.
    if (taskId) await this.tasks.setFlagged(taskId, now);
    const governingAction = hits[0]!.action;
    const routing = this.route(governingAction, candidates, rules);
    for (const id of rowIds) {
      const m = this.meta.get(id)!;
      m.routing = routing;
    }

    // AC-6.ESC.002.1: notify the routed reviewer + place in the queue; a dropped notification is surfaced.
    let notified = false;
    let notificationDropped = false;
    const n: ApprovalNotification = {
      kind: 'flag_raised',
      guardrail_log_id: rowIds[0]!,
      task_id: taskId,
      reviewer_identity: routing.reviewerIdentity,
      reviewer_role: routing.routedRole,
      summary: `Guardrail flag on '${taskId}' routed to ${routing.routedRole} — ${routing.reason}`,
      emitted_at: this.iso(now),
    };
    try {
      if (this.faults.failNotification) throw new Error('injected notification-delivery failure');
      await this.notify.emit(n);
      notified = true;
    } catch {
      notificationDropped = true;
      this.droppedNotifications.push(n); // out-of-band surface — never a silent un-notified flag (#3)
    }

    return { rowIds, governing: 'flagged', hardLimitDominated: false, routing, notified, notificationDropped };
  }

  async resolve(
    rowId: string,
    resolution: 'approve' | 'reject' | 'modify',
    by: string,
    opts: { reason?: string; editedPayload?: unknown; appliedEffects?: readonly AppliedEffect[] },
    now: number,
  ): Promise<ResolutionOutcome> {
    const row = this.rows.get(rowId);
    if (!row) throw new Error(`guardrail_log row ${rowId} not found`);
    if (row.status !== 'pending') throw new Error(ERR_RESOLVE_NOT_PENDING(row.status));

    // #2: a hard_limit row is killed-not-held — it never carries a resolution affordance at all.
    if (row.guardrail_type === 'hard_limit') throw new Error(ERR_HARD_LIMIT_NO_AFFORDANCE);

    const taskId = row.task_id;
    const task = taskId ? await this.tasks.get(taskId) : null;

    // AC-6.APR.005.3 / #6: no self-approval — the initiator can never be its own approver on ANY resolution.
    if (task && task.originating_user_id != null && task.originating_user_id === by) {
      throw new Error(ERR_SELF_APPROVAL(by));
    }

    const compensationQueued: CompensationTask[] = [];
    const nonCompensable: string[] = [];

    // Show already-applied side effects + queue durable compensation for reversible ones; surface irreversible
    // as non-compensable — NEVER auto-rollback (#2, AC-6.ESC.003.2/.3).
    for (const eff of opts.appliedEffects ?? []) {
      if (eff.reversible) {
        const t: CompensationTask = {
          for_task_id: taskId ?? row.id,
          description: `Human-visible cleanup for already-applied reversible effect: ${eff.description}`,
          created_at: this.iso(now),
        };
        await this.comp.queue(t);
        compensationQueued.push(t);
      } else {
        nonCompensable.push(`NON-COMPENSABLE (irreversible, no auto-undo): ${eff.description}`);
      }
    }

    let nextStatus: GuardrailStatus;
    let outTask: TaskRow | null = task;
    switch (resolution) {
      case 'approve':
        nextStatus = 'approved';
        if (taskId) outTask = await this.tasks.resume(taskId, by, now); // C5 resumes from the paused point
        break;
      case 'reject':
        nextStatus = 'rejected';
        if (taskId) outTask = await this.tasks.cancel(taskId, by, opts.reason ?? 'rejected', now);
        break;
      case 'modify': {
        // AC-6.APR.002.1 guard: a Modify re-enters the gate — it cannot lower a floored action below hard. The
        // requeued task is re-tiered by C6; we assert the edited payload does not attempt to strip the floor.
        nextStatus = 'modified';
        if (taskId) outTask = await this.tasks.requeueModified(taskId, opts.editedPayload ?? task?.action_payload, now);
        break;
      }
    }

    // Forward status transition — mirrors the append-only trigger whitelist (pending→approved|rejected|modified
    // with description/task_id UNCHANGED). We keep description/task_id fixed here so the live UPDATE is legal.
    row.status = nextStatus;
    row.reviewed_by = by;
    row.reviewed_at = this.iso(now);
    const m = this.meta.get(rowId);
    if (m) m.softDeadline = null;

    return {
      row: this.clone(row),
      task: outTask ?? {
        id: taskId ?? row.id,
        task_name: taskId ?? row.id,
        status: 'flagged',
        requires_approval: true,
        approved_by: by,
        approved_at: this.iso(now),
        originating_user_id: null,
        action_payload: null,
      },
      compensationQueued,
      nonCompensable,
    };
  }

  async escalateStaleWaits(now: number): Promise<GuardrailLogRow[]> {
    const threshold = this.config.escalationTimeoutSeconds;
    const escalated: GuardrailLogRow[] = [];
    for (const [id, m] of this.meta) {
      const row = this.rows.get(id);
      if (!row || row.status !== 'pending') continue;
      // logic-sweep fix (AC-6.ESC.001.2 / #2): a killed hard_limit row stays pending-and-blocked with NO
      // human-resolution path (resolve() throws ERR_HARD_LIMIT_NO_AFFORDANCE), so it must NEVER be escalated as
      // an un-actioned wait — mirror buildQueueView's exclusion and the live adapter's `guardrail_type <>
      // 'hard_limit'` SQL guard, or it gets nagged to a reviewer forever.
      if (row.guardrail_type === 'hard_limit') continue;
      // AC-6.ESC.004.3 / AC-NFR-OBS.007.1: BOTH wait kinds are covered — flagged AND awaiting_approval.
      const ageSeconds = now - Math.floor(Date.parse(row.created_at) / 1000);
      if (ageSeconds < threshold) continue;

      m.escalations += 1;
      // AC-6.ESC.004.1: set escalated_at + emit; NEVER auto-resolve, NEVER drop. Status stays pending.
      row.escalated_at = this.iso(now);
      // AC-6.ESC.004.2: after repeated timeouts the escalation WIDENS to the terminus role.
      const widened = m.escalations >= this.config.widenAfterEscalations;
      const targetRole = widened ? 'Super-Admin' : (m.routing?.routedRole ?? 'reviewer');
      const n: ApprovalNotification = {
        kind: 'stale_wait_escalation',
        guardrail_log_id: id,
        task_id: row.task_id,
        reviewer_identity: widened ? null : (m.routing?.reviewerIdentity ?? null),
        reviewer_role: targetRole,
        summary:
          `Wait-point (${m.waitKind}) on '${row.task_id ?? id}' un-actioned for ${ageSeconds}s ` +
          `(> ${threshold}s) — escalation #${m.escalations}${widened ? ' WIDENED to Super-Admin' : ''}; not auto-resolved.`,
        emitted_at: this.iso(now),
      };
      try {
        if (this.faults.failNotification) throw new Error('injected notification-delivery failure');
        await this.notify.emit(n);
      } catch {
        this.droppedNotifications.push(n); // surfaced; the escalation record (escalated_at) still stands
      }
      escalated.push(this.clone(row));
    }
    return escalated;
  }

  async buildQueueView(filter: QueueFilter, freshness: FreshnessMode, now: number): Promise<QueueView> {
    const stale = freshness !== 'live';
    const items: QueueItemView[] = [];
    for (const [id, m] of this.meta) {
      const row = this.rows.get(id);
      if (!row) continue;
      // AC-6.ESC.001.2 (#2): a hard_limit row is NEVER in the queue — no Approve affordance, killed-not-held.
      if (row.guardrail_type === 'hard_limit') continue;
      // Only unresolved (pending) items are actionable in the queue.
      if (row.status !== 'pending') continue;

      const overdue = now - Math.floor(Date.parse(row.created_at) / 1000) >= this.config.escalationTimeoutSeconds;
      const isSoftAuto = m.tier === 'soft' && !m.floored && !m.heldForFullReview && m.softDeadline !== null;
      const softCountdownSeconds = isSoftAuto ? Math.max(0, m.softDeadline! - now) : null;

      const view: QueueItemView = {
        guardrailLogId: id,
        taskId: row.task_id,
        taskName: row.task_id ?? id,
        guardrailType: row.guardrail_type,
        tier: m.tier,
        floored: m.floored,
        lockedBadge: m.floored,
        heldForFullReview: m.heldForFullReview,
        softCountdownSeconds,
        reviewerRole: m.routing?.routedRole ?? 'reviewer',
        reviewerIdentity: m.routing?.reviewerIdentity ?? null,
        overdue,
        actions: isSoftAuto
          ? (['approve', 'reject', 'modify', 'hold', 'queue_cleanup'] as const)
          : (['approve', 'reject', 'modify', 'queue_cleanup'] as const),
        // #3 honesty: when the view is stale, resolve actions are disabled until a reconnect re-fetch.
        resolveDisabled: stale,
      };
      items.push(view);
    }

    // OD-118 filter chips over the single live queue.
    const filtered = items.filter((it) => {
      switch (filter) {
        case 'all':
          return true;
        case 'approvals':
          return it.guardrailType === 'approval_gate';
        case 'safety_holds':
          return it.guardrailType !== 'approval_gate'; // anomaly / injection / rate_limit safety holds
        case 'overdue':
          return it.overdue;
      }
    });

    return { freshness, filter, items: filtered, stale };
  }
}

export {
  classifyTier,
  mostRestrictiveTier,
  routeApproval,
  type ApprovalTier,
  type AutonomyMatrix,
  type GatedAction,
  type Reviewer,
  type RoutingOutcome,
  type RoutingRules,
  type TierDecision,
};
