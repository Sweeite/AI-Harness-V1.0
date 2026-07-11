-- Client-silo migration 0044 — conflict-consolidation event_type values (ISSUE-028, C2 conflict quarantine + consolidation)
--
-- WHY: ISSUE-028's review paths record LOUD observability to event_log (#3 — a reviewer resolving a quarantined hard
-- conflict, a Personal-tier candidate withheld from auto-consolidation, and a consolidation approve/reject must never
-- be silent). The live adapter (app/conflict-consolidation/supabase-store.ts) writes these three values. event_type is
-- a FIXED enum and they are not in it, so a live event_log insert would throw 22P02 invalid input value for enum
-- event_type (the fake-passes-offline / live-throws class R10 and the offline check gate catch). Added additively:
--   memory_conflict_resolved       -- a reviewer resolved a quarantined hard conflict (keep-new / keep-existing / keep-both)
--   memory_consolidation_queued    -- a Personal-tier candidate was skipped from auto-consolidation + queued for approval
--   memory_consolidation_resolved  -- a Personal-tier consolidation was approved or rejected
--
-- The un-actioned to escalated alert on BOTH queues deliberately REUSES the existing baseline value
-- approval_queue_stale (both queues are approval queues) -- no migration for that one.
--
-- transactional:false -- ALTER TYPE ... ADD VALUE cannot run inside a txn block. IF NOT EXISTS makes it idempotent and
-- resumable. Comments stay semicolon-free (the non-transactional runner splits on the semicolon -- 0007/0011 trap).

alter type event_type add value if not exists 'memory_conflict_resolved';
alter type event_type add value if not exists 'memory_consolidation_queued';
alter type event_type add value if not exists 'memory_consolidation_resolved';
