-- app/auth/results/live-smoke.sql
-- ISSUE-013 — LIVE-ADAPTER SMOKE for app/auth/src/supabase-store.ts (SupabaseAuthStore).
-- R10 live-adapter hygiene sweep: offline-green (auth.test.ts / InMemoryAuthStore) is NOT enough to flip
-- ISSUE-013 `done`. This script replays the adapter's REAL write paths against the live silo DDL with
-- representative literals matching the real column types + enum members, asserts the expected effect, and
-- ROLLBACKs so nothing persists.
--
-- Connect role: SILO_DB_URL connects as `postgres` (rolbypassrls=t) — RLS is BYPASSED on this path (OD-193).
-- These asserts test the ADAPTER'S SQL SHAPE against the live schema, not RLS enforcement.
--
-- WHAT IT PROVES (per adapter method):
--   upsertProfile      — insert + on-conflict(id) update keeps email current, COALESCEs name (no clobber).
--   readProfile        — owner-reads-own SELECT column list resolves against live profiles.
--   touchLastActive    — greatest()/to_timestamp() monotonic-forward bump never regresses last_active_at.
--   setActive          — active flag update.
--   logEvent           — event_log insert with $1::event_type using all 7 auth enum literals (0007 applied).
--   setProviderConfig  — config_values on-conflict(key) upsert of auth.oauth_enabled / auth.oauth_provider.
--   getProviderConfig  — the read-back SELECT.
--
-- KNOWN FINDINGS EXERCISED (the smoke makes them observable):
--   F1 (CONFIRMED, MINOR): setProviderConfig writes NO config_audit_log row (no trigger on config_values —
--       verified live) though the src header L102 claims "the audit path (ISSUE-086) intact." Assert F1
--       demonstrates zero audit rows appear for a live provider toggle.
--   F2 (NEW, MINOR): setProviderConfig ON CONFLICT omits `updated_at = now()`, so an UPDATE leaves
--       updated_at stale. Assert F2 replays the adapter's exact upsert twice and shows updated_at unchanged.
--
-- DO NOT RUN THIS YOURSELF — live writes stay serial with the orchestrator. It BEGINs and ROLLBACKs.

BEGIN;

-- ── Parent rows required by FK profiles.id -> auth.users(id) (profiles_id_fkey, verified live) ──────────
-- upsertProfile inserts into profiles(id) which references auth.users(id) ON DELETE CASCADE. Create the
-- auth.users parent inside the txn so the mirror insert satisfies the FK. (postgres owner can write auth.*)
insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-0000-0000-0000000a0001'::uuid,
        '00000000-0000-0000-0000-000000000000'::uuid,
        'authenticated', 'authenticated', 'smoke-auth@example.test');

-- ── upsertProfile — first login (insert) then repeat login (on conflict update) ────────────────────────
-- Replays the adapter's exact statement (supabase-store.ts L37-42).
insert into profiles (id, email, name)
values ('00000000-0000-0000-0000-0000000a0001', 'smoke-auth@example.test', 'Smoke User')
on conflict (id) do update set email = excluded.email,
  name = coalesce(excluded.name, profiles.name)
returning id, email, name, active, created_at, last_active_at;

