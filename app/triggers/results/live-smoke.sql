-- =============================================================================
-- ISSUE-047 — live-adapter smoke for app/triggers/src/supabase-store.ts
-- (SupabaseTriggerStore, the live pg adapter for the TriggerStore port).
--
-- WHAT THIS PROVES (against the real silo, R10 live-adapter hygiene sweep):
--   Replays every write/read path the adapter actually issues, with literals
--   whose types + enum members match the real 0001_baseline.sql DDL (as amended
--   by 0007_stage3_event_types.sql), asserts the observable effect, then
--   ROLLBACKs so nothing persists.
--
--   Paths exercised:
--     * readDeploymentSettings  — single-row local read (schema §14 / OD-162)
--     * insertTask              — insert into task_queue (type::task_type cast,
--                                 payload jsonb, originating_user_id FK->profiles)
--     * appendEvent             — insert into event_log with the TWO enum values
--                                 this slice emits (dispatch_frozen_blocked,
--                                 ingest_failure), casting ::event_type
--
--   Paths that CANNOT be smoked (documented, not skipped):
--     * isDelivered / markDelivered — target table `trigger_delivery` DOES NOT
--       EXIST in any silo migration (0001–0025) nor live (to_regclass returns
--       NULL). See MAJOR finding below. These two adapter methods throw
--       `relation "trigger_delivery" does not exist` on the live silo today.
--       ISSUE-049 (which the proposal names as the owner of this table) has no
--       issue file and no DDL. A guarded assertion below PROVES the table is
--       absent so this smoke fails loudly the day the DDL is expected but missing.
--
-- CONNECT ROLE: the adapter's pool connects via SILO_DB_URL as `postgres`
-- (rolbypassrls=t) — NOT service_role despite code comments (OD-193). RLS is
-- bypassed on this path; this smoke asserts write CORRECTNESS, not RLS.
--
-- Run:  psql "$SILO_DB_URL" -f app/triggers/results/live-smoke.sql
-- DO NOT run inline — writes are serial with the orchestrator.
-- =============================================================================

begin;

-- ── Guard: prove the two paths that cannot be exercised are genuinely broken ──
-- If trigger_delivery ever gets created, this guard flips green and the smoke
-- below (currently commented) should be enabled. Until then this is the loud
-- signal for the MAJOR finding.
do $$
begin
  if to_regclass('public.trigger_delivery') is not null then
    raise exception
      'trigger_delivery NOW EXISTS — enable the isDelivered/markDelivered smoke block';
  end if;
  raise notice 'CONFIRMED: trigger_delivery absent — isDelivered/markDelivered are non-functional live (MAJOR)';
end $$;

-- ── Parent row for insertTask.originating_user_id (uuid references profiles(id)) ──
-- The silo is empty (no profiles); create one inside the txn so the FK holds.
insert into profiles (id, email)
values ('00000000-0000-4000-8000-0000000047a1', 'smoke-047@example.test');

-- ── Path 1: readDeploymentSettings — single-row local read ───────────────────
do $$
declare n int;
begin
  select count(*) into n from deployment_settings;
  if n < 1 then
    raise exception 'readDeploymentSettings: deployment_settings has no row (adapter would fail closed)';
  end if;
  raise notice 'OK readDeploymentSettings: % settings row(s) readable', n;
end $$;

-- ── Path 2: insertTask — the real INSERT the adapter issues ──────────────────
-- Mirrors: insert into task_queue (type, task_name, payload, originating_user_id)
--          values ($1::task_type, $2, $3::jsonb, $4) returning id, created_at
do $$
declare
  new_id uuid;
  new_created timestamptz;
  got_type text;
  got_parent text;
