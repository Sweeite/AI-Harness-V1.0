-- ISSUE-033 token-lifecycle — LIVE-SMOKE for the pg adapter's ACTUAL write path.
-- Target DB: SILO  (run: psql "$SILO_DB_URL" -f this).  NON-MUTATING — wrapped in begin;...rollback;.
--
-- WHY: app/token-lifecycle/src/supabase-store.ts is the only live-infra seam and has NEVER run live
-- (see its header: "⚠️ NOT YET RUN LIVE"). Its in-memory reference model passes offline; this script
-- REPLAYS the adapter's exact SQL against the real DDL so any column/enum/constraint/guard drift throws
-- HERE (the fake-passes-offline / live-adapter-throws class that has produced every BLOCKER in this build).
--
-- Each statement below is copied from the adapter, same tables/columns/enum values/guarded WHERE clauses:
--   getCredential            -> select ... where connector=$1 order by updated_at desc limit 1
--   rotatePersist (PERSIST)  -> update ... set access/refresh/expires/scopes, state='active'
--                                 where id = (newest per connector) and refresh_token is not distinct from $expected
--   rotatePersist (STALE)    -> same UPDATE with a WRONG $expected  ->  MUST match 0 rows (guard holds)
--   setState                 -> update ... set state=$2 where id = (newest per connector)
--   dueForProactiveRefresh   -> select ... where state='active' and expires_at is not null and expires_at <= $1
--
-- DDL cited: app/silo/migrations/0001_baseline.sql
--   L45  create type credential_state as enum ('active','degraded','revoked','expired');
--   L323 create table connector_credentials (id uuid pk, connector text not null, access_token text not null,
--        refresh_token text, expires_at timestamptz, scopes text[], state credential_state not null default 'active',
--        created_at timestamptz not null default now(), updated_at timestamptz not null default now());
-- No enforcement trigger exists on connector_credentials (it is a mutable table — 0008 triggers cover
-- tools/idempotency_ledger only), so the ONLY "guarded reject" here is the optimistic-concurrency
-- predicate (a stale UPDATE matching 0 rows), asserted below.
\set ON_ERROR_STOP on
begin;

do $$
declare
  v_conn        text := '__tok_smoke__';        -- isolated test connector, rolled back
  v_id          uuid;
  v_updated     int;
  v_rowcount    int;
  v_state       text;
  v_access      text;
  v_refresh     text;
