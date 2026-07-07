-- ============================================================================
-- ISSUE-075 — LIVE-ADAPTER SMOKE for app/alerting/src/supabase-store.ts
-- Live-adapter hygiene sweep (R10). Replays the adapter's REAL write paths
-- against the client-owned silo Supabase (silo plane, silo migrations head 0025).
--
-- Connect role (verified live 2026-07-07): current_user = postgres,
-- rolbypassrls = t  → RLS is BYPASSED on this path (OD-193). This smoke
-- therefore asserts SCHEMA/COLUMN/ENUM correctness of the adapter's SQL, not
-- RLS visibility. No SET ROLE / request.jwt in the adapter.
--
-- What it proves (each adapter method → a real write, asserted, then rolled back):
--   * SupabaseNotificationStore.create()  — the 9-column INSERT incl. the
--     escalated_at CASE, recipient as a REAL uuid (not a role-name string),
--     recipient_role as text, type as a live alert_type enum member.
--   * .setDeliveryState() / .escalate() / .action() — the UPDATE paths + now()
--     server-authoritative stamps.
--   * SupabaseAlertEventLogStore.append() — the 9-column event_log INSERT with
--     entity_ids::uuid[], payload::jsonb, event_type a live event_type member,
--     cost_unknown split. (append-only trigger t_append_only is BEFORE DELETE
--     OR UPDATE only → INSERT is permitted.)
--   * SupabaseAlertConfigStore.read() — the config_values + secret_manifest
--     SELECTs return the expected shape.
--
-- DDL evidence: notifications 0001_baseline.sql L500-514; event_log L483-495;
-- alert_type enum L71-73; event_type enum L60-65; config_values L626-631;
-- secret_manifest L634-638. recipient uuid references profiles(id) (uuid).
--
-- Writes are SERIAL with the orchestrator — DO NOT run this yourself; the
-- orchestrator runs it. Everything happens inside one txn and is ROLLBACK'd.
-- ============================================================================

\set ON_ERROR_STOP on
begin;

-- ── parent rows created inside the txn (rolled back at the end) ──────────────
-- A real profile to satisfy notifications.recipient → profiles(id) and be a
-- concrete deliverable user id (what resolveContact() would have produced).
insert into profiles (id)
  values ('11111111-1111-1111-1111-111111111111')
  on conflict (id) do nothing;

-- A real task_queue row to satisfy event_log.task_id → task_queue(id).
-- task_queue(id) is uuid; other NOT-NULL columns default or are permissive
-- enough for a smoke — if this insert fails on a required column, that itself
-- is a signal to widen the fixture, not an adapter bug.
insert into task_queue (id)
  values ('22222222-2222-2222-2222-222222222222')
  on conflict (id) do nothing;

-- ============================================================================
-- 1. SupabaseNotificationStore.create()  (supabase-store.ts L46-57)
--    Non-escalated primary: escalation_state NULL → escalated_at CASE = NULL.
--    recipient is a REAL uuid; recipient_role a text role name.
-- ============================================================================
do $$
declare
  nid uuid;
  r   record;
begin
  insert into notifications (type, severity, title, body, recipient, recipient_role, read_state,
                             escalation_state, escalated_at)
  values ('task_failure_spike', 'warning', 'Task failure spike', 'body text',
          '11111111-1111-1111-1111-111111111111'::uuid, 'ops_lead', 'unread',
          null, case when null is null then null else now() end)
  returning id into nid;

  select * into r from notifications where id = nid;
  if r.read_state <> 'unread' then raise exception 'create: read_state not unread'; end if;
  if r.escalation_state is not null then raise exception 'create: escalation_state should be null'; end if;
  if r.escalated_at is not null then raise exception 'create: escalated_at should be null when not escalated'; end if;
  if r.recipient <> '11111111-1111-1111-1111-111111111111'::uuid then raise exception 'create: recipient uuid mismatch'; end if;
  if r.recipient_role <> 'ops_lead' then raise exception 'create: recipient_role mismatch'; end if;
  if r.created_at is null then raise exception 'create: created_at should be server-stamped'; end if;
  raise notice 'OK create() non-escalated';
end $$;

