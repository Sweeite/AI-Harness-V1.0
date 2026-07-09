-- ============================================================================
-- app/embeddings — LIVE-ADAPTER SMOKE (ISSUE-023, C2 VEC)
-- R10 live-adapter hygiene sweep for src/supabase-store.ts (SupabaseVectorAdmin).
--
-- WHAT THIS PROVES (replays the adapter's REAL query/DDL paths against the live silo; memories + embedding columns are
-- baseline 0001, the HNSW index is 0001b_indexes, the embedding event_types are 0038):
--   [1] hnswIndexInfo   — memories_embedding_hnsw exists with the documented params (m=16, ef_construction=64,
--                         vector_cosine_ops on the embedding column) — AC-2.VEC.001.1 read back from the catalog.
--   [2] reconcile counts — the LIVE-predicate liveRowCount / validV2Count + the anyNullV2 coverage count run.
--   [3] event_types     — the three 0038 event_type values write to event_log via ::event_type with NO 22P02 (the
--                         fake-accepts-any-string / live-throws class R10 exists to catch).
--   [4] AF-019 contract — the retrieval-session GUCs (hnsw.ef_search + hnsw.iterative_scan='relaxed_order' +
--                         enable_seqscan=off) are settable AND force the vector top-k OFF a Seq Scan (the ~308x cliff fix).
--   [5] expand DDL      — `add column if not exists embedding_v2` is idempotent; the invalid-index guard runs.
--   [6] contract promote — the ATOMIC drop-old → rename v2 → re-add NOT NULL → fix provenance → (rename index) DDL
--                         executes against the REAL memories schema (coverage forced first, so the promote is valid).
--
-- CONNECTS AS: postgres (rolbypassrls=t) via SILO_DB_URL. SAFETY: ONE txn, ROLLBACK at the end — NOTHING persists
--   (Postgres DDL is transactional; the drop/rename/promote in [6] is fully reverted). Takes a brief ACCESS EXCLUSIVE
--   lock on `memories` for the txn — fine on the low-traffic dev silo, released on rollback.
-- RUN:  source ~/.ai-harness-secrets.env
--       /opt/homebrew/opt/libpq/bin/psql "$SILO_DB_URL" -v ON_ERROR_STOP=1 -f app/embeddings/results/live-smoke.sql
-- Expected tail: "EMBEDDINGS LIVE SMOKE: ALL ASSERTIONS PASSED" then ROLLBACK.
-- ============================================================================

\set ON_ERROR_STOP on
begin;

-- [1] hnswIndexInfo — the index + its documented params, read exactly as the adapter reads them.
do $$
declare
  v_reloptions text[];
  v_indexdef   text;
begin
  select c.reloptions, pg_get_indexdef(i.indexrelid)
    into v_reloptions, v_indexdef
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
    join pg_class t on t.oid = i.indrelid
    join pg_am am on am.oid = c.relam
   where t.relname = 'memories' and am.amname = 'hnsw' and c.relname = 'memories_embedding_hnsw';
  assert v_reloptions is not null, 'no memories_embedding_hnsw index found';
  assert array_to_string(v_reloptions, ',') like '%m=16%', 'm != 16';
  assert array_to_string(v_reloptions, ',') like '%ef_construction=64%', 'ef_construction != 64';
  assert v_indexdef like '%hnsw (embedding vector_cosine_ops)%', 'not hnsw(embedding vector_cosine_ops)';
  raise notice '  [1] hnsw index OK — reloptions=%', array_to_string(v_reloptions, ',');
end $$;

-- [2] reconcile counts — the exact predicates the adapter's liveRowCount / validV2Count / anyNullV2Count use.
do $$
declare
  v_live   int;
  v_validv2 int;
  v_nullv2 int;
begin
  select count(*) into v_live   from memories where superseded_by is null and (expires_at is null or expires_at > now());
  select count(*) into v_validv2 from memories where superseded_by is null and (expires_at is null or expires_at > now()) and embedding_v2 is not null;
  select count(*) into v_nullv2 from memories where embedding_v2 is null;
  raise notice '  [2] reconcile counts OK — live=% validv2=% nullv2=%', v_live, v_validv2, v_nullv2;
