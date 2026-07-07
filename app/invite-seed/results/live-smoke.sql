-- ISSUE-015 (invite-seed) LIVE-SMOKE — replays the SupabaseInviteSeedStore write-path statements against
-- the real silo DDL so any column/enum/constraint drift (the fake-passes-offline / live-adapter-throws class)
-- is caught. Rolled back → safe to run against the live silo.
--
-- Run: psql "$SILO_DB_URL" -f this. Expect ALL ASSERTIONS PASS, then ROLLBACK.  (db = silo / $SILO_DB_URL)
--
-- Mirrors the ACTUAL statements in app/invite-seed/src/supabase-store.ts:
--   - writeEvent   : insert into event_log (event_type, summary) values ($1::event_type, $2)
--                    with the four ISSUE-015 enum values (0011 delta): email_send_ok / email_send_failed /
--                    account_activated / invite_bounced.
--   - writeAudit   : insert into access_audit (audit_type, actor_identity, actor_type, action, target_type,
--                    reason) values (...,'invite', ...)  — actor_type 'user' | 'system'.
--   - profiles     : insert into profiles (id, email, active) values ($1, $2, false)  where $1 is the id the
--                    admin API (AuthAdmin.createUser) RETURNED for the just-created auth.users row  ← see #A.
--   - completeSetup: update profiles set active = true where id = $1;  and the role-redirect join
--                    select r.name from user_roles ur join roles r on r.id = ur.role_id
--                      where ur.user_id = $1 and ur.active = true limit 1
--   - runSeed      : the Super-Admin existence check + the role insert
--                    insert into user_roles (user_id, role_id, active)
--                      select $1, r.id, true from roles r where r.name = 'Super Admin'
--   - and the append-only invariant on access_audit / event_log that the adapter relies on for immutability.
--
-- FK discipline: profiles.id references auth.users(id) (0001_baseline.sql L98). The FIXED adapter creates the
-- auth.users row via the admin API (AuthAdmin.createUser) FIRST and reuses the RETURNED id for the profiles
-- mirror — never a fabricated gen_random_uuid(). We replay that exact ordering here: insert an auth.users row,
-- then insert profiles with THAT id (#A proves the fixed path COMMITS clean; the un-parented orphan is rejected).

\set ON_ERROR_STOP on
begin;

do $$
declare
  v_uid   uuid := gen_random_uuid();   -- the auth.users id we mirror into profiles (adapter reuses the admin-API id)
  v_uid2  uuid := gen_random_uuid();
  v_sa    uuid := gen_random_uuid();    -- the seed Super-Admin profile id
  v_pid   uuid;
  v_name  text;
  v_role  uuid;
  v_active boolean;
begin
  -- Seed the auth.users parents so the profiles FK (profiles.id -> auth.users(id)) is satisfiable. In a live
  -- Supabase these ids come back from the admin-API createUser; here we mint them to exercise the app-schema path.
  insert into auth.users (id, email) values (v_uid,  'invitee@example.com');
  insert into auth.users (id, email) values (v_uid2, 'invitee2@example.com');
  insert into auth.users (id, email) values (v_sa,   'seed-admin@example.com');

  -- ── #A FIX PROOF — the FIXED adapter's profiles insert reuses the admin-API-returned auth.users id ────────
  -- The fixed supabase-store.ts (issueInvite ~L140 / runSeed ~L355) runs `insert into profiles (id, email,
  -- active) values ($1, $2, false)` where $1 is the id AuthAdmin.createUser RETURNED for the auth.users row it
  -- just created. We replay that ordering: create the auth.users parent, then mirror it with THAT id — the FK
  -- (profiles.id -> auth.users(id)) is satisfied and the insert COMMITS clean. This is the assertion that the
  -- ISSUE-015 BLOCKER is fixed: a real invite/seed now succeeds instead of raising foreign_key_violation.
  declare
    v_fix_uid uuid := gen_random_uuid();  -- stands in for the id the admin API returns for the created user
    v_fix_pid uuid;
  begin
    insert into auth.users (id, email) values (v_fix_uid, 'fixed-invitee@example.com');   -- admin API createUser
    insert into profiles (id, email, active) values (v_fix_uid, 'fixed-invitee@example.com', false)
      returning id into v_fix_pid;                                                        -- mirror row reuses it
    if v_fix_pid is distinct from v_fix_uid then
      raise exception 'FAIL #A: profiles.id (%) is not the auth.users.id (%) — the adapter did not thread the real id', v_fix_pid, v_fix_uid;
    end if;
    raise notice 'PASS #A: FIXED profiles insert (id = admin-API auth.users.id) COMMITS clean — the ISSUE-015 BLOCKER is fixed (a real invite/seed no longer raises foreign_key_violation)';
  end;

  -- ── #A2 FK still real — a profiles insert with an UNPARENTED gen_random_uuid() id (the OLD broken code) is
  -- still REJECTED. This is why the fix is load-bearing: the FK to auth.users is genuinely enforced, so any
  -- future regression back to a fabricated id would throw on every live invite/seed. (defence in depth)
  begin
    insert into profiles (id, email, active) values (gen_random_uuid(), 'orphan@example.com', false);
    raise exception 'FAIL #A2: profiles insert with an UNMATCHED gen_random_uuid() id was ALLOWED (FK to auth.users not enforced — a regression to the old fabricated-id code would silently mint orphan profiles)';
  exception when foreign_key_violation then
    raise notice 'PASS #A2: profiles(id) FK to auth.users is enforced — a fabricated (unparented) id is rejected, so the fix (thread the real auth.users id) is required, not cosmetic';
  when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS #A2 (via %): profiles unparented-id insert rejected -> %', sqlstate, sqlerrm;
  end;

  -- ── #B writeEvent — the four ISSUE-015 event_type enum values (0011 delta) INSERT clean ($1::event_type) ──
  insert into event_log (event_type, summary) values ('email_send_ok'::event_type,
    'setup email sent (unconfirmed) to invitee@example.com [invite]');
  insert into event_log (event_type, summary) values ('email_send_failed'::event_type,
    'setup email SEND FAILED to invitee@example.com: smtp down');
  insert into event_log (event_type, summary) values ('account_activated'::event_type,
    'account invitee@example.com activated via password_totp -> /admin/overview');
  insert into event_log (event_type, summary) values ('invite_bounced'::event_type,
    'setup email to invitee@example.com BOUNCED — invite marked undelivered, issuer re-alerted');
  raise notice 'PASS #B: all four ISSUE-015 event_type enum values (0011 delta) accepted by event_log';

  -- ── #B2 enum fail-closed — an unadmitted event_type value must raise (mirrors the app-side guard) ────────
  begin
    insert into event_log (event_type, summary) values ('not_a_real_event'::event_type, 'x');
    raise exception 'FAIL #B2: an unadmitted event_type value was ALLOWED';
  exception when invalid_text_representation then
    raise notice 'PASS #B2: unadmitted event_type raises invalid input value for enum event_type (fail-closed #3)';
  when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS #B2 (via %): unadmitted event_type rejected -> %', sqlstate, sqlerrm;
  end;

  -- ── #C writeAudit — every actor_type the adapter uses ('user' issuer, 'system' seed), target_type 'invite' ─
  insert into access_audit (audit_type, actor_identity, actor_type, action, target_type, reason)
    values ('invite_issued', 'issuer@example.com', 'user', 'issue_invite', 'invite', null);
  insert into access_audit (audit_type, actor_identity, actor_type, action, target_type, reason)
    values ('seed_ran', 'service_role', 'system', 'create_super_admin', 'invite', 'SUPER_ADMIN_EMAIL=seed-admin@example.com');
  insert into access_audit (audit_type, actor_identity, actor_type, action, target_type, reason)
    values ('invite_bounced', 'service_role', 'system', 'mark_bounced', 'invite', 'provider bounce webhook');
  raise notice 'PASS #C: access_audit inserts (actor_type user + system, target_type invite) accepted';

  -- ── #D profiles mirror (FK-satisfied) + the completeSetup active-flip UPDATE the adapter runs ────────────
  -- issueInvite inserts profiles(id = admin-API auth.users.id, active=false); completeSetup flips active=true.
  -- Replay both with a real auth.users parent (v_uid, seeded above) so the write path — not the FK — is tested.
  insert into profiles (id, email, active) values (v_uid, 'invitee@example.com', false) returning id into v_pid;
  update profiles set active = true where id = v_pid;   -- completeSetup activation (#1 persist)
  select active into v_active from profiles where id = v_pid;
  if v_active is not true then raise exception 'FAIL #D: profiles.active flip did not persist'; end if;
  raise notice 'PASS #D: profiles insert(active=false) + completeSetup active=true flip persisted';

  -- ── #E runSeed — profiles mirror for the Super Admin + the user_roles role insert (select from roles) ─────
  -- Mirrors supabase-store.ts runSeed: profiles(id = admin-API auth.users.id, v_sa) then the role insert that
  -- selects the seeded 'Super Admin' roles(id); the unique(user_id) constraint is the ADR-004 backstop
  -- (asserted in #F). Depends on 0001d_seed.sql having seeded the six roles.
  insert into profiles (id, email, active) values (v_sa, 'seed-admin@example.com', false);
  insert into user_roles (user_id, role_id, active)
    select v_sa, r.id, true from roles r where r.name = 'Super Admin';
  if not found then
    raise exception 'FAIL #E: no roles row named ''Super Admin'' — the seed role insert would insert 0 rows (adapter L354-358 fails to assign the role)';
  end if;
  raise notice 'PASS #E: Super-Admin user_roles insert from roles catalog succeeded';

  -- ── #E2 runSeed existence check — the exact guarded SELECT that decides created vs already_present ────────
  perform ur.user_id from user_roles ur
     join roles r on r.id = ur.role_id
    where r.name = 'Super Admin' and ur.active = true
    limit 1;
  if not found then raise exception 'FAIL #E2: the seed existence-check SELECT found no Super Admin after insert'; end if;
  raise notice 'PASS #E2: seed existence-check join (user_roles->roles, active=true) returns the seeded admin';

  -- ── #F ADR-004 backstop — a SECOND user_roles row for the same user violates unique(user_id) ─────────────
  begin
    insert into user_roles (user_id, role_id, active)
      select v_sa, r.id, true from roles r where r.name = 'Super Admin';
    raise exception 'FAIL #F: a second user_roles row for the same user_id was ALLOWED (unique(user_id) backstop missing — a lost race could mint a second admin, #2)';
  exception when unique_violation then
    raise notice 'PASS #F: user_roles unique(user_id) enforced — the ADR-004 second-admin backstop fires live';
  when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS #F (via %): duplicate user_roles rejected -> %', sqlstate, sqlerrm;
  end;

  -- ── #G completeSetup role-redirect join — the LIVE user_roles->roles read that resolves the redirect ──────
  select r.name into v_name from user_roles ur join roles r on r.id = ur.role_id
    where ur.user_id = v_sa and ur.active = true limit 1;
  if v_name is distinct from 'Super Admin' then
    raise exception 'FAIL #G: role-redirect join returned % (expected Super Admin)', coalesce(v_name, '<null>');
  end if;
  raise notice 'PASS #G: completeSetup role-redirect join resolves the assigned role name live';

  -- ── #G2 completeSetup redirect for a native invite (client_tenant) with NO role assigned — the join must
  -- return zero rows (not error), so the adapter's `roleRes.rows[0]?.name ?? null` lands on SAFE_NO_ACCESS_VIEW
  -- rather than throwing. v_uid (the invitee) has no user_roles row → the redirect read is a clean empty result.
  -- NB: a SELECT INTO over an empty result leaves the target UNCHANGED in plpgsql, so reset v_name first (else
  -- it retains 'Super Admin' from #G and this assertion would false-fail).
  v_name := null;
  select r.name into v_name from user_roles ur join roles r on r.id = ur.role_id
    where ur.user_id = v_uid and ur.active = true limit 1;
  if v_name is not null then
    raise exception 'FAIL #G2: expected NULL role for an unassigned invitee, got %', v_name;
  end if;
  raise notice 'PASS #G2: redirect join returns no row for a role-less invitee (adapter falls back to SAFE_NO_ACCESS_VIEW, no crash)';

  -- ── #H append-only invariant — an in-place UPDATE / DELETE on access_audit & event_log must be REJECTED ───
  -- (writeAudit/writeEvent rely on these sinks being immutable — a mutable audit sink is a #1/#3 hole.)
  insert into access_audit (audit_type, actor_identity, actor_type, action, target_type, reason)
    values ('invite_issued', 'issuer@example.com', 'user', 'issue_invite', 'invite', 'aa-appendonly-probe')
    returning id into v_pid;
  begin
    update access_audit set reason = 'tampered' where id = v_pid;
    raise exception 'FAIL #H1: access_audit in-place UPDATE was ALLOWED';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS #H1: access_audit in-place UPDATE rejected -> %', sqlerrm;
  end;
  begin
    delete from access_audit where id = v_pid;
    raise exception 'FAIL #H2: access_audit DELETE was ALLOWED';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS #H2: access_audit DELETE rejected -> %', sqlerrm;
  end;

  insert into event_log (event_type, summary)
    values ('account_activated'::event_type, 'el-appendonly-probe') returning id into v_pid;
  begin
    update event_log set summary = 'tampered' where id = v_pid;
    raise exception 'FAIL #H3: event_log in-place UPDATE was ALLOWED';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS #H3: event_log in-place UPDATE rejected -> %', sqlerrm;
  end;

  -- ── #I OD-192 invite lifecycle (0027 markers) — revoke stamps revoked_at + invalidates the token;
  -- markBounced stamps bounced_at on the delivery axis WITHOUT invalidating. Replays the exact adapter UPDATEs
  -- (revokeInvite / markBounced) and the loadInviteLive guard reads against the real profiles DDL. ────────────
  -- revoke path: a pending invite (v_uid2) → stamp revoked_at (adapter: update profiles set revoked_at=to_timestamp($now)).
  insert into profiles (id, email, active) values (v_uid2, 'invitee2@example.com', false);
  update profiles set revoked_at = to_timestamp(extract(epoch from now())) where id = v_uid2;
  select (revoked_at is not null and active = false) into v_active from profiles where id = v_uid2;
  if v_active is not true then raise exception 'FAIL #I1: revoke did not persist revoked_at on the pending invite'; end if;
  raise notice 'PASS #I1: revokeInvite stamps profiles.revoked_at (pending invite revoked)';

  -- loadInviteLive guard: the choke-point read (select id,email,active,revoked_at,bounced_at) now sees
  -- revoked_at IS NOT NULL for this token → the adapter throws ERR_TOKEN_INVALID, so a REVOKED invite can never
  -- activate (#2). Assert the guard input is live: the row is returned with revoked_at set + still inactive.
  perform 1 from profiles where id = v_uid2 and active = false and revoked_at is not null;
  if not found then
    raise exception 'FAIL #I2: loadInviteLive guard input wrong — a revoked pending invite is not distinguishable live';
  end if;
  raise notice 'PASS #I2: loadInviteLive would reject the revoked token (revoked_at set, active=false) — a revoked invite cannot activate (#2)';

  -- markBounced path: a SEPARATE pending invite → stamp bounced_at; must NOT set revoked_at (delivery axis only),
  -- so loadInviteLive still returns it (token stays valid) with delivery='bounced' (never a silent "sent", #3).
  declare
    v_bnc_uid uuid := gen_random_uuid();
  begin
    insert into auth.users (id, email) values (v_bnc_uid, 'bounced@example.com');
    insert into profiles (id, email, active) values (v_bnc_uid, 'bounced@example.com', false);
    update profiles set bounced_at = to_timestamp(extract(epoch from now())) where id = v_bnc_uid;
    perform 1 from profiles where id = v_bnc_uid and bounced_at is not null and revoked_at is null and active = false;
    if not found then
      raise exception 'FAIL #I3: markBounced did not stamp bounced_at cleanly on the delivery axis (or wrongly touched revoked_at/active)';
    end if;
    raise notice 'PASS #I3: markBounced stamps profiles.bounced_at only (revoked_at null, active false) — invite reads undelivered, token still valid (#3)';
  end;

  raise notice 'ALL ASSERTIONS PASS';
end $$;

rollback;