begin
  -- ── FIXTURE: seed a live credential the way an OAuth grant / ISSUE-032 storage would (FR-3.TOK.001).
  -- Rotating-connector shape (GHL): a non-null refresh_token, an expiry, scopes[]. state defaults 'active'.
  insert into connector_credentials (connector, access_token, refresh_token, expires_at, scopes, state)
    values (v_conn, 'acc-v1', 'ref-v1', now() + interval '10 minutes', array['crm.read','crm.write']::text[], 'active')
    returning id into v_id;
  raise notice 'PASS fixture: seeded connector_credentials row % (state=active, refresh=ref-v1)', v_id;

  -- ── ASSERT 1: getCredential(connector) — newest row select the adapter runs at read time. ──────────
  begin
    select access_token into v_access
      from connector_credentials
     where connector = v_conn order by updated_at desc limit 1;
    if v_access is distinct from 'acc-v1' then
      raise exception 'FAIL 1: getCredential returned access_token=% (expected acc-v1)', v_access;
    end if;
    raise notice 'PASS 1: getCredential newest-row select works (access_token=acc-v1)';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise exception 'FAIL 1: getCredential select threw -> %', sqlerrm;
  end;

  -- ── ASSERT 2: rotatePersist PERSIST arm — the guarded atomic UPDATE with the CORRECT expected token.
  -- Mirrors the adapter: set access/refresh/expires/scopes, state='active', updated_at=now(),
  -- where id = (newest per connector) and refresh_token is not distinct from $expected('ref-v1').
  begin
    update connector_credentials c
        set access_token = 'acc-v2',
            refresh_token = 'ref-v2',
            expires_at    = (now() + interval '24 hours'),
            scopes        = array['crm.read','crm.write','contacts.read']::text[],
            state         = 'active',
            updated_at    = now()
      where c.id = (
            select id from connector_credentials
             where connector = v_conn order by updated_at desc limit 1)
        and c.refresh_token is not distinct from 'ref-v1';
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception 'FAIL 2: rotatePersist(correct expected) updated % rows (expected exactly 1)', v_updated;
    end if;
    -- confirm the atomic all-in-one write actually landed
    select access_token, refresh_token, state into v_access, v_refresh, v_state
      from connector_credentials where id = v_id;
    if v_access <> 'acc-v2' or v_refresh <> 'ref-v2' or v_state <> 'active' then
      raise exception 'FAIL 2: rotatePersist wrote access=%/refresh=%/state=% (expected acc-v2/ref-v2/active)',
        v_access, v_refresh, v_state;
    end if;
    raise notice 'PASS 2: rotatePersist PERSIST arm — atomic guarded UPDATE applied (1 row, acc-v2/ref-v2/active)';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise exception 'FAIL 2: rotatePersist PERSIST UPDATE threw -> %', sqlerrm;
  end;

  -- ── ASSERT 3: rotatePersist STALE arm — the optimistic-concurrency GUARD must REJECT (match 0 rows)
  -- when the expected refresh token no longer matches the live row (a concurrent flight rotated past us).
  -- The row now carries 'ref-v2'; replay with the OLD expected 'ref-v1' -> must update 0 rows -> `stale`.
  begin
    update connector_credentials c
        set access_token = 'acc-LOSER',
            refresh_token = 'ref-LOSER',
            expires_at    = (now() + interval '24 hours'),
            scopes        = array['crm.read']::text[],
            state         = 'active',
            updated_at    = now()
      where c.id = (
            select id from connector_credentials
             where connector = v_conn order by updated_at desc limit 1)
        and c.refresh_token is not distinct from 'ref-v1';   -- STALE expected token
    get diagnostics v_updated = row_count;
    if v_updated <> 0 then
      raise exception 'FAIL 3: STALE rotatePersist updated % rows (guard should have matched 0) — a lost race would CLOBBER the winner (#1)', v_updated;
    end if;
    -- and prove the winner's row was NOT clobbered
    select access_token, refresh_token into v_access, v_refresh
      from connector_credentials where id = v_id;
    if v_access <> 'acc-v2' or v_refresh <> 'ref-v2' then
      raise exception 'FAIL 3: winner row was mutated by the stale flight (access=%/refresh=%)', v_access, v_refresh;
    end if;
    raise notice 'PASS 3: rotatePersist STALE arm — guard rejected (0 rows), winner ref-v2 intact (#1 upheld)';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise exception 'FAIL 3: STALE rotatePersist replay threw -> %', sqlerrm;
  end;

  -- ── ASSERT 3b: is-not-distinct-from NULL semantics — a first-ever refresh (no prior refresh_token).
  -- Seed a NULL-refresh row and replay rotatePersist with expected=NULL: the guard must MATCH (NULL≡NULL).
  declare v_id2 uuid;
  begin
    insert into connector_credentials (connector, access_token, refresh_token, expires_at, scopes, state)
      values ('__tok_smoke_null__', 'acc-n1', null, now() + interval '10 minutes', null, 'active')
      returning id into v_id2;
    update connector_credentials c
        set access_token = 'acc-n2', refresh_token = 'ref-n2', expires_at = now() + interval '1 hour',
            scopes = null, state = 'active', updated_at = now()
      where c.id = (select id from connector_credentials
                     where connector = '__tok_smoke_null__' order by updated_at desc limit 1)
        and c.refresh_token is not distinct from null;   -- NULL expected must match a NULL stored token
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception 'FAIL 3b: rotatePersist(expected NULL) updated % rows (is-not-distinct-from NULL should match) — a no-prior-token connector could never rotate', v_updated;
    end if;
    raise notice 'PASS 3b: rotatePersist guard matches NULL≡NULL (first-ever refresh path)';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise exception 'FAIL 3b: NULL-guard replay threw -> %', sqlerrm;
  end;

  -- ── ASSERT 4: setState — Layer-3 loud degrade UPDATE. Enum value 'degraded' must be valid in the DDL.
  begin
    update connector_credentials
        set state = 'degraded', updated_at = now()
      where id = (select id from connector_credentials
                   where connector = v_conn order by updated_at desc limit 1);
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception 'FAIL 4: setState updated % rows (expected 1)', v_updated;
    end if;
    select state into v_state from connector_credentials where id = v_id;
    if v_state <> 'degraded' then
      raise exception 'FAIL 4: setState left state=% (expected degraded)', v_state;
    end if;
    raise notice 'PASS 4: setState — state=degraded enum value accepted + written (Layer-3 loud degrade)';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise exception 'FAIL 4: setState UPDATE threw -> %', sqlerrm;
  end;

  -- ── ASSERT 4b: every credential_state enum value the adapter can write is accepted by the DDL. ──────
  -- setState accepts any CredentialState; prove the full enum domain {active,degraded,revoked,expired}.
  begin
    update connector_credentials set state = 'revoked', updated_at = now() where id = v_id;
    update connector_credentials set state = 'expired', updated_at = now() where id = v_id;
    update connector_credentials set state = 'active',  updated_at = now() where id = v_id;
    raise notice 'PASS 4b: full credential_state enum {active,degraded,revoked,expired} all accepted';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise exception 'FAIL 4b: a credential_state enum value was rejected by the DDL -> %', sqlerrm;
  end;

  -- ── ASSERT 5: dueForProactiveRefresh — Layer-1 select. state='active' + expires_at not null +
  -- expires_at <= (now + lead). Our v_conn row (active, expires in ~10min) must appear for a 15-min lead;
  -- a NULL-expiry row (Slack xoxb) must be EXCLUDED even though active.
  begin
    -- put v_conn back to active + near-expiry (last enum test left it active; ensure a soon expiry)
    update connector_credentials set state='active', expires_at = now() + interval '5 minutes' where id = v_id;
    -- a non-expiring active credential that MUST be skipped by the `expires_at is not null` predicate
    insert into connector_credentials (connector, access_token, refresh_token, expires_at, scopes, state)
      values ('__tok_smoke_xoxb__', 'xoxb-acc', null, null, null, 'active');
    select count(*) into v_rowcount
      from connector_credentials
     where state = 'active' and expires_at is not null
       and expires_at <= (now() + interval '15 minutes')
       and connector like '__tok_smoke%';
    if v_rowcount < 1 then
      raise exception 'FAIL 5: dueForProactiveRefresh found % rows (expected the near-expiry active row)', v_rowcount;
    end if;
    -- prove the NULL-expiry row is NOT selected
    perform 1 from connector_credentials
      where state='active' and expires_at is not null and expires_at <= (now() + interval '15 minutes')
        and connector = '__tok_smoke_xoxb__';
    if found then
      raise exception 'FAIL 5: non-expiring (NULL expires_at) credential was returned as due — Slack xoxb should be skipped (AC-3.TOK.002.2)';
    end if;
    raise notice 'PASS 5: dueForProactiveRefresh — near-expiry active selected, NULL-expiry (xoxb) excluded';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise exception 'FAIL 5: dueForProactiveRefresh select threw -> %', sqlerrm;
  end;

  raise notice 'ALL ASSERTIONS PASS';
end $$;

rollback;
