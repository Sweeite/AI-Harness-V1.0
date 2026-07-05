-- ISSUE-010 config backbone — LIVE capstone (proves the ACs offline tests cannot reach: the DB append-only
-- trigger actually rejecting a service_role DELETE/UPDATE, the 0003 key-prefix RLS actually filtering an
-- authenticated read, and the redaction-tombstone passing after the fact). Run by the OPERATOR at the
-- Stage-2 checkpoint (a 💻 full/live env), NOT by an offline builder.
--
-- Run AFTER `npm run migrate` has applied 0003_config_values_rls to the silo:
--   source ~/.ai-harness-secrets.env
--   /opt/homebrew/opt/libpq/bin/psql "$SILO_DB_URL" -v ON_ERROR_STOP=1 -f results/issue-010-capstone.sql
--
-- It proves, fail-LOUD (any failed assertion RAISEs and aborts):
--   • AC-NFR-CMP.006.1  service_role DELETE on config_audit_log is rejected by the trigger
--   • AC-NFR-CMP.006.2  service_role in-place UPDATE (non-tombstone) on config_audit_log is rejected
--   • AC-NFR-CMP.006.3  all four audit sinks carry the BEFORE UPDATE OR DELETE trigger
--   • AC-7.LOG.008.3    the sink is append-only + tamper-evident (a content UPDATE is rejected)
--   • AC-7.LOG.008.4    the redaction-tombstone (set redacted_at + null actor_id) IS permitted, retains the
--                       change record, and is the ONLY permitted UPDATE
--   • AC-7.LOG.008.1    (RLS scope) a PERM-config.memory caller reads a memory-group config_values row but
--                       NOT a guardrails-group row; a no-config-perm caller reads nothing (default-deny)
--   • AC-NFR-SEC.003.1  secret_manifest exposes presence + last_rotated only (no value column exists)
--
-- Everything runs inside ONE transaction that ROLLS BACK — no fixture survives; only the 0003 migration
-- persists. session_replication_role is flipped to 'replica' ONLY to insert synthetic FK-referencing
-- fixtures, then back to 'origin' so RLS + triggers are genuinely enforced during the assertions.

\set ON_ERROR_STOP on
begin;

-- ── Fixtures (rolled back): a memory-perm user, a no-perm user, and seed rows in two config groups ──
set local session_replication_role = replica;   -- skip FK/trigger checks for synthetic rows
do $fx$
declare
  m_uid uuid := '00000000-0000-0000-0000-00000000010a';  -- user holding PERM-config.memory
  n_uid uuid := '00000000-0000-0000-0000-00000000010b';  -- user holding NO config perm
  r_id  uuid := '00000000-0000-0000-0000-0000000010cc';  -- role
begin
  insert into public.profiles (id, email) values (m_uid, 'issue010-mem@example.invalid') on conflict do nothing;
  insert into public.profiles (id, email) values (n_uid, 'issue010-none@example.invalid') on conflict do nothing;
  insert into public.roles (id, name) values (r_id, '__issue010_role__') on conflict do nothing;
  insert into public.role_permissions (role_id, permission_node) values (r_id, 'PERM-config.memory') on conflict do nothing;
  insert into public.user_roles (user_id, role_id, active) values (m_uid, r_id, true) on conflict (user_id) do nothing;

  -- config_values: one memory-group row, one guardrails-group row
  insert into public.config_values (key, value, updated_by)
    values ('amber_zone_threshold', '0.75'::jsonb, m_uid) on conflict (key) do nothing;
  insert into public.config_values (key, value, updated_by)
    values ('price_table', '{"anthropic":3}'::jsonb, m_uid) on conflict (key) do nothing;

  -- a config_audit_log row to exercise the immutability trigger + tombstone
  insert into public.config_audit_log (id, key, old_value, new_value, actor_id)
    values ('00000000-0000-0000-0000-0000000010e1', 'amber_zone_threshold', '0.7'::jsonb, '0.75'::jsonb, m_uid)
    on conflict (id) do nothing;
end $fx$;
set local session_replication_role = origin;     -- RLS + triggers enforced again from here on

do $t$
declare
  m_uid constant text := '00000000-0000-0000-0000-00000000010a';
  n_uid constant text := '00000000-0000-0000-0000-00000000010b';
  cnt int;
  trg int;
  ok  boolean;
