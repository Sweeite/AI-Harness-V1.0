-- Migration 0028 — task_queue.awaiting_approval_at (ISSUE-048 / logic-sweep held fix). Additive, expand-safe.
--
-- The approval-staleness clock (escalateStaleApprovals) keyed off `created_at` (task-CREATION time), but
-- FR-5.QUE.005.2 / AC-5.QUE.005.2 mean "time the item has sat IN the human approval queue" — since it entered
-- `awaiting_approval`. A low-priority requires_approval task can sit `pending` behind other work and only enter
-- awaiting_approval much later; `created_at` is still the old time → a premature `approval_queue_stale`
-- escalation fires ~immediately + the summary misreports the human wait time (fail-SAFE, but a false #3 signal).
-- This column records when a task ENTERED awaiting_approval, so the clock measures time-in-approval-queue; the
-- fake + adapter both key off `coalesce(awaiting_approval_at, created_at)` (created_at fallback for rows that
-- pre-date this column — expand-contract safe: old awaiting_approval rows keep their prior behaviour).
--
-- Nullable, no default → expand-contract safe (migration-discipline.md): no backfill, no rewrite. transactional:
-- true — do NOT add BEGIN/COMMIT. Re-runnable (add column if not exists). Mirror into schema.md §6.
--
-- NB (index): the staleness query filters `status = 'awaiting_approval'` (served by the existing composite
-- `task_queue_status_created` index) then applies the coalesce age as a residual predicate. At ADR-001 scale
-- (≤20 users, low queue volume) a dedicated index on coalesce(awaiting_approval_at, created_at) is NOT needed;
-- if the awaiting_approval backlog ever grows large, add one CONCURRENTLY in a later transactional:false tag.

alter table task_queue add column if not exists awaiting_approval_at timestamptz;   -- when the task entered awaiting_approval (FR-5.QUE.005.2 clock)
