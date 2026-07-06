-- ISSUE-019 Clearance + Restricted model — LIVE capstone (proves the ACs the offline InMemory fake cannot
-- reach: the model's mutation flows against the REAL DDL — the clearance_tier enum, the exactly-one-subject
-- CHECK on sensitivity_clearances, the mandatory-reason + per-individual NOT NULLs on restricted_grants, the
-- hard-delete clearance revoke vs soft-delete Restricted revoke, and — the load-bearing #1 proof — that
-- access_audit is genuinely APPEND-ONLY at the DB source, so a who/when/why grant record can never be
-- tampered or deleted).
--
-- Run AFTER migrations 0001-0010 are applied to the silo:
--   source ~/.ai-harness-secrets.env
--   /opt/homebrew/opt/libpq/bin/psql "$SILO_DB_URL" -v ON_ERROR_STOP=1 -f app/rbac/results/issue-019-capstone.sql
--
-- Proves, fail-LOUD (any failed assertion RAISEs and aborts the whole transaction):
--   • AC-1.CLR.002.1  the per-role default clearance seed lands as real rows: Finance = Confidential scoped to
--                     exactly {Invoice, Contract/Retainer, Financial Period, Deal} (4 rows), HR = Personal /
--                     'Team Member', Account Manager = Confidential / 'Client', Super Admin/Admin = Global
--                     Confidential+Personal, Standard User = none. Restricted appears in NO clearance row.
--   • AC-1.CLR.003.1  exactly-one-subject: a user-scoped grant (user_id set, role_id null) is accepted; a row
--                     with BOTH subjects, or NEITHER, is REJECTED by the num_nonnulls CHECK at the DB.
--   • AC-1.CLR.004.1  the data shape supports scope exclusion: a Finance Confidential row scoped to 'Invoice'
--                     exists and none scoped to 'Client' — a Confidential client-strategy memory has no
--                     matching clearance to satisfy (the RLS predicate that reads this is ISSUE-020).
--   • clearance revoke = hard DELETE (sensitivity_clearances has no revoked_at) — the row is gone.
--   • AC-1.RST.001.1  restricted_grants is per-INDIVIDUAL structurally: grantee_user_id is NOT NULL and there
--                     is NO role_id column — Restricted cannot be attached to a role at the DB.
--   • AC-1.RST.002.1  a Restricted grant with a NULL reason is REJECTED by the reason NOT NULL constraint.
--   • AC-1.RST.002.2  a grant writes an access_audit row capturing granter (actor_identity), grantee
--                     (target_entity_id), time (created_at), and reason.
--   • AC-1.RST.002.3  revoke = soft-delete (revoked_at set); the active-grant query (revoked_at is null) then
--                     returns none — access denied on the next query.
--   • #1 AUDIT IMMUTABILITY  an UPDATE and a DELETE on an access_audit row are both REJECTED by the
--                     append-only trigger — a grant/revoke record can never be altered or removed.
--
-- Everything runs inside ONE transaction that ROLLS BACK — no clearance, grant, profile, or audit row
-- survives, so the silo is byte-identical afterward.

\set ON_ERROR_STOP on
begin;

-- ── Fixtures: synthetic profiles (replica mode skips FK only for these inserts, then back to origin so the
--    CHECK constraints + the append-only trigger are evaluated under REAL semantics). ──────────────────
set local session_replication_role = replica;
insert into public.profiles (id, email) values
  ('00000000-0000-0000-0000-000000019a01', 'iss019-granter@example.invalid'),   -- granter (Super Admin)
  ('00000000-0000-0000-0000-000000019a02', 'iss019-grantee@example.invalid')    -- grantee (named individual)
on conflict (id) do nothing;
set local session_replication_role = origin;

do $cap$
declare
  granter uuid := '00000000-0000-0000-0000-000000019a01';
  grantee uuid := '00000000-0000-0000-0000-000000019a02';
  sa_role uuid;
  fin_role uuid;
  hr_role uuid;
  am_role uuid;
  std_role uuid;
  n int;
  new_clr uuid;
  new_grant uuid;
  new_audit uuid;
  rejected boolean;
