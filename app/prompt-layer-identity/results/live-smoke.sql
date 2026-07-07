-- ISSUE-043 — LIVE-ADAPTER SMOKE for app/prompt-layer-identity/src/supabase-store.ts
-- (SupabaseCorePromptStore, the pg adapter over the ISSUE-042 prompt_layers store).
--
-- WHAT THIS PROVES (against the real client-silo DDL, silo head 0025):
--   1. createCore's REAL INSERT (supabase-store.ts:64-69) inserts a version-1 'core' row with
--      previous_version_id=null and lands (columns + enum literal 'core' match the live table).
--   2. appendCoreVersion's REAL INSERT…SELECT-with-cur/head CTE (supabase-store.ts:79-94) appends
--      version 2 linked by previous_version_id, leaves the prior row byte-for-byte untouched, and
--      that a STALE target (cur.version <> head.v) returns 0 rows (the app throws on rowCount===0).
--   3. currentCoreForAgent / agentsWithCore read paths return the head row / distinct agent set.
--   4. The 0004 version-discipline trigger fires live: an empty change_reason is rejected on INSERT,
--      an in-place UPDATE of content is rejected, and a DELETE is rejected (append-only-by-version #1/#3).
--   5. FINDING F-1 (BLOCKER) — NO unique index on (agent_id,layer) or (agent_id,version): a SECOND
--      createCore for the same agent inserts a SECOND v1 root chain with NO DB error. The live adapter
--      (unlike the in-memory fake's headCore() guard, store.ts:109) does NOT prevent this.
--   6. FINDING F-2 (BLOCKER) — NO unique index on (agent_id,version): two version-2 rows for the same
--      agent coexist with NO DB error, so the appendCoreVersion CTE's "atomic increment / no
--      read-modify-write race" claim (supabase-store.ts:17-18,77-78) is UNENFORCED under concurrency —
--      two concurrent appends that both read head.v=N both insert version N+1 (lost update).
--
-- Connects as: SILO_DB_URL = 'postgres' owner (rolbypassrls=t) — RLS BYPASSED on this path (OD-193),
-- so this smoke exercises the version-discipline TRIGGER + constraint layer, not RLS.
--
-- SAFETY: everything runs inside ONE txn and ROLLBACKs at the end — nothing persists. Do NOT run it
-- concurrently with other live writes (the orchestrator runs it serially).

\set ON_ERROR_STOP on

begin;

-- ── Parent rows (created inside the txn; created_by left null so we skip the profiles→auth.users FK). ──
insert into public.agents (id, name, description, memory_scope, change_reason)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'smoke-agent-A', 'ISSUE-043 smoke', '{}'::jsonb, 'smoke');
insert into public.agents (id, name, description, memory_scope, change_reason)
values ('aaaaaaaa-0000-0000-0000-000000000002', 'smoke-agent-B', 'ISSUE-043 smoke', '{}'::jsonb, 'smoke');

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- 1. createCore — the REAL INSERT (supabase-store.ts:64-69), literals matching real column types.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
insert into public.prompt_layers
  (layer, name, content, agent_id, enabled, version, previous_version_id, change_reason, created_by)
values
  ('core', 'Layer 1 — agent A', 'v1 content', 'aaaaaaaa-0000-0000-0000-000000000001', true, 1, null, 'initial core', null)
returning id \gset core1_

do $$
declare n int; ver int; prev uuid;
begin
  select count(*), max(version), max(previous_version_id)
    into n, ver, prev
    from public.prompt_layers
   where layer='core' and agent_id='aaaaaaaa-0000-0000-0000-000000000001';
  if n <> 1 or ver <> 1 or prev is not null then
    raise exception 'createCore FAILED: expected 1 row v1 prev=null, got n=% ver=% prev=%', n, ver, prev;
  end if;
  raise notice 'PASS 1: createCore inserted v1 core, previous_version_id=null';
end $$;

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- 2. appendCoreVersion — the REAL INSERT…SELECT CTE (supabase-store.ts:79-94) against the head.
--    Replays the exact statement shape with :core1_id as the head target.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
with cur as (
  select * from public.prompt_layers where id = :'core1_id' and layer = 'core'
),
head as (
  select max(pl.version) as v
  from public.prompt_layers pl
  join cur on pl.layer = 'core' and pl.agent_id is not distinct from cur.agent_id
)
insert into public.prompt_layers
  (layer, name, content, agent_id, enabled, version, previous_version_id, change_reason, created_by)
select 'core', cur.name, 'v2 content', cur.agent_id, coalesce(null, cur.enabled), head.v + 1, cur.id, 'edit to v2', null
from cur, head
where cur.version = head.v
returning id \gset core2_

do $$
declare v2ver int; v2prev uuid; v1content text;
begin
  select version, previous_version_id into v2ver, v2prev
    from public.prompt_layers where id = (select id from public.prompt_layers
      where layer='core' and agent_id='aaaaaaaa-0000-0000-0000-000000000001' and version=2);
  if v2ver <> 2 then raise exception 'appendCoreVersion FAILED: v2 version=%', v2ver; end if;
  -- prior row untouched (append-only): v1 content is still exactly 'v1 content'
  select content into v1content from public.prompt_layers
    where layer='core' and agent_id='aaaaaaaa-0000-0000-0000-000000000001' and version=1;
  if v1content <> 'v1 content' then raise exception 'append MUTATED prior row: v1 content=%', v1content; end if;
  raise notice 'PASS 2: appendCoreVersion inserted v2 (prev links v1), v1 row untouched';
end $$;

-- ── 2b. STALE target: replay the CTE against the now-non-head v1 id → must insert 0 rows
--         (cur.version=1 <> head.v=2). The adapter throws when rowCount===0 (supabase-store.ts:95). ──
do $$
declare inserted int;
begin
  with cur as (
    select * from public.prompt_layers where id = ( select id from public.prompt_layers
        where layer='core' and agent_id='aaaaaaaa-0000-0000-0000-000000000001' and version=1 )
      and layer='core'
  ),
  head as (
    select max(pl.version) as v from public.prompt_layers pl
    join cur on pl.layer='core' and pl.agent_id is not distinct from cur.agent_id
  )
  insert into public.prompt_layers
    (layer, name, content, agent_id, enabled, version, previous_version_id, change_reason, created_by)
  select 'core', cur.name, 'stale', cur.agent_id, cur.enabled, head.v+1, cur.id, 'stale edit', null
  from cur, head where cur.version = head.v;
  get diagnostics inserted = row_count;
  if inserted <> 0 then raise exception 'STALE guard FAILED: expected 0 rows, inserted %', inserted; end if;
  raise notice 'PASS 2b: stale (non-head) edit target inserts 0 rows → adapter throws (correct)';
end $$;

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- 3. Read paths: currentCoreForAgent (head=v2) + agentsWithCore (distinct agent_ids).
-- ══════════════════════════════════════════════════════════════════════════════════════════════
do $$
declare head_ver int; agent_count int;
begin
  select version into head_ver from public.prompt_layers
    where layer='core' and agent_id='aaaaaaaa-0000-0000-0000-000000000001'
    order by version desc limit 1;                      -- currentCoreForAgent (supabase-store.ts:107-111)
  if head_ver <> 2 then raise exception 'currentCoreForAgent FAILED: head version=%', head_ver; end if;
  select count(*) into agent_count from (
    select distinct agent_id from public.prompt_layers where layer='core' and agent_id is not null
  ) s;                                                   -- agentsWithCore (supabase-store.ts:118-119)
  if agent_count < 1 then raise exception 'agentsWithCore FAILED: count=%', agent_count; end if;
  raise notice 'PASS 3: currentCoreForAgent head=v2; agentsWithCore returns % agent(s)', agent_count;
end $$;

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- 4. 0004 version-discipline trigger fires LIVE (append-only #1 / fail-loud #3).
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- 4a. empty change_reason rejected on INSERT
do $$
begin
  begin
    insert into public.prompt_layers (layer,name,content,agent_id,enabled,version,previous_version_id,change_reason,created_by)
    values ('core','x','x','aaaaaaaa-0000-0000-0000-000000000002',true,1,null,'   ',null);
    raise exception 'TRIGGER MISS: empty change_reason was accepted';
  exception when others then
    if sqlerrm like '%change_reason is mandatory%' then raise notice 'PASS 4a: empty change_reason rejected by trigger';
    else raise; end if;
  end;
end $$;

-- 4b. in-place UPDATE of content rejected
do $$
begin
  begin
    update public.prompt_layers set content='hacked'
      where layer='core' and agent_id='aaaaaaaa-0000-0000-0000-000000000001' and version=1;
    raise exception 'TRIGGER MISS: in-place content UPDATE was accepted';
  exception when others then
    if sqlerrm like '%in-place edit%' then raise notice 'PASS 4b: in-place content UPDATE rejected by trigger';
    else raise; end if;
  end;
end $$;

-- 4c. DELETE rejected
do $$
begin
  begin
    delete from public.prompt_layers where layer='core' and agent_id='aaaaaaaa-0000-0000-0000-000000000001' and version=1;
    raise exception 'TRIGGER MISS: DELETE was accepted';
  exception when others then
    if sqlerrm like '%DELETE forbidden%' then raise notice 'PASS 4c: DELETE rejected by trigger';
    else raise; end if;
  end;
end $$;

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- 5. FINDING F-1 (BLOCKER) — duplicate-core is NOT prevented at the DB.
--    The live adapter's createCore has no "agent already has a core" guard (the fake does, store.ts:109),
--    and there is NO unique index on (agent_id,layer). A second createCore INSERTs cleanly → two v1 roots.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
do $$
declare roots int;
begin
  -- Replay createCore a SECOND time for agent A (same statement shape as supabase-store.ts:64-69).
  insert into public.prompt_layers
    (layer,name,content,agent_id,enabled,version,previous_version_id,change_reason,created_by)
  values ('core','Layer 1 — agent A (dup)','v1 dup','aaaaaaaa-0000-0000-0000-000000000001',true,1,null,'dup core',null);
  select count(*) into roots from public.prompt_layers
    where layer='core' and agent_id='aaaaaaaa-0000-0000-0000-000000000001' and version=1 and previous_version_id is null;
  if roots < 2 then
    raise exception 'F-1 unexpectedly guarded: only % v1 root(s) — a unique constraint may exist', roots;
  end if;
  raise notice 'PASS 5 (F-1 CONFIRMED): % v1 root cores now coexist for one agent with NO DB error → duplicate-core is unenforced live', roots;
end $$;

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- 6. FINDING F-2 (BLOCKER) — duplicate VERSION is NOT prevented at the DB.
--    Insert a SECOND version=2 row for agent A: proves no unique (agent_id,version), so two concurrent
--    appendCoreVersion calls that both read head.v=1 and both insert version 2 would BOTH succeed (lost update).
-- ══════════════════════════════════════════════════════════════════════════════════════════════
do $$
declare dupv2 int;
begin
  insert into public.prompt_layers
    (layer,name,content,agent_id,enabled,version,previous_version_id,change_reason,created_by)
  values ('core','Layer 1 — agent A','v2 concurrent','aaaaaaaa-0000-0000-0000-000000000001',true,2,
          :'core1_id','concurrent edit racing the first v2',null);
  select count(*) into dupv2 from public.prompt_layers
    where layer='core' and agent_id='aaaaaaaa-0000-0000-0000-000000000001' and version=2;
  if dupv2 < 2 then
    raise exception 'F-2 unexpectedly guarded: only % v2 row(s) — a unique (agent_id,version) may exist', dupv2;
  end if;
  raise notice 'PASS 6 (F-2 CONFIRMED): % version-2 rows coexist for one agent → the CTE increment is NOT race-safe (no unique (agent_id,version))', dupv2;
end $$;

rollback;  -- nothing persists
