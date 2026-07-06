// @harness/loops-heartbeat — ISSUE-051 (C5 LOP). Public surface: the LoopRunner port + in-memory fake reference
// model, the boot registration, the live event_log sink adapter, the loop/config/event types.
//
// Seams this slice STOPS at (it drives recurring work; it does not own the work, the queue, or the sinks):
//   • QUE (ISSUE-048) owns task_queue — the runner dispatches through it by idempotency key (imported here).
//   • GRP (ISSUE-049) owns the task-graph idempotency-key machinery this slice CONSUMES (does not build).
//   • JOB (ISSUE-052) owns the Inngest engine/step-retry/DLQ the boot registration targets.
//   • C7 (ISSUE-011 event_log; ISSUE-075/078 UI) is the EventSink the run-log / loop_missed / loop-failure
//     heartbeat write to; C7 owns alert delivery + dashboard rendering. This slice only EMITS.

export {
  type LoopRunner,
  InMemoryLoopRunner,
  registerLoops,
  DEFAULT_LOOPS,
  CADENCE_RANGES,
  DEFAULT_FAILURE_HEARTBEAT_THRESHOLD,
  LOOP_EVENT_TYPES,
  isLoopEventType,
  type LoopDef,
  type LoopConfig,
  type CadenceRange,
  type LoopEvent,
  type LoopEventType,
  type EventSink,
  type WorkUnit,
  type LoopWorkSource,
  type TickResult,
  type TickOutcome,
  ERR_BAD_EVENT_TYPE,
  ERR_EMPTY_SUMMARY,
  ERR_CADENCE_OUT_OF_RANGE,
  ERR_DUP_LOOP,
} from './store.ts';
export { SupabaseEventSink } from './supabase-store.ts';
