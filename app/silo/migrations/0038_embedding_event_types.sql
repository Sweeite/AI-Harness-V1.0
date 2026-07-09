-- Client-silo migration 0038 — embedding / model-change event_type values (ISSUE-023, C2 VEC)
--
-- WHY: ISSUE-023's model-change orchestration (FR-2.VEC.003) records LOUD observability to event_log (#3 — a REBUILD-
-- class embedding-model change must never be a silent migration): phase transitions, re-embed progress, and — the
-- load-bearing one — the reconcile-gate BLOCKED halt (a partial backfill refused before the destructive contract step).
-- event_type is a FIXED enum and these values are not in it, so a live event_log insert would throw '22P02 invalid input
-- value for enum event_type' (the fake-passes-offline / live-throws class R10 catches — the in-memory fake accepts any
-- string, the DB does not). This adds them additively:
--   • embedding_model_change     -- phase transitions + the read-switch/contract markers (payload: phase, new_model)
--   • embedding_reembed_progress -- reconcile completeness % during backfill (payload: liveRows, validV2Rows, completePct)
--   • embedding_reconcile_blocked -- the contract step BLOCKED on a shortfall (payload: shortfall) — the #3 loud halt
--
-- transactional:false -- ALTER TYPE ... ADD VALUE cannot run inside a txn block. IF NOT EXISTS makes each idempotent
-- and resumable. Comments stay semicolon-free (the non-transactional runner splits on the semicolon -- 0007/0011 trap).

alter type event_type add value if not exists 'embedding_model_change';
alter type event_type add value if not exists 'embedding_reembed_progress';
alter type event_type add value if not exists 'embedding_reconcile_blocked';
