-- app/retention/results/live-smoke.sql
-- ISSUE-084 — live-adapter smoke for app/retention/src/supabase-store.ts (R10 hygiene sweep).
--
-- WHAT THIS PROVES (against the REAL silo DDL, connecting as the postgres owner role
-- rolbypassrls=t per OD-193 — RLS is BYPASSED on this path, so these asserts test the write
-- SHAPE + constraints + the RET.001 detector logic, not RLS):
--   1. setValue()'s atomic write path: the config_values UPSERT (insert + ON CONFLICT DO UPDATE)
--      and the config_audit_log append both land in ONE txn, columns/types match the DDL,
--      and updated_by / actor_id (uuid FK -> profiles.id) resolve against a real profile row.
--   2. The config_audit_log append-only trigger does NOT block the INSERT (trigger is
--      BEFORE DELETE OR UPDATE only) — the audit row is recorded (#3: value never lands w/o audit).
--   3. The RET.001 unauthorised-hard-delete detector (liveTombstones / unauthorisedTombstones,
--      AC-10.RET.001.3): an access_audit hard_delete WITH a matching executed individual_erasure
--      deletion_request reads back as AUTHORISED; one WITHOUT (or path_context=client_offboarding)
--      reads back as UNAUTHORISED. This replays the exact SQL join in supabase-store.ts:216-244.
--
-- Connect role verified live: current_user=postgres, rolbypassrls=t.
-- Table/enum facts verified live: config_values(key pk, value jsonb, updated_by uuid),
--   config_audit_log(key,old_value,new_value jsonb NOT NULL,actor_id uuid), access_audit
--   (target_entity_id uuid, action text, path_context text), deletion_requests(status
--   deletion_status enum='received|authorised|executed|rejected', target_user_id/authorized_by uuid),
--   actor_type enum='user|agent|system'. No GRANTs revoked from postgres on any of the four tables.
--
-- Run:  /opt/homebrew/opt/libpq/bin/psql "$SILO_DB_URL" -f app/retention/results/live-smoke.sql
-- Everything runs inside ONE txn and ROLLBACKs — nothing persists. (Serial: orchestrator runs it.)

\set ON_ERROR_STOP on
begin;

-- ── Fixture parents (uuid FK targets). profiles NOT NULL: id, email. ────────────────────────────
insert into profiles (id, email, name)
  values ('00000000-0000-4000-8000-0000000000a1', 'ret-smoke-actor@example.test', 'Ret Smoke Actor');
insert into profiles (id, email, name)
  values ('00000000-0000-4000-8000-0000000000a2', 'ret-smoke-subject@example.test', 'Ret Smoke Subject');
insert into profiles (id, email, name)
  values ('00000000-0000-4000-8000-0000000000a3', 'ret-smoke-auth@example.test', 'Ret Smoke Authoriser');
insert into profiles (id, email, name)
  values ('00000000-0000-4000-8000-0000000000a4', 'ret-smoke-exec@example.test', 'Ret Smoke Executor');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- PART 1 — setValue() atomic write path (supabase-store.ts:107-117)
--   individual_deletion_audit_years := 8 (an int key; 8 >= default floor 7, so a legal write).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- (a) prev read (supabase-store.ts:105) — key unset, so old_value is the catalog default 7 (asserted by app).
-- (b) UPSERT value (int -> jsonb):
insert into config_values (key, value, updated_by)
  values ('individual_deletion_audit_years', '8'::jsonb, '00000000-0000-4000-8000-0000000000a1')
  on conflict (key) do update
    set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by;
-- (c) audit append in the SAME txn (old_value=default 7, new_value=8):
insert into config_audit_log (key, old_value, new_value, actor_id)
  values ('individual_deletion_audit_years', '7'::jsonb, '8'::jsonb, '00000000-0000-4000-8000-0000000000a1');

do $$
declare v jsonb; n int;
begin
  select value into v from config_values where key = 'individual_deletion_audit_years';
  if v is distinct from '8'::jsonb then
    raise exception 'PART1 FAIL: config_values not upserted, got %', v; end if;

  select count(*) into n from config_audit_log
   where key = 'individual_deletion_audit_years'
     and old_value = '7'::jsonb and new_value = '8'::jsonb
     and actor_id = '00000000-0000-4000-8000-0000000000a1';
  if n <> 1 then
    raise exception 'PART1 FAIL: audit row not appended (append-only trigger blocked INSERT?), count=%', n; end if;
  raise notice 'PART1 OK: value upserted + audit appended atomically';
end $$;

-- Re-UPSERT to prove ON CONFLICT DO UPDATE overwrites (setValue on an already-set key):
insert into config_values (key, value, updated_by)
  values ('individual_deletion_audit_years', '9'::jsonb, '00000000-0000-4000-8000-0000000000a1')
  on conflict (key) do update
    set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by;
do $$
declare v jsonb;
begin
  select value into v from config_values where key = 'individual_deletion_audit_years';
  if v is distinct from '9'::jsonb then
    raise exception 'PART1b FAIL: ON CONFLICT DO UPDATE did not overwrite, got %', v; end if;
  raise notice 'PART1b OK: ON CONFLICT DO UPDATE overwrote value';
end $$;

-- Boolean key path (deletion_two_person_auth_required := false), jsonb bool literal:
insert into config_values (key, value, updated_by)
  values ('deletion_two_person_auth_required', 'false'::jsonb, '00000000-0000-4000-8000-0000000000a1')
  on conflict (key) do update
    set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by;
do $$
declare v jsonb;
begin
  select value into v from config_values where key = 'deletion_two_person_auth_required';
  if v is distinct from 'false'::jsonb then
    raise exception 'PART1c FAIL: boolean key not stored as jsonb bool, got %', v; end if;
  raise notice 'PART1c OK: boolean key stored as jsonb false';
end $$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- PART 2 — RET.001 unauthorised-hard-delete detector (supabase-store.ts:216-244)
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Subject A2: an AUTHORISED individual erasure — an executed deletion_request exists for it.
--   deletion_requests execution requires 3 distinct people in authorized_by/second/executor (DDL checks).
insert into deletion_requests
  (id, requester_id, target_user_id, status, authorized_by, second_authoriser_id, executor_id, executed_at)
values
  ('00000000-0000-4000-8000-0000000000b1',
   '00000000-0000-4000-8000-0000000000a1',   -- requester
   '00000000-0000-4000-8000-0000000000a2',   -- target subject
   'executed',
   '00000000-0000-4000-8000-0000000000a3',   -- authorized_by
   '00000000-0000-4000-8000-0000000000a1',   -- second (distinct from authorized_by)
   '00000000-0000-4000-8000-0000000000a4',   -- executor (distinct from both)
   now());
-- the hard_delete audit row for A2 (individual_erasure path):
insert into access_audit (audit_type, actor_identity, actor_type, target_entity_id, action, path_context)
  values ('deletion','system','system','00000000-0000-4000-8000-0000000000a2','hard_delete','individual_erasure');

-- Subject A?: an UNAUTHORISED hard_delete — NO deletion_request behind it, individual_erasure path.
insert into access_audit (audit_type, actor_identity, actor_type, target_entity_id, action, path_context)
  values ('deletion','system','system','00000000-0000-4000-8000-0000000000c9','hard_delete','individual_erasure');

-- A client_offboarding hard_delete — always fail-closed as unauthorised (no offboarding_records table yet,
-- and the detector's sanctioned-check only accepts individual_erasure). supabase-store.ts:213-215,228.
insert into access_audit (audit_type, actor_identity, actor_type, target_entity_id, action, path_context)
  values ('deletion','system','system','00000000-0000-4000-8000-0000000000a2','hard_delete','client_offboarding');

-- Replay the EXACT liveTombstones() query (supabase-store.ts:217-226) + the two classifications.
do $$
declare
  auth_ct int; unauth_ct int; a2_authorised boolean;
begin
  -- liveTombstones() row for subject A2 via individual_erasure: authorized_by should resolve -> sanctioned.
  select (r.path_context = 'individual_erasure' and r.authorized_by is not null)
    into a2_authorised
  from (
    select aa.target_entity_id, aa.path_context,
           (select dr.authorized_by from deletion_requests dr
              where dr.target_user_id = aa.target_entity_id and dr.status = 'executed'
              order by dr.executed_at desc limit 1) as authorized_by
      from access_audit aa
     where aa.action = 'hard_delete'
       and aa.target_entity_id = '00000000-0000-4000-8000-0000000000a2'
       and aa.path_context = 'individual_erasure'
  ) r;
  if a2_authorised is not true then
    raise exception 'PART2 FAIL: authorised individual_erasure not recognised as authorised'; end if;

  -- unauthorisedTombstones(): path is null OR authorised_by is null. Count over our 3 injected rows.
  select
    count(*) filter (where sanctioned),
    count(*) filter (where not sanctioned)
    into auth_ct, unauth_ct
  from (
    select (r.path_context = 'individual_erasure' and r.authorized_by is not null) as sanctioned
    from (
      select aa.target_entity_id, aa.path_context,
             (select dr.authorized_by from deletion_requests dr
                where dr.target_user_id = aa.target_entity_id and dr.status = 'executed'
                order by dr.executed_at desc limit 1) as authorized_by
        from access_audit aa
       where aa.action = 'hard_delete'
         and aa.target_entity_id in (
           '00000000-0000-4000-8000-0000000000a2',
           '00000000-0000-4000-8000-0000000000c9')
    ) r
  ) s;

  -- Expected among our injected rows: A2/individual_erasure=authorised(1);
  --   c9/individual_erasure w/ no request=unauthorised; A2/client_offboarding=unauthorised. => auth=1, unauth=2.
  if auth_ct <> 1 then
    raise exception 'PART2 FAIL: expected exactly 1 authorised tombstone, got %', auth_ct; end if;
  if unauth_ct <> 2 then
    raise exception 'PART2 FAIL: expected 2 unauthorised tombstones (missing-request + client_offboarding), got %', unauth_ct; end if;
  raise notice 'PART2 OK: RET.001 detector — 1 authorised, 2 unauthorised (fail-closed) as designed';
end $$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- PART 3 — audits() read path (supabase-store.ts:132-145): the append-only audit is queryable back
--   filtered to the retention keys, ordered changed_at asc, id asc.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
do $$
declare n int;
begin
  select count(*) into n from config_audit_log
   where key = any (array['client_offboarding_retention_days','individual_deletion_audit_years',
                          'data_export_link_expiry_hours','deletion_two_person_auth_required']::text[]);
  if n < 1 then
    raise exception 'PART3 FAIL: audits() read path returned no retention-key rows'; end if;
  raise notice 'PART3 OK: audits() read path returns retention-key audit rows (n=%)', n;
end $$;

rollback;
