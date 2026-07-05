// ISSUE-048 (C5 QUE) — the TaskQueue PORT + in-memory fake reference model (the house port+fake pattern,
// cf. app/config-store/src/store.ts, app/webhook-auth). Every live side effect of the task_queue lifecycle
// goes through this port so the logic is unit-testable with NO live DB. The InMemoryTaskQueue fake is BOTH
// the test double AND the reference model the live pg adapter (supabase-store.ts) must match against the DDL
// (results/proposed-migration-0008_task_queue.sql, authored to schema.md §6).
//
// Invariants enforced in the fake EXACTLY as the DB DDL + harness gate would (so a test against the fake
// proves the contract the live silo must uphold) — mapped to the three non-negotiables:
//   FR-5.QUE.001 (#1) task_queue is a PERMANENT audit record — there is NO delete method on the port. The
//                     one test hook `attemptDelete` exists only to PROVE the forbidden path throws.
//   FR-5.QUE.002 (#2) full typed row schema — every §6 column, no client_slug (OD-096), enqueue validates.
//   FR-5.QUE.003 (#3) fixed status state machine over task_status; no null/unknown status ever persists;
//                     `flagged` is C5-DEFINED but only C6 may SET it (setFlagged), distinct from
//                     awaiting_approval; a hold into flagged RETAINS completed-step outputs + envelope (#1).
//   FR-5.QUE.004      priority dequeue: lower number first, config-tunable ordering rule.
//   FR-5.QUE.005 (#2) requires_approval → awaiting_approval blocks execution; approve records approved_by/at
//                     and releases; reject records the outcome and never executes.
//   FR-5.QUE.005.2(#3) awaiting_approval past a configurable threshold ESCALATES on the event_log sink
//                     (alert + badge seam) and stays visibly pending — never auto-approves, never drops
//                     (OD-028/OD-032 escalate-don't-auto-act pattern).
//   FR-5.QUE.006 (#1) error accumulates every attempt's text — NEVER collapsed to a single last-error.

// ── §Types (schema.md L116-117) ──────────────────────────────────────────────────────────────────
export const TASK_TYPES = ['scheduled', 'event', 'human', 'chained'] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_STATUSES = [
  'pending',
  'running',
  'awaiting_approval',
  'completed',
  'failed',
  'flagged',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export function isTaskStatus(v: unknown): v is TaskStatus {
  return typeof v === 'string' && (TASK_STATUSES as readonly string[]).includes(v);
}
export function isTaskType(v: unknown): v is TaskType {
  return typeof v === 'string' && (TASK_TYPES as readonly string[]).includes(v);
}

// ── §6 task_queue row — the full column set, exactly per schema.md §6. NO client_slug (OD-096). ──────
export interface TaskQueueRow {
  id: string;
  type: TaskType;
  task_name: string;
  payload: unknown; // jsonb, default {}
  status: TaskStatus;
  priority: number; // int, default 100; lower = higher priority
  requires_approval: boolean; // default false
  approved_by: string | null; // → profiles(id); recorded on approve
  approved_at: string | null; // iso; recorded on approve
  originating_user_id: string | null; // → profiles(id); net-new
  action_payload: unknown | null; // jsonb; net-new: proposed tool call + params + target
  attempts: number; // int, default 0 (OD-058 Inngest projection)
  next_retry_at: string | null; // OD-058 Inngest projection
  error: ErrorAttempt[]; // full per-attempt history — NEVER collapsed (FR-5.QUE.006)
  completed_at: string | null;
  created_at: string;
}

/** One recorded failure attempt. The `error` column is an append-only array of these — never overwritten
 * to a single last-error (FR-5.QUE.006 / #1). */
export interface ErrorAttempt {
  attempt: number; // 1..N
  message: string;
  at: string; // iso
}

/** The fields a caller may supply on enqueue. Server-owned fields (id/status/attempts/error/timestamps)
 * are never caller-set — enqueue derives them (a defined status is always persisted, #3). */
export interface NewTask {
  type: TaskType;
  task_name: string;
  payload?: unknown;
  priority?: number; // default 100
  requires_approval?: boolean; // default false
  originating_user_id?: string | null;
  action_payload?: unknown | null;
}

/** The completed work-in-progress retained on a task (the AC-5.QUE.003.2 hold invariant): completed-step
 * outputs + a reference to the live context envelope (ISSUE-050 owns the envelope store; this slice only
 * guarantees the reference + outputs SURVIVE a hold into flagged). */
export interface WorkInProgress {
  completed_step_outputs: unknown[]; // outputs of steps that finished before the hold
  envelope_ref: string | null; // pointer to the context envelope (task_history / Inngest step-state)
}

// ── the escalation seam (C7 / ISSUE-011 event_log). This slice EMITS onto it; it does not own it. The port
// mirrors the event_log append shape (schema.md §8) so the live adapter can INSERT the identical row. ──
export interface EscalationEvent {
  task_id: string;
  event_type: 'approval_queue_stale'; // schema.md §Types event_type — the staleness signal
  entity_ids: string[];
  summary: string; // plain-English, never empty (mirrors AC-7.LOG.002.2)
  payload: Record<string, unknown>;
}
/** The event_log sink the staleness escalation writes to (ISSUE-011). A no-op/mock in offline tests. */
export interface EventSink {
  append(ev: EscalationEvent): Promise<void>;
}

// ── the config knobs this slice CONSUMES (Phase-2 registry §12 owns the keys; we do not define them). ──
export interface QueueConfig {
  /** lower number = higher priority. Config-tunable ordering rule (FR-5.QUE.004). */
  priorityOrder: 'asc' | 'desc';
  /** awaiting_approval staleness threshold in seconds (FR-5.QUE.005 / AC-5.QUE.005.2). */
  approvalStalenessThresholdSeconds: number;
}
export const DEFAULT_QUEUE_CONFIG: QueueConfig = {
  priorityOrder: 'asc', // schema default: lower priority number first
  approvalStalenessThresholdSeconds: 24 * 3600, // 24h default; config overrides it
};

// ── the allowed status transitions (FR-5.QUE.003). A hold into `flagged` is reachable from any live state
// (a guardrail can fire at any point) but is C6-set only (setFlagged), NOT via the generic transition().
// `flagged` leaves ONLY by an explicit human review action (requeue → pending, discard → failed, approve →
// running) — never automatically (AC-5.QUE.003.2). ──────────────────────────────────────────────────
// A guardrail (C6) can fire at ANY live point, so `flagged` is a legal target from every non-terminal state
// (pending / running / awaiting_approval). It is reached ONLY via setFlagged (C6-only), never via the generic
// C5 transition() (guarded separately, OD-054). It is NOT reachable from a terminal state (completed/failed).
export const ALLOWED_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  pending: ['running', 'awaiting_approval', 'flagged'],
  running: ['awaiting_approval', 'completed', 'failed', 'flagged'],
  awaiting_approval: ['running', 'completed', 'failed', 'flagged'], // release→running, reject→failed
  flagged: ['pending', 'failed', 'running'], // human review only: requeue / discard / approve
  completed: [], // terminal
  failed: [], // terminal
};

