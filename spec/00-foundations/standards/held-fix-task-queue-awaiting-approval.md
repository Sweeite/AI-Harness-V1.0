# HELD FIX — task-queue `escalateStaleApprovals` staleness clock (needs migration 0028)

> **Status:** HELD (session 74). A logic-sweep MAJOR that CANNOT be fixed correctly without a DB schema change.
> The fix-workflow agent correctly refused to apply a parity-breaking half-fix and documented the full fix here.
> **Held because:** applying a live migration to the foundation was out of scope for an unattended session.
> **Apply from a 💻 FULL operator-present session.** This doc is self-contained (Rule 0).

## The bug (MAJOR, fail-SAFE)
`app/task-queue/src/store.ts:335` (`escalateStaleApprovals`) computes
`ageSeconds = now - Math.floor(Date.parse(row.created_at)/1000)` — it keys the approval-staleness clock off
**`created_at`** (task-creation time), but FR-5.QUE.005.2 / AC-5.QUE.005.2 mean **time the item has sat IN the
human approval queue** (since it entered `awaiting_approval`). `dequeue()` processes one pending task per call
(priority then FIFO), so a low-priority `requires_approval` task enqueued at T0 can sit pending behind other
work and only transition to `awaiting_approval` much later (T0+DAY). `created_at` is still T0, so the next
`escalateStaleApprovals(T0+DAY+1)` with threshold=DAY fires a **premature** `approval_queue_stale` escalation
(~1s after a reviewer could first see it) and its summary falsely reports "awaiting approval for 86401s".
Fail-SAFE (never auto-approves #2, never drops #3) but produces false escalations + a misreported human wait.
The **same bug exists in the live adapter** `supabase-store.ts:228-233` (keys off `now() - created_at`).

## Why a migration is unavoidable
The row has no field recording WHEN it entered `awaiting_approval`. `TaskQueueRow` mirrors the §6 DDL
column-for-column; the adapter cannot recover a past transition instant from a single `now()` sweep query.
Fixing the in-memory fake alone would break fake-vs-adapter parity on the exact behaviour being fixed.

## Migration (next free tag is **0028** — 0027 is taken by `0027_profiles_invite_lifecycle`)
```sql
-- app/silo/migrations/0028_task_queue_awaiting_approval_at.sql   (transactional:true)
-- Additive nullable column recording when a task entered awaiting_approval, so the staleness clock measures
-- time-in-approval-queue (FR-5.QUE.005.2 / AC-5.QUE.005.2), not total task age. Expand-safe (nullable, IF NOT EXISTS).
alter table public.task_queue add column if not exists awaiting_approval_at timestamptz;
-- swap the staleness partial index off created_at onto the new clock (fallback to created_at when null).
drop index if exists task_queue_awaiting_approval_idx;
create index if not exists task_queue_awaiting_approval_idx
  on public.task_queue (coalesce(awaiting_approval_at, created_at) asc)
  where status = 'awaiting_approval';
```
Notes: (a) the 0021 append-only guard on `task_queue` is a DELETE-revoke only (no per-column UPDATE trigger),
so writing this column on transition needs no trigger change. (b) Update `proposed-migration-0008_task_queue.sql`
reference DDL + `schema.md` §6 in lockstep. (c) Add `0028_task_queue_awaiting_approval_at` to `_journal.json`
**and** to `app/silo/src/schema.test.ts`'s hardcoded tag list in the same commit.

## Follow-up code (apply fake + adapter TOGETHER for parity)
- **`store.ts`**: add `awaiting_approval_at: string | null` to `TaskQueueRow`; set it in `applyTransition` when
  `to === 'awaiting_approval'` (covers both `dequeue()`'s park path and approve/reject/transition edges); in
  `escalateStaleApprovals` compute `ageSeconds` from `awaiting_approval_at ?? created_at` (created_at fallback).
- **`supabase-store.ts`**: add `awaiting_approval_at` to `COLS`; in `dequeue()` UPDATE set
  `awaiting_approval_at = case when $2='awaiting_approval' then now() else awaiting_approval_at end`; likewise in
  `transition()` for the awaiting_approval target; in `escalateStaleApprovals` key off
  `coalesce(awaiting_approval_at, created_at)` in both the WHERE and the `age_seconds` EXTRACT.

## Regression test (written but not committed — no fix applied yet)
Enqueue a low-priority `requires_approval` task AND a higher-priority plain task at T0; dequeue the plain one
first (advances nothing on the gated task), then dequeue the gated task at T0+DAY so it enters
`awaiting_approval` with `created_at` still T0; assert `escalateStaleApprovals(T0+DAY+1)` with threshold=DAY
returns `[]` and emits NO event (ExplodingSink), and that escalation only fires at ~T0+2*DAY. On today's code the
first assertion FAILS (premature escalation) — that is the red that proves the bug.

## After applying: run the R10 live-smoke for task-queue against the silo (rolled back) to confirm the new
## column + index behave live, and flip this doc to RESOLVED.
