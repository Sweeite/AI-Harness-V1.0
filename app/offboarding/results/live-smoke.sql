-- ============================================================================
-- app/offboarding — LIVE-ADAPTER SMOKE (ISSUE-083, C10 OFF)  ⚠️ MANAGEMENT PLANE (not the silo)
-- R10 live-adapter hygiene sweep for src/supabase-store.ts (SupabaseOffboardingStore).
--
-- ⚠️ PRE-AUTHORED offline (Session 79); RUN in the morning AFTER hand-applying mgmt migration 0004 to the mgmt DB.
--
-- WHAT THIS PROVES (replays the adapter's REAL write paths against the live MGMT DDL incl. 0004):
--   • FK + insert            — INSERT offboarding_records (client_slug FK → client_registry) with workflow_state.
--   • NULL-permissive 2-person CHECK — the Step-1 row with BOTH deletion auth fields NULL is ALLOWED (the `<>`
--                              fix; `is distinct from` would have wrongly rejected it). This is the load-bearing fix.
--   • same-person REJECT     — setting deletion_authorized_by = deletion_second_authoriser raises check_violation.
--   • at-executed CHECK      — setting deletion_executed_at while an auth identity is NULL raises check_violation
--                              (three non-null identities required before executed — NFR-SEC.015).
--   • workflow_state enum    — freeze_pending + deletion_failed are valid enum values (the fail-safe sub-states).
--   • one-per-client         — a 2nd offboarding_records row for the same client_slug raises unique_violation.
--
-- CONNECTS AS: the mgmt-plane owner via MGMT_DATABASE_URL. SAFETY: ONE txn, ROLLBACK — nothing persists.
-- RUN:  source ~/.ai-harness-secrets.env
--       /opt/homebrew/opt/libpq/bin/psql "$MGMT_DATABASE_URL" -v ON_ERROR_STOP=1 -f app/offboarding/results/live-smoke.sql
-- Expected tail: "OFFBOARDING LIVE SMOKE: ALL ASSERTIONS PASSED" then ROLLBACK.
-- ============================================================================

\set ON_ERROR_STOP on
begin;

do $$
declare
  v_slug   text := 'smoke_offboard_client';
  v_caught boolean;
  v_p1     uuid := '11111111-1111-1111-1111-111111111111';
  v_p2     uuid := '22222222-2222-2222-2222-222222222222';
  v_p3     uuid := '33333333-3333-3333-3333-333333333333';
begin
  -- parent client_registry row (internal_token is NOT NULL).
  insert into client_registry (client_slug, client_name, internal_token, status)
  values (v_slug, 'Smoke Offboard Co', 'enc-token-smoke', 'offboarding');

  -- ── the Step-1 insert with BOTH deletion auth fields NULL must be ALLOWED (the `<>` NULL-permissive fix) ──
  insert into offboarding_records (client_slug, workflow_state, offboarding_initiated_at)
  values (v_slug, 'initiated', now());

  -- ── one-per-client: a 2nd record for the same slug is barred ──
  v_caught := false;
  begin
    insert into offboarding_records (client_slug, workflow_state) values (v_slug, 'initiated');
  exception when unique_violation then v_caught := true;
  end;
  if not v_caught then raise exception 'FAIL: a 2nd offboarding_records row for the same client was allowed'; end if;

  -- ── freeze_pending + deletion_failed are valid workflow_state values ──
  update offboarding_records set workflow_state = 'freeze_pending' where client_slug = v_slug;
  update offboarding_records set workflow_state = 'deletion_failed' where client_slug = v_slug;
  update offboarding_records set workflow_state = 'frozen' where client_slug = v_slug;

  -- ── two-person auth: a partial (one authoriser, second NULL) is allowed; SAME-PERSON pair is REJECTED ──
  update offboarding_records set deletion_authorized_by = v_p1 where client_slug = v_slug; -- second still NULL: OK
  v_caught := false;
  begin
    update offboarding_records set deletion_second_authoriser = v_p1 where client_slug = v_slug; -- == authorised_by
  exception when check_violation then v_caught := true;
  end;
  if not v_caught then raise exception 'FAIL: a same-person authoriser/second pair was allowed (2-person CHECK missing)'; end if;

  -- fill three DISTINCT identities (authoriser, second, executor) — this must pass.
  update offboarding_records set deletion_authorized_by = v_p1, deletion_second_authoriser = v_p2 where client_slug = v_slug;

  -- ── at-executed CHECK: setting deletion_executed_at with an auth identity still NULL is REJECTED ──
  -- (clear the second authoriser, then try to stamp executed → the all-non-null-at-executed CHECK fires.)
  update offboarding_records set deletion_second_authoriser = null where client_slug = v_slug;
  v_caught := false;
  begin
    update offboarding_records set deletion_executed_at = now(), deletion_executed_by = v_p3 where client_slug = v_slug;
  exception when check_violation then v_caught := true;
  end;
  if not v_caught then raise exception 'FAIL: deletion_executed_at stamped while an auth identity was NULL (at-executed CHECK missing)'; end if;

  -- restore the full trio and stamp executed — must succeed.
  update offboarding_records set deletion_second_authoriser = v_p2, deletion_executed_by = v_p3, deletion_executed_at = now()
    where client_slug = v_slug;

  raise notice 'OFFBOARDING LIVE SMOKE: ALL ASSERTIONS PASSED';
end $$;

rollback;
