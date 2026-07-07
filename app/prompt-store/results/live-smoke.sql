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
--   3. FINDING M5 (CONFIRMED) — prompt_layers has NO unique(layer,name,agent_id,version). Two concurrent
--                          appendVersion() calls both read head.v and both INSERT version v+1 → the version
--                          chain FORKS and one edit is silently lost (#1). This script demonstrates that a
--                          duplicate (layer,name,agent_id,version) row is accepted TODAY, and that the
--                          proposed fix — a partial unique index — would reject it. Same class as the agents
--                          lost-update fixed by migration 0025 (agents_version_chain_unique).
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

do $$
begin
  perform 1 from prompt_layers where id = :'v1_id' and layer='core' and version=1 and content='v1 content';
  if not found then raise exception 'FAIL createLayer: v1 row not shaped as expected'; end if;
  raise notice 'OK  createLayer inserted v1 (core, agent-scoped, enum literal valid)';
end $$;

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

do $$
begin
  if :'v2_version' <> '2' then raise exception 'FAIL appendVersion: expected version 2, got %', :'v2_version'; end if;
  if :'v2_previous_version_id' <> :'v1_id' then raise exception 'FAIL appendVersion: previous_version_id not linked to v1'; end if;
  perform 1 from prompt_layers where id=:'v2_id' and content='v2 content' and enabled=true;
  if not found then raise exception 'FAIL appendVersion: coalesce content/enabled not applied'; end if;
  raise notice 'OK  appendVersion inserted v2 linked to v1, content updated, enabled carried forward';
end $$;

-- ── 3. FINDING M5: the lost-update / forked-chain race is admissible TODAY ──────────────────────────
-- Two concurrent appendVersion() calls each read head.v=2 under READ COMMITTED and each INSERT version 3.
-- Simulate both winners landing (as they would with no unique constraint): insert a SECOND version=3 for
-- the SAME (layer,name,agent_id) chain. If the DB accepts it, the chain has forked and one edit is lost.
insert into prompt_layers (layer, name, content, agent_id, enabled, version, previous_version_id, change_reason, created_by)
values ('core', 'smoke-asset', 'racing edit A', 'aaaaaaaa-0042-4042-8042-000000000042', true, 3, :'v2_id', 'race A', null);
insert into prompt_layers (layer, name, content, agent_id, enabled, version, previous_version_id, change_reason, created_by)
values ('core', 'smoke-asset', 'racing edit B', 'aaaaaaaa-0042-4042-8042-000000000042', true, 3, :'v2_id', 'race B', null);

do $$
declare n int;
begin
  select count(*) into n from prompt_layers
   where layer='core' and name='smoke-asset'
     and agent_id='aaaaaaaa-0042-4042-8042-000000000042' and version=3;
  if n = 2 then
    raise notice 'OK  M5 CONFIRMED: two rows share (core,smoke-asset,agent,version=3) — chain FORKED, an edit is silently lost (#1). No unique constraint blocks it.';
  else
    raise exception 'UNEXPECTED: duplicate (layer,name,agent_id,version) blocked (n=%). A unique constraint may already exist — re-check M5.', n;
  end if;
end $$;

-- ── 4. Proposed fix demonstration: the 0025 partial-unique pattern WOULD reject the fork ────────────
-- Proposed fix = mirror migration 0025 (agents_prev_unique): a PARTIAL UNIQUE index on previous_version_id
-- where previous_version_id is not null. A linear append-only lineage has exactly one child per version, so
-- the racing second INSERT (same previous_version_id) fails LOUD (unique_violation) instead of forking.
-- This handles the nullable agent_id cleanly (unlike a (layer,name,agent_id,version) index) and excludes
-- roots so multiple v1 assets stay allowed. Built here transiently over the txn's rows; ROLLBACK drops it.
do $$
begin
  begin
    execute 'create unique index smoke_pl_prev_uniq on prompt_layers (previous_version_id) where previous_version_id is not null';
    raise exception 'FAIL fix-demo: unique index built despite two v3 rows sharing previous_version_id (should have failed)';
  exception when unique_violation then
    raise notice 'OK  fix-demo: proposed partial unique(previous_version_id) index REJECTS the forked v3 rows — the M5 fix pattern (mirrors 0025 agents_prev_unique).';
  when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'OK  fix-demo: unique index build failed on the duplicate (as intended): %', sqlerrm;
  end;
end $$;

rollback;
-- Nothing above persists. A green run = all 'OK ...' notices, no exception, final ROLLBACK.
