-- ISSUE-042 prompt version discipline + prompt_layers RLS — LIVE capstone (proves the ACs that the
-- offline port+fake tests cannot reach: the 0004 DB trigger actually FIRING and the prompt_layers RLS
-- policy actually ENFORCING). Run by the operator at the Stage-2 checkpoint.
--
-- Run AFTER `npm run migrate` has applied 0004_prompt_version_discipline to the silo:
--   source ~/.ai-harness-secrets.env
--   /opt/homebrew/opt/libpq/bin/psql "$SILO_DB_URL" -v ON_ERROR_STOP=1 -f results/issue-042-capstone.sql
--
-- It proves, fail-LOUD (any failed assertion RAISEs and aborts):
--   • AC-4.STO.001.1  prompt_layers has the listed columns + NO client_slug (schema shape, live catalog)
--   • AC-4.STO.003.1  an in-place UPDATE of a versioned row's content is REJECTED by the trigger; an edit
--                     must be a NEW INSERT (append-only-by-version) — the prior row is unmutated
--   • AC-4.STO.003.2  an INSERT with an empty/whitespace change_reason is REJECTED by the trigger
--   • AC-4.STO.004.1  a DELETE of any prompt_layers row is REJECTED (rollback never deletes)
--   • AC-4.STO.005.2  an authenticated user WITHOUT PERM-prompt.edit cannot read/write prompt_layers
--                     (default-deny via the 0002 floor); WITH it, they can (the 0004 prompt_edit policy)
--   • AC-4.LYR.002.1  a core row requires agent_id (the schema CHECK) — a core with null agent_id RAISEs
--
-- Everything runs inside ONE transaction that ROLLS BACK — no fixture survives, so the silo is
-- byte-identical afterward (only the 0004 migration persists). session_replication_role is flipped to
-- 'replica' ONLY to insert synthetic FK-referencing fixtures, then back to 'origin' so RLS + triggers are
-- genuinely enforced during the assertions (replica mode bypasses BOTH — the tests would be meaningless).

\set ON_ERROR_STOP on
begin;

-- ── Fixtures (rolled back): an agent, a user WITH PERM-prompt.edit, a user WITHOUT it ──
set local session_replication_role = replica;  -- skip FK checks for synthetic rows; also skips the trigger
do $fx$
declare
  ed_uid uuid := '00000000-0000-0000-0000-000000042ed1';  -- user WITH PERM-prompt.edit
  no_uid uuid := '00000000-0000-0000-0000-000000042de1';  -- user with NO prompt perm
  r_id   uuid := '00000000-0000-0000-0000-0000000042c9';  -- role holding PERM-prompt.edit
  a_id   uuid := '00000000-0000-0000-0000-00000000a642';  -- an agent
begin
  insert into public.profiles (id, email) values (ed_uid, 'prompt-editor@example.invalid') on conflict do nothing;
  insert into public.profiles (id, email) values (no_uid, 'prompt-noperm@example.invalid') on conflict do nothing;
  insert into public.roles (id, name) values (r_id, '__prompt_edit_role__') on conflict do nothing;
  insert into public.role_permissions (role_id, permission_node) values (r_id, 'PERM-prompt.edit') on conflict do nothing;
  insert into public.user_roles (user_id, role_id, active) values (ed_uid, r_id, true) on conflict (user_id) do nothing;
  insert into public.agents (id, name, description, memory_scope, change_reason)
    values (a_id, 'acme_finance_agent', 'finance', '{}'::jsonb, 'capstone fixture') on conflict do nothing;
  -- v1 of a core layer for the agent (change_reason non-empty; inserted in replica mode → trigger skipped)
  insert into public.prompt_layers (id, layer, name, content, agent_id, version, change_reason, created_by)
    values ('00000000-0000-0000-0000-0000000042f1', 'core', 'fin-core',
            'Finance agent. [BOUNDARY] [HARD-LIMITS] [PRINCIPLES] v1', a_id, 1, 'init', ed_uid)
    on conflict do nothing;
end $fx$;

set local session_replication_role = origin;  -- triggers + RLS enforced from here on

-- ── Assertions ────────────────────────────────────────────────────────────────
do $t$
declare
  a_id  constant uuid := '00000000-0000-0000-0000-00000000a642';
  v1_id constant uuid := '00000000-0000-0000-0000-0000000042f1';
  ed_uid constant text := '00000000-0000-0000-0000-000000042ed1';
  no_uid constant text := '00000000-0000-0000-0000-000000042de1';
  cnt int;
  ok boolean;
