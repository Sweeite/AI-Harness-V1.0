-- ISSUE-009 RLS scaffold — LIVE capstone (proves the ACs that offline tests cannot reach).
--
-- Run AFTER `npm run migrate` has applied 0002_rls_scaffold to the silo:
--   source ~/.ai-harness-secrets.env
--   /opt/homebrew/opt/libpq/bin/psql "$SILO_DB_URL" -v ON_ERROR_STOP=1 -f results/issue-009-rls-capstone.sql
--
-- It proves, fail-LOUD (any failed assertion RAISEs and aborts):
--   • AC-1.RLS.004.1  service_role BYPASSES RLS (sees all rows with no perm)
--   • AC-1.RLS.004.2  an authenticated user session IS RLS-constrained
--   • AC-1.RLS.002.1  a role/permission edit re-evaluates the SAME static policy — no migration
--   • AC-1.RLS.006.1  a revoke takes effect on the user's NEXT query in the SAME session — no re-login
--   • AC-NFR-PERF.001.2  the helper is evaluated once per statement (an InitPlan node in the plan)
--
-- Everything runs inside ONE transaction that ROLLS BACK — no fixture, demo table, or grant survives,
-- so the silo is byte-identical afterward (only the 0002 migration persists). session_replication_role
-- is flipped to 'replica' ONLY to insert synthetic FK-referencing fixtures, then back to 'origin' so RLS
-- is genuinely enforced during the assertions (replica mode would itself bypass RLS — the tests would be
-- meaningless). The demo table is intentionally NOT in the 44-table coverage set — it lives only inside
-- this rolled-back txn and is never a migration, so the coverage gate is unaffected.

\set ON_ERROR_STOP on
begin;

-- ── Fixtures (rolled back) — a test user U with a role holding PERM-capstone.read ──
set local session_replication_role = replica;   -- skip FK/trigger checks for synthetic rows
do $fx$
declare
  u_uid uuid := '00000000-0000-0000-0000-0000000009c9';  -- test user WITH the perm
  n_uid uuid := '00000000-0000-0000-0000-0000000009de';  -- test user with NO role/perm
  r_id  uuid := '00000000-0000-0000-0000-00000000c9c9';  -- test role
begin
  insert into public.profiles (id) values (u_uid) on conflict do nothing;
  insert into public.profiles (id) values (n_uid) on conflict do nothing;
  insert into public.roles (id, name) values (r_id, '__capstone_role__') on conflict do nothing;
  insert into public.role_permissions (role_id, permission_node) values (r_id, 'PERM-capstone.read') on conflict do nothing;
  insert into public.user_roles (user_id, role_id, active) values (u_uid, r_id, true) on conflict (user_id) do nothing;
end $fx$;

-- Demo table + a policy that uses the helper the correct (select …)-wrapped way.
create table public._rls_capstone_demo (id int primary key, label text);
alter table public._rls_capstone_demo enable row level security;
insert into public._rls_capstone_demo values (1,'a'),(2,'b'),(3,'c');
create policy demo_read on public._rls_capstone_demo for select to authenticated
  using ((select public.user_perms(auth.uid())) @> array['PERM-capstone.read']);

set local session_replication_role = origin;     -- RLS is enforced again from here on

-- ── Assertions ────────────────────────────────────────────────────────────────
do $t$
declare
  u_uid  constant text := '00000000-0000-0000-0000-0000000009c9';
  n_uid  constant text := '00000000-0000-0000-0000-0000000009de';
  cnt    int;
  plan   text;
