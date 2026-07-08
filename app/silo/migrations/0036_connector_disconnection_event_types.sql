-- Client-silo migration 0036 — connector-disconnection event_type values (ISSUE-038, C3 DSC)
--
-- AUTHORED, NOT YET APPLIED (offline overnight build, Session 79). APPLY LIVE after 0034/0035.
--
-- WHY: ISSUE-038 writes its #3-never-silent trail to event_log, whose event_type is a FIXED enum (baseline 0001 +
-- the OD-179 additive extensions). The four coarse disconnection events the DSC slice emits are not in that enum, so
-- a live event_log write would fail (the exact fake-passes-offline / live-throws class R10 catches -- the in-memory
-- sink accepts any string, the DB does not). This adds them additively. The finer detail (which cause, which scope,
-- sent-vs-failed, window-vs-resume-halt) rides in event_log.payload, keeping the enum coarse (4 values, not 7).
--   • connector_disconnected -- FR-3.DSC.001 detection
--   • connector_reconnected  -- FR-3.DSC.003 resolution on reconnect
--   • connector_escalated    -- FR-3.DSC.004 window-unresolved escalation AND the FR-3.DSC.003.2 resume-halt escalate
--   • connector_alert        -- FR-3.DSC.006 expiry alert (payload.outcome = sent | delivery_failed | unresolved_recipient)
--
-- access_audit.audit_type is free text (not an enum), so the pause/resume/resume_halted audit rows need no enum change.
--
-- transactional:false -- ALTER TYPE ... ADD VALUE cannot run inside a txn block (and a later statement using the new
-- value would fail in-txn pre-commit). IF NOT EXISTS makes each idempotent and resumable. Comments stay semicolon-free
-- (the non-transactional runner splits on the semicolon -- the 0007/0011 trap). Same pattern as 0011/0018.

alter type event_type add value if not exists 'connector_disconnected';
alter type event_type add value if not exists 'connector_reconnected';
alter type event_type add value if not exists 'connector_escalated';
alter type event_type add value if not exists 'connector_alert';