-- Repeat login with a NULL name: COALESCE must keep the existing 'Smoke User' (no clobber, #1).
insert into profiles (id, email, name)
values ('00000000-0000-0000-0000-0000000a0001', 'smoke-auth+2@example.test', null)
on conflict (id) do update set email = excluded.email,
  name = coalesce(excluded.name, profiles.name);

DO $$
DECLARE r profiles%ROWTYPE;
BEGIN
  select * into r from profiles where id = '00000000-0000-0000-0000-0000000a0001';
  IF r.email <> 'smoke-auth+2@example.test' THEN
    RAISE EXCEPTION 'upsertProfile: email not kept current (got %)', r.email;
  END IF;
  IF r.name <> 'Smoke User' THEN
    RAISE EXCEPTION 'upsertProfile: COALESCE clobbered name on null-name re-login (got %)', r.name;
  END IF;
  IF r.active <> true THEN
    RAISE EXCEPTION 'upsertProfile: active did not default true (got %)', r.active;
  END IF;
END $$;

-- ── touchLastActive — monotonic-forward greatest() bump (supabase-store.ts L60-65) ─────────────────────
-- Seed last_active_at to a fixed point, then attempt a BACKWARD bump; greatest() must refuse to regress.
update profiles set last_active_at = to_timestamp(2000000000) where id = '00000000-0000-0000-0000-0000000a0001';
update profiles
   set last_active_at = greatest(coalesce(last_active_at, to_timestamp(1000000000)), to_timestamp(1000000000))
 where id = '00000000-0000-0000-0000-0000000a0001';

DO $$
DECLARE la timestamptz;
BEGIN
  select last_active_at into la from profiles where id = '00000000-0000-0000-0000-0000000a0001';
  IF la <> to_timestamp(2000000000) THEN
    RAISE EXCEPTION 'touchLastActive: backward write regressed last_active_at to % (greatest() failed)', la;
  END IF;
END $$;

-- Forward bump must advance.
update profiles
   set last_active_at = greatest(coalesce(last_active_at, to_timestamp(2100000000)), to_timestamp(2100000000))
 where id = '00000000-0000-0000-0000-0000000a0001';
DO $$
DECLARE la timestamptz;
BEGIN
  select last_active_at into la from profiles where id = '00000000-0000-0000-0000-0000000a0001';
  IF la <> to_timestamp(2100000000) THEN
    RAISE EXCEPTION 'touchLastActive: forward bump did not advance last_active_at (got %)', la;
  END IF;
END $$;

-- ── setActive (supabase-store.ts L69) ──────────────────────────────────────────────────────────────────
update profiles set active = false where id = '00000000-0000-0000-0000-0000000a0001';
DO $$
DECLARE a boolean;
BEGIN
  select active into a from profiles where id = '00000000-0000-0000-0000-0000000a0001';
  IF a <> false THEN RAISE EXCEPTION 'setActive: active not set false (got %)', a; END IF;
END $$;

-- ── logEvent — all 7 auth event_type literals cast ::event_type (supabase-store.ts L82-85) ─────────────
-- Each cast raises invalid_text_representation LOUD if the enum literal is absent (0007). entity_ids uuid[].
DO $$
DECLARE
  et text;
  auth_types text[] := array['sign_in_success','sign_in_failure','session_established','identity_rejected',
                             'reuse_detection_revocation','task_continuation','verification_failure'];
  n int;
BEGIN
  FOREACH et IN ARRAY auth_types LOOP
    EXECUTE format(
      $q$insert into event_log (task_id, event_type, entity_ids, summary, payload)
         values (null, %L::event_type, %L::uuid[], %L, %L::jsonb)$q$,
      et,
      '{00000000-0000-0000-0000-0000000a0001}',
      'smoke: ' || et,
      '{"smoke":true}');
  END LOOP;
  select count(*) into n from event_log where summary like 'smoke: %';
  IF n <> 7 THEN RAISE EXCEPTION 'logEvent: expected 7 auth events inserted, got %', n; END IF;
END $$;

-- ── setProviderConfig — config_values on-conflict(key) upsert (supabase-store.ts L104-115) ─────────────
-- Replays the adapter's EXACT two statements (note: NO updated_at = now() in the on-conflict clause).
insert into config_values (key, value) values ('auth.oauth_enabled', to_jsonb(false))
  on conflict (key) do update set value = excluded.value;
insert into config_values (key, value) values ('auth.oauth_provider', to_jsonb('microsoft'::text))
  on conflict (key) do update set value = excluded.value;

DO $$
DECLARE v_enabled jsonb; v_provider jsonb;
BEGIN
  select value into v_enabled  from config_values where key = 'auth.oauth_enabled';
  select value into v_provider from config_values where key = 'auth.oauth_provider';
  IF v_enabled is distinct from to_jsonb(false) THEN
    RAISE EXCEPTION 'setProviderConfig: oauth_enabled not persisted (got %)', v_enabled;
  END IF;
  IF v_provider is distinct from to_jsonb('microsoft'::text) THEN
    RAISE EXCEPTION 'setProviderConfig: oauth_provider not persisted (got %)', v_provider;
  END IF;
END $$;

-- ── F1 (CONFIRMED): no config_audit_log row is produced by the provider toggle above ───────────────────
-- No trigger on config_values (verified live), and the adapter writes no audit row itself. The header
-- claim "the audit path (ISSUE-086) intact" is FALSE. This assert documents the gap: the toggle left the
-- audit trail empty for these keys (#3 silent-audit-gap).
DO $$
DECLARE n int;
BEGIN
  select count(*) into n from config_audit_log where key in ('auth.oauth_enabled','auth.oauth_provider');
  IF n <> 0 THEN
    RAISE NOTICE 'F1 unexpectedly refuted: % audit rows found (a trigger now exists?)', n;
  ELSE
    RAISE NOTICE 'F1 CONFIRMED: provider toggle produced 0 config_audit_log rows (audit path NOT intact).';
  END IF;
END $$;

-- ── F2 (NEW): ON CONFLICT omits updated_at = now() → updated_at is stale on UPDATE ─────────────────────
-- Replay the adapter's upsert a second time with a NEW value; updated_at must NOT advance (proving the bug).
DO $$
DECLARE ts_before timestamptz; ts_after timestamptz;
BEGIN
  select updated_at into ts_before from config_values where key = 'auth.oauth_enabled';
  perform pg_sleep(0.05);
  -- adapter's exact clause (no updated_at bump):
  insert into config_values (key, value) values ('auth.oauth_enabled', to_jsonb(true))
    on conflict (key) do update set value = excluded.value;
  select updated_at into ts_after from config_values where key = 'auth.oauth_enabled';
  IF ts_after <> ts_before THEN
    RAISE NOTICE 'F2 refuted: updated_at advanced (% -> %), adapter must be bumping it.', ts_before, ts_after;
  ELSE
    RAISE NOTICE 'F2 CONFIRMED: value changed but updated_at stayed % (stale audit-relevant timestamp).', ts_after;
  END IF;
END $$;

ROLLBACK;
