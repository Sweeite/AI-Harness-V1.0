-- Migration 0029 — entities Internal-Org singleton DB guard (ISSUE-022 / FR-2.ENT.003 / AC-2.ENT.003.1). Additive.
--
-- The 0001 baseline created `entities` with `is_internal_org boolean not null default false` and the 0001d seed
-- inserts exactly one true row via `where not exists (select 1 from entities where is_internal_org)`. But that seed
-- is a first-boot convenience, NOT a guard -- nothing at the DB layer stops a SECOND `is_internal_org = true`
-- insert. A second Internal-Org entity fragments the agency into two "self" entities: internal knowledge splits
-- across both, client-facing exclusion (AC-2.ENT.003.2) can leak from whichever the filter misses, and every
-- Internal-Org retrieval silently sees half its knowledge. That is a direct non-negotiable #1 (knowledge
-- fragmentation) and #2 (exclusion bypass) hazard, and the design (FR-2.ENT.003) mandates a real singleton guard.
--
-- This adds a PARTIAL UNIQUE index over the constant `is_internal_org` restricted to the true rows: because every
-- included row carries the same value (true), uniqueness on that column admits AT MOST ONE true row. False rows
-- are excluded from the index, so ordinary (non-Internal-Org) entities are unconstrained. A racing second insert
-- of a true row fails LOUD (unique_violation) instead of silently creating a duplicate self -- converting a #1
-- into a recoverable #3. Standard singleton pattern (cf. 0025 agents_prev_unique partial-unique lineage backstop).
--
-- Live precondition: the silo has exactly one is_internal_org=true row (the 0001d seed), so the CONCURRENTLY
-- build succeeds. If two ever existed, the concurrent build would fail + mark the index invalid -- itself the
-- correct fail-loud signal that the invariant was already violated and needs a human merge.
--
-- transactional:false -- CREATE INDEX CONCURRENTLY cannot run inside a txn block. IF NOT EXISTS makes it
-- idempotent + resumable. Comments stay semicolon-free (the non-transactional runner splits on the semicolon).

create unique index concurrently if not exists entities_internal_org_singleton
  on entities (is_internal_org)
  where is_internal_org;