begin
  insert into task_queue (type, task_name, payload, originating_user_id)
  values (
    'chained'::task_type,                                   -- valid task_type member
    'smoke-chained-handoff',
    jsonb_build_object('_parent_task_id', '11111111-1111-4111-8111-111111111111'),
    '00000000-0000-4000-8000-0000000047a1'
  )
  returning id, created_at into new_id, new_created;

  if new_id is null or new_created is null then
    raise exception 'insertTask: RETURNING id/created_at came back null';
  end if;

  select type::text, payload->>'_parent_task_id'
    into got_type, got_parent
    from task_queue where id = new_id;

  if got_type <> 'chained' then
    raise exception 'insertTask: type roundtrip mismatch, got %', got_type;
  end if;
  if got_parent <> '11111111-1111-4111-8111-111111111111' then
    raise exception 'insertTask: chained provenance not carried in payload._parent_task_id, got %', got_parent;
  end if;
  raise notice 'OK insertTask: task % created, type=% parent-in-payload=%', new_id, got_type, got_parent;

  -- Negative: a non-enum task type must be rejected by the DB cast (AC-5.TRG.001.1)
  begin
    insert into task_queue (type, task_name, payload, originating_user_id)
    values ('not_a_type'::task_type, 'bad', '{}'::jsonb, null);
    raise exception 'insertTask NEGATIVE: bad task_type was accepted (enum guard broken)';
  exception when invalid_text_representation then
    raise notice 'OK insertTask negative: bad task_type rejected by enum cast';
  end;
end $$;

-- ── Path 3: appendEvent — both enum values this slice emits ──────────────────
-- Mirrors: insert into event_log (task_id, event_type, summary, payload)
--          values ($1, $2::event_type, $3, $4::jsonb)
do $$
declare parent_task uuid;
begin
  -- event_log.task_id references task_queue(id); make a real parent for the
  -- freeze-block event (dispatch_frozen_blocked carries the dispatched task id).
  insert into task_queue (type, task_name, payload, originating_user_id)
  values ('event'::task_type, 'freeze-parent', '{}'::jsonb, null)
  returning id into parent_task;

  -- 3a: dispatch_frozen_blocked with a real task_id
  insert into event_log (task_id, event_type, summary, payload)
  values (parent_task, 'dispatch_frozen_blocked'::event_type,
          'dispatch blocked: deployment frozen', jsonb_build_object('path','queue_dispatch'));

  -- 3b: ingest_failure with a null task_id (verified event produced no task row)
  insert into event_log (task_id, event_type, summary, payload)
  values (null, 'ingest_failure'::event_type,
          'verified event produced no task_queue row', jsonb_build_object('delivery_id','d-1'));

  if (select count(*) from event_log
        where event_type in ('dispatch_frozen_blocked','ingest_failure')) < 2 then
    raise exception 'appendEvent: expected 2 event rows, found fewer';
  end if;
  raise notice 'OK appendEvent: both enum values (dispatch_frozen_blocked, ingest_failure) inserted';

  -- Negative: a value not in the enum must be rejected by the ::event_type cast
  begin
    insert into event_log (task_id, event_type, summary, payload)
    values (null, 'no_such_event'::event_type, 's', '{}'::jsonb);
    raise exception 'appendEvent NEGATIVE: bogus event_type accepted (enum broken)';
  exception when invalid_text_representation then
    raise notice 'OK appendEvent negative: bogus event_type rejected by enum cast';
  end;
end $$;

-- ── isDelivered / markDelivered — NOT exercised: trigger_delivery absent ──────
-- Enable this block only once the ISSUE-049 trigger_delivery DDL lands (the guard
-- at the top will start failing then, prompting the switch):
--
--   insert into trigger_delivery (delivery_id, task_id) values ('d-1', <task>)
--     on conflict (delivery_id) do nothing;
--   -- assert exists(select 1 from trigger_delivery where delivery_id='d-1')

rollback;

-- Expected NOTICE tape on a healthy silo:
--   CONFIRMED: trigger_delivery absent ...
--   OK readDeploymentSettings ...
--   OK insertTask ... / OK insertTask negative ...
--   OK appendEvent ... / OK appendEvent negative ...
-- Any raised exception = a real live-adapter defect.
