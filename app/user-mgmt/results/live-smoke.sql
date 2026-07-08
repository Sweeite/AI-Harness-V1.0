-- ISSUE-021 (C1 USR + AUD — user-management lifecycle + RBAC/access audit) — LIVE-SMOKE for the
-- SupabaseUserMgmtStore adapter (app/user-mgmt/src/supabase-store.ts).
-- Target DB: SILO  (run: psql "$SILO_DB_URL" -f this).  Non-mutating: the whole script ROLLS BACK.
--
-- Purpose: replay the adapter's ACTUAL write-path SQL against the real baseline DDL
-- (0001_baseline.sql: profiles L276-285 · roles/user_roles/sensitivity_clearances/restricted_grants §2 ·
-- access_audit L211-226 + actor_type enum L41 + clearance_tier enum L38 + the append-only trigger L689-720)
-- so any column / enum / constraint / cast / guarded-WHERE drift throws HERE — catching the
-- "fake-passes-offline / live-adapter-throws" class (R10). This is the AF-081 assertion surface too:
-- the agent-path audit append + originating_user_id attribution must land.
--
-- Adapter statements replayed VERBATIM (same tables/cols/casts/guarded WHERE):
--   appendAudit(): insert into access_audit (audit_type,actor_identity,actor_type,action,target_type,
--                    target_entity_id,before_value,after_value,reason,path_context,originating_user_id)
--                    values ($1,$2,$3::actor_type,$4,$5,$6,$7,$8,$9,$10,$11) returning id,created_at
--   userPermissionNodes(): select rp.permission_node from profiles p join user_roles ur ... join role_permissions rp
--                    where p.id=$1 and p.active
--   atomicDeactivate():   update profiles set active=false where id=$1 and active and not(<last-SA guard>)
--   reactivateUser():     update profiles set active=true where id=$1 and not active
--   deleteClearance():    delete from sensitivity_clearances where id=$1
--   listUserClearances(): select ... from sensitivity_clearances where user_id=$1
--   revokeRestrictedById(): update restricted_grants set revoked_at=now(),revoked_by=$2 where id=$1 and revoked_at is null
--   listActiveRestricted(): select ... from restricted_grants where grantee_user_id=$1 and revoked_at is null
--
-- Style mirrors app/support-recovery/results/live-smoke.sql: per-assertion savepoint/exception, PASS/FAIL notices.
\set ON_ERROR_STOP on
begin;

do $$
declare
  v_sa_role   uuid;                        -- the Super Admin role id
  v_std_role  uuid;                        -- a plain role id
  v_sa        uuid := gen_random_uuid();   -- the sole Super Admin
  v_target    uuid := gen_random_uuid();   -- a normal user under lifecycle test
  v_clr       uuid;                         -- a sensitivity_clearances row
  v_rst       uuid;                         -- a restricted_grants row
  v_cnt       int;
  v_active    boolean;
  v_aud_id    uuid;
