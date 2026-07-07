-- ISSUE-012 (FR-10.MGT.001/002, FR-7.MGM.001-005) — live-adapter hygiene smoke for
-- app/management/src/supabase-store.ts (R10 / live-adapter-hygiene-sweep.md).
--
-- WHAT THIS PROVES: replays the SupabaseManagementStore's REAL write SQL — verbatim column
-- lists + representative literals matching the live mgmt-plane DDL (app/management/migrations/
-- 0001_client_registry.sql + 0002_deployment_health.sql) — against the operator-owned mgmt
-- Supabase, and asserts the effect each method promises. Offline-green (the 32/32 in-memory
-- battery) proves the LOGIC; this proves the SQL actually binds to the real columns/enums.
--
-- CONNECTS AS: MGMT_DB_URL → role 'postgres' (rolbypassrls=t), the MANAGEMENT plane (NOT a
--   client silo, NOT service_role — OD-193). RLS is bypassed on this path; grants for postgres/
--   service_role/authenticated/anon are all full (verified live), so no grant assertion here.
--
-- Covers each adapter write path:
--   1. registerClient INSERT (8-col list, region coalesce default, status 'initialising')
--   2. transitionStatus CAS UPDATE (status = $2 ... where status = $3; offboarding/frozen stamps)
--   3. ingest — ingest_deliveries dedup (on conflict do nothing → rowCount tells replay) +
--      deployment_health upsert with per-column coalesce (omitted field preserves prior; the
--      log_write_failing #3 posture) + last_push_at server-authoritative (AF-120)
--   4. rotateToken UPDATE (internal_token/token_id/token_active)
--   5. revokeToken UPDATE (token_active=false)
--
-- One BEGIN ... ROLLBACK — nothing persists. Run by the orchestrator (writes stay serial):
--   /opt/homebrew/opt/libpq/bin/psql "$MGMT_DB_URL" -v ON_ERROR_STOP=1 -f app/management/results/live-smoke.sql
-- Expect: no FAIL raised, final "ROLLBACK" — a raise exception aborts the txn with the reason.

begin;

do $$
declare
  n            int;
  r            record;
  pushed       timestamptz;
  st           client_status;
  tok_active   boolean;
  tid1         uuid;
  tid2         uuid;
begin
  -- ── 1. registerClient INSERT (verbatim from supabase-store.ts:68-74) ───────────────────────
  --    region param NULL ⇒ coalesce falls to the DDL default 'ap-southeast-2'; status 'initialising'.
  insert into client_registry
      (client_slug, client_name, railway_url, internal_token, token_id, token_active, region, status)
    values ('__mgmt_smoke__', 'mgmt smoke client', 'https://rail.example',
            '{"ciphertext":"aa","iv":"bb","tag":"cc"}', gen_random_uuid(), true,
            coalesce(NULL, 'ap-southeast-2'), 'initialising')
    returning region, status, token_active into r;
  if r.region <> 'ap-southeast-2' then raise exception 'FAIL 1a: region coalesce default not applied (%)', r.region; end if;
  if r.status <> 'initialising' then raise exception 'FAIL 1b: status not initialising (%)', r.status; end if;
  if r.token_active is not true then raise exception 'FAIL 1c: token_active not true on register'; end if;

  -- duplicate client_slug must raise 23505 (unique_violation) → adapter maps to ERR_DUPLICATE_SLUG.
  begin
    insert into client_registry (client_slug, client_name, internal_token, token_id, region, status)
      values ('__mgmt_smoke__', 'dup', 'x', gen_random_uuid(), 'ap-southeast-2', 'initialising');
    raise exception 'FAIL 1d: duplicate client_slug did NOT raise unique_violation';
  exception when unique_violation then null; -- expected
  end;

  -- ── 2. transitionStatus CAS UPDATE (verbatim from supabase-store.ts:109-112) ───────────────
  --    initialising → active (allowed). CAS on the read status; stamps only for offboarding/frozen.
  update client_registry set status = 'active'::client_status
    where client_slug = '__mgmt_smoke__' and status = 'initialising'::client_status;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 2a: initialising→active CAS did not update exactly one row (%)', n; end if;

  -- active → offboarding stamps offboarding_initiated_at (adapter branch to === offboarding).
  update client_registry set status = 'offboarding'::client_status, offboarding_initiated_at = now()
    where client_slug = '__mgmt_smoke__' and status = 'active'::client_status;
  select offboarding_initiated_at is not null into tok_active from client_registry where client_slug='__mgmt_smoke__';
  if tok_active is not true then raise exception 'FAIL 2b: offboarding_initiated_at not stamped'; end if;

  -- CAS loser: an UPDATE whose read-status no longer matches must touch ZERO rows (rowCount 0 →
  -- adapter throws ERR_TRANSITION_CONFLICT rather than silently last-write-wins).
  update client_registry set status = 'active'::client_status
    where client_slug = '__mgmt_smoke__' and status = 'initialising'::client_status; -- stale expected-status
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 2c: stale-status CAS updated a row (should be 0) — lost-update hole'; end if;

  -- offboarding → frozen stamps offboarding_at.
  update client_registry set status = 'frozen'::client_status, offboarding_at = now()
    where client_slug = '__mgmt_smoke__' and status = 'offboarding'::client_status;
  select offboarding_at is not null into tok_active from client_registry where client_slug='__mgmt_smoke__';
  if tok_active is not true then raise exception 'FAIL 2d: offboarding_at not stamped on frozen'; end if;
  -- back to active so ingest/rotate/revoke run on a live client.
  update client_registry set status = 'active'::client_status
    where client_slug = '__mgmt_smoke__' and status = 'frozen'::client_status;

  -- ── 3a. ingest dedup ledger (verbatim from supabase-store.ts:167-170) ──────────────────────
  insert into ingest_deliveries (client_slug, delivery_id) values ('__mgmt_smoke__', 'dlv-1') on conflict do nothing;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 3a: first delivery insert should be fresh (rowCount 1), got %', n; end if;
  -- replay: same (client_slug, delivery_id) → PK conflict → 0 rows → adapter treats as replay (no re-count).
  insert into ingest_deliveries (client_slug, delivery_id) values ('__mgmt_smoke__', 'dlv-1') on conflict do nothing;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 3b: replayed delivery did NOT dedup (rowCount %), double-count risk', n; end if;

  -- ── 3b. deployment_health upsert — FIRST push writes a subset; omitted cols land NULL/default ──
  --    (verbatim col list + coalesce($12,false) for log_write_failing from supabase-store.ts:186-206)
  insert into deployment_health
      (client_slug, health_score, queue_depth, approval_queue_depth, alert_counts, core_version,
       last_migrated_at, connector_rollup, cost_to_date, plugin_version, backup_health, log_write_failing,
       last_push_at, updated_at)
    values ('__mgmt_smoke__', 0.9::numeric, 5, 2, '{"warn":3}'::jsonb, 'core-v1',
            now(), '{"gmail":"ok"}'::jsonb, 12.50::numeric, 'plg-v1', '{"last":"ok"}'::jsonb,
            coalesce(true, false), now(), now())
    on conflict (client_slug) do update set
      health_score        = coalesce(excluded.health_score, deployment_health.health_score),
      queue_depth         = coalesce(excluded.queue_depth, deployment_health.queue_depth),
      approval_queue_depth= coalesce(excluded.approval_queue_depth, deployment_health.approval_queue_depth),
      alert_counts        = coalesce(excluded.alert_counts, deployment_health.alert_counts),
      core_version        = coalesce(excluded.core_version, deployment_health.core_version),
      last_migrated_at    = coalesce(excluded.last_migrated_at, deployment_health.last_migrated_at),
      connector_rollup    = coalesce(excluded.connector_rollup, deployment_health.connector_rollup),
      cost_to_date        = coalesce(excluded.cost_to_date, deployment_health.cost_to_date),
      plugin_version      = coalesce(excluded.plugin_version, deployment_health.plugin_version),
      backup_health       = coalesce(excluded.backup_health, deployment_health.backup_health),
      log_write_failing   = coalesce(true, deployment_health.log_write_failing),
      last_push_at        = now(),
      updated_at          = now();
  select health_score, log_write_failing, last_push_at into r from deployment_health where client_slug='__mgmt_smoke__';
  if r.health_score <> 0.9 then raise exception 'FAIL 3c: first-push health_score not written (%)', r.health_score; end if;
  if r.log_write_failing is not true then raise exception 'FAIL 3d: log_write_failing not written true'; end if;
  -- AF-120: last_push_at is DB-clock (now()), never a caller-supplied future.
  if r.last_push_at > now() then raise exception 'FAIL 3e: last_push_at not server-anchored (%)', r.last_push_at; end if;
  pushed := r.last_push_at;

  -- ── 3c. SECOND push OMITS health_score, alert_counts, log_write_failing → coalesce MUST preserve ──
  --    prior values ($n bound NULL for omitted; $12 NULL ⇒ coalesce($12, prior) keeps prior true).
  --    This is the #1/#3 anti-clobber guarantee: an omitted field is NOT read as "cleared".
  insert into deployment_health
      (client_slug, health_score, queue_depth, approval_queue_depth, alert_counts, core_version,
       last_migrated_at, connector_rollup, cost_to_date, plugin_version, backup_health, log_write_failing,
       last_push_at, updated_at)
    values ('__mgmt_smoke__', NULL, 7, NULL, NULL, 'core-v2',
            NULL, NULL, NULL, NULL, NULL, coalesce(NULL, false), now(), now())
    on conflict (client_slug) do update set
      health_score        = coalesce(excluded.health_score, deployment_health.health_score),
      queue_depth         = coalesce(excluded.queue_depth, deployment_health.queue_depth),
      approval_queue_depth= coalesce(excluded.approval_queue_depth, deployment_health.approval_queue_depth),
      alert_counts        = coalesce(excluded.alert_counts, deployment_health.alert_counts),
      core_version        = coalesce(excluded.core_version, deployment_health.core_version),
      last_migrated_at    = coalesce(excluded.last_migrated_at, deployment_health.last_migrated_at),
      connector_rollup    = coalesce(excluded.connector_rollup, deployment_health.connector_rollup),
      cost_to_date        = coalesce(excluded.cost_to_date, deployment_health.cost_to_date),
      plugin_version      = coalesce(excluded.plugin_version, deployment_health.plugin_version),
      backup_health       = coalesce(excluded.backup_health, deployment_health.backup_health),
      log_write_failing   = coalesce(NULL, deployment_health.log_write_failing),
      last_push_at        = now(),
      updated_at          = now();
  select health_score, queue_depth, core_version, alert_counts, log_write_failing
    into r from deployment_health where client_slug='__mgmt_smoke__';
  if r.health_score <> 0.9 then raise exception 'FAIL 3f: omitted health_score clobbered (%) — coalesce broken', r.health_score; end if;
  if r.alert_counts is null then raise exception 'FAIL 3g: omitted alert_counts clobbered to NULL — coalesce broken'; end if;
  if r.log_write_failing is not true then raise exception 'FAIL 3h: omitted log_write_failing cleared — #3 silent-failure hole'; end if;
  if r.queue_depth <> 7 then raise exception 'FAIL 3i: provided queue_depth not updated (%)', r.queue_depth; end if;
  if r.core_version <> 'core-v2' then raise exception 'FAIL 3j: provided core_version not updated (%)', r.core_version; end if;

  -- ── 4. rotateToken UPDATE (verbatim from supabase-store.ts:142-145) ────────────────────────
  select token_id into tid1 from client_registry where client_slug='__mgmt_smoke__';
  update client_registry
    set internal_token = '{"ciphertext":"dd","iv":"ee","tag":"ff"}', token_id = gen_random_uuid(), token_active = true
    where client_slug = '__mgmt_smoke__';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 4a: rotate did not update the row (%)', n; end if;
  select token_id, token_active into tid2, tok_active from client_registry where client_slug='__mgmt_smoke__';
  if tid2 = tid1 then raise exception 'FAIL 4b: token_id not rotated'; end if;
  if tok_active is not true then raise exception 'FAIL 4c: token_active not true after rotate'; end if;

  -- ── 5. revokeToken UPDATE (verbatim from supabase-store.ts:155) ────────────────────────────
  update client_registry set token_active = false where client_slug = '__mgmt_smoke__';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 5a: revoke did not update the row (%)', n; end if;
  select token_active into tok_active from client_registry where client_slug='__mgmt_smoke__';
  if tok_active is not false then raise exception 'FAIL 5b: token_active not false after revoke — revoked token could still authenticate'; end if;
  -- revoke of a non-existent slug → rowCount 0 → adapter throws ERR_NO_SUCH_CLIENT (not a silent no-op).
  update client_registry set token_active = false where client_slug = '__mgmt_smoke__nope__';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 5c: revoke of unknown slug touched a row (%)', n; end if;

  raise notice 'mgmt live-smoke: ALL CHECKS PASSED (rolled back)';
end $$;

rollback;
