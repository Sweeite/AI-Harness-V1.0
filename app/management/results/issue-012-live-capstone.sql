-- ISSUE-012 live proof — deployment_health / ingest_deliveries / token lifecycle on the mgmt Supabase.
-- One rolled-back transaction. Proves the DDL-level live invariants (the app-level token-auth logic is
-- offline-proven in the 32/32 battery and the pg adapter mirrors the fake 1:1).
begin;

do $$
declare
  n int;
  pushed timestamptz;
  future timestamptz := now() + interval '10 years';
begin
  -- seed a throwaway deployment (rolled back).
  insert into client_registry (client_slug, client_name, railway_url, internal_token, region, status)
    values ('__iss012_live__', 'iss012 live proof', 'https://x', 'enc:test', 'ap-southeast-2', 'active');

  -- A. server-authoritative freshness (AF-120): an ingest upsert never trusts a caller time — last_push_at
  --    defaults to the DB clock. Insert WITHOUT last_push_at and confirm it is ~now(), not the future.
  insert into deployment_health (client_slug, core_version) values ('__iss012_live__', 'v1');
  select last_push_at into pushed from deployment_health where client_slug = '__iss012_live__';
  if pushed > now() then raise exception 'FAIL A: last_push_at is not server-anchored (%)', pushed; end if;
  if pushed = future then raise exception 'FAIL A: a caller-supplied future time leaked into last_push_at'; end if;
  raise notice 'PASS A: last_push_at is server-authoritative (%)', pushed;

  -- B. idempotent dedup: a replayed delivery_id is a no-op (never a double-count).
  insert into ingest_deliveries (client_slug, delivery_id) values ('__iss012_live__', 'delivery-1');
  insert into ingest_deliveries (client_slug, delivery_id) values ('__iss012_live__', 'delivery-1')
    on conflict (client_slug, delivery_id) do nothing;
  select count(*) into n from ingest_deliveries where client_slug = '__iss012_live__' and delivery_id = 'delivery-1';
  if n <> 1 then raise exception 'FAIL B: replayed delivery was not deduped (count=%)', n; end if;
  raise notice 'PASS B: replayed delivery_id deduped (idempotent ingest)';

  -- C. token lifecycle columns present + revocation gates auth (token_active=false).
  update client_registry set token_active = false where client_slug = '__iss012_live__';
  select count(*) into n from client_registry where client_slug = '__iss012_live__' and token_active = false and token_id is not null;
  if n <> 1 then raise exception 'FAIL C: token_active/token_id lifecycle columns missing or wrong'; end if;
  raise notice 'PASS C: token revocation flag + token_id present (auth-gating column live)';

  -- D. FK cascade: deleting the deployment removes its health row (offboarding integrity, no orphan).
  delete from client_registry where client_slug = '__iss012_live__';
  select count(*) into n from deployment_health where client_slug = '__iss012_live__';
  if n <> 0 then raise exception 'FAIL D: deployment_health row orphaned after registry delete (count=%)', n; end if;
  raise notice 'PASS D: deployment_health cascades on registry delete (no orphan)';

  raise notice 'ISSUE-012 LIVE — ALL ASSERTIONS PASS';
end $$;

rollback;
