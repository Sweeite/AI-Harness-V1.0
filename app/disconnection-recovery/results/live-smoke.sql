-- ============================================================================
-- app/disconnection-recovery — LIVE-ADAPTER SMOKE (ISSUE-038, C3 DSC)
-- R10 live-adapter hygiene sweep for src/supabase-store.ts (SupabaseDisconnectionStore + SupabaseDisconnectionSinks).
--
-- ⚠️ PRE-AUTHORED offline (Session 79); RUN in the morning AFTER applying silo migrations 0034/0035/0036.
--
-- WHAT THIS PROVES (replays the adapter's REAL write paths against the live silo DDL incl. 0034/0035/0036):
--   • detect (system-wide)     — UPDATE connector_credentials SET state='degraded' (metadata only, no token column)
--                                + INSERT connector_disconnection_state RETURNING extract(epoch …) round-trips.
--   • idempotent open guard    — a 2nd OPEN row for the same (connector,scope,null-user) raises unique_violation
--                                (the 0035 partial-unique connector_disconnection_open_uniq) — the adapter re-selects.
--   • escalation clock         — detected_at + escalation_window persist; extract(epoch …) reconstructs the ms clock.
--   • paused-set               — INSERT connector_disconnection_paused_tasks (FK → task_queue) ON CONFLICT DO NOTHING
--                                is idempotent; resume_halted column exists (the DSC.003.2 halt marker).
--   • event_log ::event_type   — the 4 additive connector event_type values (0036) INSERT without 22P02.
--   • access_audit             — INSERT with actor_type='system' (the #3 audit trail SupabaseDisconnectionSinks writes).
--
-- CONNECTS AS: postgres (rolbypassrls=t) via SILO_DB_URL (OD-193). SAFETY: ONE txn, ROLLBACK — nothing persists.
-- RUN:  source ~/.ai-harness-secrets.env
--       /opt/homebrew/opt/libpq/bin/psql "$SILO_DB_URL" -v ON_ERROR_STOP=1 -f app/disconnection-recovery/results/live-smoke.sql
-- Expected tail: "DSC LIVE SMOKE: ALL ASSERTIONS PASSED" then ROLLBACK.
-- ============================================================================

\set ON_ERROR_STOP on
begin;

do $$
declare
  v_dsc      uuid;
  v_secs     numeric;
  v_win      numeric;
  v_task     uuid;
  v_rc       int;
  v_caught   boolean;
begin
  -- ── detect: mark the shared connector credential degraded (metadata only — NEVER a token column) ──
  insert into connector_credentials (connector, access_token, state) values ('smoke_ghl', 'x', 'active');
  update connector_credentials set state = 'degraded', updated_at = now() where connector = 'smoke_ghl';
  if (select state from connector_credentials where connector = 'smoke_ghl') <> 'degraded' then
    raise exception 'FAIL: connector_credentials.state not set to degraded';
  end if;

  -- ── INSERT the durable disconnection-state row; the persisted clock round-trips ──
  insert into connector_disconnection_state (connector, scope, cause, status, detected_at, escalation_window)
  values ('smoke_ghl', 'system_wide', 'dead_refresh', 'open', now(), make_interval(secs => 86400))
  returning id into v_dsc;
  select extract(epoch from detected_at), extract(epoch from escalation_window)
    into v_secs, v_win from connector_disconnection_state where id = v_dsc;
  if v_win <> 86400 then raise exception 'FAIL: escalation_window did not persist as 24h (got % s)', v_win; end if;

  -- ── 0035 partial-unique: a 2nd OPEN row for the same (connector,scope,null-user) is barred ──
  v_caught := false;
  begin
    insert into connector_disconnection_state (connector, scope, cause, status, detected_at, escalation_window)
    values ('smoke_ghl', 'system_wide', 'failed_call', 'open', now(), make_interval(secs => 86400));
  exception when unique_violation then v_caught := true;
  end;
  if not v_caught then raise exception 'FAIL: a 2nd OPEN disconnection was allowed (0035 guard missing)'; end if;

  -- ── paused-set: FK → task_queue, idempotent ON CONFLICT ──
  insert into task_queue (type, task_name) values ('event', 'smoke_paused_task') returning id into v_task;
  insert into connector_disconnection_paused_tasks (disconnection_id, task_id, paused_at) values (v_dsc, v_task, now());
  insert into connector_disconnection_paused_tasks (disconnection_id, task_id, paused_at)
    values (v_dsc, v_task, now()) on conflict (disconnection_id, task_id) do nothing;
  get diagnostics v_rc = row_count;
  if v_rc <> 0 then raise exception 'FAIL: duplicate paused-task insert was not a no-op (idempotency broken)'; end if;
  -- resume_halted column exists + defaults false
  if (select resume_halted from connector_disconnection_paused_tasks where disconnection_id = v_dsc and task_id = v_task) <> false then
    raise exception 'FAIL: resume_halted did not default false';
  end if;

  -- ── event_log ::event_type accepts the 4 additive connector values (0036) ──
  insert into event_log (event_type, entity_ids, summary, payload, created_at)
    values ('connector_disconnected'::event_type, array[]::uuid[], 'smoke', '{}'::jsonb, now());
  insert into event_log (event_type, entity_ids, summary, payload, created_at)
    values ('connector_escalated'::event_type, array[]::uuid[], 'smoke', '{"kind":"resume_halt"}'::jsonb, now());
  insert into event_log (event_type, entity_ids, summary, payload, created_at)
    values ('connector_reconnected'::event_type, array[]::uuid[], 'smoke', '{}'::jsonb, now());
  insert into event_log (event_type, entity_ids, summary, payload, created_at)
    values ('connector_alert'::event_type, array[]::uuid[], 'smoke', '{"outcome":"sent"}'::jsonb, now());

  -- ── access_audit: the #3 audit trail write shape (actor_type='system') ──
  insert into access_audit (audit_type, actor_identity, actor_type, action, reason, path_context, created_at)
    values ('connector_pause', 'system', 'system'::actor_type, 'pause_task', 'paused by disconnection', v_task::text, now());

  raise notice 'DSC LIVE SMOKE: ALL ASSERTIONS PASSED';
end $$;

rollback;
