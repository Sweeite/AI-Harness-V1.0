// @harness/task-graphs — ISSUE-049 (C5 GRP). Public surface: the versioned task-graph store (append-only by
// version, change-control), the dependency-order resolver + chain-depth ceiling, per-task/per-step idempotency
// key derivation (ADR-004 §4 ledger pattern), and the resume-from-first-incomplete-step executor. Port +
// in-memory fake reference models + live pg adapters (authored, NOT run live).
//
// Seams this slice STOPS at (consumes, does not build):
//   • QUE (ISSUE-048, @harness/task-queue) owns the task_queue row + status machine; a dequeued row's `type`
//     is what resolveGraph() looks up. This slice imports task-queue's TaskType for the resolution key.
//   • JOB (ISSUE-052) owns the Inngest execution engine; it REALISES resume by mapping each resolved graph
//     step to an Inngest step function and driving GraphExecutor.execute with a real RunStep + step retry/DLQ.
//   • ENV (ISSUE-050) owns the task_history originals store this slice READS on resume (HistoryStore port).
//   • C7 (ISSUE-011 event_log) is the ConfigErrorSink the graph-less / over-limit config errors record onto.
//   • PLAN (ISSUE-064 / FR-8.PLAN.003) shares the chain_depth_limit enforcement point (here: graph property).

// The dequeue→graph resolution key is the task_queue row's `type` (@harness/task-queue, ISSUE-048). Re-exported
// so a consumer resolving a graph for a dequeued row uses the same TaskType union, not a redefined string. The
// sibling package ships no build artefact (source-only, like every app/* package here), so we import its source
// via the package subpath — resolved through the `file:` symlink the fan-out install created. We import from the
// sibling's `store.ts` (its pure port/model module) rather than its `index.ts`, so we do NOT drag in ISSUE-048's
// live pg adapter (which needs task-queue's OWN node_modules for `pg`, absent in this isolated build). This is a
// READ-ONLY consumption of ISSUE-048's public types; this slice never edits the task-queue package.
export { type TaskType, type TaskQueueRow, TASK_TYPES } from '@harness/task-queue/src/store.ts';

export {
  // step / graph model
  type StepKind,
  type FailureMode,
  type GraphStep,
  type TaskGraphVersionRow,
  type NewGraphVersion,
  type TaskHistoryRow,
  STEP_KINDS,
  FAILURE_MODES,
  // config
  type GraphConfig,
  DEFAULT_GRAPH_CONFIG,
  type ChainDepthOutcome,
  // idempotency-key derivation (pure)
  canonicalJson,
  fnv1a64Hex,
  stepIdempotencyKey,
  taskIdempotencyKey,
  // dependency-order + validation (pure)
  resolveDependencyOrder,
  validateSteps,
  // ports + fakes
  type GraphStore,
  InMemoryGraphStore,
  type HistoryStore,
  InMemoryHistoryStore,
  type IdempotencyLedger,
  type LedgerEntry,
  InMemoryIdempotencyLedger,
  LEDGER_CONNECTOR,
  // executor / resume
  type RunStep,
  type StepResult,
  type ExecuteResult,
  GraphExecutor,
  CrashWindowError,
  // config-error sink seam
  type ConfigErrorEvent,
  type ConfigErrorSink,
  CONFIG_ERROR_EVENT_TYPE,
  ADMITTED_EVENT_TYPES,
  eventTypeForKind,
  EnumCheckingConfigErrorSink,
  // exact error/outcome strings (so a consumer can assert the same failures)
  ERR_NO_GRAPH,
  ERR_EMPTY_CHANGE_REASON,
  ERR_DUP_STEP_ID,
  ERR_UNKNOWN_DEP,
  ERR_CYCLE,
  ERR_OVER_LIMIT,
  ERR_BAD_STEP,
} from './store.ts';

export {
  SupabaseGraphStore,
  SupabaseHistoryStore,
  SupabaseIdempotencyLedger,
  SupabaseConfigErrorSink,
} from './supabase-store.ts';
