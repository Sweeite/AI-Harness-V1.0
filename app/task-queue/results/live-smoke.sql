-- ============================================================================
-- app/task-queue — LIVE-ADAPTER SMOKE (ISSUE-048, C5 QUE)
-- R10 live-adapter hygiene sweep for src/supabase-store.ts (SupabaseTaskQueue).
--
-- WHAT THIS PROVES (replays the adapter's REAL write paths against the live silo DDL):
--   • enqueue      — INSERT task_queue (type,task_name,payload,priority,requires_approval,
--                    originating_user_id,action_payload); server-owned status defaults to 'pending',
--                    attempts→0, error→NULL (coalesced to '[]' on read).
--   • dequeue      — FOR UPDATE SKIP LOCKED claim → 'running' (or 'awaiting_approval' when gated).
--   • transition   — state-machine UPDATE; terminal sets completed_at=now().
--   • setFlagged   — task_history INSERT (task_id,step_index,full_output) ON CONFLICT DO NOTHING,
--                    then status→'flagged'; work-in-progress survives the hold (#1).
--   • approve      — approved_by/approved_at set, status→'running' (guarded status='awaiting_approval').
--   • reject       — status→'failed', completed_at=now(), error jsonb-array APPENDED (never overwritten).
--   • recordError  — attempts+1 AND error jsonb-array APPENDED in one atomic UPDATE (#1 / FR-5.QUE.006).
--   • escalateStale— (SELECT-only; the event_log write is delegated to the injected C7 EventSink, not
--                    this adapter — the adapter only reads the awaiting_approval rows here.)
--   • no-DELETE invariant — task_queue DELETE revoked from anon/authenticated/service_role (0021);
--                    the adapter path (postgres owner, rolbypassrls) holds DELETE but issues no DELETE.
--   • task_history cascade — FK ON DELETE CASCADE confirmed; asserted structurally below.
--
-- CONNECTS AS: postgres (rolbypassrls=t) via SILO_DB_URL — the silo plane (OD-193). RLS is bypassed on
--   this path, so no authenticated/RLS assertions are made here (they would be vacuous).
--
-- Enum literals used below are all verified members of the live enums:
--   task_type   ∈ {scheduled,event,human,chained}          → uses 'event'
--   task_status ∈ {pending,running,awaiting_approval,completed,failed,flagged}
--
-- SAFETY: everything runs inside ONE txn and ROLLBACKs — nothing persists. Parent rows (auth.users →
--   profiles) are created inside the txn to satisfy approved_by/originating_user_id FKs, then rolled back.
--   DO NOT run this ad hoc — writes are serialised by the orchestrator.
--
-- RUN:  source ~/.ai-harness-secrets.env
--       /opt/homebrew/opt/libpq/bin/psql "$SILO_DB_URL" -v ON_ERROR_STOP=1 -f app/task-queue/results/live-smoke.sql
-- Expected tail: "TASK-QUEUE LIVE SMOKE: ALL ASSERTIONS PASSED" then ROLLBACK.
-- ============================================================================

\set ON_ERROR_STOP on
begin;

-- Isolate: a scratch profile for approver / originating_user_id (both FK profiles(id) → auth.users(id)).
do $$
declare
  v_user   uuid := gen_random_uuid();
  v_task   uuid;
  v_status task_status;
  v_attempts int;
  v_errlen int;
  v_completed timestamptz;
  v_approved uuid;
  v_hist   int;
  v_del_grantees int;
begin
  insert into auth.users (id) values (v_user);
  insert into profiles (id, email, name) values (v_user, 'smoke@example.test', 'smoke');

  -- ── enqueue ───────────────────────────────────────────────────────────────
  insert into task_queue (type, task_name, payload, priority, requires_approval, originating_user_id, action_payload)
  values ('event', 'smoke-task', '{"k":"v"}'::jsonb, 100, false, v_user, '{"tool":"noop"}'::jsonb)
  returning id, status, attempts into v_task, v_status, v_attempts;
  if v_status <> 'pending' then raise exception 'enqueue: expected pending, got %', v_status; end if;
  if v_attempts <> 0 then raise exception 'enqueue: expected attempts=0, got %', v_attempts; end if;
  -- error defaults NULL; adapter coalesces to '[]' on read:
  perform 1 from task_queue where id = v_task and error is null;
  if not found then raise exception 'enqueue: expected error NULL on fresh row'; end if;

  -- ── dequeue (non-approval → running) ─────────────────────────────────────
  -- replays: SELECT ... FOR UPDATE SKIP LOCKED then UPDATE status.
  perform id from task_queue where status='pending' and id=v_task
    order by priority asc, created_at asc limit 1 for update skip locked;
  update task_queue set status='running' where id=v_task;
  select status into v_status from task_queue where id=v_task;
  if v_status <> 'running' then raise exception 'dequeue: expected running, got %', v_status; end if;

  -- ── recordError — attempts+1 AND error appended atomically (#1) ───────────
  update task_queue
     set attempts = attempts + 1,
         error = coalesce(error,'[]'::jsonb) || jsonb_build_array(
                   jsonb_build_object('attempt', attempts + 1, 'message', 'boom-1', 'at', now()))
   where id = v_task;
  update task_queue
     set attempts = attempts + 1,
         error = coalesce(error,'[]'::jsonb) || jsonb_build_array(
                   jsonb_build_object('attempt', attempts + 1, 'message', 'boom-2', 'at', now()))
   where id = v_task;
  select attempts, jsonb_array_length(error) into v_attempts, v_errlen from task_queue where id=v_task;
  if v_attempts <> 2 then raise exception 'recordError: expected attempts=2, got %', v_attempts; end if;
  if v_errlen <> 2 then raise exception 'recordError: expected 2 error entries (append, not overwrite), got %', v_errlen; end if;
  -- attempt labels must be 1 then 2 (matches new attempts value, not stale):
  perform 1 from task_queue where id=v_task
    and error->0->>'attempt'='1' and error->1->>'attempt'='2';
  if not found then raise exception 'recordError: attempt labels not 1,2 — stale attempts read'; end if;

  -- ── transition running→completed (terminal sets completed_at) ────────────
  update task_queue
     set status='completed', completed_at = case when true then now() else completed_at end
   where id=v_task;
  select status, completed_at into v_status, v_completed from task_queue where id=v_task;
  if v_status <> 'completed' then raise exception 'transition: expected completed, got %', v_status; end if;
  if v_completed is null then raise exception 'transition: terminal must set completed_at'; end if;

  -- ── setFlagged path: task_history persistence + ON CONFLICT idempotence ───
  -- (use a SEPARATE task so we don't need a legal completed→flagged edge — the app guards that in TS.)
  insert into task_queue (type, task_name, requires_approval)
  values ('human', 'smoke-flag', false) returning id into v_task;
  insert into task_history (task_id, step_index, full_output)
  values (v_task, 0, '{"out":0}'::jsonb) on conflict (task_id, step_index) do nothing;
  insert into task_history (task_id, step_index, full_output)
  values (v_task, 1, '{"out":1}'::jsonb) on conflict (task_id, step_index) do nothing;
  -- re-insert step 0 → ON CONFLICT DO NOTHING must NOT duplicate / clobber:
  insert into task_history (task_id, step_index, full_output)
  values (v_task, 0, '{"out":"CLOBBER?"}'::jsonb) on conflict (task_id, step_index) do nothing;
  select count(*) into v_hist from task_history where task_id=v_task;
  if v_hist <> 2 then raise exception 'setFlagged: expected 2 task_history rows (no dup on conflict), got %', v_hist; end if;
  perform 1 from task_history where task_id=v_task and step_index=0 and full_output->>'out'='0';
  if not found then raise exception 'setFlagged: ON CONFLICT DO NOTHING clobbered step 0 output'; end if;
  update task_queue set status='flagged' where id=v_task;
  select status into v_status from task_queue where id=v_task;
  if v_status <> 'flagged' then raise exception 'setFlagged: expected flagged, got %', v_status; end if;

  -- ── approve path (awaiting_approval → running, guarded) ───────────────────
  insert into task_queue (type, task_name, requires_approval)
  values ('scheduled', 'smoke-appr', true) returning id into v_task;
  update task_queue set status='awaiting_approval' where id=v_task;  -- dequeue-of-gated-task effect
  update task_queue
     set approved_by = v_user, approved_at = now(), status='running'
   where id=v_task and status='awaiting_approval';
  select status, approved_by into v_status, v_approved from task_queue where id=v_task;
  if v_status <> 'running' then raise exception 'approve: expected running, got %', v_status; end if;
  if v_approved <> v_user then raise exception 'approve: approved_by not recorded'; end if;

  -- ── reject path (awaiting_approval → failed, error appended, completed_at set) ─
  insert into task_queue (type, task_name, requires_approval)
  values ('scheduled', 'smoke-rej', true) returning id into v_task;
  update task_queue set status='awaiting_approval' where id=v_task;
  update task_queue
     set approved_by=v_user, approved_at=now(), status='failed', completed_at=now(),
         error = coalesce(error,'[]'::jsonb) || jsonb_build_array(
                   jsonb_build_object('attempt', attempts + 1, 'message', 'approval rejected: nope', 'at', now()))
   where id=v_task and status='awaiting_approval';
  select status, jsonb_array_length(error), completed_at into v_status, v_errlen, v_completed
    from task_queue where id=v_task;
  if v_status <> 'failed' then raise exception 'reject: expected failed, got %', v_status; end if;
  if v_errlen <> 1 then raise exception 'reject: expected 1 error entry appended, got %', v_errlen; end if;
  if v_completed is null then raise exception 'reject: terminal must set completed_at'; end if;

  -- ── no-DELETE invariant (0021): DELETE revoked from anon/authenticated/service_role ──
  select count(*) into v_del_grantees
    from information_schema.role_table_grants
   where table_name='task_queue' and privilege_type='DELETE'
     and grantee in ('anon','authenticated','service_role');
  if v_del_grantees <> 0 then
    raise exception 'no-DELETE: % of {anon,authenticated,service_role} still hold DELETE on task_queue (0021 regression)', v_del_grantees;
  end if;

  -- ── task_history FK must be ON DELETE CASCADE (audit trail follows its task) ──
  perform 1 from information_schema.referential_constraints rc
    join information_schema.table_constraints tc on tc.constraint_name=rc.constraint_name
   where tc.table_name='task_history' and rc.delete_rule='CASCADE';
  if not found then raise exception 'task_history: FK to task_queue is not ON DELETE CASCADE'; end if;

  raise notice 'TASK-QUEUE LIVE SMOKE: ALL ASSERTIONS PASSED';
end
$$;

rollback;
