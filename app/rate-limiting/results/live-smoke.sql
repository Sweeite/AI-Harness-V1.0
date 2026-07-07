-- ISSUE-034 (C3 rate-limiting) — LIVE-SMOKE for the SupabaseRateLimiter write path (app/rate-limiting/src/supabase-store.ts).
-- Target DB: SILO ($SILO_DB_URL). Rolled back (non-mutating) — safe to run against the live silo.
-- Run: psql "$SILO_DB_URL" -f app/rate-limiting/results/live-smoke.sql   → expect ALL ASSERTIONS PASS, then ROLLBACK.
--
-- WHY: the offline suite only exercises the InMemoryRateLimiter fake — the live pg adapter's ACTUAL insert/update/
-- select statements have never run against the real DDL. This replays the adapter's real write-path statements
-- (same tables / columns / enum values / casts / guarded WHERE clauses) so any column/enum/constraint drift
-- (the fake-passes-offline / live-adapter-throws class) is caught here, not in production.
--
-- Objects replayed (exactly what the adapter touches, per the issue manifest):
--   rate_limit_tracker      — ensureWindow INSERT..ON CONFLICT, decide SELECT..FOR UPDATE + increment UPDATE +
--                             window-roll UPDATE, reconcileHeader SELECT..FOR UPDATE + calls_made UPDATE
--   rate_limit_deferred     — 95%-pause enqueue INSERT, pending-count SELECT, drainDue SELECT..FOR UPDATE SKIP
--                             LOCKED + drained_at UPDATE (id = any($1::uuid[]))
--   event_log               — the 4 rate_limit_* enum values the injected EventSink emits (0011 enum delta)
--                             + the append-only guard (an in-place UPDATE must raise)
--
-- DDL of record: app/silo/migrations/0001_baseline.sql (rate_limit_tracker, event_log, append-only trigger),
--   0012_rate_limit_deferred.sql (rate_limit_deferred), 0011_stage4_event_types.sql (rate_limit_* enum values).

\set ON_ERROR_STOP on
begin;

do $$
declare
  v_tracker_id   uuid;
  v_after_seed   int;
  v_after_confl  int;
  v_calls        int;
  v_reset        timestamptz;
  v_limit        int;
  v_made         int;
  v_remaining    int;
  v_new_made     int;
  v_def_id       uuid;
  v_def2_id      uuid;
  v_pending      bigint;
  v_run_after    timestamptz;
  v_drained_ids  uuid[];
  v_ev_id        uuid;
