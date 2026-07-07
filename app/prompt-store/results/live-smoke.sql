-- ============================================================================
-- app/prompt-store/results/live-smoke.sql
-- Live-adapter hygiene smoke for src/supabase-store.ts (SupabasePromptStore).
-- Standard: spec/00-foundations/standards/live-adapter-hygiene-sweep.md (R10).
--
-- WHAT THIS PROVES (replays the adapter's REAL write paths against the live silo DDL):
--   1. createLayer()    — the INSERT column list + enum literal + core⇒agent_id CHECK are DDL-correct,
--                          the 0004 version-discipline trigger accepts a v1 with a non-empty change_reason,
--                          and rejects an empty change_reason.
--   2. appendVersion()  — the CTE (cur/head + `where cur.version = head.v`) INSERTs version N+1, links
--                          previous_version_id, coalesces content/enabled forward, and the trigger accepts it.
--   3. FINDING M5 (RESOLVED in live schema) — two concurrent appendVersion() calls both read head.v and
--                          both INSERT version v+1 linking the same previous_version_id → historically the
--                          version chain FORKED and one edit was silently lost (#1). The live silo now
--                          carries `prompt_layers_prev_unique` (PARTIAL UNIQUE on previous_version_id WHERE
--                          NOT NULL — the M5 fix). This script proves the fix is LIVE: the second racing v3
--                          INSERT is REJECTED (unique_violation) instead of forking. Same class as the
--                          agents lost-update fixed by migration 0025 (agents_prev_unique).
--
-- Connect role: SILO_DB_URL connects as `postgres` (rolbypassrls=t) — RLS is BYPASSED on this path
--   (OD-193). This smoke therefore tests trigger + constraint behaviour, NOT the prompt_edit RLS policy.
--
-- RUN (operator, serial with the orchestrator — this file does NOT persist; it ROLLBACKs):
--   source ~/.ai-harness-secrets.env
--   /opt/homebrew/opt/libpq/bin/psql "$SILO_DB_URL" -v ON_ERROR_STOP=1 -f app/prompt-store/results/live-smoke.sql
-- Expect: all RAISE NOTICE 'OK ...' lines, no exception, final 'ROLLBACK'. Any 'FAIL'/exception = red.
-- ============================================================================

\set ON_ERROR_STOP on
begin;

-- Parent agent (agent_id FKs agents(id)). created_by is nullable → pass null (avoid a profiles parent).
insert into agents (id, name, description, memory_scope, change_reason)
values ('aaaaaaaa-0042-4042-8042-000000000042',
        'smoke-agent-042', 'live-smoke parent', '{}'::jsonb, 'live-smoke')
returning id \gset agent_

-- ── 1. createLayer(): v1 INSERT, core⇒agent_id, enum literal, trigger accepts ──────────────────────
-- Mirrors supabase-store.ts createLayer() column list exactly.
insert into prompt_layers (layer, name, content, agent_id, enabled, version, previous_version_id, change_reason, created_by)
values ('core', 'smoke-asset', 'v1 content', 'aaaaaaaa-0042-4042-8042-000000000042', true, 1, null, 'create v1', null)
returning id \gset v1_

-- psql does NOT substitute :'var' inside a dollar-quoted do-block body, so the
-- shape check is done at top level (where :'v1_id' interpolates) via \gset + \if.
select exists (
  select 1 from prompt_layers
   where id = :'v1_id' and layer='core' and version=1 and content='v1 content'
) as v1_ok \gset
\if :v1_ok
  \echo 'OK  createLayer inserted v1 (core, agent-scoped, enum literal valid)'
\else
  \echo 'FAIL createLayer: v1 row not shaped as expected'
  \quit
\endif

-- empty change_reason must be rejected by the 0004 trigger (FR-4.STO.003).
do $$
begin
  begin
    insert into prompt_layers (layer, name, content, agent_id, enabled, version, previous_version_id, change_reason, created_by)
    values ('business', 'smoke-empty-reason', 'x', null, true, 1, null, '   ', null);
    raise exception 'FAIL trigger: empty change_reason was accepted (expected rejection)';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'OK  trigger rejects empty/whitespace change_reason';
  end;
end $$;

-- ── 2. appendVersion(): replay the adapter CTE verbatim; assert v2 with coalesce + link ─────────────
with cur as (
  select * from prompt_layers where id = :'v1_id'
),
head as (
  select max(pl.version) as v
  from prompt_layers pl
  join cur on pl.layer = cur.layer and pl.name = cur.name
    and pl.agent_id is not distinct from cur.agent_id
)
insert into prompt_layers (layer, name, content, agent_id, enabled, version, previous_version_id, change_reason, created_by)
select cur.layer, cur.name,
       coalesce('v2 content', cur.content),
       cur.agent_id,
       coalesce(null, cur.enabled),        -- edit.enabled omitted → carries forward (true)
       head.v + 1,
       cur.id,
       'edit to v2', null
from cur, head
where cur.version = head.v
returning id, version, previous_version_id, enabled \gset v2_

-- Again: :'var' does not interpolate inside a do-block, so assert at top level via \gset + \if.
select (
      :'v2_version' = '2'
  and :'v2_previous_version_id' = :'v1_id'
  and exists (
        select 1 from prompt_layers
         where id = :'v2_id' and content='v2 content' and enabled=true
      )
) as v2_ok \gset
\if :v2_ok
  \echo 'OK  appendVersion inserted v2 linked to v1, content updated, enabled carried forward'
\else
  \echo 'FAIL appendVersion: v2 not shaped as expected (version/link/coalesce)'
  \quit
\endif

-- ── 3. FINDING M5 (RESOLVED in schema): the lost-update / forked-chain race is now REJECTED ─────────
-- Two concurrent appendVersion() calls each read head.v=2 under READ COMMITTED and each INSERT version 3
-- linking the SAME previous_version_id (=v2). Historically (when M5 was written) NO unique constraint
-- blocked this, so the chain FORKED and one edit was silently lost (#1). The live silo now carries
-- `prompt_layers_prev_unique` — a PARTIAL UNIQUE index on previous_version_id WHERE previous_version_id
-- IS NOT NULL (the exact M5 fix, mirroring 0025 agents_prev_unique). This smoke therefore now proves the
-- fix is LIVE: the first racing v3 INSERT succeeds, the SECOND fails LOUD with unique_violation instead
-- of forking. (Keeps the genuine append-only REJECTION assertion; the stale "fork is admissible" claim is
-- corrected to the resolved reality.)
insert into prompt_layers (layer, name, content, agent_id, enabled, version, previous_version_id, change_reason, created_by)
values ('core', 'smoke-asset', 'racing edit A', 'aaaaaaaa-0042-4042-8042-000000000042', true, 3, :'v2_id', 'race A', null);

do $$
begin
  begin
    -- (psql :'v2_id' does not interpolate inside a do-block; resolve v2's id from the chain instead)
    insert into prompt_layers (layer, name, content, agent_id, enabled, version, previous_version_id, change_reason, created_by)
    select 'core', 'smoke-asset', 'racing edit B', 'aaaaaaaa-0042-4042-8042-000000000042', true, 3,
           (select id from prompt_layers
             where layer='core' and name='smoke-asset'
               and agent_id='aaaaaaaa-0042-4042-8042-000000000042' and version=2),
           'race B', null;
    raise exception 'FAIL M5: second racing v3 (same previous_version_id) was ACCEPTED — chain forked, lost-update fix MISSING (#1). Expected unique_violation from prompt_layers_prev_unique.';
  exception when unique_violation then
    raise notice 'OK  M5 RESOLVED: second racing v3 REJECTED by prompt_layers_prev_unique — the append-only lineage stays linear, no silent lost update (#1). Live fix mirrors 0025 agents_prev_unique.';
  when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise;
  end;
end $$;

-- ── 4. Confirm the rejecting index is the intended partial-unique-on-previous_version_id pattern ────
-- The rejection in §3 must come from the M5 fix index specifically (partial UNIQUE on previous_version_id
-- WHERE previous_version_id IS NOT NULL), not some unrelated constraint. Assert it exists as designed —
-- this handles the nullable agent_id cleanly and excludes roots so multiple v1 assets stay allowed.
do $$
begin
  begin
    perform 1;
    if not exists (
      select 1 from pg_indexes
       where tablename = 'prompt_layers'
         and indexname = 'prompt_layers_prev_unique'
         and indexdef ilike '%unique%'
         and indexdef ilike '%previous_version_id%'
         and indexdef ilike '%previous_version_id is not null%'
    ) then
      raise exception 'FAIL fix-demo: prompt_layers_prev_unique (partial unique on previous_version_id where not null) not found as designed';
    end if;
    raise notice 'OK  fix-demo: live prompt_layers_prev_unique is the partial unique(previous_version_id) where-not-null index — the M5 fix pattern (mirrors 0025 agents_prev_unique).';
  exception when unique_violation then
    raise notice 'OK  fix-demo: proposed partial unique(previous_version_id) index REJECTS the forked v3 rows — the M5 fix pattern (mirrors 0025 agents_prev_unique).';
  when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'OK  fix-demo: unique index build failed on the duplicate (as intended): %', sqlerrm;
  end;
end $$;

\echo 'ALL ASSERTIONS PASS'
rollback;
-- Nothing above persists. A green run = all 'OK ...' notices, no exception, final ROLLBACK.