-- create() escalated secondary: escalation_state set → escalated_at stamped now() in the SAME insert.
do $$
declare nid uuid; r record;
begin
  insert into notifications (type, severity, title, body, recipient, recipient_role, read_state,
                             escalation_state, escalated_at)
  values ('hard_limit_hit', 'critical', 'Hard limit', 'body',
          null, null, 'unread',
          'step-2', case when 'step-2' is null then null else now() end)
  returning id into nid;
  select * into r from notifications where id = nid;
  if r.escalation_state <> 'step-2' then raise exception 'create-escalated: escalation_state mismatch'; end if;
  if r.escalated_at is null then raise exception 'create-escalated: escalated_at must be stamped when escalation_state set'; end if;
  raise notice 'OK create() escalated secondary (escalated_at stamped in same insert)';
end $$;

-- ============================================================================
-- 2. setDeliveryState()  (L60-66) — jsonb write-back, separate statement.
-- 3. escalate()          (L68-74) — escalated_at = now() server-authoritative.
-- 4. action()            (L76-81) — read_state='actioned', actioned_at=now().
-- ============================================================================
do $$
declare nid uuid; r record;
begin
  insert into notifications (type, severity, title, body, read_state)
  values ('cost_threshold_breach', 'warning', 't', 'b', 'unread')
  returning id into nid;

  -- setDeliveryState
  update notifications set delivery_state = '{"slack_attempted":true,"slack_ok":false,"slack_error":"503"}'::jsonb
    where id = nid;
  select * into r from notifications where id = nid;
  if (r.delivery_state->>'slack_ok')::boolean <> false then raise exception 'setDeliveryState: jsonb not written'; end if;

  -- escalate
  update notifications set escalation_state = 'step-1', escalated_at = now() where id = nid;
  select * into r from notifications where id = nid;
  if r.escalation_state <> 'step-1' or r.escalated_at is null then raise exception 'escalate: not applied'; end if;

  -- action
  update notifications set read_state = 'actioned', actioned_at = now() where id = nid;
  select * into r from notifications where id = nid;
  if r.read_state <> 'actioned' or r.actioned_at is null then raise exception 'action: not applied'; end if;
  raise notice 'OK setDeliveryState/escalate/action';
end $$;

-- ============================================================================
-- 5. SupabaseAlertEventLogStore.append()  (L107-124) — 9-col INSERT.
--    Exercises every one of the 7 ALERT_EVENT_TYPES the adapter can write,
--    entity_ids::uuid[], payload::jsonb, cost_unknown split.
-- ============================================================================
do $$
declare
  et text;
  cnt int;
begin
  foreach et in array array['task_failure_spike','queue_backup','memory_confidence_drop',
                            'approval_queue_stale','cost_threshold_breach','loop_missed','guardrail_hit']
  loop
    insert into event_log (task_id, event_type, entity_ids, summary, payload, duration_ms,
                           cost_tokens, cost_unknown, answer_mode)
    values ('22222222-2222-2222-2222-222222222222',
            et::event_type,
            array['33333333-3333-3333-3333-333333333333']::uuid[],
            'alert ' || et,
            '{"k":"v"}'::jsonb,
            42, 1000, false, null);
  end loop;

  select count(*) into cnt from event_log where summary like 'alert %';
  if cnt <> 7 then raise exception 'append: expected 7 alert event_log rows, got %', cnt; end if;

  -- cost_unknown=true / cost_tokens=null path (the sentinel split, AC-7.LOG.004.1).
  insert into event_log (task_id, event_type, entity_ids, summary, payload, duration_ms,
                         cost_tokens, cost_unknown, answer_mode)
  values (null, 'loop_missed'::event_type, null, 'cost-unknown row', null, null, null, true, null);
  raise notice 'OK append() all 7 alert event_types + cost_unknown split';
end $$;

-- ============================================================================
-- 6. SupabaseAlertConfigStore.read()  (L142-161) — the two SELECTs return
--    the expected shape (no write; just prove the columns/keys exist).
-- ============================================================================
do $$
declare cnt int;
begin
  perform key, value from config_values
    where key in ('alert_routing_rules','escalation_contacts','quiet_hours','alert_email_enabled');
  -- secret_manifest presence read
  perform present from secret_manifest where key = 'SLACK_WEBHOOK_URL';
  raise notice 'OK config read() SELECTs resolve against live columns';
end $$;

rollback;
-- Nothing persists. Adapter write paths + column/enum/type contracts verified live.
