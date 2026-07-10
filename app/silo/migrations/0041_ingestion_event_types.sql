-- Client-silo migration 0041 — ingestion filter/audit event_type value (ISSUE-026, C2 ING)
--
-- WHY: ISSUE-026's two ingestion filters + the sampled-drop audit record LOUD observability to event_log (#3 — a
-- Filter-1/Filter-2 decision and an audit run must never be silent). The live adapter (app/ingestion/supabase-store.ts
-- filterDecision + auditRun) writes an ingestion_filtered event carrying the filter, verdict, and reason. event_type is
-- a FIXED enum and this value is not in it, so a live event_log insert would throw '22P02 invalid input value for enum
-- event_type' (the fake-passes-offline / live-throws class R10 and the offline check gate catch). This adds it
-- additively:
--   ingestion_filtered -- one per filter decision / sampled-drop audit run (payload jsonb: kind, filter, verdict, reason)
--
-- The escalation signal deliberately REUSES the existing baseline value approval_queue_stale (no migration for that).
--
-- transactional:false -- ALTER TYPE ... ADD VALUE cannot run inside a txn block. IF NOT EXISTS makes it idempotent and
-- resumable. Comments stay semicolon-free (the non-transactional runner splits on the semicolon -- 0007/0011 trap).

alter type event_type add value if not exists 'ingestion_filtered';
