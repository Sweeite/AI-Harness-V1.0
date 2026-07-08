-- ISSUE-020 RLS ENFORCEMENT — LIVE capstone (proves the ACs the offline suite cannot reach — the real
-- Postgres policy engine enforcing visibility ∩ sensitivity ∩ Restricted ∩ aal2 against a genuine
-- `authenticated` session, plus the rls-enforcement adapter's live queries/writes).
--
-- Run AFTER `npm run migrate` has applied 0031_rls_enforcement:
--   source ~/.ai-harness-secrets.env
--   /opt/homebrew/opt/libpq/bin/psql "$SILO_DB_URL" -v ON_ERROR_STOP=1 -f results/issue-020-rls-enforcement-capstone.sql
--
-- Proves, fail-LOUD (any failed assertion RAISEs + aborts):
--   • AC-1.RLS.005.1     no protected table reachable at aal1 (the aal2 baseline gates memories)
--   • AC-1.RLS.003.1     an under-cleared / wrong-visibility session sees zero forbidden rows
--   • AC-1.RLS.006.1     a clearance GRANT / Restricted GRANT / REVOKE is instant on the next query
--   • AC-1.RLS.003.2     (offline-asserted) — no client_slug predicate; here we simply prove intra-client works
--   • FR-1.RLS.003       the Restricted axis (a 'restricted' row needs a live per-individual grant)
--   • entities Internal-Org wall (confidential-clearance-gated)
--   • user_visibility resolves the role's held tiers (OD-168)
--   • the rls-enforcement live adapter: loadOriginatingAuthz shape + event_log/access_audit appends
--
-- ONE transaction that ROLLS BACK — the silo is byte-identical afterward (only 0031 persists).
-- session_replication_role='replica' only to insert FK-referencing fixtures, then 'origin' so RLS is
-- genuinely enforced during the assertions (replica mode bypasses RLS — the tests would be meaningless).

\set ON_ERROR_STOP on
begin;

set local session_replication_role = replica;   -- skip FK/trigger checks for synthetic rows
do $fx$
declare
  u_uid  uuid := '00000000-0000-0000-0000-0000000200a0';  -- test user U (role R: global+team visibility)
  r_id   uuid := '00000000-0000-0000-0000-0000000200c0';  -- test role R
  e_std  uuid := '00000000-0000-0000-0000-0000000200e1';  -- client entity (type 'client')
  e_conf uuid := '00000000-0000-0000-0000-0000000200e2';  -- finance entity (type 'finance')
  e_rst  uuid := '00000000-0000-0000-0000-0000000200e3';  -- client entity for the Restricted row
  e_io   uuid := '00000000-0000-0000-0000-0000000200e4';  -- an Internal-Org entity
  v_zero vector(1536) := ('[' || array_to_string(array_fill(0::float8, array[1536]), ',') || ']')::vector;
begin
  insert into public.profiles (id, email, active) values (u_uid, 'issue020-u@example.invalid', true) on conflict do nothing;
  insert into public.roles (id, name, visibility_tiers)
    values (r_id, '__issue020_role__', '{global,team}'::public.visibility_tier[]) on conflict do nothing;
  insert into public.user_roles (user_id, role_id, active) values (u_uid, r_id, true) on conflict (user_id) do nothing;

  insert into public.entities (id, type, name) values
    (e_std,  'client',       'Issue020 Client')   on conflict do nothing;
  insert into public.entities (id, type, name) values
    (e_conf, 'finance',      'Issue020 Finance')  on conflict do nothing;
  insert into public.entities (id, type, name) values
    (e_rst,  'client',       'Issue020 Restricted Subject') on conflict do nothing;
  insert into public.entities (id, type, name, is_internal_org) values
    (e_io,   'internal_org', 'Issue020 Internal Org', true) on conflict do nothing;

  -- Four memories spanning the axes (embedding is a valid zero vector; entity_ids ≥1; confidence set).
  insert into public.memories (type, content, embedding, entity_ids, source, confidence, visibility, sensitivity, content_hash, idempotency_key) values
    ('semantic','M_std  global/standard',      v_zero, array[e_std]::uuid[],  'ai_inferred', 0.9, 'global',  'standard',     'h-std',  'idem-020-std'),
    ('semantic','M_conf global/confidential',  v_zero, array[e_conf]::uuid[], 'ai_inferred', 0.9, 'global',  'confidential', 'h-conf', 'idem-020-conf'),
    ('semantic','M_priv private/standard',     v_zero, array[e_std]::uuid[],  'ai_inferred', 0.9, 'private', 'standard',     'h-priv', 'idem-020-priv'),
    ('semantic','M_rst  global/restricted',    v_zero, array[e_rst]::uuid[],  'ai_inferred', 0.9, 'global',  'restricted',   'h-rst',  'idem-020-rst')
  on conflict (idempotency_key) do nothing;
end $fx$;

set local session_replication_role = origin;     -- RLS enforced from here on

do $t$
declare
  u_uid  constant text := '00000000-0000-0000-0000-0000000200a0';
  r_id   constant uuid := '00000000-0000-0000-0000-0000000200c0';
  e_conf constant uuid := '00000000-0000-0000-0000-0000000200e2';
  e_rst  constant uuid := '00000000-0000-0000-0000-0000000200e3';
  cnt    int;
  vis    public.visibility_tier[];
begin
  -- ── user_visibility resolves the role's held tiers (OD-168) ──
  vis := public.user_visibility(u_uid::uuid);
  if not (vis @> array['global','team']::public.visibility_tier[] and not (vis @> array['private']::public.visibility_tier[])) then
    raise exception 'user_visibility FAIL: role holds %, expected {global,team} and NOT private', vis;
  end if;
  raise notice 'PASS user_visibility — role R holds {global,team}, not private (OD-168)';

  -- ── AC-1.RLS.005.1 — aal1 session reads ZERO protected rows (aal2 baseline gate) ──
  set local role authenticated;
  perform set_config('request.jwt.claims', format('{"sub":"%s","aal":"aal1"}', u_uid), true);
  select count(*) into cnt from public.memories;
  if cnt <> 0 then raise exception 'AC-1.RLS.005.1 FAIL: aal1 session saw % memory rows, expected 0 (aal2 bypass, #2/#3)', cnt; end if;
  reset role;
  raise notice 'PASS AC-1.RLS.005.1 — an aal1 session sees 0 protected rows';

  -- ── AC-1.RLS.003.1 — aal2, holds global+team, NO clearances → only the global/standard row ──
  -- (M_conf hidden: no confidential clearance · M_priv hidden: no private visibility · M_rst hidden: no grant)
  set local role authenticated;
  perform set_config('request.jwt.claims', format('{"sub":"%s","aal":"aal2"}', u_uid), true);
  select count(*) into cnt from public.memories;
  if cnt <> 1 then raise exception 'AC-1.RLS.003.1 FAIL: under-cleared aal2 user saw % rows, expected 1 (only M_std)', cnt; end if;
  reset role;
  raise notice 'PASS AC-1.RLS.003.1 — under-cleared user sees only the global/standard row (confidential/private/restricted all hidden)';

  -- ── AC-1.RLS.006.1 — GRANT a confidential/finance clearance → M_conf appears on the NEXT query ──
  insert into public.sensitivity_clearances (user_id, tier, entity_type_scope) values (u_uid::uuid, 'confidential', 'finance');
  set local role authenticated;
  perform set_config('request.jwt.claims', format('{"sub":"%s","aal":"aal2"}', u_uid), true);
  select count(*) into cnt from public.memories;
  if cnt <> 2 then raise exception 'AC-1.RLS.006.1 FAIL: after confidential/finance grant saw % rows, expected 2 (M_std + M_conf)', cnt; end if;
  reset role;
  raise notice 'PASS AC-1.RLS.006.1 — confidential/finance clearance grant is instant (M_conf now visible, entity-type-scoped)';

  -- entity-type scope bites: a clearance scoped to the WRONG type must NOT reveal M_conf. Prove by revoking
  -- the finance grant and granting an 'hr'-scoped one → M_conf hidden again.
  delete from public.sensitivity_clearances where user_id = u_uid::uuid and entity_type_scope = 'finance';
  insert into public.sensitivity_clearances (user_id, tier, entity_type_scope) values (u_uid::uuid, 'confidential', 'hr');
  set local role authenticated;
  perform set_config('request.jwt.claims', format('{"sub":"%s","aal":"aal2"}', u_uid), true);
  select count(*) into cnt from public.memories;
  if cnt <> 1 then raise exception 'entity-type-scope FAIL: hr-scoped clearance revealed % rows, expected 1 (M_conf is finance-typed, must stay hidden)', cnt; end if;
  reset role;
  raise notice 'PASS entity-type-scope — an hr-scoped confidential clearance does NOT reveal a finance-typed row (FR-1.CLR.004)';

  -- ── Restricted axis (FR-1.RLS.003) — a 'restricted' row needs a live per-individual grant ──
  -- restore the finance clearance (irrelevant to M_rst which is standard-clearable but restricted-sens),
  -- then grant Restricted on e_rst → M_rst appears; revoke → hidden again.
  insert into public.restricted_grants (grantee_user_id, granter_user_id, entity_id, entity_type, reason)
    values (u_uid::uuid, u_uid::uuid, e_rst, 'client', 'issue020 capstone');
  set local role authenticated;
  perform set_config('request.jwt.claims', format('{"sub":"%s","aal":"aal2"}', u_uid), true);
  select count(*) into cnt from public.memories where sensitivity = 'restricted';
  if cnt <> 1 then raise exception 'Restricted FAIL: after grant saw % restricted rows, expected 1 (M_rst)', cnt; end if;
  reset role;
  raise notice 'PASS FR-1.RLS.003 (Restricted) — a live per-individual grant reveals the restricted row';

  update public.restricted_grants set revoked_at = now() where grantee_user_id = u_uid::uuid and entity_id = e_rst;
  set local role authenticated;
  perform set_config('request.jwt.claims', format('{"sub":"%s","aal":"aal2"}', u_uid), true);
  select count(*) into cnt from public.memories where sensitivity = 'restricted';
  if cnt <> 0 then raise exception 'Restricted REVOKE FAIL: after revoke saw % restricted rows, expected 0 (revoke not instant, #2)', cnt; end if;
  reset role;
  raise notice 'PASS FR-1.RLS.003 (Restricted revoke) — revoking the grant hides the restricted row on the next query';

  -- ── entities Internal-Org wall — hidden without a confidential clearance, visible with one ──
  -- currently the user holds an 'hr'-scoped confidential clearance (any confidential tier lifts the wall).
  set local role authenticated;
  perform set_config('request.jwt.claims', format('{"sub":"%s","aal":"aal2"}', u_uid), true);
  select count(*) into cnt from public.entities where is_internal_org;
  if cnt <> 1 then raise exception 'entities Internal-Org FAIL: confidential-cleared user saw % internal-org rows, expected 1', cnt; end if;
  -- drop ALL confidential clearances → the wall closes.
  reset role;
  delete from public.sensitivity_clearances where user_id = u_uid::uuid and tier = 'confidential';
  set local role authenticated;
  perform set_config('request.jwt.claims', format('{"sub":"%s","aal":"aal2"}', u_uid), true);
  select count(*) into cnt from public.entities where is_internal_org;
  if cnt <> 0 then raise exception 'entities Internal-Org FAIL: uncleared user saw % internal-org rows, expected 0 (wall broken, #2)', cnt; end if;
  reset role;
  raise notice 'PASS entities Internal-Org wall — internal-org rows require a confidential clearance';

  -- ── service_role bypasses RLS (sees every seeded memory) — the agent path is off-RLS by design ──
  set local role service_role;
  perform set_config('request.jwt.claims', '', true);
  select count(*) into cnt from public.memories where idempotency_key like 'idem-020-%';
  if cnt <> 4 then raise exception 'service_role bypass FAIL: saw % seeded rows, expected 4', cnt; end if;
  reset role;
  raise notice 'PASS service_role bypass — the agent path sees all 4 rows (ADR-006 part 6)';

  raise notice '════════ PART A (DB-side RLS predicates) PASSED ════════';
end $t$;

-- ── PART B — the rls-enforcement live adapter's queries + append shapes (owner/service_role path) ──
do $b$
declare
  u_uid  constant uuid := '00000000-0000-0000-0000-0000000200a0';
  v_active boolean;
  v_clear  int;
  v_evt    int;
  v_aud    int;
begin
  -- loadOriginatingAuthz: profiles.active read (the deactivation signal, FR-1.USR.002).
  select active into v_active from public.profiles where id = u_uid;
  if v_active is not true then raise exception 'adapter FAIL: profiles.active read did not return true'; end if;

  -- loadOriginatingAuthz: held clearances (user- OR active-role-scoped). Grant one and read it back.
  insert into public.sensitivity_clearances (user_id, tier, entity_type_scope) values (u_uid, 'personal', null);
  select count(*) into v_clear from public.sensitivity_clearances sc
    where sc.user_id = u_uid
       or sc.role_id in (select ur.role_id from public.user_roles ur where ur.user_id = u_uid and ur.active);
  if v_clear < 1 then raise exception 'adapter FAIL: clearance read returned % rows, expected >=1', v_clear; end if;

  -- appendEventLog: BOTH OD-170 event_type values are accepted by the live enum (the #3 signal never throws).
  insert into public.event_log (event_type, entity_ids, summary, payload)
    values ('authz_revoked_midtask', array[]::uuid[], 'capstone mid-task stop', '{"task_id":"t"}'::jsonb);
  insert into public.event_log (event_type, entity_ids, summary, payload)
    values ('rls_harness_divergence', array[]::uuid[], 'capstone divergence', '{"resource":"memories"}'::jsonb);
  select count(*) into v_evt from public.event_log where event_type in ('authz_revoked_midtask','rls_harness_divergence') and summary like 'capstone %';
  if v_evt <> 2 then raise exception 'adapter FAIL: event_log append accepted % rows, expected 2', v_evt; end if;

  -- appendAudit: the mid-task stop's access_audit row carries originating_user_id attribution.
  insert into public.access_audit (audit_type, actor_identity, actor_type, action, originating_user_id, reason, path_context)
    values ('authz_revoked_midtask', 'memory-agent', 'system', 'halt_and_quarantine:send external email', u_uid, 'deactivated', 't');
  select count(*) into v_aud from public.access_audit where audit_type = 'authz_revoked_midtask' and originating_user_id = u_uid;
  if v_aud <> 1 then raise exception 'adapter FAIL: access_audit append returned % rows, expected 1', v_aud; end if;

  raise notice 'PASS PART B — loadOriginatingAuthz reads (active + clearances), event_log (both OD-170 types) + access_audit appends all succeed';
  raise notice '════════ ALL ISSUE-020 LIVE CAPSTONE ASSERTIONS PASSED ════════';
end $b$;

rollback;   -- leave the silo untouched: only the 0031 migration persists
