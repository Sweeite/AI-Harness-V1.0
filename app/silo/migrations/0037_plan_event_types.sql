-- Client-silo migration 0037 — execution-plan event_type values (ISSUE-064, C8 PLAN)
--
-- AUTHORED, NOT YET APPLIED (offline overnight build, Session 79). APPLY LIVE anytime (no dependency on 0034–0036).
--
-- WHY: ISSUE-064 records a version→outcome attribution (FR-8.PLAN.004.1) and a human-rollback audit (FR-8.PLAN.004.2)
-- to event_log, whose event_type is a FIXED enum. The two coarse plan events are not in it, so a live insert would
-- throw '22P02 invalid input value for enum event_type' (the fake-passes-offline / live-throws class R10 catches --
-- the in-memory fake accepts any string, the DB does not). This adds them additively:
--   • plan_outcome  -- FR-8.PLAN.004.1 a run outcome attributed to a plan version (payload carries plan_version_id + status)
--   • plan_rollback -- FR-8.PLAN.004.2 a HUMAN-decided, authority-gated, audited rollback (payload carries actor + from/to/new)
--
-- transactional:false -- ALTER TYPE ... ADD VALUE cannot run inside a txn block. IF NOT EXISTS makes each idempotent
-- and resumable. Comments stay semicolon-free (the non-transactional runner splits on the semicolon -- 0007/0011 trap).

alter type event_type add value if not exists 'plan_outcome';
alter type event_type add value if not exists 'plan_rollback';
