-- Client-silo migration 0039 — memory-write event_type values (ISSUE-024, C2 WRT)
--
-- WHY: ISSUE-024's sole-writer path records LOUD observability to event_log (#3 — a write that supersedes,
-- quarantines, or halts must never be a silent side effect). event_type is a FIXED enum and these values are not
-- in it, so a live event_log insert would throw '22P02 invalid input value for enum event_type' (the
-- fake-passes-offline / live-throws class R10 catches — the in-memory fake accepts any string, the DB does not).
-- The mid-task-authorization halt reuses the baseline authz_revoked_midtask (OD-170) and the successful write
-- reuses the baseline memory_written. This adds the three write-outcome values additively:
--   • memory_write_superseded    -- a soft-conflict CAS-supersede (payload: memory_id, superseded[], on_race)
--   • memory_write_conflict      -- a hard-conflict quarantine into memory_conflicts + the overdue escalation
--   • memory_write_embed_failed  -- FR-2.WRT.007 embed-failure halt (payload: draft_index, reason) before commit
--
-- transactional:false -- ALTER TYPE ... ADD VALUE cannot run inside a txn block. IF NOT EXISTS makes each
-- idempotent and resumable. Comments stay semicolon-free (the non-transactional runner splits on the semicolon
-- -- the 0007/0011 trap).

alter type event_type add value if not exists 'memory_write_superseded';
alter type event_type add value if not exists 'memory_write_conflict';
alter type event_type add value if not exists 'memory_write_embed_failed';
