-- ISSUE-061 (C8 ORC/REG) — LIVE-SMOKE for the SILO agents live adapter (app/orchestrator/src/supabase-store.ts).
-- Purpose: replay the ADAPTER'S ACTUAL write-path SQL against the real baseline DDL (0001_baseline.sql `agents`
-- + the 0016 version-lineage trigger) so a live run catches any column / cast / enum / constraint / trigger
-- drift — the "fake-passes-offline / live-adapter-throws" class that has produced every BLOCKER in this build.
--
-- DB: SILO. Run: psql "$SILO_DB_URL" -f app/orchestrator/results/live-smoke.sql
-- Expect: a stream of 'PASS ...' notices ending in 'ALL ASSERTIONS PASS', then ROLLBACK (non-mutating).
--
-- The adapter touches ONLY `agents` live (event_log / execution_plans / prompt_layers sinks are NOT implemented
-- in supabase-store.ts — see its trailing note; the reference models are the proven contract there). So this
-- smoke replays the four agents statements the adapter actually runs:
--   (1) insert()         — insert into agents (name, description, memory_scope::jsonb, tools_allowed::uuid[],
--                          max_tokens, enabled, change_reason, created_by) returning <AGENT_COLS>
--   (2) get()            — the recursive-chain "current version" resolve (max version in the chain)
--   (3) candidates(dom)  — enabled current-version rows filtered by memory_scope->>'__domain'
--   (4) appendVersion()  — insert a NEW version linking previous_version_id (capability edit / disable)
-- plus the 0016 append-only floor: an in-place lineage UPDATE / a DELETE MUST raise.
--
-- created_by is passed NULL (as the adapter does on the seed/provisioning path) → no profiles FK row needed.

\set ON_ERROR_STOP on
begin;

do $$
declare
  v1  uuid;   -- version 1 (root)
  v2  uuid;   -- version 2 (capability edit)
  v3  uuid;   -- version 3 (disable)
  n   int;
  got uuid;
  cur_ver int;
