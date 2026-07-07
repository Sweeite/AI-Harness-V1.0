-- ISSUE-037 trigger-infra — LIVE write-path smoke (SILO db). Rolled back; safe to run against the silo.
-- Replays the ACTUAL statements SupabaseTriggerStore (src/supabase-store.ts) runs, against the real DDL, so
-- any column/enum/constraint drift surfaces here (the fake-passes-offline / live-throws class).
--
-- Run: psql "$SILO_DB_URL" -f app/trigger-infra/results/live-smoke.sql
-- Expect: a mix of PASS lines, then 'ALL ASSERTIONS PASS'. Everything rolls back.
--
-- SCHEMA HOMING (OD-190): trigger runtime state lives in its OWN mutable tables (migration 0019 /0020) —
-- connector_triggers, connector_watches, event_watermarks, connector_delivery_health, event_dedup_ledger —
-- NOT tools.config. The prior smoke ASSERTED the tools.config in-place UPDATE was REJECTED by the 0008
-- version-discipline trigger (the confirmed BLOCKER). OD-190 re-homed the state, so every trigger write now
-- SUCCEEDS — this smoke asserts each new-table write lands and the key guards hold.
--
-- Mirrored statements (supabase-store.ts):
--   setDefaultTriggerEnabled : update connector_triggers set enabled=$3 where connector=$1 and kind='default' and event_name=$2
--   saveRule                 : insert into connector_triggers (connector,kind='rule',event_name,conditions,task_name,enabled)
--   recordEvent              : insert into event_dedup_ledger (connector,event_id,seen_at) on conflict (connector,event_id) do nothing
--   upsertWatch              : insert into connector_watches (...) on conflict (connector,kind) do update ...
--   setWatermark             : insert into event_watermarks (...) on conflict (connector,channel) do update ...
--   getDeliverySample        : select ... from connector_delivery_health where connector=$1
--   logEvent                 : insert into event_log (task_id,event_type::event_type,entity_ids::uuid[],summary,payload::jsonb)
--   writeAudit               : insert into access_audit (audit_type,actor_identity,actor_type::actor_type,action,target_type,after_value::jsonb,reason)
\set ON_ERROR_STOP on
begin;

do $$
declare
  v_evt_id      uuid;
  v_aud_id      uuid;
  v_rule_id     uuid;
  v_enabled     boolean;
  v_pos         text;
  v_chan        text;
  v_rate        numeric;
  v_seen        int;
