-- Client-silo migration 0042 — memory-maintenance event_type values (ISSUE-027, C2 MNT)
--
-- WHY: ISSUE-027's scheduled + on-signal maintenance jobs record LOUD observability to event_log (#3 — a decay/merge/
-- supersede/expiry job run, a confidence change, a raised dashboard task, and each mutation must never be silent). The
-- live adapter (app/memory-maintenance/supabase-store.ts) writes these four values; event_type is a FIXED enum and they
-- are not in it, so a live event_log insert would throw '22P02 invalid input value for enum event_type' (the
-- fake-passes-offline / live-throws class R10 and the offline check gate catch). Added additively:
--   memory_maintenance_run      -- one per job run (payload jsonb: job, window, counts, missed flag)
--   memory_confidence_changed   -- a confidence lifecycle adjustment (decay/reinforce)
--   memory_maintenance_task     -- a human-facing dashboard task raised by a scan (coverage/structural/relevance erosion)
--   memory_maintenance_mutation -- a merge / supersede / summarise mutation applied through the sole-writer primitives
--
-- The amber/bulk-drop alert deliberately REUSES the existing baseline value memory_confidence_drop (no migration).
--
-- transactional:false -- ALTER TYPE ... ADD VALUE cannot run inside a txn block. IF NOT EXISTS makes it idempotent and
-- resumable. Comments stay semicolon-free (the non-transactional runner splits on the semicolon -- 0007/0011 trap).

alter type event_type add value if not exists 'memory_maintenance_run';
alter type event_type add value if not exists 'memory_confidence_changed';
alter type event_type add value if not exists 'memory_maintenance_task';
alter type event_type add value if not exists 'memory_maintenance_mutation';