// The exact rejection messages, so a test can assert the same failure the live gate produces.
export const ERR_DELETE_FORBIDDEN =
  'task_queue: DELETE forbidden — permanent audit record, no row is ever deletable (FR-5.QUE.001)';
export const ERR_UNKNOWN_STATUS = (s: unknown) =>
  `task_queue: refusing to persist an undefined/blank status '${String(s)}' (FR-5.QUE.003 / #3)`;
export const ERR_BAD_TRANSITION = (from: TaskStatus, to: TaskStatus) =>
  `task_queue: illegal status transition ${from} → ${to} (not permitted by the state machine, FR-5.QUE.003)`;
export const ERR_FLAGGED_NOT_C6 =
  'task_queue: `flagged` is a C6-set quarantine state — C5 execution may not set it via transition() (OD-054)';
export const ERR_EXECUTE_BLOCKED =
  'task_queue: task is in awaiting_approval — execution is blocked until a human approves (FR-5.QUE.005)';
export const ERR_APPROVE_NOT_WAITING =
  'task_queue: approve/reject is only valid on an awaiting_approval task (FR-5.QUE.005)';

// ── the port. Sync-shaped in the fake, modelled async for the DB adapter. ──────────────────────────
export interface TaskQueue {
  enqueue(task: NewTask, now: number): Promise<TaskQueueRow>;
  get(id: string): Promise<TaskQueueRow | null>;

  /** Dequeue the highest-priority RUNNABLE task (pending, not requires_approval-blocked). If the top task
   * requires approval it is moved to awaiting_approval and NOT returned as runnable (FR-5.QUE.005). Returns
   * the row now running, or the row parked in awaiting_approval, or null if the queue is empty. */
  dequeue(now: number): Promise<TaskQueueRow | null>;

  /** A generic state-machine transition. Rejects a null/unknown target (#3), an illegal edge, and any
   * attempt to reach `flagged` (that is C6-only — use setFlagged). */
  transition(id: string, to: TaskStatus, now: number): Promise<TaskQueueRow>;

  /** C6-only: set the guardrail/quarantine `flagged` hold. RETAINS the row's work-in-progress (#1). */
  setFlagged(id: string, wip: WorkInProgress, now: number): Promise<TaskQueueRow>;

