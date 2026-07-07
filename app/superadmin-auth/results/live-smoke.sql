-- ============================================================================
-- live-smoke.sql — ISSUE-014  SupabaseSuperAdminAuthStore  (#2-critical: super-admin auth)
--
-- WHAT THIS PROVES (offline sweep is NOT enough — R10 / live-adapter-hygiene-sweep):
--   Session 72 disclosed this package NEVER had a live-adapter smoke. This script replays
--   the adapter's ONLY real DB write paths (src/supabase-store.ts) against the live silo DDL
--   and asserts each write actually lands with the shape the code emits:
--     1. logEvent()   — INSERT into event_log (task_id, event_type, entity_ids, summary, payload)
--                       VALUES (null, $1::event_type, $2, $3, $4::jsonb) RETURNING id, created_at
--                       proven for a representative auth event_type ('sign_in_success')
--                       AND for the null-user_id case where entity_ids := '{}' (uuid[]).
--     2. raiseAlert()  — is logEvent() with event_type='identity_rejected', user_id=null,
--                       summary='super-admin alert: …', payload={alert_kind, account}.
--                       Proves the enum literal 'identity_rejected' (added by 0007) is admitted live.
--   The soft-lock read-modify-write is APP-LAYER process-local state (Map), by design (AF-077 /
--   ISSUE-014 §5 — "no net-new app table") — it touches NO DB table, so there is nothing to smoke here.
--
-- CONNECT ROLE (verified live): SILO_DB_URL connects as 'postgres' owner (rolbypassrls=t) — RLS is
--   BYPASSED on this path (OD-193). event_log has RLS enabled + all revoked from anon/authenticated,
--   but the owner insert is unaffected. The append-only t_append_only trigger fires on UPDATE/DELETE
--   only (0001_baseline.sql L707) — INSERT is unaffected. DELETE is additionally revoked (0001c_rls L70)
--   but the adapter never deletes.
--
-- DDL cross-check (all confirmed live via information_schema.columns + pg_enum):
--   event_log(task_id uuid NULL, event_type event_type NOT NULL, entity_ids _uuid NULL,
--             summary text NOT NULL, payload jsonb NULL, id/created_at defaulted)  — 0001_baseline.sql L483.
--   event_type enum contains 'sign_in_success' + 'identity_rejected' (+5 more) — 0007_stage3_event_types.sql L19-25.
--
-- RUN: psql "$SILO_DB_URL" -f app/superadmin-auth/results/live-smoke.sql
--   Everything runs inside BEGIN … ROLLBACK — NOTHING PERSISTS. Do NOT commit. Orchestrator runs it serially.
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ── Path 1: logEvent() with a real user_id → entity_ids := ARRAY[user_id] ────────────
-- Mirrors login.ts L148: logEvent({event_type:'sign_in_success', user_id, summary, detail:{aal:'aal2'}})
DO $$
DECLARE
  v_uid    uuid := gen_random_uuid();   -- a representative auth.users(id); not FK-checked (entity_ids is a bare uuid[])
  v_id     uuid;
  v_ts     timestamptz;
  v_type   text;
  v_ent    uuid[];
  v_pay    jsonb;
BEGIN
  INSERT INTO event_log (task_id, event_type, entity_ids, summary, payload)
  VALUES (null, 'sign_in_success'::event_type, ARRAY[v_uid], 'password+2FA passed', '{"aal":"aal2"}'::jsonb)
  RETURNING id, created_at INTO v_id, v_ts;

  IF v_id IS NULL OR v_ts IS NULL THEN
    RAISE EXCEPTION 'logEvent smoke: RETURNING id/created_at came back NULL';
  END IF;

  SELECT event_type::text, entity_ids, payload INTO v_type, v_ent, v_pay
  FROM event_log WHERE id = v_id;

  IF v_type <> 'sign_in_success' THEN
    RAISE EXCEPTION 'logEvent smoke: stored event_type=% (expected sign_in_success)', v_type;
  END IF;
  IF v_ent IS DISTINCT FROM ARRAY[v_uid] THEN
    RAISE EXCEPTION 'logEvent smoke: entity_ids mismatch — got %', v_ent;
  END IF;
  IF v_pay->>'aal' <> 'aal2' THEN
    RAISE EXCEPTION 'logEvent smoke: payload jsonb not stored — got %', v_pay;
  END IF;
  RAISE NOTICE 'OK path1 logEvent(sign_in_success, user_id) id=%', v_id;
END $$;

-- ── Path 2: logEvent() with NULL user_id → entity_ids := '{}' (empty uuid[]) ─────────
-- Adapter: `const entityIds = row.user_id ? [row.user_id] : [];` → an empty uuid[] param.
-- Proves the empty-array bind is accepted by the nullable _uuid column (not a not-null violation).
DO $$
DECLARE v_id uuid; v_ent uuid[];
BEGIN
  INSERT INTO event_log (task_id, event_type, entity_ids, summary, payload)
  VALUES (null, 'sign_in_failure'::event_type, ARRAY[]::uuid[], 'wrong password', '{}'::jsonb)
  RETURNING id INTO v_id;
  SELECT entity_ids INTO v_ent FROM event_log WHERE id = v_id;
  IF v_ent IS DISTINCT FROM ARRAY[]::uuid[] THEN
    RAISE EXCEPTION 'logEvent smoke(null-user): entity_ids expected empty array, got %', v_ent;
  END IF;
  RAISE NOTICE 'OK path2 logEvent(sign_in_failure, null user) empty entity_ids id=%', v_id;
END $$;

-- ── Path 3: raiseAlert() — logEvent(event_type='identity_rejected', null user, alert payload) ─
-- Mirrors supabase-store.ts L72-75: raiseAlert('account_lockout', account, summary) →
--   logEvent({event_type:'identity_rejected', user_id:null,
--             summary:`super-admin alert: ${summary}`, detail:{alert_kind, account}})
-- Proves the 'identity_rejected' enum literal is admitted live (0007) — an unknown value here would
-- raise invalid_text_representation LOUD (#3-safe), never a silent skip.
DO $$
DECLARE v_id uuid; v_type text; v_sum text; v_pay jsonb;
BEGIN
  INSERT INTO event_log (task_id, event_type, entity_ids, summary, payload)
  VALUES (null, 'identity_rejected'::event_type, ARRAY[]::uuid[],
          'super-admin alert: account temporarily locked after 5 failed password attempts',
          '{"alert_kind":"account_lockout","account":"admin@example.com"}'::jsonb)
  RETURNING id INTO v_id;

  SELECT event_type::text, summary, payload INTO v_type, v_sum, v_pay
  FROM event_log WHERE id = v_id;

  IF v_type <> 'identity_rejected' THEN
    RAISE EXCEPTION 'raiseAlert smoke: event_type=% (expected identity_rejected)', v_type;
  END IF;
  IF v_sum NOT LIKE 'super-admin alert:%' THEN
    RAISE EXCEPTION 'raiseAlert smoke: summary prefix wrong — got %', v_sum;
  END IF;
  IF v_pay->>'alert_kind' <> 'account_lockout' OR v_pay->>'account' <> 'admin@example.com' THEN
    RAISE EXCEPTION 'raiseAlert smoke: alert payload not stored — got %', v_pay;
  END IF;
  RAISE NOTICE 'OK path3 raiseAlert(identity_rejected) id=%', v_id;
END $$;

-- ── Negative control: an event_type NOT in the enum must raise LOUD (proves #3 cast-guard) ──
-- The adapter relies on `$1::event_type` to fail loud on a bad value. Confirm the guard is real.
DO $$
BEGIN
  BEGIN
    INSERT INTO event_log (task_id, event_type, entity_ids, summary, payload)
    VALUES (null, 'not_a_real_event'::event_type, ARRAY[]::uuid[], 'should never persist', '{}'::jsonb);
    RAISE EXCEPTION 'negative control FAILED: bogus event_type was accepted (silent-skip risk #3)';
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE NOTICE 'OK negative-control: bogus event_type raised invalid_text_representation (loud, #3-safe)';
  END;
END $$;

ROLLBACK;
-- Nothing above persists. If every RAISE NOTICE 'OK …' printed and no exception fired, the adapter's
-- live write paths are DDL-correct against the current silo head.
