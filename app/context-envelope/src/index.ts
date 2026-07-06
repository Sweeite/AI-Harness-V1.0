// @harness/context-envelope — ISSUE-050 (C5 ENV). Public surface: the ContextEnvelope structure + manager, the
// durable TaskHistoryStore port + in-memory fake reference model, the live pg adapter, config knobs, helpers.
//
// Seams this slice STOPS at (it delivers the envelope container + compression discipline + originals tail, not
// the drivers):
//   • QUE (ISSUE-048) owns task_queue; task_history.task_id FK-targets task_queue.id (envelope is per-task).
//   • GRP (ISSUE-049) owns the resume-from-first-incomplete-step algorithm; it READS the originals this slice
//     retains (reconstructOriginals / listOriginals) rather than the compressed working envelope.
//   • JOB (ISSUE-052) owns Inngest step-function mapping / retry / DLQ — the runtime home of the live envelope
//     (step-state); this slice is engine-agnostic and keeps the durable originals tail regardless.
//   • ASM (ISSUE-053) populates memory_retrieved + drives per-step execution order.
//   • OPT.003 (ISSUE-054) populates execution_plan.
//   • config-registry §H owns compression_threshold_tokens (already registered); this slice CONSUMES it.

export {
  type ContextEnvelope,
  type StepOutput,
  type NewEnvelope,
  type EnvelopeConfig,
  type TaskHistoryStore,
  ContextEnvelopeManager,
  InMemoryTaskHistoryStore,
  ENVELOPE_FIELDS,
  DEFAULT_ENVELOPE_CONFIG,
  CONFIG_MIN_THRESHOLD,
  estimateTokens,
  summariseOutput,
  ERR_BAD_THRESHOLD,
  ERR_NO_TASK_ID,
  ERR_SUMMARISE_WITHOUT_RETAIN,
} from './store.ts';
export { SupabaseTaskHistoryStore } from './supabase-store.ts';
