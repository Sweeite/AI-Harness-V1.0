-- ============================================================================
-- app/rbac live-adapter smoke — ISSUE-018 / ISSUE-019 (R10 live-adapter hygiene sweep)
-- Adapter under test: app/rbac/src/supabase-store.ts (SupabaseRbacStore)
-- Connects as: postgres owner (rolbypassrls=t) on the SILO plane — RLS bypassed (OD-193).
--
-- WHAT THIS PROVES (replays the adapter's REAL write paths against the live silo DDL,
-- migrations head 0025, table DDL from 0001_baseline.sql §2 RBAC & Access):
--   1. createRole / assignRole upsert (on conflict (user_id)) land the expected rows.
--   2. atomicChangeRole / atomicDeactivate last-Super-Admin guard: the conditional UPDATE
--      refuses to drop the final active Super Admin (rowCount 0) and permits it when >1.
--   3. setNode grant/revoke (role_permissions on conflict (role_id,permission_node) do nothing).
--   4. insertClearance — column list + tier::clearance_tier cast + num_nonnulls(user_id,role_id)=1
--      check; deleteClearance (hard delete); touchClearanceReview.
--   5. insertRestricted (granter_user_id NOT NULL satisfied by the real grantRestricted path)
--      + revokeRestrictedById soft-delete (revoked_at is null guard = idempotent).
--   6. appendAudit partial-column INSERT + actor_type::actor_type cast ('user' and 'system').
--
-- All literals match the real column types + enum members (clearance_tier {confidential,personal},
-- actor_type {user,agent,system}). Parent profiles/roles rows are created INSIDE the txn.
-- Everything runs in ONE txn and ROLLBACKs — nothing persists. Read-verify via raise exception.
-- DO NOT RUN interactively out of band — the orchestrator runs live writes serially.
-- ============================================================================

begin;

-- Silence FK noise from auth.users: profiles.id references auth.users(id). Seed the auth rows first.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'sa1@smoke.test'),
  ('22222222-2222-2222-2222-222222222222', 'sa2@smoke.test'),
  ('33333333-3333-3333-3333-333333333333', 'grantee@smoke.test')
on conflict (id) do nothing;

insert into profiles (id, email, name) values
  ('11111111-1111-1111-1111-111111111111', 'sa1@smoke.test', 'SA One'),
  ('22222222-2222-2222-2222-222222222222', 'sa2@smoke.test', 'SA Two'),
  ('33333333-3333-3333-3333-333333333333', 'grantee@smoke.test', 'Grantee')
on conflict (id) do nothing;

-- ── 1. createRole ── mirrors: insert into roles (name,is_default,is_protected) ...
insert into roles (name, is_default, is_protected)
  values ('Super Admin', false, true), ('Member', true, false);

-- ── 2. assignRole upsert ── on conflict (user_id) do update set role_id=excluded.role_id, active=true
insert into user_roles (user_id, role_id, active)
  values ('11111111-1111-1111-1111-111111111111',
          (select id from roles where name='Super Admin'), true)
  on conflict (user_id) do update set role_id = excluded.role_id, active = true;
insert into user_roles (user_id, role_id, active)
  values ('22222222-2222-2222-2222-222222222222',
          (select id from roles where name='Super Admin'), true)
  on conflict (user_id) do update set role_id = excluded.role_id, active = true;

do $$ begin
  if (select count(*) from user_roles ur join roles r on ur.role_id=r.id
      where r.name='Super Admin' and ur.active) <> 2 then
    raise exception 'FAIL 2: expected 2 active Super Admins after assignRole upsert';
  end if;
end $$;

-- Re-run the upsert for user 1 to prove idempotency + active reset (no duplicate row).
insert into user_roles (user_id, role_id, active)
  values ('11111111-1111-1111-1111-111111111111',
          (select id from roles where name='Super Admin'), true)
  on conflict (user_id) do update set role_id = excluded.role_id, active = true;
do $$ begin
  if (select count(*) from user_roles where user_id='11111111-1111-1111-1111-111111111111') <> 1 then
    raise exception 'FAIL 2b: unique(user_id) violated — upsert produced >1 row';
  end if;
end $$;

-- ── 3. atomicChangeRole / atomicDeactivate guard (ADR-004) ──
-- With TWO active Super Admins, demoting one MUST succeed (guard sub-select count > 1).
do $$
declare rc int;
begin
  update user_roles set active = false
    where user_id = '11111111-1111-1111-1111-111111111111' and active
      and not (
        role_id = (select id from roles where name='Super Admin')
        and (select count(*) from user_roles ur join roles r on ur.role_id=r.id
               where r.name='Super Admin' and ur.active) <= 1
      );
  get diagnostics rc = row_count;
  if rc <> 1 then raise exception 'FAIL 3a: first SA deactivate should succeed (2 active), rowCount=%', rc; end if;
end $$;