begin
  -- ── A. writeAudit → access_audit INSERT (the trigger-config audit sink) ────────────────────────────
  insert into access_audit (audit_type, actor_identity, actor_type, action, target_type, after_value, reason)
    values (
      'trigger_config_change', '__smoke_admin__', 'user'::actor_type, 'enable', 'trigger_default',
      '{"connector":"slack","eventName":"message","enabled":true}'::jsonb, 'smoke: default trigger enable'
    )
    returning id into v_aud_id;
  if v_aud_id is null then raise exception 'FAIL A: access_audit insert returned no id'; end if;
  raise notice 'PASS A: access_audit trigger-config insert succeeded (all NOT-NULL cols + actor_type enum)';

  begin
    insert into access_audit (audit_type, actor_identity, actor_type, action)
      values ('trigger_config_change', '__smoke_admin__', 'root'::actor_type, 'enable');
    raise exception 'FAIL A2: access_audit accepted a non-enum actor_type';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS A2: bad actor_type rejected by enum cast -> %', sqlerrm;
  end;

  -- ── B. logEvent → event_log INSERT with the ::event_type cast (proves 0018 additive delta applied) ──
  insert into event_log (task_id, event_type, entity_ids, summary, payload)
    values (
      null, 'trigger_fired'::event_type, '{}'::uuid[],
      'smoke: trigger fired [slack/message] rule rule-1 -> launched task ''__smoke_task__''',
      '{"connector":"slack","eventName":"message","ruleId":"rule-1","taskName":"__smoke_task__"}'::jsonb
    )
    returning id into v_evt_id;
  if v_evt_id is null then raise exception 'FAIL B: event_log insert returned no id'; end if;
  raise notice 'PASS B: event_log trigger_fired insert succeeded (::event_type cast resolved — 0018 applied)';

  insert into event_log (task_id, event_type, entity_ids, summary, payload) values
    (null, 'trigger_inbound'::event_type,        '{}'::uuid[], 'smoke inbound',        '{}'::jsonb),
    (null, 'trigger_parse_failed'::event_type,   '{}'::uuid[], 'smoke parse_failed',   '{}'::jsonb),
    (null, 'watch_rearmed'::event_type,          '{}'::uuid[], 'smoke rearmed',        '{}'::jsonb),
    (null, 'watch_rearm_failed'::event_type,     '{}'::uuid[], 'smoke rearm_failed',   '{}'::jsonb),
    (null, 'event_gap_detected'::event_type,     '{}'::uuid[], 'smoke gap_detected',   '{}'::jsonb),
    (null, 'event_gap_reconciled'::event_type,   '{}'::uuid[], 'smoke gap_reconciled', '{}'::jsonb),
    (null, 'delivery_degraded'::event_type,      '{}'::uuid[], 'smoke degraded',       '{}'::jsonb),
    (null, 'reconcile_sweep_failed'::event_type, '{}'::uuid[], 'smoke sweep_failed',   '{}'::jsonb);
  raise notice 'PASS B2: all 9 trigger-slice event_type values accepted by the enum (0018 complete)';

  begin
    insert into event_log (task_id, event_type, entity_ids, summary, payload)
      values (null, 'trigger_fired'::event_type, '{}'::uuid[], null, '{}'::jsonb);
    raise exception 'FAIL B3: event_log accepted a null summary';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS B3: event_log null summary rejected (NOT NULL) -> %', sqlerrm;
  end;

  -- ── C. connector_triggers — default set (kind='default') + no-code rules (kind='rule'), OD-190 ──────
  -- Seed a default row as provisioning would, then flip it (setDefaultTriggerEnabled). No version trigger
  -- guards this table (that was the whole point of OD-190): the in-place UPDATE now SUCCEEDS.
  insert into connector_triggers (connector, kind, event_name, available_fields, enabled)
    values ('slack', 'default', 'message', array['channel','user'], true);
  raise notice 'PASS C0: connector_triggers default row seeded (kind=default)';

  update connector_triggers set enabled = false, updated_at = now()
    where connector = 'slack' and kind = 'default' and event_name = 'message';
  select enabled into v_enabled from connector_triggers
    where connector = 'slack' and kind = 'default' and event_name = 'message';
  if v_enabled is distinct from false then raise exception 'FAIL C1: default toggle did not persist enabled=false'; end if;
  raise notice 'PASS C1: setDefaultTriggerEnabled in-place UPDATE SUCCEEDED (no version-lock — OD-190 re-home works)';

  -- The kind='default' partial unique index (connector_triggers_default_uq, 0020) forbids a 2nd default per event.
  begin
    insert into connector_triggers (connector, kind, event_name, available_fields, enabled)
      values ('slack', 'default', 'message', array['channel'], true);
    raise exception 'FAIL C2: a duplicate (connector,event_name) default was allowed';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS C2: duplicate default rejected by connector_triggers_default_uq -> %', sqlerrm;
  end;

  -- saveRule — a plain INSERT (rules are NOT unique per event: overlapping rules all fire). Two rules on the
  -- SAME event must BOTH persist (the partial unique index is default-only, so this must succeed).
  insert into connector_triggers (connector, kind, event_name, conditions, task_name, enabled)
    values ('slack', 'rule', 'message', '[{"field":"channel","op":"eq","value":"C1"}]'::jsonb, 'on_msg_1', true)
    returning id into v_rule_id;
  if v_rule_id is null then raise exception 'FAIL C3: saveRule insert returned no id'; end if;
  insert into connector_triggers (connector, kind, event_name, conditions, task_name, enabled)
    values ('slack', 'rule', 'message', '[{"field":"channel","op":"eq","value":"C2"}]'::jsonb, 'on_msg_2', true);
  raise notice 'PASS C3: two overlapping rules on one event BOTH persisted (rules not unique per event)';

  -- A rule with a null task_name must be rejected (CHECK kind<>'rule' or task_name is not null).
  begin
    insert into connector_triggers (connector, kind, event_name, conditions, task_name, enabled)
      values ('slack', 'rule', 'message', '[]'::jsonb, null, true);
    raise exception 'FAIL C4: a rule with a null task_name was allowed';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS C4: rule with null task_name rejected (CHECK) -> %', sqlerrm;
  end;

  -- ── D. event_dedup_ledger — idempotent receive (on conflict (connector,event_id) do nothing) ────────
  insert into event_dedup_ledger (connector, event_id, seen_at)
    values ('slack', 'evt-1', 1800000000) on conflict (connector, event_id) do nothing;
  -- Re-delivery of the SAME (connector,event_id) is a no-op — must not error, must not duplicate.
  insert into event_dedup_ledger (connector, event_id, seen_at)
    values ('slack', 'evt-1', 1800000009) on conflict (connector, event_id) do nothing;
  select count(*) into v_seen from event_dedup_ledger where connector = 'slack' and event_id = 'evt-1';
  if v_seen <> 1 then raise exception 'FAIL D: dedup ledger held % rows for one (connector,event_id), expected 1', v_seen; end if;
  raise notice 'PASS D: event_dedup_ledger insert-on-conflict is idempotent (one row per (connector,event_id))';

  -- ── E. connector_watches — upsert on the STABLE (connector,kind) key (re-arm mints a new channel) ────
  insert into connector_watches (connector, kind, channel_id, resource_id, expires_at, degraded, updated_at)
    values ('google', 'gmail', 'ch-1', 'res-1', 1800000600, false, now())
    on conflict (connector, kind) do update
      set channel_id = excluded.channel_id, resource_id = excluded.resource_id,
          expires_at = excluded.expires_at, degraded = excluded.degraded, updated_at = now();
  -- A re-arm: same (connector,kind), NEW channel — must UPDATE the single row, not leak a second.
  insert into connector_watches (connector, kind, channel_id, resource_id, expires_at, degraded, updated_at)
    values ('google', 'gmail', 'ch-2', 'res-2', 1800604800, false, now())
    on conflict (connector, kind) do update
      set channel_id = excluded.channel_id, resource_id = excluded.resource_id,
          expires_at = excluded.expires_at, degraded = excluded.degraded, updated_at = now();
  select channel_id into v_chan from connector_watches where connector = 'google' and kind = 'gmail';
  if v_chan <> 'ch-2' then raise exception 'FAIL E: watch re-arm did not update channel to ch-2 (got %)', v_chan; end if;
  select count(*) into v_seen from connector_watches where connector = 'google' and kind = 'gmail';
  if v_seen <> 1 then raise exception 'FAIL E2: re-arm leaked % watch rows for one (connector,kind), expected 1', v_seen; end if;
  raise notice 'PASS E: connector_watches upsert on (connector,kind) re-arms in place (one row, new channel)';

  -- setWatchDegraded — update by the CURRENT channel_id.
  update connector_watches set degraded = true, updated_at = now()
    where connector = 'google' and channel_id = 'ch-2';
  raise notice 'PASS E2: setWatchDegraded UPDATE by channel_id succeeded';

  -- ── F. event_watermarks — upsert on (connector,channel), high-churn advance ─────────────────────────
  insert into event_watermarks (connector, channel, position, updated_at)
    values ('slack', 'C1', 'ts-100', 1800000000)
    on conflict (connector, channel) do update set position = excluded.position, updated_at = excluded.updated_at;
  insert into event_watermarks (connector, channel, position, updated_at)
    values ('slack', 'C1', 'ts-102', 1800000030)
    on conflict (connector, channel) do update set position = excluded.position, updated_at = excluded.updated_at;
  select position into v_pos from event_watermarks where connector = 'slack' and channel = 'C1';
  if v_pos <> 'ts-102' then raise exception 'FAIL F: watermark did not advance to ts-102 (got %)', v_pos; end if;
  raise notice 'PASS F: event_watermarks upsert on (connector,channel) advances in place';

  -- ── G. connector_delivery_health — upsert-by-connector; CHECK success_rate in [0,1] ─────────────────
  insert into connector_delivery_health (connector, success_rate, updated_at)
    values ('slack', 0.99, 1800000000)
    on conflict (connector) do update set success_rate = excluded.success_rate, updated_at = excluded.updated_at;
  select success_rate into v_rate from connector_delivery_health where connector = 'slack';
  if v_rate is null then raise exception 'FAIL G: getDeliverySample select returned no row'; end if;
  raise notice 'PASS G: connector_delivery_health upsert + select succeeded';

  begin
    insert into connector_delivery_health (connector, success_rate, updated_at) values ('ghl', 1.5, 1800000000);
    raise exception 'FAIL G2: an out-of-range success_rate was allowed';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS G2: success_rate 1.5 rejected by CHECK [0,1] -> %', sqlerrm;
  end;

  raise notice 'ALL ASSERTIONS PASS';
end $$;

rollback;