begin
  -- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
  -- (1) ensureWindow — INSERT .. ON CONFLICT (connector, window_label) DO UPDATE  [FR-3.RL.001 / .008]
  --     Mirror: values (connector, window_label, now(), ($3||' seconds')::interval, call_limit, 0,
  --                     now() + ($3||' seconds')::interval); conflict updates call_limit/window_duration only.
  -- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
  insert into rate_limit_tracker
      (connector, window_label, window_start, window_duration, call_limit, calls_made, reset_at)
    values ('__smoke_ghl__', 'ghl_burst_10s', now(), ('10' || ' seconds')::interval, 100, 0,
            now() + ('10' || ' seconds')::interval)
    on conflict (connector, window_label) do update
      set call_limit = excluded.call_limit,
          window_duration = excluded.window_duration,
          updated_at = now()
    returning id, calls_made into v_tracker_id, v_after_seed;
  if v_tracker_id is null then raise exception 'FAIL 1a: ensureWindow INSERT returned no id'; end if;
  if v_after_seed <> 0 then raise exception 'FAIL 1a: fresh tracker calls_made expected 0, got %', v_after_seed; end if;
  raise notice 'PASS 1a: ensureWindow INSERT landed (rate_limit_tracker id=%, calls_made=0)', v_tracker_id;

  -- Re-run with a CHANGED limit → the ON CONFLICT path must UPDATE call_limit while PRESERVING calls_made.
  -- First bump calls_made so we can prove it is preserved across the conflict-update (the FR-3.RL.008 no-redeploy path).
  update rate_limit_tracker set calls_made = 7 where id = v_tracker_id;
  insert into rate_limit_tracker
      (connector, window_label, window_start, window_duration, call_limit, calls_made, reset_at)
    values ('__smoke_ghl__', 'ghl_burst_10s', now(), ('10' || ' seconds')::interval, 250, 0,
            now() + ('10' || ' seconds')::interval)
    on conflict (connector, window_label) do update
      set call_limit = excluded.call_limit,
          window_duration = excluded.window_duration,
          updated_at = now()
    returning call_limit, calls_made into v_limit, v_after_confl;
  if v_limit <> 250 then raise exception 'FAIL 1b: conflict-update did not apply new call_limit (got %)', v_limit; end if;
  if v_after_confl <> 7 then raise exception 'FAIL 1b: conflict-update clobbered calls_made (expected preserved 7, got %)', v_after_confl; end if;
  raise notice 'PASS 1b: ensureWindow ON CONFLICT updated call_limit->250, preserved calls_made=7';

  -- reset back to a clean state for the tier/roll assertions
  update rate_limit_tracker set call_limit = 100, calls_made = 10 where id = v_tracker_id;

  -- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
  -- (2) decide — SELECT .. FOR UPDATE, then the below-80% proceed INCREMENT UPDATE  [FR-3.RL.002 source-of-truth]
  --     Mirror: select TRACKER_COLS .. for update; update set calls_made = calls_made + 1, updated_at = now().
  -- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
  select call_limit, calls_made, reset_at
    into v_limit, v_made, v_reset
    from rate_limit_tracker
    where connector = '__smoke_ghl__' and window_label = 'ghl_burst_10s'
    for update;
  if v_made is null then raise exception 'FAIL 2a: SELECT FOR UPDATE found no tracker row'; end if;
  raise notice 'PASS 2a: decide SELECT..FOR UPDATE read tracker (calls_made=%, limit=%)', v_made, v_limit;

  update rate_limit_tracker
    set calls_made = calls_made + 1, updated_at = now()
    where connector = '__smoke_ghl__' and window_label = 'ghl_burst_10s'
    returning calls_made into v_calls;
  if v_calls <> v_made + 1 then raise exception 'FAIL 2b: proceed increment expected %, got %', v_made + 1, v_calls; end if;
  raise notice 'PASS 2b: decide proceed increment UPDATE (calls_made %->%)', v_made, v_calls;

  -- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
  -- (3) decide — window-roll UPDATE (reset_at passed)  [FR-3.RL.001]
  --     Mirror: update set window_start = now(), reset_at = now() + window_duration, calls_made = 0, updated_at = now().
  --     Force an expired window first so the roll branch is genuinely exercised.
  -- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
  update rate_limit_tracker set reset_at = now() - interval '1 second', calls_made = 55
    where id = v_tracker_id;
  update rate_limit_tracker
    set window_start = now(), reset_at = now() + window_duration, calls_made = 0, updated_at = now()
    where connector = '__smoke_ghl__' and window_label = 'ghl_burst_10s'
    returning calls_made, reset_at into v_calls, v_reset;
  if v_calls <> 0 then raise exception 'FAIL 3: window-roll did not reset calls_made to 0 (got %)', v_calls; end if;
  if v_reset <= now() then raise exception 'FAIL 3: window-roll reset_at not in the future (got %)', v_reset; end if;
  raise notice 'PASS 3: decide window-roll UPDATE (calls_made->0, reset_at=%)', v_reset;

  -- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
  -- (4) reconcileHeader — SELECT .. FOR UPDATE + conservative calls_made bump  [FR-3.RL.002 / AC-3.RL.002.2]
  --     Mirror: newCallsMade = call_limit - vendorRemaining;
  --             update set calls_made = $3, updated_at = now() where connector=$1 and window_label=$2.
  -- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
  update rate_limit_tracker set calls_made = 10 where id = v_tracker_id;   -- tracker thinks 90 remaining
  select call_limit, calls_made
    into v_limit, v_made
    from rate_limit_tracker
    where connector = '__smoke_ghl__' and window_label = 'ghl_burst_10s'
    for update;
  v_remaining := v_limit - v_made;             -- tracker's own remaining = 90
  -- vendor header says only 5 remaining (< tracker's 90) → conservative value wins.
  v_new_made := v_limit - 5;                    -- = 95
  update rate_limit_tracker set calls_made = v_new_made, updated_at = now()
    where connector = '__smoke_ghl__' and window_label = 'ghl_burst_10s'
    returning calls_made into v_calls;
  if v_calls <> 95 then raise exception 'FAIL 4: conservative reconcile expected calls_made 95, got %', v_calls; end if;
  raise notice 'PASS 4: reconcileHeader conservative bump (tracker_remaining %, vendor 5 -> calls_made %)', v_remaining, v_calls;

  -- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
  -- (5) 95%-pause enqueue — INSERT into rate_limit_deferred  [FR-3.RL.004 persisted queue / #1]
  --     Mirror: values (connector, window_label, run_after, risk_level, irreversible, urgency, idempotency_key, now()).
  --     run_after = the tracker's reset_at at enqueue time.
  -- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
  select reset_at into v_run_after from rate_limit_tracker where id = v_tracker_id;
  insert into rate_limit_deferred
      (connector, window_label, run_after, risk_level, irreversible, urgency, idempotency_key, enqueued_at)
    values ('__smoke_ghl__', 'ghl_burst_10s', v_run_after, 'low', false, 'background',
            '__smoke_idem_key_1__', now())
    returning id, run_after into v_def_id, v_run_after;
  if v_def_id is null then raise exception 'FAIL 5a: rate_limit_deferred INSERT returned no id'; end if;
  raise notice 'PASS 5a: 95%%-pause enqueue INSERT into rate_limit_deferred (id=%, key set)', v_def_id;

  -- A second row WITHOUT an idempotency_key (a queued READ) — column is nullable; must accept null.
  insert into rate_limit_deferred
      (connector, window_label, run_after, risk_level, irreversible, urgency, idempotency_key, enqueued_at)
    values ('__smoke_ghl__', 'ghl_burst_10s', now() - interval '1 second', null, false, 'background',
            null, now())
    returning id into v_def2_id;
  raise notice 'PASS 5b: enqueue INSERT with null risk_level + null idempotency_key accepted (id=%)', v_def2_id;

  -- pending-count SELECT (the paused-event payload) — count(*) where drained_at is null, scoped to our smoke rows.
  select count(*) into v_pending
    from rate_limit_deferred where drained_at is null and connector = '__smoke_ghl__';
  if v_pending < 2 then raise exception 'FAIL 5c: pending-count expected >=2 for smoke rows, got %', v_pending; end if;
  raise notice 'PASS 5c: pending-count SELECT (drained_at is null) = % for smoke rows', v_pending;

  -- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
  -- (6) drainDue — SELECT .. FOR UPDATE SKIP LOCKED (run_after <= now()) + mark-drained UPDATE  [FR-3.RL.004.2]
  --     Mirror: select .. where drained_at is null and run_after <= now() .. for update skip locked;
  --             update set drained_at = now() where id = any($1::uuid[]).
  --     Force our keyed row due so it is picked; the future-run_after row must NOT be picked.
  -- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
  update rate_limit_deferred set run_after = now() - interval '1 second' where id = v_def_id;
  -- FOR UPDATE cannot combine with an aggregate, so the claim runs in a CTE (exactly as the adapter's
  -- row-returning claim SELECT does) and the app-side id-collection is mirrored by array_agg over the CTE.
  with claimed as (
    select id
      from rate_limit_deferred
      where drained_at is null and run_after <= now() and connector = '__smoke_ghl__'
      order by enqueued_at asc
      for update skip locked
  )
  select array_agg(id) into v_drained_ids from claimed;
  if v_drained_ids is null or array_length(v_drained_ids, 1) < 1 then
    raise exception 'FAIL 6a: drainDue claim SELECT picked no due rows';
  end if;
  raise notice 'PASS 6a: drainDue SELECT..FOR UPDATE SKIP LOCKED claimed % due row(s)', array_length(v_drained_ids, 1);

  update rate_limit_deferred set drained_at = now() where id = any(v_drained_ids::uuid[]);
  if (select drained_at from rate_limit_deferred where id = v_def_id) is null then
    raise exception 'FAIL 6b: drainDue mark-drained UPDATE did not set drained_at on the claimed row';
  end if;
  raise notice 'PASS 6b: drainDue mark-drained UPDATE (drained_at set via id = any($1::uuid[]))';

  -- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
  -- (7) event_log — the 4 rate_limit_* enum values the injected EventSink emits  [0011 enum delta / #3]
  --     If migration 0011 did not land, ANY of these INSERTs raises `invalid input value for enum event_type`.
  --     summary is NOT NULL (AC-7.LOG.002.2). task_id left null (nullable FK → no fixture parent needed).
  -- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
  insert into event_log (event_type, summary, payload)
    values ('rate_limit_throttled', '80% throttle — background call throttled (smoke)',
            '{"usage_fraction":0.8,"threshold":0.8}'::jsonb);
  insert into event_log (event_type, summary, payload)
    values ('rate_limit_paused', '95% pause — non-critical call queued for post-reset (smoke)',
            '{"queued_count":2}'::jsonb);
  insert into event_log (event_type, summary, payload)
    values ('rate_limit_backoff', '429 — backing off before retry (smoke)',
            '{"delay_ms":1000,"source":"exponential"}'::jsonb);
  insert into event_log (event_type, summary, payload)
    values ('rate_limit_halt_escalated', 'high-risk/irreversible call HALTED and escalated (smoke)',
            '{"reason":"ceiling","risk_level":"high"}'::jsonb)
    returning id into v_ev_id;
  raise notice 'PASS 7: all 4 rate_limit_* event_type enum values accepted by event_log INSERT';

  -- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
  -- (8) GUARDED REJECT — event_log is append-only: an in-place content UPDATE on a fresh row MUST raise (#1/#3).
  --     Proves the tamper-evident trigger enforces LIVE (the sink can never silently rewrite a rate-limit event).
  -- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
  begin
    update event_log set summary = 'tampered' where id = v_ev_id;
    raise exception 'FAIL 8: event_log in-place content UPDATE was ALLOWED (append-only breached)';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS 8: event_log append-only in-place UPDATE rejected -> %', sqlerrm;
  end;

  raise notice 'ALL ASSERTIONS PASS';
end $$;

rollback;