begin
  -- AC-1.RLS.004.1 — service_role bypasses RLS (sees all 3 with no perm predicate applied)
  set local role service_role;
  set local request.jwt.claims = '';
  select count(*) into cnt from public._rls_capstone_demo;
  if cnt <> 3 then raise exception 'AC-1.RLS.004.1 FAIL: service_role saw % rows, expected 3 (bypass broken)', cnt; end if;
  reset role;
  raise notice 'PASS AC-1.RLS.004.1 — service_role bypasses RLS (saw all 3 rows)';

  -- AC-1.RLS.004.2 (positive) — authenticated user WITH the perm sees the rows
  set local role authenticated;
  set local request.jwt.claims = format('{"sub":"%s","aal":"aal2"}', u_uid);
  select count(*) into cnt from public._rls_capstone_demo;
  if cnt <> 3 then raise exception 'AC-1.RLS.004.2 FAIL: user WITH perm saw % rows, expected 3', cnt; end if;
  reset role;
  raise notice 'PASS AC-1.RLS.004.2 — authenticated user WITH perm is RLS-permitted (saw 3 rows)';

  -- AC-1.RLS.004.2 (negative / default-deny) — authenticated user with NO perm sees nothing
  set local role authenticated;
  set local request.jwt.claims = format('{"sub":"%s","aal":"aal2"}', n_uid);
  select count(*) into cnt from public._rls_capstone_demo;
  if cnt <> 0 then raise exception 'AC-1.RLS.004.2 FAIL: user with NO perm saw % rows, expected 0 (default-deny broken, #2)', cnt; end if;
  reset role;
  raise notice 'PASS AC-1.RLS.004.2 — user with NO perm is denied (default-deny holds, 0 rows)';

  -- AC-NFR-PERF.001.2 — the helper is an InitPlan (evaluated once per statement, not per row)
  set local role authenticated;
  set local request.jwt.claims = format('{"sub":"%s","aal":"aal2"}', u_uid);
  declare r record; acc text := '';
  begin
    for r in execute 'explain (format json) select * from public._rls_capstone_demo' loop
      acc := acc || (r."QUERY PLAN")::text;
    end loop;
    plan := acc;
  end;
  reset role;
  if position('InitPlan' in plan) = 0 then
    raise exception 'AC-NFR-PERF.001.2 FAIL: no InitPlan in the plan — the (select …) wrapper is not forcing once-per-statement eval. Plan: %', left(plan, 400);
  end if;
  raise notice 'PASS AC-NFR-PERF.001.2 — helper evaluated in an InitPlan (once per statement)';

  -- AC-1.RLS.006.1 — REVOKE takes effect on the NEXT query in the SAME session (no re-login/migration)
  delete from public.role_permissions where permission_node = 'PERM-capstone.read'
    and role_id = '00000000-0000-0000-0000-00000000c9c9';
  set local role authenticated;
  set local request.jwt.claims = format('{"sub":"%s","aal":"aal2"}', u_uid);
  select count(*) into cnt from public._rls_capstone_demo;
  if cnt <> 0 then raise exception 'AC-1.RLS.006.1 FAIL: after revoke the user still saw % rows (not instant)', cnt; end if;
  reset role;
  raise notice 'PASS AC-1.RLS.006.1 — revoke is instant on the next query (same session, 0 rows)';

  -- AC-1.RLS.002.1 — RE-GRANT re-opens access via the SAME static policy (no migration, no policy edit)
  insert into public.role_permissions (role_id, permission_node)
    values ('00000000-0000-0000-0000-00000000c9c9', 'PERM-capstone.read');
  set local role authenticated;
  set local request.jwt.claims = format('{"sub":"%s","aal":"aal2"}', u_uid);
  select count(*) into cnt from public._rls_capstone_demo;
  if cnt <> 3 then raise exception 'AC-1.RLS.002.1 FAIL: after re-grant the user saw % rows, expected 3', cnt; end if;
  reset role;
  raise notice 'PASS AC-1.RLS.002.1 — grant edit re-evaluates the same policy, no migration (3 rows)';

  raise notice '════════ ALL ISSUE-009 LIVE CAPSTONE ASSERTIONS PASSED ════════';
end $t$;

rollback;   -- leave the silo untouched: only the 0002 migration persists