end $$;

-- [3] the three 0038 embedding event_types write via ::event_type with no 22P02 (append-only trigger permits insert).
insert into event_log (event_type, entity_ids, summary, payload, created_at) values
  ('embedding_model_change'::event_type,      array[]::uuid[], 'r10 smoke', '{"phase":"smoke"}'::jsonb, now()),
  ('embedding_reembed_progress'::event_type,  array[]::uuid[], 'r10 smoke', '{"phase":"smoke"}'::jsonb, now()),
  ('embedding_reconcile_blocked'::event_type, array[]::uuid[], 'r10 smoke', '{"phase":"smoke"}'::jsonb, now());
\echo '  [3] embedding event_types (0038) insert via ::event_type OK — no 22P02'

-- [4] the AF-019 retrieval-session contract forces the HNSW index (no Seq Scan). This is the whole point of the gate.
set local hnsw.ef_search = 40;
set local hnsw.iterative_scan = 'relaxed_order';
set local enable_seqscan = off;
do $$
declare
  v_probe text;
  v_plan  text;
begin
  v_probe := '[' || array_to_string(array_fill(0.5::float8, array[1536]), ',') || ']';
  execute format('explain (format json) select id from memories order by embedding <=> %L::vector limit 7', v_probe) into v_plan;
  assert position('Seq Scan' in v_plan) = 0, 'AF-019 contract did NOT force the index — Seq Scan present in the plan';
  raise notice '  [4] AF-019 retrieval-session contract forces the index (no Seq Scan) — GUCs settable on live pgvector';
end $$;

-- [5] expand DDL — idempotent add-column + the invalid-index guard (the CONCURRENTLY build is asserted by the check gate,
--     not here — it cannot run inside a txn).
alter table memories add column if not exists embedding_v2 vector(1536);
do $$
begin
  if exists (select 1 from pg_class c join pg_index i on i.indexrelid = c.oid
             where c.relname = 'memories_embedding_v2_hnsw' and not i.indisvalid) then
    execute 'drop index memories_embedding_v2_hnsw';
  end if;
  raise notice '  [5] expand DDL OK — embedding_v2 add-column idempotent + invalid-index guard runs';
end $$;

-- [6] the ATOMIC contract promote DDL executes against the REAL memories schema. Coverage is forced first (copy the
--     existing embedding into v2) so the NOT NULL promote is valid; the whole thing rolls back with the txn.
do $$
declare
  v_nullv2 int;
  v_notnull boolean;
begin
  update memories set embedding_v2 = embedding where embedding_v2 is null;
  select count(*) into v_nullv2 from memories where embedding_v2 is null;
  assert v_nullv2 = 0, 'coverage incomplete after copy — cannot smoke the NOT NULL promote';

  alter table memories drop column embedding;                                   -- cascade-drops memories_embedding_hnsw
  alter table memories rename column embedding_v2 to embedding;
  alter table memories alter column embedding set not null;                      -- restore the FR-2.WRT.007 guard
  update memories set embedding_model = 'text-embedding-3-large-1536' where embedding_model <> 'text-embedding-3-large-1536';
  if exists (select 1 from pg_class where relname = 'memories_embedding_v2_hnsw') then
    execute 'alter index memories_embedding_v2_hnsw rename to memories_embedding_hnsw';
  end if;

  select (a.attnotnull) into v_notnull from pg_attribute a
   where a.attrelid = 'memories'::regclass and a.attname = 'embedding' and not a.attisdropped;
  assert v_notnull, 'promoted embedding column is not NOT NULL';
  raise notice '  [6] contract promote DDL executes against the real schema (atomic, rolled back) — embedding is NOT NULL';
end $$;

\echo ''
\echo 'EMBEDDINGS LIVE SMOKE: ALL ASSERTIONS PASSED'
rollback;
