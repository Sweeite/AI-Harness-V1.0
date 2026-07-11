-- Client-silo migration 0046 — compliance-erasure event_type values (ISSUE-029, C2 memory-side transitive delete)
--
-- WHY: ISSUE-029 is the ONE sanctioned destructive path (FR-2.MNT.017). An erasure run, and ABOVE ALL a PARTIAL /
-- failed erasure, must be loudly + distinctly observable (#3 — silent residue from a half-applied erasure is exactly
-- the failure AC-2.MNT.017.5 forbids). The loud event sink (app/memory-erasure/supabase-store.ts SupabaseErasureEventSink)
-- writes these two values. No baseline event_type fits (this is destructive, not a routine mutation), and event_type
-- is a FIXED enum, so a live event_log insert of an unregistered value would throw 22P02 invalid input value for enum
-- event_type (the fake-passes-offline / live-throws class R10 + the offline check gate catch). Added additively:
--   memory_erased               -- a compliance erasure run completed (counts only, NO erased PII, AC-7.LOG.006.3)
--   memory_erasure_incomplete   -- a partial/failed erasure was recorded + ESCALATED (the #3 loud signal C10 acts on)
--
-- transactional:false -- ALTER TYPE ... ADD VALUE cannot run inside a txn block. IF NOT EXISTS makes it idempotent and
-- resumable. Comments stay semicolon-free (the non-transactional runner splits on the semicolon -- 0007/0011 trap).

alter type event_type add value if not exists 'memory_erased';
alter type event_type add value if not exists 'memory_erasure_incomplete';