  /** Human approves an awaiting_approval task: record approved_by/approved_at, release to running. */
  approve(id: string, approver: string, now: number): Promise<TaskQueueRow>;
  /** Human rejects an awaiting_approval task: record the outcome (failed) and never execute. */
  reject(id: string, approver: string, reason: string, now: number): Promise<TaskQueueRow>;

  /** Append one attempt's error text — NEVER overwrite the history (FR-5.QUE.006 / #1). */
  recordError(id: string, message: string, now: number): Promise<TaskQueueRow>;

  /** Emit the staleness escalation for every awaiting_approval task older than the config threshold. Returns
   * the escalated rows. Never auto-approves, never drops — the rows stay awaiting_approval (AC-5.QUE.005.2). */
  escalateStaleApprovals(now: number): Promise<TaskQueueRow[]>;
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// In-memory fake — the reference model. Deterministic: a logical `now` (epoch seconds) is supplied by the
// caller; no Date.now()/random (house discipline). There is deliberately NO delete method — the permanent
// audit invariant is structural (FR-5.QUE.001).
// ───────────────────────────────────────────────────────────────────────────────────────────────────
export class InMemoryTaskQueue implements TaskQueue {
  private seq = 0;
  readonly rows = new Map<string, TaskQueueRow>();
  /** the retained work-in-progress for a held (flagged) task — AC-5.QUE.003.2 (#1). */
  readonly heldWork = new Map<string, WorkInProgress>();

  constructor(
    private readonly sink: EventSink,
    private readonly config: QueueConfig = DEFAULT_QUEUE_CONFIG,
  ) {}

  private nextId(): string {
    this.seq += 1;
    return `task-${String(this.seq).padStart(4, '0')}`;
  }
  private iso(now: number): string {
    return new Date(now * 1000).toISOString();
  }

  async enqueue(task: NewTask, now: number): Promise<TaskQueueRow> {
    if (!isTaskType(task.type)) {
      throw new Error(`task_queue: unknown task type '${String(task.type)}' (FR-5.QUE.002)`);
    }
    if (typeof task.task_name !== 'string' || task.task_name.length === 0) {
      throw new Error('task_queue: task_name is required and non-empty (FR-5.QUE.002)');
    }
    const priority = task.priority ?? 100; // schema default
    if (!Number.isInteger(priority)) {
      throw new Error('task_queue: priority must be an integer (FR-5.QUE.002)');
    }
    const row: TaskQueueRow = {
      id: this.nextId(),
      type: task.type,
      task_name: task.task_name,
      payload: task.payload ?? {}, // schema default '{}'
      status: 'pending', // schema default — a DEFINED status always persists (#3)
      priority,
      requires_approval: task.requires_approval ?? false,
      approved_by: null,
      approved_at: null,
      originating_user_id: task.originating_user_id ?? null,
      action_payload: task.action_payload ?? null,
      attempts: 0,
      next_retry_at: null,
      error: [], // full per-attempt history starts empty (never a scalar last-error)
      completed_at: null,
      created_at: this.iso(now),
    };
    this.rows.set(row.id, row);
    return { ...row, error: [...row.error] };
  }

  async get(id: string): Promise<TaskQueueRow | null> {
    const r = this.rows.get(id);
    return r ? { ...r, error: [...r.error] } : null;
  }

  private mustGet(id: string): TaskQueueRow {
    const r = this.rows.get(id);
    if (!r) throw new Error(`task_queue: no such task '${id}'`);
    return r;
  }

  async dequeue(now: number): Promise<TaskQueueRow | null> {
    // Runnable = status 'pending'. Order by priority per the config rule (lower first when asc), then FIFO by
    // created_at as the deterministic tiebreak (FR-5.QUE.004).
    const pending = [...this.rows.values()].filter((r) => r.status === 'pending');
    if (pending.length === 0) return null;
    pending.sort((a, b) => {
      const cmp = this.config.priorityOrder === 'asc' ? a.priority - b.priority : b.priority - a.priority;
      if (cmp !== 0) return cmp;
      return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
    });
    const top = pending[0]!;
    if (top.requires_approval) {
      // FR-5.QUE.005: an approval-gated task moves to awaiting_approval and does NOT run.
      this.applyTransition(top, 'awaiting_approval', now);
      return { ...top, error: [...top.error] };
    }
    this.applyTransition(top, 'running', now);
    return { ...top, error: [...top.error] };
  }

  /** Internal: apply a validated transition IN PLACE. Callers must have validated the edge. */
  private applyTransition(row: TaskQueueRow, to: TaskStatus, now: number): void {
    if (!isTaskStatus(to)) throw new Error(ERR_UNKNOWN_STATUS(to));
    row.status = to;
    if (to === 'completed' || to === 'failed') row.completed_at = this.iso(now);
  }

