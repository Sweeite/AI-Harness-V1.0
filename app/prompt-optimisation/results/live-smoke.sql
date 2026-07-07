-- ================================================================================================
-- live-smoke.sql — ISSUE-046 (C4 OPT) live-adapter hygiene sweep (R10 / live-adapter-hygiene-sweep.md)
-- Adapter under test: app/prompt-optimisation/src/supabase-store.ts (SupabasePromptOptimisationStore)
--
-- WHAT THIS PROVES (and what it deliberately cannot):
--   * putDynamicField / assembleDynamicLayer2 write+read paths run against the REAL
--     public.dynamic_field_values DDL (0001_baseline.sql L391) with the real column types.
--   * The OPT.001 attribution + outcome paths (captureAttribution / getAttribution / recordOutcome /
--     outcomesByVersion) reference tables that DO NOT EXIST in ANY silo migration (head 0025):
--       - prompt_version_attribution  -> to_regclass = NULL (proposal only, results/opt001-attribution-columns.sql)
--       - task_outcome                -> to_regclass = NULL (C5-owned, ISSUE-053, unbuilt)
--     Verified live 2026-07-07 as role `postgres` (session_user=postgres, rolbypassrls=t — RLS bypassed).
--     Those four adapter methods therefore raise 42P01 relation-does-not-exist on EVERY call today.
--     This script ASSERTS that non-existence (so the smoke fails loudly the day C5 lands the tables and
--     this file must be extended to exercise them). It does NOT replay those write paths because there is
--     no table to write to.
--
-- Connect as the adapter does: SILO_DB_URL (owner `postgres`).  Run:
--   /opt/homebrew/opt/libpq/bin/psql "$SILO_DB_URL" -f app/prompt-optimisation/results/live-smoke.sql
-- Everything is inside one txn and ROLLBACK at the end — nothing persists.
-- ================================================================================================

begin;

-- ── Assertion 0 — the connect role is the owner plane the shared context documents (postgres, bypassrls).
do $$
declare v_bypass bool;
begin
  select rolbypassrls into v_bypass from pg_roles where rolname = current_user;
  if session_user <> 'postgres' then
    raise exception 'SMOKE FAIL: expected to connect as postgres owner, got session_user=%', session_user;
  end if;
  if v_bypass is distinct from true then
    raise exception 'SMOKE FAIL: connect role % does not bypass RLS (rolbypassrls<>t)', current_user;
  end if;
end $$;

-- ── Assertion 1 — the OPT.001 tables the adapter names are ABSENT (M12). Proves the 4 attribution/outcome
--    methods raise 42P01 today. When C5/ISSUE-053 lands them, this block fails and forces this file to grow
--    real replays for captureAttribution/getAttribution/recordOutcome/outcomesByVersion.
do $$
begin
  if to_regclass('public.prompt_version_attribution') is not null then
    raise exception 'SMOKE FAIL(expected): prompt_version_attribution NOW EXISTS — extend live-smoke.sql to replay captureAttribution/getAttribution/recordOutcome/outcomesByVersion (was NULL at ISSUE-046 authoring)';
  end if;
  if to_regclass('public.task_outcome') is not null then
    raise exception 'SMOKE FAIL(expected): task_outcome NOW EXISTS — extend live-smoke.sql to replay outcomesByVersion join';
  end if;
end $$;

-- ── Assertion 2 — putDynamicField(): the upsert INSERT column list + ON CONFLICT (field_name) target match
--    the real DDL (field_name text PK, field_value text NULL, last_updated timestamptz NOT NULL).
--    Insert-then-conflict-update replays the adapter's exact statement (supabase-store.ts L156-161).
do $$
declare v_val text; v_ts timestamptz;
begin
  -- first write (INSERT branch)
  insert into public.dynamic_field_values (field_name, field_value, last_updated)
  values ('smoke_opt002_field', 'v1', to_timestamp(1751000000))
  on conflict (field_name) do update
    set field_value = excluded.field_value, last_updated = excluded.last_updated;

  select field_value, last_updated into v_val, v_ts
    from public.dynamic_field_values where field_name = 'smoke_opt002_field';
  if v_val is distinct from 'v1' then
    raise exception 'SMOKE FAIL: putDynamicField INSERT branch did not persist value (got %)', v_val;
  end if;

  -- second write same key (ON CONFLICT UPDATE branch) — proves fresh-read visibility of an edited value
  insert into public.dynamic_field_values (field_name, field_value, last_updated)
  values ('smoke_opt002_field', 'v2', to_timestamp(1751000900))
  on conflict (field_name) do update
    set field_value = excluded.field_value, last_updated = excluded.last_updated;

  select field_value, last_updated into v_val, v_ts
    from public.dynamic_field_values where field_name = 'smoke_opt002_field';
  if v_val is distinct from 'v2' then
    raise exception 'SMOKE FAIL: putDynamicField ON CONFLICT UPDATE did not overwrite value (got %)', v_val;
  end if;
  if v_ts is distinct from to_timestamp(1751000900) then
    raise exception 'SMOKE FAIL: putDynamicField ON CONFLICT UPDATE did not update last_updated (got %)', v_ts;
  end if;

  -- a NULL field_value is legal (column is nullable) — the adapter passes null through.
  insert into public.dynamic_field_values (field_name, field_value, last_updated)
  values ('smoke_opt002_nullfield', null, to_timestamp(1751000000))
  on conflict (field_name) do update
    set field_value = excluded.field_value, last_updated = excluded.last_updated;
  select field_value into v_val from public.dynamic_field_values where field_name = 'smoke_opt002_nullfield';
  if v_val is not null then
    raise exception 'SMOKE FAIL: putDynamicField did not store NULL field_value';
  end if;
end $$;

-- ── Assertion 3 — assembleDynamicLayer2(): the fresh-read SELECT with `field_name = any($1)` returns the
--    current rows, and a declared-but-absent field yields no row (adapter defaults it to null + epoch-0).
do $$
declare v_count int;
begin
  select count(*) into v_count
    from public.dynamic_field_values
   where field_name = any (array['smoke_opt002_field','smoke_opt002_nullfield','smoke_opt002_missing']);
  -- two of the three declared fields exist; the third ('missing') is absent by design.
  if v_count <> 2 then
    raise exception 'SMOKE FAIL: assembleDynamicLayer2 fresh-read expected 2 present rows, got %', v_count;
  end if;
end $$;

rollback;
-- Nothing persists. Expected result: all DO blocks pass silently, then ROLLBACK.
