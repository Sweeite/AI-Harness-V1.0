-- Client-silo migration 0040 — maturity-recompute event_type value (ISSUE-030, C2 MAT)
--
-- WHY: ISSUE-030's Maturity recompute (FR-2.MAT.002) records LOUD observability to event_log (#3 — a stored-Maturity
-- state change and a cold-start latch trip must never be silent). Every per-entity recompute (daily slow-loop or
-- on-write) emits a maturity_recomputed event carrying the filled/expected counts, the new Maturity, the rolled-up
-- avg aggregate, and whether the cold-start mode has deactivated. event_type is a FIXED enum and this value is not in
-- it, so a live event_log insert would throw '22P02 invalid input value for enum event_type' (the fake-passes-offline
-- / live-throws class R10 and the offline check gate catch). This adds it additively:
--   maturity_recomputed -- one per per-entity recompute (payload jsonb: entityId, maturity, filledCount,
--                          expectedCount, trigger daily|on_write, aggregate, coldStartDeactivated)
--
-- transactional:false -- ALTER TYPE ... ADD VALUE cannot run inside a txn block. IF NOT EXISTS makes it idempotent
-- and resumable. Comments stay semicolon-free (the non-transactional runner splits on the semicolon -- 0007/0011 trap).

alter type event_type add value if not exists 'maturity_recomputed';
