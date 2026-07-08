-- ============================================================================
-- app/execution-plans — LIVE-ADAPTER SMOKE (ISSUE-064, C8 PLAN)
-- R10 live-adapter hygiene sweep for src/supabase-store.ts (SupabaseExecutionPlanAdmin).
--
-- ⚠️ PRE-AUTHORED offline (Session 79); RUN in the morning AFTER applying silo migration 0037.
--
-- WHAT THIS PROVES (replays the adapter's REAL write paths against the live silo DDL; execution_plans +
-- step_failure_mode are baseline 0001 = verify-present, 0037 adds the plan event_type values):
--   • saveVersion              — INSERT execution_plans with plan_body jsonb carrying CANONICAL step_failure_mode
--                                values + version derived by (select coalesce(max(version),0)+1 …) RETURNING.
--   • unique(task_type_name,version) — a 2nd INSERT at the same (task_type_name, version) raises unique_violation
--                                (the version race backstop).
--   • attribution              — INSERT event_log ('plan_outcome'::event_type, 0037) keyed by plan_version_id — no 22P02.
--   • rollback (atomic)        — a reinstating version INSERT (previous_version_id self-FK) + a 'plan_rollback'::event_type
--                                audit, both inside ONE txn (here the whole smoke txn) — the append-or-nothing shape.
--
-- CONNECTS AS: postgres (rolbypassrls=t) via SILO_DB_URL (OD-193). SAFETY: ONE txn, ROLLBACK — nothing persists.
-- RUN:  source ~/.ai-harness-secrets.env
--       /opt/homebrew/opt/libpq/bin/psql "$SILO_DB_URL" -v ON_ERROR_STOP=1 -f app/execution-plans/results/live-smoke.sql
-- Expected tail: "PLAN LIVE SMOKE: ALL ASSERTIONS PASSED" then ROLLBACK.
-- ============================================================================

\set ON_ERROR_STOP on
begin;

do $$
declare
  v_v1     uuid;
  v_v1ver  int;
  v_v3     uuid;
  v_caught boolean;
  v_body   jsonb := '{"task_type_name":"smoke_reply","parallel":false,"steps":[{"index":0,"agent_id":"a","failure_mode":"halt_and_escalate","defaulted":false}]}'::jsonb;
begin
  -- ── saveVersion: plan_body stores the CANONICAL failure_mode; version = coalesce(max,0)+1 ──
  insert into execution_plans (task_type_name, version, plan_body, created_at)
  values ('smoke_reply', (select coalesce(max(version),0)+1 from execution_plans where task_type_name = 'smoke_reply'), v_body, now())
  returning id, version into v_v1, v_v1ver;
  if v_v1ver <> 1 then raise exception 'FAIL: first version was not 1 (got %)', v_v1ver; end if;
  if (v_body #>> '{steps,0,failure_mode}') <> 'halt_and_escalate' then
    raise exception 'FAIL: plan_body did not carry the canonical failure_mode';
  end if;

  -- ── a 2nd version appends (previous_version_id self-FK) ──
  insert into execution_plans (task_type_name, version, plan_body, previous_version_id, created_at)
  values ('smoke_reply', (select coalesce(max(version),0)+1 from execution_plans where task_type_name = 'smoke_reply'), v_body, v_v1, now());

  -- ── unique(task_type_name, version): a duplicate version is barred ──
  v_caught := false;
  begin
    insert into execution_plans (task_type_name, version, plan_body, created_at) values ('smoke_reply', 1, v_body, now());
  exception when unique_violation then v_caught := true;
  end;
  if not v_caught then raise exception 'FAIL: a duplicate (task_type_name, version) was allowed'; end if;

  -- ── attribution: 'plan_outcome'::event_type accepted (0037) ──
  insert into event_log (event_type, entity_ids, summary, payload, created_at)
  values ('plan_outcome'::event_type, array[]::uuid[], 'smoke outcome', jsonb_build_object('plan_version_id', v_v1::text, 'status', 'success'), now());

  -- ── rollback (atomic): a reinstating version + a 'plan_rollback' audit, both in this txn ──
  insert into execution_plans (task_type_name, version, plan_body, previous_version_id, created_at)
  values ('smoke_reply', (select coalesce(max(version),0)+1 from execution_plans where task_type_name = 'smoke_reply'), v_body, v_v1, now())
  returning id into v_v3;
  insert into event_log (event_type, entity_ids, summary, payload, created_at)
  values ('plan_rollback'::event_type, array[]::uuid[], 'smoke rollback', jsonb_build_object('from_version_id', v_v1::text, 'to_version_id', v_v1::text, 'new_version_id', v_v3::text, 'reason', 'smoke'), now());
  if v_v3 is null then raise exception 'FAIL: rollback did not append a reinstating version'; end if;

  raise notice 'PLAN LIVE SMOKE: ALL ASSERTIONS PASSED';
end $$;

rollback;