  async transition(id: string, to: TaskStatus, now: number): Promise<TaskQueueRow> {
    const row = this.mustGet(id);
    // #3: a null/unknown status is never persisted.
    if (!isTaskStatus(to)) throw new Error(ERR_UNKNOWN_STATUS(to));
    // OD-054: `flagged` is C6-only — the generic C5 transition path may not reach it.
    if (to === 'flagged') throw new Error(ERR_FLAGGED_NOT_C6);
    const allowed = ALLOWED_TRANSITIONS[row.status];
    if (!allowed.includes(to)) throw new Error(ERR_BAD_TRANSITION(row.status, to));
    this.applyTransition(row, to, now);
    return { ...row, error: [...row.error] };
  }

  async setFlagged(id: string, wip: WorkInProgress, now: number): Promise<TaskQueueRow> {
    const row = this.mustGet(id);
    if (row.status === 'flagged') return { ...row, error: [...row.error] }; // idempotent
    // A guardrail can fire from any live state; the edge to flagged must be one the machine permits.
    if (!ALLOWED_TRANSITIONS[row.status].includes('flagged')) {
      throw new Error(ERR_BAD_TRANSITION(row.status, 'flagged'));
    }
    // AC-5.QUE.003.2 (#1): the held task's work-in-progress (completed-step outputs + envelope) is RETAINED
    // with the record — never discarded on the hold.
    this.heldWork.set(id, {
      completed_step_outputs: [...wip.completed_step_outputs],
      envelope_ref: wip.envelope_ref,
    });
    row.status = 'flagged';
    return { ...row, error: [...row.error] };
  }

  async approve(id: string, approver: string, now: number): Promise<TaskQueueRow> {
    const row = this.mustGet(id);
    if (row.status !== 'awaiting_approval') throw new Error(ERR_APPROVE_NOT_WAITING);
    row.approved_by = approver;
    row.approved_at = this.iso(now);
    this.applyTransition(row, 'running', now); // release to execution
    return { ...row, error: [...row.error] };
  }

  async reject(id: string, approver: string, reason: string, now: number): Promise<TaskQueueRow> {
    const row = this.mustGet(id);
    if (row.status !== 'awaiting_approval') throw new Error(ERR_APPROVE_NOT_WAITING);
    // Record the outcome (who + why + when) and do NOT execute — moves to failed (terminal, recorded).
    row.approved_by = approver;
    row.approved_at = this.iso(now);
    row.error.push({ attempt: row.attempts + 1, message: `approval rejected: ${reason}`, at: this.iso(now) });
    this.applyTransition(row, 'failed', now);
    return { ...row, error: [...row.error] };
  }

  async recordError(id: string, message: string, now: number): Promise<TaskQueueRow> {
    const row = this.mustGet(id);
    // FR-5.QUE.006 (#1): APPEND — never overwrite. attempts increments; each attempt's text is recoverable.
    row.attempts += 1;
    row.error.push({ attempt: row.attempts, message, at: this.iso(now) });
    return { ...row, error: [...row.error] };
  }

  async escalateStaleApprovals(now: number): Promise<TaskQueueRow[]> {
    const threshold = this.config.approvalStalenessThresholdSeconds;
    const escalated: TaskQueueRow[] = [];
    for (const row of this.rows.values()) {
      if (row.status !== 'awaiting_approval') continue;
      const ageSeconds = now - Math.floor(Date.parse(row.created_at) / 1000);
      if (ageSeconds < threshold) continue;
      // AC-5.QUE.005.2: EMIT the escalation (alert + badge seam) and LEAVE the task awaiting_approval.
      // Never auto-approve (#2), never drop (#3). Idempotence of the sink is the sink's concern (ISSUE-011).
      await this.sink.append({
        task_id: row.id,
        event_type: 'approval_queue_stale',
        entity_ids: [row.id],
        summary: `Task '${row.task_name}' has been awaiting approval for ${ageSeconds}s (> ${threshold}s threshold) — escalating; not auto-approved.`,
        payload: { task_id: row.id, age_seconds: ageSeconds, threshold_seconds: threshold, status: row.status },
      });
      escalated.push({ ...row, error: [...row.error] });
      // NB: status is intentionally UNCHANGED — the task stays visibly pending approval.
    }
    return escalated;
  }

  // ── test/contract hook — PROVE the forbidden delete path. There is no delete method on the port; this
  // exists so the reference model can assert FR-5.QUE.001 (#1): a task_queue row is never deletable. ──
  attemptDelete(_id: string): void {
    throw new Error(ERR_DELETE_FORBIDDEN);
  }
}
