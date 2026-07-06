-- Migration 0017 — Stage-4 indexes (built CONCURRENTLY). Additive.
--
-- The two supporting indexes for the 0012 (rate_limit_deferred) + 0014 (support_requests) migrations. Built
-- CONCURRENTLY so a deploy never locks the table (migration-discipline.md L39 / AC-NFR-INF.002.1) -- which is
-- why they live here, not inline: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.
--
-- transactional:false -- the runner applies with autocommit (no BEGIN/COMMIT), required for CONCURRENTLY.
-- IF NOT EXISTS makes each build idempotent + the migration resumable (mirror 0001b_indexes).

-- ISSUE-034: the drainDue() scan -- only pending (not-yet-drained) rows whose window has reset.
create index concurrently if not exists rate_limit_deferred_due_idx
  on rate_limit_deferred (run_after) where drained_at is null;

-- ISSUE-016: the FR-0.REC.007 overdue computation reads (status, created_at).
create index concurrently if not exists support_requests_status_created_idx
  on support_requests (status, created_at);
