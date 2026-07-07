-- ============================================================================
-- LIVE-ADAPTER SMOKE — app/prompt-layer-context (ISSUE-044)
-- Adapter under test: app/prompt-layer-context/src/supabase-store.ts
--   * SupabaseDynamicFieldStore  -> dynamic_field_values  (schema §5)
--   * SupabaseContentStore        -> prompt_layers          (schema §5, layer in business|task_template)
--
-- WHAT THIS PROVES (replays the adapter's REAL write SQL, verbatim shapes):
--   1. dynamic_field_values.set() upsert-on-PK re-stamps last_updated and overwrites
--      field_value (incl. null) — the 0022 grant/policy path is exercisable (we run as the
--      RLS-exempt owner, so this proves the DDL/column/enum shapes, not the RLS filter).
--   2. prompt_layers createContent() INSERT (v1, previous_version_id=null, agent_id=null)
--      lands under the 0004 t_prompt_version_discipline trigger with a non-empty change_reason.
--   3. appendVersion() INSERT..SELECT (the head-in-SQL CTE) appends v2 linked to v1 and does
--      NOT mutate v1 (append-only-by-version / FR-4.STO.003).
--   4. rollbackTo() appends a forward v3 whose content = v1's content, previous_version_id=head
--      (non-destructive rollback / FR-4.STO.004).
--   5. The 0004 trigger REJECTS an in-place content UPDATE and a DELETE (fails LOUD, #3).
--   6. LOST-UPDATE PROBE (finding PLC-1): two children of the SAME version v2 are BOTH
--      insertable — there is no partial-unique on previous_version_id (unlike agents_prev_unique
--      added in 0025). This SHOULD fail with unique_violation but instead succeeds → forked
--      version chain, silent lost update (#1/#3). Documented here as a live demonstration.
--
-- Connect role (Wave A): SILO_DB_URL connects as 'postgres' (rolbypassrls=t) — RLS is BYPASSED
-- on this path, so RLS filtering is NOT what this smoke asserts; column/enum/trigger/uniqueness
-- correctness IS. Enums verified live: prompt_layer_kind = (core,business,memory,task_template).
--
-- created_by is nullable (FK -> profiles(id); the silo has 0 profiles) so we pass NULL to keep
-- the txn self-contained (matches the adapter, which forwards input.created_by / null).
--
-- RUN:  psql "$SILO_DB_URL" -f app/prompt-layer-context/results/live-smoke.sql
-- Everything runs inside ONE txn and ROLLBACKs — nothing persists. Do NOT commit.
-- ============================================================================

begin;

-- unique-ish names so a partial run can't collide with real data
\set nm 'smoke_tt_' `date +%s%N`

-- ────────────────────────────────────────────────────────────────────────────
-- 1. dynamic_field_values.set() — upsert-on-PK, re-stamp last_updated, null overwrite
-- ────────────────────────────────────────────────────────────────────────────
insert into dynamic_field_values (field_name, field_value, last_updated)
values ('smoke_field', 'first', to_timestamp(1000000000))
on conflict (field_name) do update
  set field_value = excluded.field_value, last_updated = excluded.last_updated;

-- second set(): overwrite value with NULL and re-stamp to a newer time (adapter re-stamps always)
insert into dynamic_field_values (field_name, field_value, last_updated)
values ('smoke_field', null, to_timestamp(2000000000))
on conflict (field_name) do update
  set field_value = excluded.field_value, last_updated = excluded.last_updated;

do $$
declare v text; ts timestamptz;
begin
  select field_value, last_updated into v, ts from dynamic_field_values where field_name='smoke_field';
  if v is not null then raise exception 'DFV set(null) did not clear field_value (got %)', v; end if;
  if ts <> to_timestamp(2000000000) then raise exception 'DFV set did not re-stamp last_updated (got %)', ts; end if;
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. createContent() — v1 INSERT (business), trigger accepts non-empty change_reason
-- ────────────────────────────────────────────────────────────────────────────
insert into prompt_layers (layer, name, content, agent_id, enabled, version, previous_version_id, change_reason, created_by)
values ('business', 'smoke_asset', 'v1 body', null, true, 1, null, 'create', null);

do $$
declare c int;
begin
  select count(*) into c from prompt_layers where layer='business' and name='smoke_asset';
  if c <> 1 then raise exception 'createContent: expected 1 v1 row, got %', c; end if;
end $$;

-- Empty change_reason must be REJECTED by the 0004 trigger (FR-4.STO.003)
do $$
begin
  begin
    insert into prompt_layers (layer, name, content, agent_id, enabled, version, previous_version_id, change_reason, created_by)
    values ('business', 'smoke_asset_bad', 'x', null, true, 1, null, '   ', null);
    raise exception 'TRIGGER MISS: empty change_reason was accepted';
  exception when others then
    if sqlerrm !~ 'change_reason is mandatory' then raise exception 'unexpected error on empty reason: %', sqlerrm; end if;
  end;
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. appendVersion() — the adapter's exact INSERT..SELECT CTE (v2 linked to v1)
-- ────────────────────────────────────────────────────────────────────────────
with cur as (select * from prompt_layers where layer='business' and name='smoke_asset' and version=1),
head as (
  select max(pl.version) as v from prompt_layers pl
  join cur on pl.layer = cur.layer and pl.name = cur.name
    and pl.agent_id is not distinct from cur.agent_id
)
insert into prompt_layers (layer, name, content, agent_id, enabled, version, previous_version_id, change_reason, created_by)
select cur.layer, cur.name, coalesce('v2 body', cur.content), cur.agent_id,
       coalesce(null, cur.enabled), head.v + 1, cur.id, 'edit to v2', null
from cur, head
where cur.version = head.v;

do $$
declare v2content text; v1content text;
begin
  select content into v2content from prompt_layers where layer='business' and name='smoke_asset' and version=2;
  select content into v1content from prompt_layers where layer='business' and name='smoke_asset' and version=1;
  if v2content <> 'v2 body' then raise exception 'appendVersion: v2 content wrong (%)', v2content; end if;
  if v1content <> 'v1 body' then raise exception 'appendVersion MUTATED v1 (now %) — append-only violated', v1content; end if;
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. rollbackTo() — non-destructive forward append (v3 content = v1 content)
-- ────────────────────────────────────────────────────────────────────────────
with prior as (select * from prompt_layers where layer='business' and name='smoke_asset' and version=1),
head as (
  select max(pl.version) as v, max(pl.id::text) as _ from prompt_layers pl
  join prior on pl.layer = prior.layer and pl.name = prior.name
    and pl.agent_id is not distinct from prior.agent_id
),
headrow as (
  select pl.id from prompt_layers pl
  join prior on pl.layer = prior.layer and pl.name = prior.name
    and pl.agent_id is not distinct from prior.agent_id
  join head on pl.version = head.v
)
insert into prompt_layers (layer, name, content, agent_id, enabled, version, previous_version_id, change_reason, created_by)
select prior.layer, prior.name, prior.content, prior.agent_id, prior.enabled,
       head.v + 1, headrow.id, 'rollback to v1', null
from prior, head, headrow;

do $$
declare v3content text; prevlink uuid; v2id uuid;
begin
  select content, previous_version_id into v3content, prevlink
    from prompt_layers where layer='business' and name='smoke_asset' and version=3;
  select id into v2id from prompt_layers where layer='business' and name='smoke_asset' and version=2;
  if v3content <> 'v1 body' then raise exception 'rollbackTo: v3 content should equal v1 (got %)', v3content; end if;
  if prevlink <> v2id then raise exception 'rollbackTo: v3 previous_version_id should be the head v2 (%), got %', v2id, prevlink; end if;
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. 0004 trigger — in-place content UPDATE and DELETE must both FAIL LOUD
-- ────────────────────────────────────────────────────────────────────────────
do $$
begin
  begin
    update prompt_layers set content='tamper' where layer='business' and name='smoke_asset' and version=1;
    raise exception 'TRIGGER MISS: in-place content UPDATE was accepted';
  exception when others then
    if sqlerrm !~ 'in-place edit' then raise exception 'unexpected error on UPDATE: %', sqlerrm; end if;
  end;
  begin
    delete from prompt_layers where layer='business' and name='smoke_asset' and version=1;
    raise exception 'TRIGGER MISS: DELETE was accepted';
  exception when others then
    if sqlerrm !~ 'DELETE forbidden' then raise exception 'unexpected error on DELETE: %', sqlerrm; end if;
  end;
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. LOST-UPDATE PROBE (finding PLC-1) — no partial-unique on previous_version_id
--    (agents got agents_prev_unique in 0025; prompt_layers did NOT). Two children of the
--    SAME parent (v2) are both insertable → forked chain, silent lost update (#1/#3).
--    A CORRECT schema would raise unique_violation on the 2nd insert; here it succeeds.
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare v2id uuid; forks int;
begin
  select id into v2id from prompt_layers where layer='business' and name='smoke_asset' and version=2;
  -- two concurrent appendVersion callers would each compute head=v3 and link to... in the
  -- real race both link to the SAME head; here we directly insert two children of v2 to show
  -- the schema permits a forked lineage at all.
  insert into prompt_layers (layer,name,content,agent_id,enabled,version,previous_version_id,change_reason,created_by)
    values ('business','smoke_asset','fork A',null,true,4,v2id,'fork A',null);
  insert into prompt_layers (layer,name,content,agent_id,enabled,version,previous_version_id,change_reason,created_by)
    values ('business','smoke_asset','fork B',null,true,4,v2id,'fork B',null);
  select count(*) into forks from prompt_layers where previous_version_id=v2id;
  if forks >= 2 then
    raise warning 'PLC-1 CONFIRMED: prompt_layers accepted % children of one version (forked chain / lost update). A partial-unique on previous_version_id (cf. agents_prev_unique in 0025) would have rejected the 2nd.', forks;
  else
    raise exception 'PLC-1 probe inconclusive: expected >=2 children, got % (a unique constraint may now exist)', forks;
  end if;
end $$;

rollback;
-- END SMOKE — nothing persists.