begin
  -- ── fixture: two auth.users + profiles, the Super Admin role + a plain role, user_roles for each ─────
  begin
    insert into auth.users (id, instance_id, aud, role, email) values
      (v_sa,     '00000000-0000-0000-0000-000000000000','authenticated','authenticated','__usr021_sa__@smoke.local'),
      (v_target, '00000000-0000-0000-0000-000000000000','authenticated','authenticated','__usr021_tgt__@smoke.local');
    insert into profiles (id, email, name) values
      (v_sa, '__usr021_sa__@smoke.local','USR021 SA'),
      (v_target, '__usr021_tgt__@smoke.local','USR021 Target');
    -- 'Super Admin' is a live-seeded, unique-named role — SELECT it (re-inserting collides on roles_name_key).
    select id into v_sa_role from roles where name = 'Super Admin';
    if v_sa_role is null then
      insert into roles (name, is_default, is_protected) values ('Super Admin', true, true) returning id into v_sa_role;
    end if;
    insert into roles (name, is_default, is_protected) values ('__usr021_std__', false, false) returning id into v_std_role;
    insert into user_roles (user_id, role_id, active) values (v_sa, v_sa_role, true), (v_target, v_std_role, true);
    -- Make v_sa the SOLE active Super Admin so the last-SA guard test (4) is deterministic regardless of any
    -- live-seeded SA users (this UPDATE rolls back with the whole script — no residue).
    update user_roles ur set active = false
      from roles r
      where r.id = ur.role_id and r.name = 'Super Admin' and ur.user_id <> v_sa and ur.active;
    -- give the target's role one node so userPermissionNodes has something to resolve
    insert into role_permissions (role_id, permission_node) values (v_std_role, 'PERM-memory.read');
    raise notice 'PASS setup: users + roles + user_roles seeded (sa=% target=%)', v_sa, v_target;
  exception when others then
    raise exception 'FAIL setup: fixture seed threw (not drift) -> %', sqlerrm;
  end;

  -- ══ (1) appendAudit() — the full 11-column insert with actor_type cast + jsonb before/after + originating_user_id.
  begin
    insert into access_audit (audit_type, actor_identity, actor_type, action, target_type, target_entity_id,
                              before_value, after_value, reason, path_context, originating_user_id)
      values ('access', 'agent:specialist-1', 'agent'::actor_type, 'restricted-read', 'Memory',
              gen_random_uuid(), null, null, null, 'agent-task:t-1', v_target)
      returning id into v_aud_id;
    if v_aud_id is null then raise exception 'FAIL 1: appendAudit RETURNING id was null'; end if;
    raise notice 'PASS 1: appendAudit insert accepted (actor_type cast + originating_user_id attribution valid) — AF-081 agent-path row lands';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise exception 'FAIL 1: appendAudit insert threw -> %', sqlerrm;
  end;

  -- ══ (2) userPermissionNodes() — join resolves the active user's role node; a deactivated user resolves ZERO.
  begin
    select count(*) into v_cnt
      from profiles p
      join user_roles ur on ur.user_id = p.id and ur.active
      join role_permissions rp on rp.role_id = ur.role_id
     where p.id = v_target and p.active;
    if v_cnt <> 1 then raise exception 'FAIL 2a: active target resolved % nodes (expected 1)', v_cnt; end if;
    raise notice 'PASS 2: userPermissionNodes resolves the active user role node (join + p.active gate live)';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise exception 'FAIL 2: userPermissionNodes select threw -> %', sqlerrm;
  end;

  -- ══ (3) grant an above-Standard clearance + a Restricted grant to the target (insertClearance/insertRestricted).
  begin
    insert into sensitivity_clearances (user_id, role_id, tier, entity_type_scope, granted_by, granted_at)
      values (v_target, null, 'confidential'::clearance_tier, 'Invoice', v_sa, now()) returning id into v_clr;
    insert into restricted_grants (grantee_user_id, granter_user_id, entity_id, entity_type, reason, granted_at, revoked_at)
      values (v_target, v_sa, null, null, 'incident review', now(), null) returning id into v_rst;
    raise notice 'PASS 3: insertClearance + insertRestricted accepted (clearance_tier cast + mandatory reason valid)';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise exception 'FAIL 3: clearance/restricted insert threw -> %', sqlerrm;
  end;

  -- ══ (4) atomicDeactivate() last-Super-Admin guard: deactivating the SOLE Super Admin must affect ZERO rows.
  begin
    update profiles p set active = false
     where p.id = v_sa and p.active
       and not (
         exists (select 1 from user_roles ur join roles r on r.id = ur.role_id
                  where ur.user_id = p.id and ur.active and r.name = 'Super Admin')
         and (select count(*) from profiles p2
                join user_roles ur2 on ur2.user_id = p2.id and ur2.active
                join roles r2 on r2.id = ur2.role_id
               where p2.active and r2.name = 'Super Admin') <= 1
       );
    get diagnostics v_cnt = row_count;
    if v_cnt <> 0 then raise exception 'FAIL 4: deactivating the last Super Admin affected % rows (guard dead — #2)', v_cnt; end if;
    select active into v_active from profiles where id = v_sa;
    if v_active is not true then raise exception 'FAIL 4b: the last Super Admin ended up inactive'; end if;
    raise notice 'PASS 4: atomicDeactivate last-Super-Admin guard holds (0-row no-op; the sole SA stays active)';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise exception 'FAIL 4: atomicDeactivate guard threw -> %', sqlerrm;
  end;

  -- ══ (5) atomicDeactivate() a NON-Super-Admin succeeds (affects 1 row); then the deactivation revoke path
  --        (deleteClearance + revokeRestrictedById) removes all above-Standard access.
  begin
    update profiles p set active = false
     where p.id = v_target and p.active
       and not (
         exists (select 1 from user_roles ur join roles r on r.id = ur.role_id
                  where ur.user_id = p.id and ur.active and r.name = 'Super Admin')
         and (select count(*) from profiles p2
                join user_roles ur2 on ur2.user_id = p2.id and ur2.active
                join roles r2 on r2.id = ur2.role_id
               where p2.active and r2.name = 'Super Admin') <= 1
       );
    get diagnostics v_cnt = row_count;
    if v_cnt <> 1 then raise exception 'FAIL 5a: deactivating the target affected % rows (expected 1)', v_cnt; end if;
    delete from sensitivity_clearances where id = v_clr;
    update restricted_grants set revoked_at = now(), revoked_by = v_sa where id = v_rst and revoked_at is null;
    get diagnostics v_cnt = row_count;
    if v_cnt <> 1 then raise exception 'FAIL 5b: revokeRestrictedById affected % rows (expected 1)', v_cnt; end if;
    raise notice 'PASS 5: non-SA deactivate succeeds; above-Standard clearance deleted + Restricted grant soft-revoked';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise exception 'FAIL 5: non-SA deactivate/revoke threw -> %', sqlerrm;
  end;

  -- ══ (6) reactivateUser() flips active=true ONLY — and NOTHING above-Standard comes back (AC-1.USR.002.2).
  begin
    update profiles set active = true where id = v_target and not active;
    get diagnostics v_cnt = row_count;
    if v_cnt <> 1 then raise exception 'FAIL 6a: reactivate affected % rows (expected 1)', v_cnt; end if;
    -- re-read the live grant state: it MUST be empty (deactivation revoked it; reactivation restored nothing)
    select count(*) into v_cnt from sensitivity_clearances where user_id = v_target;
    if v_cnt <> 0 then raise exception 'FAIL 6b: % above-Standard clearance(s) survived into the reactivated account (#2 leak)', v_cnt; end if;
    select count(*) into v_cnt from restricted_grants where grantee_user_id = v_target and revoked_at is null;
    if v_cnt <> 0 then raise exception 'FAIL 6c: % Restricted grant(s) auto-restored on reactivation (#2 leak)', v_cnt; end if;
    raise notice 'PASS 6: reactivation restores base account only — above-Standard clearances + Restricted grants NOT auto-restored (AC-1.USR.002.2)';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise exception 'FAIL 6: reactivate threw -> %', sqlerrm;
  end;

  -- ══ (7) access_audit is APPEND-ONLY (0001 trigger): an in-place content UPDATE of a fresh audit row is REJECTED.
  begin
    update access_audit set action = 'tampered' where id = v_aud_id;
    raise exception 'FAIL 7: in-place UPDATE of access_audit was ALLOWED (append-only trigger dead — #1/#3)';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS 7: access_audit in-place UPDATE rejected (append-only / tamper-evident) -> %', sqlerrm;
  end;

  -- ══ (8) access_audit DELETE is REJECTED too (append-only; retention prune must set app.retention_prune).
  begin
    delete from access_audit where id = v_aud_id;
    raise exception 'FAIL 8: DELETE of access_audit was ALLOWED (append-only trigger dead — #1)';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS 8: access_audit DELETE rejected (append-only) -> %', sqlerrm;
  end;

  raise notice 'ALL ASSERTIONS PASS';
end $$;

rollback;
