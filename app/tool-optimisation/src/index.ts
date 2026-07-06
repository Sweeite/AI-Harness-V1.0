// @harness/tool-optimisation — ISSUE-036 (C3 OPT). The four generic-runtime cost/quality optimisations
// built ONCE into the shared connector runtime (ISSUE-032) so every connector inherits them:
//   • confidenceGate         — FR-3.OPT.001: below CFG-tool_selection_confidence_threshold → ask, log it.
//   • RunReadCache           — FR-3.OPT.002: repeat identical read served from cache; a write is
//                              structurally ineligible (never cached, never served); discarded at run end.
//   • planBatches / clamp    — FR-3.OPT.003: group batch-eligible reads to the connector's documented
//                              limit; clamp/reject over-limit; non-batching → individual calls.
//   • degrade / assertConsumable — FR-3.OPT.004: a missing tool logs the gap, completes the doable part,
//                              and attaches a STRUCTURED, MANDATORY-TO-READ gap field; a blocking
//                              dependency raises a recoverable pause, never a hard fail (#3).
// Rests on ADR-007 (containment-first) + ADR-004 (idempotency = the write-side guard that pairs with
// never-cache-writes). No schema of its own; consumes the ISSUE-032 read/write category branch + tools,
// and emits its two observability events to event_log via the OptEventSink port.

export {
  type OptConfig,
  DEFAULT_OPT_CONFIG,
  type OptEventType,
  OPT_EVENT_TYPES,
  type OptEvent,
  type OptEventSink,
  type ResultGap,
  type GapReason,
  GAP_REASONS,
  type DegradableResult,
  type ToolRow,
  type ToolCategory,
} from './store.js';

export { InMemoryOptEventSink } from './fake.js';

export { confidenceGate, type GateDecision, type GateInput } from './confidence-gate.js';

export { RunReadCache, WriteNotCacheableError, type CacheStats } from './run-cache.js';

export {
  planBatches,
  assertWithinLimit,
  clampBatch,
  OverLimitBatchError,
  type BatchCapability,
  type BatchPlan,
} from './batch.js';

export {
  degrade,
  isComplete,
  hasUnacknowledgedGap,
  acknowledgeGap,
  assertConsumable,
  UnreadGapError,
  type Degradation,
} from './degrade.js';

export { SupabaseOptEventSink } from './supabase-store.js';
