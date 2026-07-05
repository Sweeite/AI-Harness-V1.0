-- ISSUE-048 (C5 QUE) — proposed migration tag 0008_task_queue.
-- The task_queue permanent-audit-record table, authored to schema.md §6 (Execution / Harness) and the
-- §Types enums task_type / task_status. This is the QUE slice's authored DDL — the reference the live pg
-- adapter (app/task-queue/src/supabase-store.ts) is written against and the InMemoryTaskQueue fake mirrors.
--
-- ⚠️ PROPOSED — NOT applied here. The orchestrator integrates this into app/silo/migrations as tag 0008
-- (after 0006 profiles / 0007). It is idempotent (IF NOT EXISTS + guarded enum adds) so it composes safely
-- whether or not the 0001 baseline already stood the table up — the columns/defaults/constraints below are
-- the single authored source for the QUE slice.
--
-- DEPENDENCY: `profiles` is created by ISSUE-013 migration 0006 (an EARLIER tag). This migration REFERENCES
-- profiles(id) for approved_by / originating_user_id; it does NOT create profiles.
--
-- The three non-negotiables, enforced in DDL:
--   #1 never lose knowledge  — no ON DELETE CASCADE onto this table; no delete grant; permanent audit record
--                              (FR-5.QUE.001 / AC-5.QUE.001.1). error is jsonb (full per-attempt history).
--   #2 never do what it shouldn't — status is a fixed enum (task_status); no blank/unknown status can persist
--                              (NOT NULL + default 'pending'); flagged is C6-set only (comment + app gate).
--   #3 never fail silently   — a held (flagged) / stale (awaiting_approval) task stays in a defined, recorded
--                              state; the staleness escalation emits on event_log (app layer / ISSUE-011).

-- ── §Types — the two enums (schema.md L116-117). Guarded so this composes whether or not the baseline
-- created them (baseline 0001 already carries both; a fresh stack without them gets them here). task_status
-- MUST include 'flagged' (OD-054 — the C5-defined / C6-set quarantine state, distinct from awaiting_approval).
do $$
begin
  if not exists (select 1 from pg_type where typname = 'task_type') then
    create type task_type as enum ('scheduled','event','human','chained');
  end if;
  if not exists (select 1 from pg_type where typname = 'task_status') then
    create type task_status as enum ('pending','running','awaiting_approval','completed','failed','flagged');
  end if;
  -- expand-contract-safe: if task_status pre-exists WITHOUT 'flagged', add it (OD-054).
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'task_status' and e.enumlabel = 'flagged'
  ) then
    alter type task_status add value 'flagged';
  end if;
end
$$;

-- ── §6 task_queue — the full column set, exactly per schema.md §6. ─────────────────────────────────
create table if not exists task_queue (
  id                  uuid primary key default gen_random_uuid(),
  type                task_type   not null,
  task_name           text        not null,
  payload             jsonb       not null default '{}',
  status              task_status not null default 'pending',      -- fixed state machine; never null/blank (#3)
  priority            int         not null default 100,            -- lower = higher priority (FR-5.QUE.004)
  requires_approval   boolean     not null default false,
  approved_by         uuid        references profiles(id),          -- recorded on human approve (FR-5.QUE.005)
  approved_at         timestamptz,
  originating_user_id uuid        references profiles(id),          -- ⊕ net-new (no-self-approval + My Queue)
  action_payload      jsonb,                                        -- ⊕ net-new: proposed tool call + params + target
  attempts            int         not null default 0,               -- OD-058 Inngest audit projection (JOB writes)
  next_retry_at       timestamptz,                                  -- OD-058 Inngest audit projection (JOB writes)
  error               jsonb,                                        -- full per-attempt history, NEVER collapsed (FR-5.QUE.006)
  completed_at        timestamptz,
  created_at          timestamptz not null default now()
);
-- NOTE (OD-096 / FR-10.ISO.001): there is deliberately NO client_slug column on this client-side table.
-- It was label-only in the FR prose, then DELETED in the Phase-4 schema reconciliation — client isolation is
-- physical (ADR-001), client_slug lives only in the management-plane client_registry. Do not add one.
comment on table task_queue is
  'Permanent audit record of every task (FR-5.QUE.001) — NEVER deleted, no delete path/cascade. '
  'status is a fixed state machine (task_status). flagged is DEFINED here (C5) but SET only by C6 on a '
  'guardrail hit (OD-054) — distinct from awaiting_approval. No client_slug column (OD-096/FR-10.ISO.001).';
comment on column task_queue.status is
  'Fixed state machine. flagged = C6-set quarantine/guardrail hold (never set by C5 execution) — kept '
  'distinct from awaiting_approval (a safety hold is not a routine approval wait). No blank/unknown status.';
comment on column task_queue.error is
  'Full per-attempt error history (jsonb array), never collapsed to a single last-error (FR-5.QUE.006 / #1).';
comment on column task_queue.originating_user_id is
  'Net-new: the user a task originated for — drives no-self-approval (C6/ISSUE-056) + My Queue. FK profiles(id).';

-- ── #1 permanent audit record: revoke every DELETE grant on this sink. No app/service role may delete a
-- task_queue row (FR-5.QUE.001 / AC-5.QUE.001.1). No retention/cleanup job has a delete path here — unlike
-- the audit sinks, task_queue has NO whitelisted prune at all. (service_role bypasses grants, so the harness
-- app-layer gate is the enforced #2 boundary; this REVOKE is the belt to that suspenders.)
revoke delete on task_queue from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke delete on task_queue from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke delete on task_queue from anon';
  end if;
end
$$;

-- ── indexes: priority dequeue (lower first) among runnable rows, and the staleness sweep over
-- awaiting_approval rows by age. Partial indexes keep the hot queries cheap.
create index if not exists task_queue_dequeue_idx
  on task_queue (priority asc, created_at asc)
  where status = 'pending';
create index if not exists task_queue_awaiting_approval_idx
  on task_queue (created_at asc)
  where status = 'awaiting_approval';
