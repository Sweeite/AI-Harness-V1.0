-- Migration 0007 — Stage-3 event_type enum expansion. Additive, expand-contract-safe.
--
-- Adds the event_type values two Stage-3 slices write into the append-only event_log sink:
--   ISSUE-013 (auth/session) — the seven login/session security events (FR-0.AUTH.004 / FR-0.SESS.003).
--     Without these, oauthLogin's logEvent('sign_in_success')/logEvent('session_established') would throw
--     `invalid input value for enum event_type` on the live silo → every login fails on an audit write, and
--     the identity_rejected / reuse-detection security events could never be recorded (#1 lost audit / #3).
--   ISSUE-047 (triggers/freeze) — the freeze-block + ingest-failure dispatch events (FR-5.TRG.001 /
--     AC-5.TRG.001.3 / NFR-INF.012 · FR-5.TRG.005 / AC-5.TRG.005.1). Same change-control class as OD-170/OD-179.
-- NOTE: transactional:false migrations are split on the semicolon char without comment-stripping, so comments
-- here must contain no semicolon (it would fragment a comment into a bogus statement). Keep comments clean.
--
-- transactional:false — the runner applies with autocommit (no BEGIN/COMMIT). `ALTER TYPE … ADD VALUE`
-- carries no in-transaction restriction under autocommit, each value commits independently, and IF NOT
-- EXISTS makes every statement idempotent + the migration resumable.

-- ISSUE-013 — auth / session security events (event_log sink · consistent with the existing security events
-- authz_revoked_midtask / rls_harness_divergence already in the enum).
alter type event_type add value if not exists 'sign_in_success';
alter type event_type add value if not exists 'sign_in_failure';
alter type event_type add value if not exists 'session_established';
alter type event_type add value if not exists 'identity_rejected';
alter type event_type add value if not exists 'reuse_detection_revocation';
alter type event_type add value if not exists 'task_continuation';
alter type event_type add value if not exists 'verification_failure';

-- ISSUE-047 — deployment-freeze / ingest dispatch events.
alter type event_type add value if not exists 'dispatch_frozen_blocked';
alter type event_type add value if not exists 'ingest_failure';
