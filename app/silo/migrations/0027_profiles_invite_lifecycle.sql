-- Migration 0027 — profiles invite-lifecycle markers (ISSUE-015 / OD-192). Additive, expand-safe.
--
-- OD-192 (operator-resolved: model the invite lifecycle on the existing pending-`profiles` row, no new table).
-- The live invite = a pending profiles row (active=false, token `native-<profileId>`); activation flips
-- active=true. But `profiles` had ONLY `active boolean`, so there was no home for the revoked / bounced
-- lifecycle states — revoke/reissue/resend/markBounced delegated to an unpopulated in-memory fake and returned
-- a silently-wrong live result (#1/#3). Two additive nullable markers close that, matching the house
-- one-way-timestamp pattern (guardrail_log.redacted_at 0015, guardrail_log.escalated_at, task_queue stamps):
--   • revoked_at — set when an issuer revokes a still-pending invite (the invite's token then no longer
--     validates → a revoked invite can never activate, #2). One-way; null for a live invite.
--   • bounced_at — set when the provider reports the setup email bounced (FR-0.INV.007) → the invite reads
--     "undelivered", never a silent "sent" (#3). A delivery-axis marker; does NOT invalidate the token.
--
-- Invite expiry + consumption stay SERVER-SIDE (OD-014 native Supabase token; loadInviteLive reconstructs
-- pending-vs-used from `active` only) — so NO expiry column is owed here. The true server-side token REFRESH on
-- reissue (Supabase generateLink) remains the tracked AF-074 residual; the app-schema lifecycle is complete
-- with these two markers.
--
-- Both columns are nullable with no default → expand-contract-safe (migration-discipline.md): no backfill, no
-- rewrite, forward-compatible. profiles is a regular RLS table (not an audit sink) — existing row policies
-- cover the new columns; no RLS/policy/trigger change is owed. transactional:true — do NOT add BEGIN/COMMIT.
-- Re-runnable (add column if not exists). Mirror into schema.md §1 (profiles).

alter table profiles add column if not exists revoked_at  timestamptz;   -- one-way: issuer pre-use revoke (OD-192)
alter table profiles add column if not exists bounced_at  timestamptz;   -- delivery-axis: setup email bounced (FR-0.INV.007)