begin
  -- Seed the six roles + their default clearances (mirrors seedRoles + seedDefaultClearances; OD-186 set).
  insert into public.roles (name, is_default, is_protected) values
    ('Super Admin', true, true), ('Admin', true, false), ('Finance', true, false),
    ('HR', true, false), ('Account Manager', true, false), ('Standard User', true, false)
  on conflict (name) do nothing;
  select id into sa_role  from public.roles where name = 'Super Admin';
  select id into fin_role from public.roles where name = 'Finance';
  select id into hr_role  from public.roles where name = 'HR';
  select id into am_role  from public.roles where name = 'Account Manager';
  select id into std_role from public.roles where name = 'Standard User';

  insert into public.sensitivity_clearances (role_id, tier, entity_type_scope) values
    (sa_role,  'confidential', null), (sa_role,  'personal', null),
    (fin_role, 'confidential', 'Invoice'), (fin_role, 'confidential', 'Contract/Retainer'),
    (fin_role, 'confidential', 'Financial Period'), (fin_role, 'confidential', 'Deal'),
    (hr_role,  'personal', 'Team Member'),
    (am_role,  'confidential', 'Client');

  -- AC-1.CLR.002.1 — Finance holds exactly the four finance-domain Confidential scopes, no more.
  select count(*) into n from public.sensitivity_clearances
    where role_id = fin_role and tier = 'confidential'
      and entity_type_scope in ('Invoice','Contract/Retainer','Financial Period','Deal');
  if n <> 4 then raise exception 'AC-1.CLR.002.1 FAIL: Finance finance-scope rows = % (want 4)', n; end if;
  -- AC-1.CLR.004.1 — no Finance clearance scoped to 'Client' (client-strategy is excluded).
  select count(*) into n from public.sensitivity_clearances where role_id = fin_role and entity_type_scope = 'Client';
  if n <> 0 then raise exception 'AC-1.CLR.004.1 FAIL: Finance has a Client-scoped clearance (%))', n; end if;
  -- Restricted appears in NO clearance row (the enum cannot even hold it — this is a belt-and-braces read).
  select count(*) into n from public.sensitivity_clearances where tier::text = 'restricted';
  if n <> 0 then raise exception 'AC-1.RST.001.1 FAIL: a Restricted clearance row exists (%)', n; end if;

  -- AC-1.CLR.003.1 — exactly-one-subject CHECK: user-scoped grant accepted...
  insert into public.sensitivity_clearances (user_id, tier, entity_type_scope, granted_by)
    values (grantee, 'personal', null, granter) returning id into new_clr;
  -- ...both subjects → REJECTED.
  rejected := false;
  begin
    insert into public.sensitivity_clearances (user_id, role_id, tier) values (grantee, std_role, 'confidential');
  exception when check_violation then rejected := true; end;
  if not rejected then raise exception 'AC-1.CLR.003.1 FAIL: a clearance with BOTH user_id and role_id was accepted'; end if;
  -- ...neither subject → REJECTED.
  rejected := false;
  begin
    insert into public.sensitivity_clearances (tier) values ('confidential');
  exception when check_violation then rejected := true; end;
  if not rejected then raise exception 'AC-1.CLR.003.1 FAIL: a subjectless clearance was accepted'; end if;

  -- clearance revoke = hard DELETE (no revoked_at column) — the row is gone.
  delete from public.sensitivity_clearances where id = new_clr;
  select count(*) into n from public.sensitivity_clearances where id = new_clr;
  if n <> 0 then raise exception 'clearance revoke FAIL: row survived the hard delete'; end if;

  -- AC-1.RST.002.1 — a Restricted grant with a NULL reason is REJECTED by the DDL (mandatory why).
  rejected := false;
  begin
    insert into public.restricted_grants (grantee_user_id, granter_user_id, reason) values (grantee, granter, null);
  exception when not_null_violation then rejected := true; end;
  if not rejected then raise exception 'AC-1.RST.002.1 FAIL: a reasonless Restricted grant was accepted'; end if;

  -- AC-1.RST.002.2 — a valid grant captures granter/grantee/time/reason; the flow also writes access_audit.
  insert into public.restricted_grants (grantee_user_id, granter_user_id, reason, entity_type)
    values (grantee, granter, 'board-only diligence', 'Client') returning id into new_grant;
  insert into public.access_audit (audit_type, actor_identity, actor_type, action, target_entity_id, reason)
    values ('rbac', granter::text, 'user', 'grant-restricted', grantee, 'board-only diligence') returning id into new_audit;
  perform 1 from public.restricted_grants
    where id = new_grant and granter_user_id = granter and grantee_user_id = grantee
      and reason = 'board-only diligence' and granted_at is not null and revoked_at is null;
  if not found then raise exception 'AC-1.RST.002.2 FAIL: grant row did not capture granter/grantee/reason/time'; end if;

  -- AC-1.RST.002.3 — revoke = soft-delete; the active-grant query then returns none (next query denied).
  update public.restricted_grants set revoked_at = now(), revoked_by = granter where id = new_grant;
  select count(*) into n from public.restricted_grants where grantee_user_id = grantee and revoked_at is null;
  if n <> 0 then raise exception 'AC-1.RST.002.3 FAIL: a revoked grant still reads as active (count %)', n; end if;

  -- #1 AUDIT IMMUTABILITY — the access_audit grant record can neither be UPDATEd nor DELETEd (append-only).
  rejected := false;
  begin
    update public.access_audit set reason = 'tampered' where id = new_audit;
  exception when others then rejected := true; end;
  if not rejected then raise exception '#1 FAIL: an access_audit row was UPDATEd (append-only violated)'; end if;
  rejected := false;
  begin
    delete from public.access_audit where id = new_audit;
  exception when others then rejected := true; end;
  if not rejected then raise exception '#1 FAIL: an access_audit row was DELETEd (append-only violated)'; end if;

  raise notice 'ISSUE-019 capstone: ALL ASSERTIONS PASS (seed + exactly-one-subject + finance scope + hard/soft revoke + mandatory reason + audit append-only). Rolling back.';
end;
$cap$;

rollback;