-- Now ONE active Super Admin remains. Deactivating the LAST one MUST be refused (rowCount 0).
do $$
declare rc int;
begin
  update user_roles set active = false
    where user_id = '22222222-2222-2222-2222-222222222222' and active
      and not (
        role_id = (select id from roles where name='Super Admin')
        and (select count(*) from user_roles ur join roles r on ur.role_id=r.id
               where r.name='Super Admin' and ur.active) <= 1
      );
  get diagnostics rc = row_count;
  if rc <> 0 then raise exception 'FAIL 3b: last-Super-Admin deactivate must be REFUSED, rowCount=%', rc; end if;
  if (select count(*) from user_roles ur join roles r on ur.role_id=r.id
      where r.name='Super Admin' and ur.active) <> 1 then
    raise exception 'FAIL 3c: exactly 1 active Super Admin must survive the guard';
  end if;
end $$;

-- ── 4. setNode grant (on conflict do nothing) + revoke (delete) ──
insert into role_permissions (role_id, permission_node)
  values ((select id from roles where name='Member'), 'PERM-memory.write')
  on conflict (role_id, permission_node) do nothing;
insert into role_permissions (role_id, permission_node)      -- duplicate grant = no-op
  values ((select id from roles where name='Member'), 'PERM-memory.write')
  on conflict (role_id, permission_node) do nothing;
do $$ begin
  if (select count(*) from role_permissions
      where role_id=(select id from roles where name='Member')
        and permission_node='PERM-memory.write') <> 1 then
    raise exception 'FAIL 4a: setNode grant must be idempotent (unique(role_id,permission_node))';
  end if;
end $$;
delete from role_permissions
  where role_id=(select id from roles where name='Member') and permission_node='PERM-memory.write';
do $$ begin
  if (select count(*) from role_permissions
      where role_id=(select id from roles where name='Member') and permission_node='PERM-memory.write') <> 0 then
    raise exception 'FAIL 4b: setNode revoke (delete) left a row';
  end if;
end $$;

-- ── 5. insertClearance (tier cast + num_nonnulls check) → touch → delete ──
do $$
declare cid uuid;
begin
  insert into sensitivity_clearances (role_id, user_id, tier, entity_type_scope, granted_by, last_reviewed_at, granted_at)
    values ((select id from roles where name='Member'), null, 'confidential'::clearance_tier,
            null, '11111111-1111-1111-1111-111111111111', null, coalesce(null, now()))
    returning id into cid;
  -- touchClearanceReview
  update sensitivity_clearances set last_reviewed_at = now() where id = cid;
  if (select last_reviewed_at from sensitivity_clearances where id=cid) is null then
    raise exception 'FAIL 5a: touchClearanceReview did not set last_reviewed_at';
  end if;
  -- deleteClearance (hard delete — no revoked_at column on this table)
  delete from sensitivity_clearances where id = cid;
  if exists (select 1 from sensitivity_clearances where id=cid) then
    raise exception 'FAIL 5b: deleteClearance did not remove the row';
  end if;
end $$;

-- num_nonnulls(user_id, role_id)=1 check must REJECT a both-null clearance (adapter passes values straight through).
do $$
begin
  begin
    insert into sensitivity_clearances (role_id, user_id, tier, entity_type_scope, granted_by, last_reviewed_at, granted_at)
      values (null, null, 'personal'::clearance_tier, null, null, null, now());
    raise exception 'FAIL 5c: both-null clearance should have violated num_nonnulls check';
  exception when check_violation then
    null; -- expected
  end;
end $$;

-- ── 6. insertRestricted (granter_user_id NOT NULL) + revokeRestrictedById soft-delete idempotency ──
do $$
declare gid uuid; rc int;
begin
  insert into restricted_grants (grantee_user_id, granter_user_id, entity_id, entity_type, reason)
    values ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222',
            null, null, 'smoke: audited restricted grant')
    returning id into gid;

  -- first revoke: active row → rowCount 1
  update restricted_grants set revoked_at = now(), revoked_by = '22222222-2222-2222-2222-222222222222'
    where id = gid and revoked_at is null;
  get diagnostics rc = row_count;
  if rc <> 1 then raise exception 'FAIL 6a: first revoke should affect 1 row, got %', rc; end if;

  -- second revoke: already revoked → rowCount 0 (idempotent, never silent double-write)
  update restricted_grants set revoked_at = now(), revoked_by = '22222222-2222-2222-2222-222222222222'
    where id = gid and revoked_at is null;
  get diagnostics rc = row_count;
  if rc <> 0 then raise exception 'FAIL 6b: second revoke must be a no-op (revoked_at guard), got %', rc; end if;
end $$;

-- ── 7. appendAudit partial-column INSERT + actor_type cast (user + system) ──
insert into access_audit (audit_type, actor_identity, actor_type, action, target_type, target_entity_id, reason)
  values ('rbac', '11111111-1111-1111-1111-111111111111', 'user'::actor_type, 'grant-restricted',
          'user', '33333333-3333-3333-3333-333333333333', 'smoke');
insert into access_audit (audit_type, actor_identity, actor_type, action, target_type, target_entity_id, reason)
  values ('rbac', 'system', 'system'::actor_type, 'clearance-auto-revoked', 'clearance', null, 'review-overdue-fail-closed');
do $$ begin
  if (select count(*) from access_audit where audit_type='rbac' and reason in ('smoke','review-overdue-fail-closed')) <> 2 then
    raise exception 'FAIL 7: appendAudit rows (user + system actor_type) not both present';
  end if;
end $$;

-- All assertions passed. Nothing persists.
rollback;
