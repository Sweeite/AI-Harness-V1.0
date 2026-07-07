-- ISSUE-051 (loops-heartbeat) LIVE-SMOKE — replays the SupabaseEventSink write-path against the real silo DDL.
-- Target DB: SILO ($SILO_DB_URL). Rolled back (non-mutating) → safe to run live.
-- Run: psql "$SILO_DB_URL" -f app/loops-heartbeat/results/live-smoke.sql   Expect: ALL ASSERTIONS PASS, then ROLLBACK.
--
-- What it proves (the fake-passes-offline / live-adapter-throws class):
--   The adapter's ONLY write is (supabase-store.ts L38-42):
--       insert into event_log (event_type, entity_ids, summary, payload)
--         values ($1::event_type, $2::uuid[], $3, $4::jsonb)
--   with event_type ∈ {loop_missed, task_failure_spike, task_completed, task_failed} (store.ts LOOP_EVENT_TYPES),
--   entity_ids = [] (empty uuid[]), summary = non-empty text, payload = JSON.stringify(obj)::jsonb, task_id left NULL.
--   This smoke replays that exact statement for ALL FOUR emitted enum values so any column/enum/cast/constraint
--   drift (a renamed column, an enum value missing from the DDL, a NOT-NULL added without a default) throws HERE.
--   It also asserts the append-only invariant (0001 trigger t_append_only) the sink relies on: DELETE + in-place
--   UPDATE are rejected, and the one-way redaction-tombstone is accepted.
--
-- FK note: event_log.task_id references task_queue(id) but is NULLABLE, and the adapter always leaves it NULL for
--   loop-level events — so NO parent row is required. entity_ids is a plain uuid[] (not an FK), empty = '{}'.

\set ON_ERROR_STOP on
begin;

do $$
declare
  r_id     uuid;
  n_before bigint;
  n_after  bigint;
