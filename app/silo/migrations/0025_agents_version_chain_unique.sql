-- Migration 0025 — agents version-chain lost-update backstop (session-73 audit finding B4). Additive.
--
-- orchestrator.appendVersion reads the current head, computes version+1, and INSERTs a new row with
-- previous_version_id = head.id. Under READ COMMITTED with no row lock / no CAS, two concurrent
-- editCapability calls both read the same head and both INSERT a child of it: the version chain forks,
-- two rows become current, and get() (order by version desc limit 1) silently drops one operator's edit
-- (#1 knowledge loss / #3 silent). agents has only a non-unique agents_prev index, so nothing stopped it.
--
-- This adds a PARTIAL UNIQUE index on previous_version_id: a linear append-only lineage has exactly one
-- child per version, so uniqueness holds for every legitimate edit — the racing second INSERT fails LOUD
-- (unique_violation) instead of silently losing the edit -- converting a #1 into a recoverable #3. Roots
-- (previous_version_id is null) are excluded so multiple root agents remain allowed. A graceful re-read+retry
-- in the adapter is an optional follow-up. This constraint is the load-bearing safety backstop.
--
-- transactional:false -- CREATE INDEX CONCURRENTLY cannot run inside a txn block. IF NOT EXISTS makes it
-- idempotent + resumable. Comments stay semicolon-free (the non-transactional runner splits on the semicolon).

create unique index concurrently if not exists agents_prev_unique
  on agents (previous_version_id)
  where previous_version_id is not null;
