-- Client-silo migration 0045 — memories.derived_from provenance edge (OD-204 — unblocks ISSUE-029 transitive erasure)
--
-- WHY: ISSUE-029's compliance-erasure walk (FR-2.MNT.017 / AC-2.MNT.017.3) must reach the merge-collapsed rows
-- (FR-2.MNT.005) and episodic->semantic summary rows (FR-2.MNT.007) that were DERIVED from an erased Personal source,
-- so Personal content cannot survive re-tagged Standard/Confidential inside a surviving derived row. ISSUE-027 already
-- COMPUTES that source set (insertDerivedMemory(row, derivedFrom)) but as built it wrote derivedFrom to an event_log
-- payload ONLY (append-only observability, not a queryable edge) -- see OD-204. There was NO derived_from column or
-- link table on memories, so the erasure walk had nothing to query. Without it, an erased source row could leave its
-- content alive inside a merged/summary row -- the exact residue AC-2.MNT.017.3 forbids (a #1 knowledge-not-erased +
-- #2 Personal-data-broadened hole). OD-204 option (A): persist the edge queryably.
--
-- WHAT: an additive, nullable uuid[] column on memories naming the source memory ids a derived (merge/summary) row was
-- built from. null / empty = not a derived row (a directly-written memory). ISSUE-027's live adapter now populates it on
-- every insertDerivedMemory. The erasure walk queries it (derived_from && ARRAY[<erased ids>]) to reach derived rows.
-- A GIN index makes the containment/overlap lookup cheap (mirrors the existing memories_entity_ids_gin pattern).
--
-- Additive + nullable => existing rows are untouched (they are non-derived, correctly null). No backfill: pre-0045
-- derived rows predate any live memory data (build phase, silos seeded empty) so there is no historical edge to recover.
-- transactional:false -- the GIN index is built CONCURRENTLY (migration-discipline.md L39 -- a deploy must never lock
-- memories), and CREATE INDEX CONCURRENTLY cannot run inside a txn block, so the runner applies this file under
-- autocommit. ADD COLUMN (nullable, no rewrite) + COMMENT are autocommit-safe. IF NOT EXISTS makes every statement
-- idempotent + resumable. Comments stay semicolon-free (the non-transactional runner splits on the semicolon -- the
-- 0007/0011 trap). Mirrors the 0001b_indexes CONCURRENTLY-under-autocommit precedent.

alter table memories add column if not exists derived_from uuid[];

comment on column memories.derived_from is 'OD-204: source memory ids this row was merge/summary-derived from (FR-2.MNT.005/007). null/empty = directly written. Walked by ISSUE-029 compliance erasure (FR-2.MNT.017).';

create index concurrently if not exists memories_derived_from_gin on memories using gin (derived_from);