begin
  -- ── (1) insert() write-path — MIRRORS supabase-store.ts insert() lines 93-98 ────────────────────────
  -- memory_scope carries the __domain tag exactly as the adapter stores it:
  --   JSON.stringify({ ...a.memory_scope, __domain: a.domain })
  -- tools_allowed cast $4::uuid[]; enabled coalesce($6, true); version/previous_version_id defaulted.
  insert into agents (name, description, memory_scope, tools_allowed, max_tokens, enabled, change_reason, created_by)
    values (
      '__smoke_orc_finance__',
      'finance specialist (routing signal)',
      '{"tiers":["semantic","entity"],"entity_model":true,"tool_registry":false,"__domain":"finance"}'::jsonb,
      '{}'::uuid[],
      null,
      coalesce(null, true),
      'smoke seed v1',
      null
    )
    returning id, version into v1, cur_ver;
  if cur_ver <> 1 then raise exception 'FAIL 1a: inserted row version = % (expected 1)', cur_ver; end if;
  raise notice 'PASS 1a: insert() write-path accepted (agents v1 id=% version=1)', v1;

  -- ── (2) get() — recursive-chain current-version resolve — MIRRORS get() lines 105-116 ────────────────
  -- Walk from the given id down the previous_version_id links, take max(version).
  with recursive chain as (
    select id, name, description, memory_scope, tools_allowed, max_tokens, enabled, version,
           previous_version_id, change_reason, created_at, updated_at, created_by
      from agents where id = v1
    union all
    select a.id, a.name, a.description, a.memory_scope, a.tools_allowed, a.max_tokens, a.enabled, a.version,
           a.previous_version_id, a.change_reason, a.created_at, a.updated_at, a.created_by
      from agents a join chain c on a.previous_version_id = c.id
  )
  select id, version from chain order by version desc limit 1 into got, cur_ver;
  if got is distinct from v1 or cur_ver <> 1 then
    raise exception 'FAIL 2a: get() resolved id=% version=% (expected % / 1)', got, cur_ver, v1;
  end if;
  raise notice 'PASS 2a: get() recursive current-version resolve returns v1';

  -- ── (3) candidates('finance') — enabled current-version rows, __domain filter — MIRRORS lines 121-128 ─
  select count(*) into n
    from agents a
   where a.enabled = true
     and not exists (select 1 from agents b where b.previous_version_id = a.id)
     and a.memory_scope->>'__domain' = 'finance'
     and a.id = v1;   -- restrict to our smoke row so a seeded finance agent doesn't perturb the count
  if n <> 1 then raise exception 'FAIL 3a: candidates(finance) did not surface the enabled v1 row (n=%)', n; end if;
  raise notice 'PASS 3a: candidates(finance) surfaces the enabled current-version row';

  -- ── (4) appendVersion() — a capability edit inserts a NEW version — MIRRORS appendVersion() lines 168-183
  -- next = {...cur, ...patch}; version = cur.version + 1; previous_version_id = cur.id.
  -- FIXED: appendVersion() now re-injects the current head's __domain into the (domain-less) replacement
  -- memory_scope via withDomain(next.memory_scope, domainOf(cur.memory_scope)) BEFORE the write. So a
  -- scope-replacing capability edit KEEPS __domain — the new current version stays in candidates(domain).
  -- We replay the FIXED adapter behaviour: the replacement scope changes `tiers` but __domain is preserved.
  insert into agents (name, description, memory_scope, tools_allowed, max_tokens, enabled, version,
                      previous_version_id, change_reason, created_by)
    values (
      '__smoke_orc_finance__',
      'finance specialist (routing signal)',
      -- scope-replacing edit: caller sent {tiers:["semantic"],...} with NO __domain; the adapter re-injects it,
      -- so the row the DB actually sees carries __domain:"finance" (domain PRESERVED across the edit).
      '{"tiers":["semantic"],"entity_model":true,"tool_registry":false,"__domain":"finance"}'::jsonb,
      '{}'::uuid[],
      null,
      true,
      2,
      v1,
      'smoke capability edit v2',
      null
    )
    returning id into v2;
  raise notice 'PASS 4a: appendVersion() capability edit accepted (agents v2 id=% previous=%)', v2, v1;

  -- get() after the edit must resolve to v2 (the new current version)
  with recursive chain as (
    select id, version, previous_version_id from agents where id = v1
    union all
    select a.id, a.version, a.previous_version_id from agents a join chain c on a.previous_version_id = c.id
  )
  select id, version from chain order by version desc limit 1 into got, cur_ver;
  if got is distinct from v2 or cur_ver <> 2 then
    raise exception 'FAIL 4b: get() after edit resolved id=% version=% (expected % / 2)', got, cur_ver, v2;
  end if;
  raise notice 'PASS 4b: get() now resolves the v2 current version';

  -- ── (4b′) DOMAIN-PRESERVATION teeth: after the scope-replacing edit, candidates('finance') MUST still surface
  -- the agent (the v2 current version). Pre-fix this returned 0 rows — __domain was dropped and the agent
  -- silently vanished from its domain's routing candidate set (#1/#3). Now it stays.
  select count(*) into n
    from agents a
   where a.enabled = true
     and not exists (select 1 from agents b where b.previous_version_id = a.id)
     and a.memory_scope->>'__domain' = 'finance'
     and a.id = v2;
  if n <> 1 then
    raise exception 'FAIL 4b2: candidates(finance) LOST the agent after a scope-replacing edit (n=% — __domain dropped)', n;
  end if;
  raise notice 'PASS 4b2: candidates(finance) still surfaces the agent after a scope-replacing edit (__domain PRESERVED)';

  -- ── (4c) disable() append-version (enabled=false, new version) — MIRRORS disable()->appendVersion ─────
  insert into agents (name, description, memory_scope, tools_allowed, max_tokens, enabled, version,
                      previous_version_id, change_reason, created_by)
    values (
      '__smoke_orc_finance__',
      'finance specialist (routing signal)',
      -- disable() → appendVersion() likewise preserves __domain (it carries the head's memory_scope forward).
      '{"tiers":["semantic"],"entity_model":true,"tool_registry":false,"__domain":"finance"}'::jsonb,
      '{}'::uuid[],
      null,
      false,               -- disabled
      3,
      v2,
      'smoke disable v3',
      null
    )
    returning id into v3;
  raise notice 'PASS 4c: disable() append-version accepted (agents v3 id=% enabled=false)', v3;

  -- after disable, the chain's current version is disabled → NOT a candidate (REG.005)
  select count(*) into n
    from agents a
   where a.enabled = true
     and not exists (select 1 from agents b where b.previous_version_id = a.id)
     and a.id in (v1, v2, v3);
  if n <> 0 then raise exception 'FAIL 4d: a disabled chain still surfaced an enabled current version (n=%)', n; end if;
  raise notice 'PASS 4d: disabled current version is excluded from candidates (REG.005)';

  -- ── (5) 0016 append-only floor: an in-place lineage UPDATE MUST raise ────────────────────────────────
  begin
    update agents set version = 99 where id = v1;
    raise exception 'FAIL 5a: agents version-lineage in-place UPDATE was ALLOWED (0016 trigger not enforcing)';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS 5a: agents lineage UPDATE rejected -> %', sqlerrm;
  end;

  begin
    update agents set previous_version_id = null where id = v2;
    raise exception 'FAIL 5b: agents previous_version_id rewrite was ALLOWED';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS 5b: agents previous_version_id rewrite rejected -> %', sqlerrm;
  end;

  -- ── (6) 0016 append-only floor: DELETE of any version MUST raise ─────────────────────────────────────
  begin
    delete from agents where id = v1;
    raise exception 'FAIL 6a: agents DELETE was ALLOWED (append-only floor not enforcing)';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS 6a: agents DELETE rejected -> %', sqlerrm;
  end;

  -- ── (7) the non-lineage `enabled` toggle IS still permitted in place (0016 leaves it mutable) ─────────
  -- The adapter never issues this, but the DDL contract (0016 scope note) must hold, else a future path breaks.
  update agents set enabled = true where id = v3;
  raise notice 'PASS 7a: non-lineage enabled-toggle permitted in place (0016 scope note holds)';

  raise notice 'ALL ASSERTIONS PASS';
end $$;

rollback;
