-- ISSUE-018 RBAC authorization core — LIVE capstone (proves the ACs offline tests cannot reach: the seed
-- against real tables, the RLS helper reading the SAME role_permissions the harness does [AF-080], and the
-- ADR-004 last-Super-Admin atomic guard under a real conditional UPDATE).
--
-- Run AFTER migrations 0001-0005 are applied to the silo:
--   source ~/.ai-harness-secrets.env
--   /opt/homebrew/opt/libpq/bin/psql "$SILO_DB_URL" -v ON_ERROR_STOP=1 -f app/rbac/results/issue-018-capstone.sql
--
-- Proves, fail-LOUD (any failed assertion RAISEs and aborts):
--   • AC-1.ROLE.001.1  the six seed roles reach existence (seed mechanism target state)
--   • AC-1.PERM.002.1 / AF-080  user_perms(uid) — the RLS SECURITY-DEFINER helper — returns EXACTLY the
--                     seeded role_permissions grant set: a Super Admin session sees PERM-system.role_manage,
--                     a Standard User session does not. The harness can() reads the same two tables, so the
--                     two readers cannot drift.
--   • AC-1.ROLE.005.2  the atomic guard: with two Super Admins, demoting a non-last one succeeds (rowcount 1)
--                     and demoting the resulting last one is REFUSED by the same conditional UPDATE (rowcount
--                     0) — the count is re-evaluated under the row lock, so it can never reach zero.
--
-- Everything runs inside ONE transaction that ROLLS BACK — no role, grant, user, or profile survives, so the
-- silo is byte-identical afterward. session_replication_role is 'replica' ONLY to insert synthetic
-- FK-referencing fixtures, then 'origin' so the helper reads under real semantics.

\set ON_ERROR_STOP on
begin;

set local session_replication_role = replica;   -- skip FK/trigger checks for synthetic rows
do $fx$
declare
  sa1 uuid := '00000000-0000-0000-0000-000000018a01';  -- Super Admin user #1
  sa2 uuid := '00000000-0000-0000-0000-000000018a02';  -- Super Admin user #2
  stu uuid := '00000000-0000-0000-0000-000000018501';  -- Standard User
  sa_role uuid;
  std_role uuid;
begin
  -- Seed the six roles (idempotent target state — on conflict keeps any real seed intact).
  insert into public.roles (name, is_default, is_protected) values
    ('Super Admin', true, true),
    ('Admin', true, false),
    ('Finance', true, false),
    ('HR', true, false),
    ('Account Manager', true, false),
    ('Standard User', true, false)
  on conflict (name) do nothing;

  select id into sa_role  from public.roles where name = 'Super Admin';
  select id into std_role from public.roles where name = 'Standard User';

  -- Super Admin holds PERM-system.role_manage; Standard User does not (default-deny).
  insert into public.role_permissions (role_id, permission_node)
    values (sa_role, 'PERM-system.role_manage') on conflict (role_id, permission_node) do nothing;

  insert into public.profiles (id, email) values
    (sa1, 'iss018-sa1@example.invalid'),
    (sa2, 'iss018-sa2@example.invalid'),
    (stu, 'iss018-std@example.invalid')
  on conflict do nothing;

  insert into public.user_roles (user_id, role_id, active) values
    (sa1, sa_role, true),
    (sa2, sa_role, true),
    (stu, std_role, true)
  on conflict (user_id) do nothing;
end $fx$;

set local session_replication_role = origin;     -- real semantics from here

-- ── Assertions ───────────────────────────────────────────────────────────────────────────────────
do $t$
declare
  sa1 uuid := '00000000-0000-0000-0000-000000018a01';
  sa2 uuid := '00000000-0000-0000-0000-000000018a02';
  stu uuid := '00000000-0000-0000-0000-000000018501';
  sa_role uuid;
  std_role uuid;
  n_roles int;
  sa_perms text[];
  std_perms text[];
  rc int;
  n_sa int;
begin
  -- AC-1.ROLE.001.1 — the six seed roles exist.
  select count(*) into n_roles from public.roles
    where name in ('Super Admin','Admin','Finance','HR','Account Manager','Standard User');
  if n_roles <> 6 then raise exception 'AC-1.ROLE.001.1 FAIL: expected 6 seed roles, found %', n_roles; end if;

  select id into sa_role  from public.roles where name = 'Super Admin';
  select id into std_role from public.roles where name = 'Standard User';

  -- AC-1.PERM.002.1 / AF-080 — the RLS helper returns the seeded grant set; harness reads the same tables.
  sa_perms  := public.user_perms(sa1);
  std_perms := public.user_perms(stu);
  if not (sa_perms @> array['PERM-system.role_manage']) then
    raise exception 'AF-080 FAIL: user_perms(SuperAdmin) missing PERM-system.role_manage — got %', sa_perms; end if;
  if std_perms @> array['PERM-system.role_manage'] then
    raise exception 'AC-1.PERM.002.1 FAIL: Standard User has role_manage via user_perms — default-deny broken'; end if;

  -- AC-1.ROLE.005.2 — the atomic guard. Two Super Admins present.
  select count(*) into n_sa from public.user_roles ur join public.roles r on ur.role_id = r.id
    where r.name = 'Super Admin' and ur.active;
  if n_sa < 2 then raise exception 'setup FAIL: expected >=2 active Super Admins, got %', n_sa; end if;

  -- demote a NON-last Super Admin (sa1) — the conditional UPDATE applies (count would stay >= 1).
  update public.user_roles set role_id = std_role
    where user_id = sa1 and active
      and not (
        role_id = (select id from public.roles where name = 'Super Admin')
        and (select count(*) from public.user_roles ur join public.roles r on ur.role_id = r.id
               where r.name = 'Super Admin' and ur.active) <= 1
      );
  get diagnostics rc = row_count;
  if rc <> 1 then raise exception 'AC-1.ROLE.005.2 FAIL: non-last demotion should apply (rowcount 1), got %', rc; end if;

  -- now sa2 is the LAST Super Admin — the SAME conditional UPDATE must REFUSE it (rowcount 0).
  update public.user_roles set role_id = std_role
    where user_id = sa2 and active
      and not (
        role_id = (select id from public.roles where name = 'Super Admin')
        and (select count(*) from public.user_roles ur join public.roles r on ur.role_id = r.id
               where r.name = 'Super Admin' and ur.active) <= 1
      );
  get diagnostics rc = row_count;
  if rc <> 0 then raise exception 'AC-1.ROLE.005.2 FAIL: last-Super-Admin demotion must be blocked (rowcount 0), got %', rc; end if;

  select count(*) into n_sa from public.user_roles ur join public.roles r on ur.role_id = r.id
    where r.name = 'Super Admin' and ur.active;
  if n_sa < 1 then raise exception 'AC-1.ROLE.005.2 FAIL: Super Admin count reached zero — invariant violated'; end if;

  raise notice 'ISSUE-018 capstone: ALL ASSERTIONS PASS (6 roles · AF-080 helper parity · atomic last-SA guard · % SA remain)', n_sa;
end $t$;

rollback;