begin
  -- ── (A) REPLAY the adapter INSERT for every event_type the sink emits ────────────────────────────────────
  -- 1) task_completed  (logRun success / idle_short_circuit path)
  insert into event_log (event_type, entity_ids, summary, payload)
    values ('task_completed'::event_type, '{}'::uuid[],
            'loop ''fast'' tick ran at 2026-07-07T00:00:00.000Z',
            '{"loop":"fast","outcome":"ran","at":"2026-07-07T00:00:00.000Z"}'::jsonb)
    returning id into r_id;
  raise notice 'PASS A1: insert event_type=task_completed accepted (id=%)', r_id;

  -- 2) task_failed  (logRun failure path)
  insert into event_log (event_type, entity_ids, summary, payload)
    values ('task_failed'::event_type, '{}'::uuid[],
            'loop ''fast'' tick failed at 2026-07-07T00:10:00.000Z',
            '{"loop":"fast","outcome":"failed","consecutive_failures":1}'::jsonb)
    returning id into r_id;
  raise notice 'PASS A2: insert event_type=task_failed accepted (id=%)', r_id;

  -- 3) loop_missed  (detected-miss signal)
  insert into event_log (event_type, entity_ids, summary, payload)
    values ('loop_missed'::event_type, '{}'::uuid[],
            'loop ''medium'' missed 2 window(s) — performing a SINGLE catch-up (no backfill stampede)',
            '{"loop":"medium","missed_windows":2,"at":"2026-07-07T02:00:00.000Z"}'::jsonb)
    returning id into r_id;
  raise notice 'PASS A3: insert event_type=loop_missed accepted (id=%)', r_id;

  -- 4) task_failure_spike  (three-consecutive-failure loop-failure heartbeat)
  insert into event_log (event_type, entity_ids, summary, payload)
    values ('task_failure_spike'::event_type, '{}'::uuid[],
            'loop ''slow'' failed 3 runs in a row (>= 3) — loop-failure heartbeat; operations alert',
            '{"loop":"slow","consecutive_failures":3,"threshold":3}'::jsonb)
    returning id into r_id;
  raise notice 'PASS A4: insert event_type=task_failure_spike accepted (id=%)', r_id;

  -- ── (B) COLUMN/NOT-NULL fidelity: the two NOT-NULL-no-default cols the INSERT must satisfy are event_type +
  --        summary. Assert an empty summary is REJECTED by the adapter gate's DB counterpart is a CHECK-less
  --        text-not-null col → an explicit NULL summary must throw (proves the col name is real + not-null). ──
  begin
    insert into event_log (event_type, entity_ids, summary, payload)
      values ('task_completed'::event_type, '{}'::uuid[], null, '{}'::jsonb);
    raise exception 'FAIL B1: event_log accepted a NULL summary (summary should be NOT NULL)';
  exception when not_null_violation then
    raise notice 'PASS B1: NULL summary rejected (summary is NOT NULL, as the adapter guards) -> %', sqlerrm;
  when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS B1: NULL summary rejected -> %', sqlerrm;
  end;

  -- ── (C) ENUM drift guard: a value NOT in the event_type enum must throw. The adapter pre-validates against
  --        LOOP_EVENT_TYPES, but this asserts the DB enum itself would reject an off-list value (the failure the
  --        adapter's isLoopEventType() gate is mirroring). ──────────────────────────────────────────────────
  begin
    execute $q$ insert into event_log (event_type, entity_ids, summary, payload)
                values ('loop_completed'::event_type, '{}'::uuid[], 'bogus', '{}'::jsonb) $q$;
    raise exception 'FAIL C1: event_log accepted a bogus event_type value';
  exception when invalid_text_representation then
    raise notice 'PASS C1: bogus event_type rejected by enum (matches ERR_BAD_EVENT_TYPE gate) -> %', sqlerrm;
  when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS C1: bogus event_type rejected -> %', sqlerrm;
  end;

  -- ── (D) APPEND-ONLY invariant the sink relies on (0001 trigger t_append_only) ────────────────────────────
  -- seed a fresh row via the adapter's exact statement, then assert the guarded rejects.
  insert into event_log (event_type, entity_ids, summary, payload)
    values ('task_completed'::event_type, '{}'::uuid[],
            'loop ''fast'' append-only probe', '{"probe":true}'::jsonb)
    returning id into r_id;

  -- (D1) in-place content UPDATE (e.g. rewriting summary) must be REJECTED
  begin
    update event_log set summary = 'tampered' where id = r_id;
    raise exception 'FAIL D1: in-place event_log UPDATE was ALLOWED (append-only breached)';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS D1: in-place event_log UPDATE rejected (append-only) -> %', sqlerrm;
  end;

  -- (D2) DELETE must be REJECTED
  begin
    delete from event_log where id = r_id;
    raise exception 'FAIL D2: event_log DELETE was ALLOWED (append-only breached)';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS D2: event_log DELETE rejected (append-only) -> %', sqlerrm;
  end;

  -- (D3) the one-way redaction-tombstone (redacted_at null->ts) is the ONLY permitted mutation → ACCEPTED
  update event_log set redacted_at = now(), payload = '{"redacted":true}'::jsonb where id = r_id;
  raise notice 'PASS D3: redaction-tombstone (redacted_at null->ts) accepted (one-way, FR-7.LOG.006)';

  -- ── (E) sanity: the four adapter INSERTs above landed (append-only detector can join them) ────────────────
  select count(*) into n_after from event_log
    where event_type in ('task_completed','task_failed','loop_missed','task_failure_spike')
      and (summary like 'loop %' or summary like 'loop ''%');
  if n_after < 4 then
    raise exception 'FAIL E1: expected >=4 replayed loop rows in-txn, found %', n_after;
  end if;
  raise notice 'PASS E1: % loop event rows present in-txn (>=4 replayed)', n_after;

  raise notice 'ALL ASSERTIONS PASS';
end $$;

rollback;
