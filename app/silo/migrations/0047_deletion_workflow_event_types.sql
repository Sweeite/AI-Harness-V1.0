-- Client-silo migration 0047 — deletion-workflow event_type values (ISSUE-082, C10 individual right-to-erasure workflow)
--
-- WHY: FR-10.DEL.001 requires the erasure-request lifecycle (received / authorised / executed / rejected) + the
-- held/blocked/escalated states to be observable on event_log (#3 — a deletion request must never be silently dropped
-- or silently held — a legal-obligation queue with a statutory clock is exactly where silence is a #3 failure). The
-- live adapter (app/compliance-erasure/supabase-store.ts SupabaseDeletionWorkflowStore.emitLifecycle) writes these
-- values. event_type is a FIXED enum with no deletion-workflow members, so a live event_log insert of an unregistered
-- value would throw 22P02 invalid input value for enum event_type (the fake-passes-offline / live-throws class R10 +
-- the offline check gate catch). Each C10 lifecycle event gets its OWN honest type (no conflation with an unrelated
-- signal) — added additively:
--   deletion_request_received          -- a documented erasure request entered the Admin queue (AC-10.DEL.001.1)
--   deletion_request_authorised        -- the first Admin/Super-Admin authorised (perm-checked, own identity)
--   deletion_request_second_authorised -- the second DISTINCT Admin/Super-Admin confirmed (two-person, AC-10.DEL.006.2)
--   deletion_request_rejected          -- a request rejected as not a valid erasure basis (recorded, never dropped)
--   deletion_records_identified      -- Step-1 identification ran (per-class counts recorded, FR-10.DEL.002)
--   deletion_config_fail_closed      -- an unresolvable two-person config read → treated as required (AC-10.DEL.006.4)
--   deletion_request_blocked_frozen  -- an ad-hoc erasure blocked on a frozen/offboarding deployment (AC-10.DEL.007.1)
--   deletion_request_held            -- a partial/failed/indeterminate erasure held + escalated (AC-10.DEL.003.4/.005.3)
--   deletion_request_executed        -- an erasure verified complete + the immutable audit written (AC-10.DEL.005.1)
--
-- The two ESCALATION events (an un-actioned request / an un-acknowledged connector flag past the window) deliberately
-- REUSE the existing baseline value approval_queue_stale (both are approval-style queues, as ISSUE-028 does) -- no new
-- value for those.
--
-- transactional:false -- ALTER TYPE ... ADD VALUE cannot run inside a txn block. IF NOT EXISTS makes it idempotent and
-- resumable. Comments stay semicolon-free (the non-transactional runner splits on the semicolon -- 0007/0011 trap).

alter type event_type add value if not exists 'deletion_request_received';
alter type event_type add value if not exists 'deletion_request_authorised';
alter type event_type add value if not exists 'deletion_request_second_authorised';
alter type event_type add value if not exists 'deletion_request_rejected';
alter type event_type add value if not exists 'deletion_records_identified';
alter type event_type add value if not exists 'deletion_config_fail_closed';
alter type event_type add value if not exists 'deletion_request_blocked_frozen';
alter type event_type add value if not exists 'deletion_request_held';
alter type event_type add value if not exists 'deletion_request_executed';