begin
  -- AC-NFR-CMP.006.3 — all four sinks carry the append-only trigger
  select count(*) into trg
  from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
  where tg.tgname = 't_append_only'
    and c.relname in ('event_log','guardrail_log','access_audit','config_audit_log')
    and not tg.tgisinternal;
  if trg <> 4 then raise exception 'AC-NFR-CMP.006.3 FAIL: expected 4 t_append_only triggers, found %', trg; end if;
  raise notice 'PASS AC-NFR-CMP.006.3 — all four audit sinks carry the append-only trigger';

  -- AC-NFR-CMP.006.1 / AC-7.LOG.008.3 — service_role DELETE on config_audit_log is REJECTED
  set local role service_role;
  begin
    delete from public.config_audit_log where id = '00000000-0000-0000-0000-0000000010e1';
    reset role;
    raise exception 'AC-NFR-CMP.006.1 FAIL: service_role DELETE was NOT rejected (append-only broken, #1)';
  exception when others then
    reset role;
    if sqlerrm not like '%append-only%' and sqlerrm not like '%DELETE forbidden%' and sqlerrm not like '%permission denied%' then
      raise exception 'AC-NFR-CMP.006.1 FAIL: DELETE raised the wrong error: %', sqlerrm;
    end if;
  end;
  raise notice 'PASS AC-NFR-CMP.006.1 — service_role DELETE on config_audit_log is rejected';

  -- AC-NFR-CMP.006.2 / AC-7.LOG.008.3 — service_role in-place content UPDATE is REJECTED
  set local role service_role;
  begin
    update public.config_audit_log set new_value = '0.99'::jsonb where id = '00000000-0000-0000-0000-0000000010e1';
    reset role;
    raise exception 'AC-NFR-CMP.006.2 FAIL: service_role content UPDATE was NOT rejected (tamper-evident broken, #1/#3)';
  exception when others then
    reset role;
    if sqlerrm not like '%append-only%' and sqlerrm not like '%UPDATE forbidden%' then
      raise exception 'AC-NFR-CMP.006.2 FAIL: UPDATE raised the wrong error: %', sqlerrm;
    end if;
  end;
  raise notice 'PASS AC-NFR-CMP.006.2 — service_role content UPDATE on config_audit_log is rejected';

  -- AC-7.LOG.008.4 — the redaction-tombstone (set redacted_at + null actor_id) IS permitted
  set local role service_role;
  update public.config_audit_log
    set actor_id = null, redacted_at = now()
    where id = '00000000-0000-0000-0000-0000000010e1';
  reset role;
  -- the change record survives (key/old/new/changed_at retained), only attribution is gone
  select (actor_id is null and redacted_at is not null and key = 'amber_zone_threshold'
          and old_value = '0.7'::jsonb and new_value = '0.75'::jsonb)
    into ok from public.config_audit_log where id = '00000000-0000-0000-0000-0000000010e1';
  if not ok then raise exception 'AC-7.LOG.008.4 FAIL: tombstone did not retain the change record while scrubbing actor'; end if;
  raise notice 'PASS AC-7.LOG.008.4 — redaction-tombstone permitted; change record retained, actor scrubbed';

  -- AC-7.LOG.008.1 (RLS scope) — a PERM-config.memory caller reads the memory row, NOT the guardrails row
  set local role authenticated;
  perform set_config('request.jwt.claims', format('{"sub":"%s","aal":"aal2"}', m_uid), true);
  select count(*) into cnt from public.config_values where key = 'amber_zone_threshold';
  if cnt <> 1 then raise exception 'AC-7.LOG.008.1 FAIL: memory-perm caller could not read the memory-group key (saw %)', cnt; end if;
  select count(*) into cnt from public.config_values where key = 'price_table';
  if cnt <> 0 then raise exception 'AC-7.LOG.008.1 FAIL: memory-perm caller READ a guardrails-group key (key-prefix RLS leak, #2)'; end if;
  reset role;
  raise notice 'PASS AC-7.LOG.008.1 — key-prefix RLS: memory caller reads only its group''s config_values';

  -- default-deny: a caller with NO config perm reads nothing
  set local role authenticated;
  perform set_config('request.jwt.claims', format('{"sub":"%s","aal":"aal2"}', n_uid), true);
  select count(*) into cnt from public.config_values;
  if cnt <> 0 then raise exception 'AC-7.LOG.008.1 FAIL: no-config-perm caller saw % config_values rows (default-deny broken, #2)', cnt; end if;
  reset role;
  raise notice 'PASS default-deny — no-config-perm caller reads zero config_values rows';

  -- AC-NFR-SEC.003.1 — secret_manifest has NO value column (a value can never be SELECTed)
  select count(*) into cnt from information_schema.columns
    where table_schema='public' and table_name='secret_manifest'
      and column_name not in ('key','present','last_rotated');
  if cnt <> 0 then raise exception 'AC-NFR-SEC.003.1 FAIL: secret_manifest has an unexpected (value-bearing?) column'; end if;
  raise notice 'PASS AC-NFR-SEC.003.1 — secret_manifest exposes presence + last_rotated only (no value column)';

  raise notice '════════ ALL ISSUE-010 LIVE CAPSTONE ASSERTIONS PASSED ════════';
end $t$;

rollback;   -- leave the silo untouched: only the 0003 migration persists