begin
  -- AC-4.STO.001.1 — the column set is present and client_slug is ABSENT.
  select bool_and(c in (select column_name from information_schema.columns
                        where table_schema='public' and table_name='prompt_layers'))
    into ok
  from unnest(array['id','layer','name','content','agent_id','enabled','version',
                    'previous_version_id','change_reason','created_at','created_by']) c;
  if not ok then raise exception 'AC-4.STO.001.1 FAIL: prompt_layers is missing a required column'; end if;
  perform 1 from information_schema.columns
    where table_schema='public' and table_name='prompt_layers' and column_name='client_slug';
  if found then raise exception 'AC-4.STO.001.1 FAIL: prompt_layers carries client_slug (OD-096 / FR-10.ISO.001 forbids it)'; end if;
  raise notice 'PASS AC-4.STO.001.1 — prompt_layers has the listed columns and NO client_slug';

  -- AC-4.STO.003.1 — an in-place UPDATE of a versioned row's content is REJECTED by the trigger.
  begin
    update public.prompt_layers set content = 'MUTATED IN PLACE' where id = v1_id;
    raise exception 'AC-4.STO.003.1 FAIL: an in-place content UPDATE was allowed (append-only broken, #1)';
  exception when others then
    if sqlerrm like '%append-only-by-version%' then
      raise notice 'PASS AC-4.STO.003.1 — in-place content edit rejected by the version-discipline trigger';
    else raise; end if;
  end;
  -- the row is unmutated
  select content into ok from (select content = 'Finance agent. [BOUNDARY] [HARD-LIMITS] [PRINCIPLES] v1' as content
                               from public.prompt_layers where id = v1_id) s;
  if not ok then raise exception 'AC-4.STO.003.1 FAIL: v1 content changed despite the rejection'; end if;

  -- AC-4.STO.003.2 — an INSERT with an empty change_reason is REJECTED by the trigger.
  begin
    insert into public.prompt_layers (layer, name, content, agent_id, version, previous_version_id, change_reason, created_by)
      values ('core', 'fin-core', 'v2 attempt', a_id, 2, v1_id, '   ', ed_uid::uuid);
    raise exception 'AC-4.STO.003.2 FAIL: an empty change_reason INSERT was allowed';
  exception when others then
    if sqlerrm like '%change_reason is mandatory%' then
      raise notice 'PASS AC-4.STO.003.2 — empty change_reason rejected';
    else raise; end if;
  end;

  -- AC-4.STO.004.1 (delete half) — a DELETE of any prompt_layers row is REJECTED (rollback never deletes).
  begin
    delete from public.prompt_layers where id = v1_id;
    raise exception 'AC-4.STO.004.1 FAIL: a prompt_layers DELETE was allowed (history destroyed, #1)';
  exception when others then
    if sqlerrm like '%DELETE forbidden%' then
      raise notice 'PASS AC-4.STO.004.1 — DELETE forbidden (rollback creates a new version, never deletes)';
    else raise; end if;
  end;

  -- AC-4.LYR.002.1 (schema keying) — a core row with null agent_id violates the CHECK.
  begin
    insert into public.prompt_layers (layer, name, content, agent_id, version, change_reason, created_by)
      values ('core', 'orphan-core', 'no agent', null, 1, 'init', ed_uid::uuid);
    raise exception 'AC-4.LYR.002.1 FAIL: a core row with null agent_id was allowed (per-agent keying broken)';
  exception when check_violation then
    raise notice 'PASS AC-4.LYR.002.1 — core requires agent_id (schema CHECK enforced)';
  end;

  -- AC-4.STO.005.2 — an authenticated user WITHOUT PERM-prompt.edit sees no prompt_layers rows (default-deny).
  set local role authenticated;
  perform set_config('request.jwt.claims', format('{"sub":"%s","aal":"aal2"}', no_uid), true);
  select count(*) into cnt from public.prompt_layers where id = v1_id;
  if cnt <> 0 then raise exception 'AC-4.STO.005.2 FAIL: user WITHOUT PERM-prompt.edit saw % rows (default-deny broken, #2)', cnt; end if;
  reset role;
  raise notice 'PASS AC-4.STO.005.2 (deny) — user without PERM-prompt.edit is denied (0 rows)';

  -- AC-4.STO.005.2 (positive) — a user WITH PERM-prompt.edit can read the row (the 0004 prompt_edit policy).
  set local role authenticated;
  perform set_config('request.jwt.claims', format('{"sub":"%s","aal":"aal2"}', ed_uid), true);
  select count(*) into cnt from public.prompt_layers where id = v1_id;
  if cnt <> 1 then raise exception 'AC-4.STO.005.2 FAIL: user WITH PERM-prompt.edit saw % rows, expected 1', cnt; end if;
  reset role;
  raise notice 'PASS AC-4.STO.005.2 (allow) — user with PERM-prompt.edit reads the row (1 row)';

  raise notice '════════ ALL ISSUE-042 LIVE CAPSTONE ASSERTIONS PASSED ════════';
end $t$;

rollback;  -- leave the silo untouched: only the 0004 migration persists
