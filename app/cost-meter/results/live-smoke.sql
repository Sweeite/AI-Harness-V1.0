-- ISSUE-074 — live-adapter hygiene smoke for app/cost-meter/src/supabase-store.ts (R10).
-- Connects as the silo owner role 'postgres' (rolbypassrls=t) per Wave A / OD-193 — RLS is bypassed,
-- so this proves GRANTs + column/enum shape + the dedup write path, NOT an authenticated RLS path.
--
-- WHAT THIS PROVES (the adapter's REAL write path — the ONLY write it does):
--   writeCostBreachNotification():  INSERT INTO notifications (type, severity, title, body)
--                                   VALUES ('cost_threshold_breach','warning', <title>, <body>)
--   plus the dedup guard: a second breach for the same window+title inside the window interval
--   must NOT insert (the `select 1 ... where type=$1 and title=$2 and created_at > now()-interval` gate).
--   notifications() read-back: select ... where type='cost_threshold_breach' order by created_at asc.
--
-- Also asserts the READ-path column/enum shape the adapter depends on (event_log / task_queue /
-- config_values) exists with the expected types, so a schema drift is caught here not in prod.
--
-- Everything runs inside ONE txn and ROLLBACKs — nothing persists. Do NOT edit to COMMIT.
-- Run (orchestrator, serial):  /opt/homebrew/opt/libpq/bin/psql "$SILO_DB_URL" -f app/cost-meter/results/live-smoke.sql

\set ON_ERROR_STOP on
BEGIN;

-- ── 0. Guardrail: confirm we are the expected owner plane (postgres, rlsbypass). ──────────────────────
DO $$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'expected connect role postgres (per OD-193); got %', current_user;
  END IF;
END $$;

-- ── 1. READ-path shape guard: the exact columns/types the adapter SELECTs must exist. ─────────────────
DO $$
DECLARE missing text;
BEGIN
  -- event_log: id, task_id(uuid), event_type(enum), cost_tokens(bigint), cost_unknown(bool), payload(jsonb), created_at
  SELECT string_agg(c.needed, ', ') INTO missing
  FROM (VALUES
    ('event_log','cost_tokens','bigint'),
    ('event_log','cost_unknown','boolean'),
    ('event_log','task_id','uuid'),
    ('event_log','payload','jsonb'),
    ('task_queue','id','uuid'),
    ('config_values','key','text'),
    ('config_values','value','jsonb')
  ) AS want(tbl, col, typ)
  CROSS JOIN LATERAL (SELECT format('%s.%s(%s)', want.tbl, want.col, want.typ) AS needed) c
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns ic
    WHERE ic.table_name = want.tbl AND ic.column_name = want.col AND ic.data_type = want.typ
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'read-path column/type drift: missing %', missing;
  END IF;
END $$;

-- ── 2. Enum guard: 'cost_threshold_breach' must be a live alert_type member (the INSERT's type literal). ──
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'alert_type' AND e.enumlabel = 'cost_threshold_breach'
  ) THEN
    RAISE EXCEPTION 'alert_type is missing enum member cost_threshold_breach';
  END IF;
END $$;

-- ── 3. WRITE path: replay the adapter INSERT with representative literals (daily breach). ──────────────
--     Mirrors writeCostBreachNotification(window='daily', estimatedUsd=63.20, thresholdUsd=50.00).
INSERT INTO notifications (type, severity, title, body)
VALUES (
  'cost_threshold_breach',
  'warning',
  'Cost threshold breach (daily)',
  'Estimated daily spend $63.20 exceeded the $50.00 soft alert. Estimate-grade (never the vendor invoice).'
);

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM notifications
   WHERE type = 'cost_threshold_breach' AND title = 'Cost threshold breach (daily)';
  IF n <> 1 THEN
    RAISE EXCEPTION 'expected exactly 1 daily breach row after first insert; got %', n;
  END IF;
END $$;

-- ── 4. DEDUP guard: replay the adapter's read-then-insert gate. The `select 1` must find the row above,
--       so the second breach for the same window+title inside the interval is SUPPRESSED (no 2nd insert). ──
DO $$
DECLARE already boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM notifications
     WHERE type = 'cost_threshold_breach'
       AND title = 'Cost threshold breach (daily)'
       AND created_at > now() - interval '1 day'
  ) INTO already;
  IF NOT already THEN
    -- would mean the adapter re-inserts every poll tick → notification flood (regression of the session-72 fix)
    RAISE EXCEPTION 'dedup guard failed: prior daily breach not visible to the suppression select';
  END IF;
END $$;

-- ── 5. Distinct window is NOT suppressed by the daily row: a weekly breach has a different title, so the
--       dedup gate (keyed on type+title) lets it through. Replay writeCostBreachNotification(window='weekly'). ──
INSERT INTO notifications (type, severity, title, body)
VALUES (
  'cost_threshold_breach',
  'warning',
  'Cost threshold breach (weekly)',
  'Estimated weekly spend $240.00 exceeded the $200.00 soft alert. Estimate-grade (never the vendor invoice).'
);

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM notifications
   WHERE type = 'cost_threshold_breach'
     AND title IN ('Cost threshold breach (daily)', 'Cost threshold breach (weekly)');
  IF n <> 2 THEN
    RAISE EXCEPTION 'expected 2 breach rows (daily + weekly); got %', n;
  END IF;
END $$;

-- ── 6. READ-BACK: notifications() returns both rows, cost_threshold_breach only, created_at asc. ─────────
DO $$
DECLARE rec record; cnt int := 0;
BEGIN
  FOR rec IN
    SELECT id::text AS id, type, severity, title, body, created_at
      FROM notifications
     WHERE type = 'cost_threshold_breach'
       AND title IN ('Cost threshold breach (daily)', 'Cost threshold breach (weekly)')
     ORDER BY created_at ASC
  LOOP
    cnt := cnt + 1;
    IF rec.severity <> 'warning' THEN
      RAISE EXCEPTION 'read-back row % has severity % (expected warning)', rec.title, rec.severity;
    END IF;
  END LOOP;
  IF cnt <> 2 THEN
    RAISE EXCEPTION 'read-back expected 2 rows; got %', cnt;
  END IF;
END $$;

ROLLBACK;  -- nothing persists — writes stay serial with the orchestrator.
