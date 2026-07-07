-- Migration 0024 — webhook-auth event_type enum expansion (OD-179 live residual). Additive, expand-contract-safe.
--
-- ISSUE-017 webhook-auth EMITS four observability events onto the append-only event_log (outcome.ts:
-- verified / replay_dropped / rate_throttled, and supabase-store alertSuperAdmins: failure_alert), but the
-- baseline enum admits none of them. Against the live silo an INSERT of any raised `invalid input value for
-- enum event_type` -- every verified-webhook accept and every failure alert threw on its audit write: a #3
-- silent failure and, for a verified-but-unpersisted payload, a #1 knowledge loss. OD-179 resolved the
-- change-control decision but its enum-add migration was never landed -- found by the session-73 hygiene
-- audit (finding B1, live-confirmed: the enum had none of the four). Same class as 0007 and 0011.
--
-- transactional:false -- ALTER TYPE ADD VALUE runs under autocommit (cannot run inside a txn block). Each
-- statement commits independently and IF NOT EXISTS makes it idempotent + the migration resumable. Comments
-- stay semicolon-free (the non-transactional runner splits on the semicolon -- the 0007/0011 live lesson,
-- now also enforced by the discipline linter's no-semicolon-in-comment rule).
--
-- Lockstep guard: webhook-auth freezes this value set in its own package (outcome.ts / supabase-store.ts) and
-- both the in-memory fake and the live adapter reject any unadmitted value, so the enum and the code cannot
-- drift silently.

-- ── ISSUE-017 webhook-auth verify/replay/throttle/alert outcomes ──────────────────────────────────────
alter type event_type add value if not exists 'webhook_verified';
alter type event_type add value if not exists 'webhook_replay_dropped';
alter type event_type add value if not exists 'webhook_rate_throttled';
alter type event_type add value if not exists 'webhook_failure_alert';
