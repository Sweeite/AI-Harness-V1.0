// @harness/trigger-infra — ISSUE-037 (C3 TRIG). Public surface: the generic connector trigger layer +
// the liveness spine. The once-per-connector inbound handler/parser consuming C0's verified event
// (ISSUE-017 seam), the per-vendor scheme-identity table (OD-044; arms held on AF-090/084/083/108/109),
// the no-code event+condition→task config + runtime matching, the per-connector default trigger set with
// enable/disable toggles, and the #3 liveness pair — watch re-arm (FR-3.TRIG.005) + gap detection &
// reconciliation (FR-3.TRIG.006). The connector instances (ISSUE-039/040/041) supply concrete parsers,
// re-arm effects, and history-read effects, and flip their arm ready once the AF is GREEN.

export { type Connector, type VerifiedEvent, CONNECTORS, isConnector } from './seam.js';

export {
  type TriggerStore,
  InMemoryTriggerStore,
  type NormalizedEvent,
  type TriggerCondition,
  type TriggerConditionOp,
  type TriggerRule,
  type DefaultTrigger,
  type WatchState,
  type Watermark,
  type DeliverySample,
  type EventLogRow,
  type AuditRow,
  type NewEvent,
  type NewAudit,
  type ActorType,
  ACTOR_TYPES,
  AUDIT_TYPE_TRIGGER_CONFIG,
  type TriggerEventType,
  TRIGGER_EVENT_TYPES,
  EVT_TRIGGER_INBOUND,
  EVT_TRIGGER_PARSE_FAILED,
  EVT_TRIGGER_FIRED,
  EVT_WATCH_REARMED,
  EVT_WATCH_REARM_FAILED,
  EVT_EVENT_GAP_DETECTED,
  EVT_EVENT_GAP_RECONCILED,
  EVT_DELIVERY_DEGRADED,
  EVT_RECONCILE_SWEEP_FAILED,
} from './store.js';

export {
  type SchemeIdentity,
  type SchemeAlgorithm,
  SCHEME_TABLE,
  schemeFor,
  isArmReady,
} from './scheme.js';

export { type ParseResult, type ConnectorParser, PARSERS, parserFor } from './parser.js';

export {
  type DefaultTriggerSpec,
  type RuleValidation,
  DEFAULT_TRIGGER_SET,
  CFG_WATCH_REARM_LEAD_MINUTES,
  CFG_EVENT_RECONCILIATION_SWEEP_MINUTES,
  validateRule,
  matchesCondition,
  ruleMatches,
} from './config.js';

export {
  type RearmEffect,
  type RearmReport,
  type HistoryReadEffect,
  type SweepReport,
  SLACK_SUCCESS_RATE_DEGRADED_FLOOR,
  runWatchRearm,
  runReconciliationSweep,
} from './liveness.js';

export {
  type LaunchTask,
  type InboundResult,
  type HandleDeps,
  handleInbound,
} from './pipeline.js';

export { SupabaseTriggerStore } from './supabase-store.js';
