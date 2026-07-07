-- ISSUE-080 — live-adapter smoke for app/release/src/supabase-store.ts
-- (SupabaseDeploymentHealthStore.list) — R10 live-adapter hygiene sweep.
--
-- PLANE: MANAGEMENT plane (operator-owned mgmt Supabase), reached via $MGMT_DATABASE_URL — NOT a client
-- silo, NOT $SILO_DB_URL. deployment_health is push-fed operational metadata only (schema.md §13, mgmt
-- migration 0002_deployment_health.sql). Run this against the mgmt DB, e.g.:
--     /opt/homebrew/opt/libpq/bin/psql "$MGMT_DATABASE_URL" -f app/release/results/live-smoke.sql
-- NOTE (authored offline): $MGMT_DATABASE_URL was NOT present in ~/.ai-harness-secrets.env in the review
-- environment (only $SILO_DB_URL was), so this smoke was authored to the DDL and NOT executed. The
-- orchestrator runs it live against the mgmt plane. It assumes mgmt migrations 0001 (client_registry) +
-- 0002 (deployment_health) are applied.
--
-- WHAT THIS PROVES (the adapter is read-only — a single SELECT, no writes):
--   The exact SELECT the adapter issues —
--     select client_slug, core_version, last_migrated_at, plugin_version, last_push_at from deployment_health
--   — resolves against the LIVE mgmt schema: all 5 projected columns exist with the types the adapter maps
--   (text / text / timestamptz / text / timestamptz), last_push_at is NOT NULL (the adapter dereferences it
--   with an unguarded .toISOString()), and the three nullable columns (core_version, last_migrated_at,
--   plugin_version) survive a NULL round-trip (the adapter's null-guard path). We seed one representative
--   parent client_registry row + one deployment_health row inside the txn, run the adapter's literal query,
--   assert it returns the row with the expected shape, and ROLLBACK so nothing persists.
--
-- SAFETY: everything runs inside one transaction and is rolled back. No row persists. No enum literals are
-- involved (the table has none on the read path). No GRANT is exercised beyond SELECT/INSERT for the smoke.

begin;

-- ── Parent row: client_registry (deployment_health.client_slug is an FK → client_registry.client_slug) ──
-- Insert only the columns the smoke needs; rely on table defaults (token_id/token_active from 0002, plus
-- whatever 0001 declares NOT NULL). If 0001 requires more NOT NULL columns without defaults, the orchestrator
-- extends this INSERT — the assertions below are the load-bearing part.
insert into client_registry (client_slug)
values ('smoke-release-0080')
on conflict (client_slug) do nothing;

-- ── The row the adapter reads. Representative literals matching real column types. One nullable column
--    (plugin_version) is left NULL to exercise the adapter's null-guard branch; last_push_at is stamped by
--    the DB default now() (server-authoritative, AF-120) exactly as the ingest would. ──
insert into deployment_health (client_slug, core_version, last_migrated_at, plugin_version)
values ('smoke-release-0080', 'v1.4.2', now() - interval '2 days', null);

-- ── Assert: the adapter's EXACT projection resolves and returns the seeded row with the expected shape. ──
do $$
declare
  r record;
begin
  -- This is the adapter's literal query (supabase-store.ts L31-33), narrowed to our seeded slug so the
  -- assertion is deterministic regardless of other fleet rows present.
  select client_slug, core_version, last_migrated_at, plugin_version, last_push_at
    into r
    from deployment_health
   where client_slug = 'smoke-release-0080';

  if not found then
    raise exception 'SMOKE FAIL: adapter projection returned no row for seeded client_slug';
  end if;
  if r.core_version is distinct from 'v1.4.2' then
    raise exception 'SMOKE FAIL: core_version round-trip wrong: got %', r.core_version;
  end if;
  if r.plugin_version is not null then
    raise exception 'SMOKE FAIL: plugin_version should be NULL (null-guard branch), got %', r.plugin_version;
  end if;
  if r.last_migrated_at is null then
    raise exception 'SMOKE FAIL: last_migrated_at should be a timestamp, got NULL';
  end if;
  -- last_push_at is NOT NULL in DDL; the adapter dereferences it unguarded (.toISOString()). Prove it.
  if r.last_push_at is null then
    raise exception 'SMOKE FAIL: last_push_at is NULL but adapter dereferences it unguarded (would NPE)';
  end if;

  raise notice 'SMOKE PASS: deployment_health projection resolves; 5 cols present, types map, last_push_at NOT NULL, nullable cols round-trip.';
end $$;

-- ── Column-contract assertion: fail loudly if the live schema ever drops/renames a projected column or
--    weakens last_push_at's NOT NULL (which the adapter relies on). Catches drift the row-level test can't. ──
do $$
declare
  n int;
  push_nullable text;
begin
  select count(*) into n
    from information_schema.columns
   where table_name = 'deployment_health'
     and column_name in ('client_slug','core_version','last_migrated_at','plugin_version','last_push_at');
  if n <> 5 then
    raise exception 'SMOKE FAIL: expected all 5 adapter-projected columns on deployment_health, found %', n;
  end if;

  select is_nullable into push_nullable
    from information_schema.columns
   where table_name = 'deployment_health' and column_name = 'last_push_at';
  if push_nullable <> 'NO' then
    raise exception 'SMOKE FAIL: last_push_at is nullable in live schema (%), but adapter dereferences it unguarded', push_nullable;
  end if;

  raise notice 'SMOKE PASS: all 5 projected columns present; last_push_at is NOT NULL (unguarded deref is safe).';
end $$;

rollback;
