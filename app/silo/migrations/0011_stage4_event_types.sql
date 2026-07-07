-- Migration 0011 — Stage-4 event_type + alert_type enum expansion. Additive, expand-contract-safe.
--
-- Five Stage-4 slices EMIT observability events onto the append-only event_log (and one alert onto the
-- notifications alert_type), but the baseline enums admit none of these values. Against the live silo an
-- INSERT of any would raise `invalid input value for enum event_type` (or alert_type), i.e. every genesis
-- path would throw on its audit write -- a #3 silent-failure and, for a lost activation, a #1. Same class
-- as OD-170 (authz_revoked_midtask / rls_harness_divergence) and the 0007 Stage-3 additions.
--
-- transactional:false -- ALTER TYPE ADD VALUE runs under autocommit (cannot run inside a txn block). Each
-- statement commits independently and IF NOT EXISTS makes it idempotent + the migration resumable. The
-- non-transactional runner splits on the semicolon, so this header (and every comment) stays semicolon-free
-- (the session-69 live lesson -- a comment semicolon fragmented 0007).
--
-- Lockstep guard: each slice freezes its value set in its own package (INVITE_SEED_EVENT_TYPES /
-- RateLimitEventType / OPT_EVENT_TYPES / eventTypeForKind / the REC sinks) and both the in-memory fake and
-- the live adapter reject any unadmitted value -- so the enum here and the code can never drift silently.

-- ── ISSUE-015 invite/seed (FR-0.INV.003/.005/.007) ────────────────────────────────────────────────────
alter type event_type add value if not exists 'email_send_ok';
alter type event_type add value if not exists 'email_send_failed';
alter type event_type add value if not exists 'invite_bounced';
alter type event_type add value if not exists 'account_activated';

-- ── ISSUE-016 support-recovery (FR-0.REC.002/.006/.007) ───────────────────────────────────────────────
alter type event_type add value if not exists 'support_request_created';
alter type event_type add value if not exists 'support_notification_sent';
alter type event_type add value if not exists 'support_notification_failed';
alter type event_type add value if not exists 'support_reescalation';

-- ── ISSUE-034 rate-limiting (FR-3.RL.003/004/005/006 -- loud per-tier events) ─────────────────────────
alter type event_type add value if not exists 'rate_limit_throttled';
alter type event_type add value if not exists 'rate_limit_paused';
alter type event_type add value if not exists 'rate_limit_backoff';
alter type event_type add value if not exists 'rate_limit_halt_escalated';

-- ── ISSUE-036 tool-optimisation (FR-3.OPT.001/.004) ───────────────────────────────────────────────────
alter type event_type add value if not exists 'tool_selection_ask';
alter type event_type add value if not exists 'tool_unavailable';

-- ── ISSUE-049 task-graphs (FR-5.GRP.001 / NFR-PERF.007 config-error signals) ──────────────────────────
alter type event_type add value if not exists 'task_graph_missing';
alter type event_type add value if not exists 'task_graph_chain_depth_over_limit';

-- ── ISSUE-016 support-recovery admin notification (FR-0.REC.006) ──────────────────────────────────────
alter type alert_type add value if not exists 'support_request';
