-- AF-065 — expand-contract mixed-version fleet safety (ISSUE-008 / AC-NFR-INF.002.2)
--
-- Claim (feasibility-register AF-065): through a rollout a vN and a vN-1 deployment both run correctly
-- against their own schema, AND prior code runs correctly against the newer schema (the rollback
-- premise). This spike proves it against the LIVE migrated silo:
--   1. seed a memory under the v1 (baseline) schema, read it with a v1 reader;
--   2. EXPAND (add a nullable column) => schema is now v2;
--   3. the SAME v1 reader still reads correctly against v2 (rollback premise);
--   4. a v1 WRITER (vN-1 still deployed mid-rollout) still inserts against v2;
--   5. a v2 writer/reader uses the new column;
--   6. assert NO DATA LOSS (row count + embedding dims intact);
--   7. CONTRACT: drop the throwaway column + spike rows => restore the baseline.
-- Self-verifying: any failed invariant RAISEs and \set ON_ERROR_STOP aborts (fail-loud).

\set ON_ERROR_STOP on
\pset pager off

-- session-temp helper so we don't repeat the 1536-d vector literal; auto-dropped at session end.
create function pg_temp.vec1536() returns vector language sql as
  $$ select ('[' || string_agg('0.001', ',') || ']')::vector from generate_series(1,1536) $$;

\echo '=== 1. seed M1 under the v1 (baseline) schema ==='
insert into memories (type, content, embedding, entity_ids, source, confidence, visibility, sensitivity, content_hash, idempotency_key)
select 'semantic', 'AF065 M1 (v1-written)', pg_temp.vec1536(),
  array[(select id from entities where is_internal_org limit 1)],
  'ai_inferred', 0.9, 'global', 'standard', 'af065_h1', 'af065_k1';

\echo '=== 2. v1 READER (baseline columns only) reads M1 ==='
select 'v1reader_pre_expand: ' || content || ' | model=' || embedding_model
from memories where idempotency_key = 'af065_k1';

\echo '=== 3. EXPAND: add a nullable column -> schema is now v2 ==='
alter table memories add column af065_flag boolean;

\echo '=== 4. ROLLBACK PREMISE: the SAME v1 reader still works against the v2 schema ==='
select 'v1reader_post_expand: ' || content || ' | model=' || embedding_model
from memories where idempotency_key = 'af065_k1';

\echo '=== 5. v1 WRITER (vN-1 still deployed) inserts M2 WITHOUT the new column ==='
insert into memories (type, content, embedding, entity_ids, source, confidence, visibility, sensitivity, content_hash, idempotency_key)
select 'semantic', 'AF065 M2 (v1-written, post-expand)', pg_temp.vec1536(),
  array[(select id from entities where is_internal_org limit 1)],
  'ai_inferred', 0.8, 'global', 'standard', 'af065_h2', 'af065_k2';

\echo '=== 6. v2 WRITER inserts M3 using the new column, and updates M1 ==='
insert into memories (type, content, embedding, entity_ids, source, confidence, visibility, sensitivity, content_hash, idempotency_key, af065_flag)
select 'semantic', 'AF065 M3 (v2-written)', pg_temp.vec1536(),
  array[(select id from entities where is_internal_org limit 1)],
  'ai_inferred', 0.7, 'global', 'standard', 'af065_h3', 'af065_k3', true;
update memories set af065_flag = true where idempotency_key = 'af065_k1';

\echo '=== 7. v2 READER: flags visible; v1-written M2 is null (not corrupted) ==='
select idempotency_key || ' flag=' || coalesce(af065_flag::text, 'null') || ' dims=' || vector_dims(embedding)
from memories where idempotency_key like 'af065_k%' order by idempotency_key;

\echo '=== 8. ASSERT no data loss + prior reads intact (fail-loud) ==='
do $$
declare n int;
begin
  select count(*) into n from memories where idempotency_key like 'af065_k%';
  if n <> 3 then raise exception 'AF-065 FAIL: expected 3 rows, got %', n; end if;
  if exists (select 1 from memories where idempotency_key like 'af065_k%' and vector_dims(embedding) <> 1536) then
    raise exception 'AF-065 FAIL: an embedding lost its 1536 dims across the expand';
  end if;
  -- prior (v1) code path — select of baseline columns — must still return M1 unchanged
  if not exists (select 1 from memories where idempotency_key='af065_k1' and content='AF065 M1 (v1-written)' and embedding_model='text-embedding-3-small') then
    raise exception 'AF-065 FAIL: v1 read of M1 diverged after expand';
  end if;
  raise notice 'AF-065 PASS: v1 & v2 both correct against their own schema; prior code correct against the newer schema; 0 data loss.';
end $$;

\echo '=== 9. CONTRACT: drop the throwaway column + spike rows -> baseline restored ==='
delete from memories where idempotency_key like 'af065_k%';
alter table memories drop column af065_flag;

\echo '=== 10. verify baseline restored (memories empty, no af065_flag column) ==='
select 'memories_rows=' || count(*) from memories;
select 'af065_flag_exists=' || exists(select 1 from information_schema.columns where table_name='memories' and column_name='af065_flag');
