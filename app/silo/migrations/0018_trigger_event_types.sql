-- Migration 0018 — ISSUE-037 trigger-lifecycle event_type enum expansion. Additive, expand-contract-safe.
--
-- The trigger infra (FR-3.TRIG.001/002/005/006) writes nine lifecycle events into the append-only event_log
-- (inbound received/parsed, malformed-rejected, rule-fired, watch re-armed/failed, event-gap detected/
-- reconciled, delivery degraded, sweep-could-not-run). The baseline event_type enum admits none of them, so
-- a live INSERT would raise invalid input value for enum event_type -- a #3 silent-failure on the trigger
-- liveness spine. Same class as OD-170 and OD-179 (the webhook values) and the 0007/0011 additions.
--
-- transactional:false -- ALTER TYPE ADD VALUE runs under autocommit (cannot run inside a txn block). Each
-- statement commits independently and IF NOT EXISTS makes it idempotent + the migration resumable. NOTE the
-- non-transactional runner splits on the statement terminator, so NO comment in this file may contain one
-- (the 0007/0011 live lesson -- a comment terminator fragments a statement into a syntax error).
--
-- Anti-drift: app/trigger-infra freezes these in TRIGGER_EVENT_TYPES and both the fake and the live adapter
-- reject any value outside the set, so the enum here and the code stay in lockstep. The C7 observability
-- EVENT_TYPES projection is reconciled to include these nine in the same integration (as OD-179 did).

alter type event_type add value if not exists 'trigger_inbound';
alter type event_type add value if not exists 'trigger_parse_failed';
alter type event_type add value if not exists 'trigger_fired';
alter type event_type add value if not exists 'watch_rearmed';
alter type event_type add value if not exists 'watch_rearm_failed';
alter type event_type add value if not exists 'event_gap_detected';
alter type event_type add value if not exists 'event_gap_reconciled';
alter type event_type add value if not exists 'delivery_degraded';
alter type event_type add value if not exists 'reconcile_sweep_failed';
