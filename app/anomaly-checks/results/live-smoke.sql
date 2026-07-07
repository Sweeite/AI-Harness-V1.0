-- ISSUE-057 — live-adapter hygiene smoke for app/anomaly-checks/src/supabase-store.ts (R10).
--
-- WHAT THIS PROVES (replays the adapter's REAL write paths against the live silo DDL, then ROLLBACKs):
--   1. logGuardrail        — INSERT into guardrail_log with an 'anomaly' guardrail_type + 'pending'
--                            status + a real escalated_at, RETURNING every column the adapter reads back.
--   2. transitionGuardrail — forward status transition pending -> approved, setting reviewed_by/reviewed_at,
--                            passing the t_append_only trigger branch (a). Asserts the pending-guard makes a
--                            non-pending row a 0-row no-op (adapter then throws — #3).
--   3. markEscalated       — monotonic escalated_at null->ts + action_blocked false->true on a pending row,
--                            passing trigger branch (b) (OD-182). Asserts a re-escalate is a 0-row no-op.
--   4. flagForReview       — task_queue.status -> 'flagged' by id.
--
-- Connect role: SILO_DB_URL connects as the 'postgres' owner (rolbypassrls=t) — RLS bypassed on this path
-- (OD-193); the postgres role holds INSERT/UPDATE/SELECT on guardrail_log + task_queue (verified live).
-- Enums verified live: guardrail_type/guardrail_status/task_status all contain the literals used below.
-- Columns verified live against guardrail_log (id,task_id,guardrail_type,description,action_blocked,status,
-- reviewed_by,reviewed_at,escalated_at,created_at,redacted_at) and task_queue(id,status,type,task_name).
--
-- SAFE: everything runs inside a single txn and ROLLBACKs at the end — nothing persists.
-- Do NOT run standalone in parallel; the orchestrator runs live writes serially.

begin;

-- ── parent rows (created inside the txn) ─────────────────────────────────────────────
-- task_queue needs type (task_type enum) + task_name; everything else has a default.
insert into task_queue (id, type, task_name, status)
values ('11111111-1111-1111-1111-111111111111', 'event', 'anomaly-smoke-task', 'pending');

-- ── 1. logGuardrail: append an 'anomaly'/'pending' row (the only type this slice writes) ──
insert into guardrail_log (task_id, guardrail_type, description, action_blocked, status, escalated_at)
values ('11111111-1111-1111-1111-111111111111', 'anomaly', 'smoke: default-severity anomaly', false, 'pending', null)
returning id \gset log1_

do $$
declare r guardrail_log%rowtype;
begin
  select * into r from guardrail_log where description = 'smoke: default-severity anomaly';
  if r.status <> 'pending' then raise exception 'logGuardrail: expected pending, got %', r.status; end if;
  if r.guardrail_type <> 'anomaly' then raise exception 'logGuardrail: expected anomaly type, got %', r.guardrail_type; end if;
  if r.created_at is null then raise exception 'logGuardrail: created_at not server-stamped'; end if;
end $$;

-- ── 2. transitionGuardrail: forward pending -> approved (adapter WHERE: id AND status='pending') ──
update guardrail_log
   set status = 'approved', reviewed_by = null, reviewed_at = to_timestamp(1751846400)
 where id = :'log1_id' and status = 'pending';
do $$
declare n int;
begin
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'transitionGuardrail: expected 1 row updated, got %', n; end if;
end $$;

-- assert the forward-only guard: a second transition on the now-approved row is a 0-row no-op
-- (the adapter turns rowCount=0 into a LOUD throw — never a silent overwrite, #3).
update guardrail_log set status = 'rejected', reviewed_at = to_timestamp(1751846401)
 where id = :'log1_id' and status = 'pending';
do $$
declare n int;
begin
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'transitionGuardrail forward-guard: expected 0-row no-op on non-pending, got %', n; end if;
end $$;

-- ── 3. markEscalated: monotonic escalated_at + action_blocked on a still-pending row (branch b) ──
insert into guardrail_log (task_id, guardrail_type, description, action_blocked, status, escalated_at)
values ('11111111-1111-1111-1111-111111111111', 'anomaly', 'smoke: to-escalate', false, 'pending', null)
returning id \gset log2_

update guardrail_log set escalated_at = to_timestamp(1751846500), action_blocked = true
 where id = :'log2_id' and escalated_at is null;
do $$
declare n int; r guardrail_log%rowtype;
begin
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'markEscalated: expected 1 row, got %', n; end if;
  select * into r from guardrail_log where id = :'log2_id';
  if r.escalated_at is null then raise exception 'markEscalated: escalated_at not set'; end if;
  if r.action_blocked <> true then raise exception 'markEscalated: action_blocked not true'; end if;
  if r.status <> 'pending' then raise exception 'markEscalated: status must stay pending, got %', r.status; end if;
end $$;

-- assert write-once: a re-escalate is a 0-row no-op (adapter throws on rowCount=0, never silent — #3).
update guardrail_log set escalated_at = to_timestamp(1751846600), action_blocked = true
 where id = :'log2_id' and escalated_at is null;
do $$
declare n int;
begin
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'markEscalated write-once: expected 0-row no-op, got %', n; end if;
end $$;

-- ── 4. flagForReview: task_queue.status -> 'flagged' by id ────────────────────────────
update task_queue set status = 'flagged' where id = '11111111-1111-1111-1111-111111111111';
do $$
declare r task_queue%rowtype;
begin
  select * into r from task_queue where id = '11111111-1111-1111-1111-111111111111';
  if r.status <> 'flagged' then raise exception 'flagForReview: expected flagged, got %', r.status; end if;
end $$;

-- NOTE (MINOR, #3): the adapter's flagForReview does NOT check rowCount. A flag for a non-existent
-- task_id is a silent 0-row no-op (below) — the caller believes the task was flagged. The guardrail_log
-- row is persisted first so the anomaly is never lost (#1 safe), but the flag routing can silently vanish.
update task_queue set status = 'flagged' where id = '22222222-2222-2222-2222-222222222222';
do $$
declare n int;
begin
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'flagForReview missing-task: expected 0-row (adapter does NOT detect this), got %', n; end if;
end $$;

rollback;
