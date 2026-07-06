// @harness/rate-limiting — ISSUE-034 (C3 RL). Public surface: the RateLimiter port + in-memory fake reference
// model, the live pg adapter, the tier-decision types, the call-classification (urgency + risk) types, the
// per-connector config surface + dossier-cap validation, and the event_log emit + idempotency-guard seams.
//
// Seams this slice STOPS at (it delivers the generic rate-limit machinery, not the drivers):
//   • CONN (ISSUE-032) owns the shared ToolRuntime + the idempotency_ledger guard this slice CONSUMES on
//     queue-drain (IdempotencyGuard). tools.risk_level (FR-3.REG.001) is the classifier the runtime supplies
//     into CallContext.
//   • The connector INSTANCES (ISSUE-039 GHL / 040 Google / 041 Slack) supply the REAL caps + honour real
//     Retry-After on top of this generic tracker (AF-093 / AF-104 / AF-086 finalize there, owed-to-live here).
//   • C6 (ISSUE-058) owns the escalation/approval machinery + cost ladder the halt-escalate branch hooks into;
//     this slice only NAMES the rule and EMITS the escalation event.
//   • C7 (ISSUE-011 event_log; ISSUE-076/078 UI) is the EventSink the tier events are emitted onto + the panel
//     that surfaces rate-limit headroom; this slice only EMITS.

export {
  type RateLimiter,
  InMemoryRateLimiter,
  type RateLimiterState,
  newRateLimiterState,
  type RateLimitTrackerRow,
  type DeferredCallRow,
  type DrainOutcome,
  type CallContext,
  type CallUrgency,
  type TierDecision,
  type DecideOpts,
  type RateLimitConfig,
  DEFAULT_RATE_LIMIT_CONFIG,
  type DossierCap,
  type RateLimitEvent,
  type RateLimitEventType,
  type EventSink,
  type IdempotencyGuard,
  type IntentOutcome,
  isHighRisk,
  ERR_NO_TRACKER,
  ERR_LIMIT_ABOVE_CAP,
} from './store.ts';

export { SupabaseRateLimiter } from './supabase-store.ts';
