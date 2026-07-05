// @harness/task-queue — ISSUE-048 (C5 QUE). Public surface: the TaskQueue port + in-memory fake reference
// model, the live pg adapter, the status state machine + config knobs + the event_log escalation seam type.
//
// Seams this slice STOPS at (it delivers the audit-record substrate + lifecycle machinery, not the drivers):
//   • TRG (ISSUE-047) creates rows (the four trigger types) → calls enqueue.
//   • JOB (ISSUE-052) owns Inngest retry/DLQ; it writes attempts/next_retry_at (OD-058 projection) and calls
//     recordError on each failed attempt.
//   • C6 (ISSUE-056) owns approval tier/routing + SETS flagged on a guardrail hit → calls setFlagged /
//     approve / reject; no-self-approval (originating_user_id) is enforced there, not here.
//   • ENV (ISSUE-050) owns the task_history originals store the flagged-hold work-in-progress persists to.
//   • C7 (ISSUE-011 event_log; ISSUE-075/076 UI) is the EventSink the staleness escalation writes to.

export {
  type TaskQueue,
  InMemoryTaskQueue,
  type TaskQueueRow,
  type NewTask,
  type ErrorAttempt,
  type WorkInProgress,
  type TaskType,
  type TaskStatus,
  type EscalationEvent,
  type EventSink,
  type QueueConfig,
  TASK_TYPES,
  TASK_STATUSES,
  isTaskType,
  isTaskStatus,
  ALLOWED_TRANSITIONS,
  DEFAULT_QUEUE_CONFIG,
  ERR_DELETE_FORBIDDEN,
  ERR_UNKNOWN_STATUS,
  ERR_BAD_TRANSITION,
  ERR_FLAGGED_NOT_C6,
  ERR_EXECUTE_BLOCKED,
  ERR_APPROVE_NOT_WAITING,
} from './store.ts';
export { SupabaseTaskQueue } from './supabase-store.ts';
