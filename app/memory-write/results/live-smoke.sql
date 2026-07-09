-- ============================================================================
-- app/memory-write — LIVE-ADAPTER SMOKE (ISSUE-024, C2 WRT)
-- R10 live-adapter hygiene sweep for src/supabase-store.ts (SupabaseCommitStore / readers / sinks).
--
-- WHAT THIS PROVES (replays the sole-writer commit path's REAL query/DDL against the live silo — memories,
-- memory_conflicts, event_log, access_audit are baseline 0001; the WRITE event_types are 0039):
--   [1] advisory locks — pg_advisory_xact_lock(hashtext(eid)::int8) is settable per entity id (ADR-004 §2).
--   [2] watermark      — the entity-overlap `entity_ids && $::uuid[]` max(updated_at) read runs.
--   [3] insert         — the idempotency-keyed insert into memories with ::memory_type/::memory_source/
--                        ::visibility_tier/::sensitivity_tier casts + a real vector(1536) + ON CONFLICT DO
--                        NOTHING executes against the real schema (the two CHECKs + unique(idempotency_key)).
--   [4] CAS supersede  — `update ... set superseded_by ... where superseded_by is null` runs (no lost-supersede).
--   [5] quarantine     — insert into memory_conflicts (new_memory jsonb, conflicting_memory_ids uuid[], 'pending').
--   [6] event_types    — the 0039 WRITE values (memory_write_superseded/_conflict/_embed_failed) + baseline
--                        memory_written + authz_revoked_midtask write via ::event_type with NO 22P02.
--   [7] access_audit   — the agent-path audit insert (actor_type 'agent') executes.
--   [8] similar reader — the write-path "most similar" read (entity_ids && ... and type = ...::memory_type) runs.
--
-- CONNECTS AS: postgres (rolbypassrls=t) via SILO_DB_URL. SAFETY: ONE txn, ROLLBACK at the end — NOTHING persists.
-- RUN:  source ~/.ai-harness-secrets.env
--       /opt/homebrew/opt/libpq/bin/psql "$SILO_DB_URL" -v ON_ERROR_STOP=1 -f app/memory-write/results/live-smoke.sql
-- PREREQUISITE: migration 0039 applied (the three WRITE event_type values). Expected tail: "MEMORY-WRITE LIVE
-- SMOKE: ALL ASSERTIONS PASSED" then ROLLBACK.
-- ============================================================================

\set ON_ERROR_STOP on
begin;

-- [1] per-entity advisory locks (sorted acquisition is the adapter's job; here we prove the primitive is settable).
do $$
declare v_e1 uuid := '11111111-1111-1111-1111-111111111111'; v_e2 uuid := '22222222-2222-2222-2222-222222222222';
begin
  perform pg_advisory_xact_lock(hashtext(v_e1::text)::int8);
  perform pg_advisory_xact_lock(hashtext(v_e2::text)::int8);
  raise notice '  [1] pg_advisory_xact_lock(hashtext(eid)::int8) settable';
end $$;

-- [2] watermark read — entity-overlap max(updated_at) epoch.
do $$
declare v_w numeric;
begin
  select coalesce(extract(epoch from max(updated_at)), 0) into v_w
    from memories where entity_ids && array['11111111-1111-1111-1111-111111111111']::uuid[];
  raise notice '  [2] watermark read OK — w=%', v_w;
end $$;

-- [3] the idempotency-keyed insert with all enum casts + a real vector(1536) + ON CONFLICT DO NOTHING.
do $$
declare v_id uuid; v_target uuid;
  v_vec text := '[' || array_to_string(array_fill(0.01::float8, array[1536]), ',') || ']';
begin
  insert into memories (type, content, embedding, embedding_model, entity_ids, source, source_ref, confidence,
                        visibility, sensitivity, content_hash, idempotency_key, expires_at)
  values ('semantic'::memory_type, 'r10 smoke — Acme HQ Boston', v_vec::vector, 'text-embedding-3-small',
          array['11111111-1111-1111-1111-111111111111']::uuid[], 'ai_inferred'::memory_source, null, 0.8,
          'team'::visibility_tier, 'standard'::sensitivity_tier, 'r10hash-a', 'r10idem-a', null)
  on conflict (idempotency_key) do nothing
  returning id into v_target;
  assert v_target is not null, 'insert returned no id (unexpected pre-existing r10idem-a?)';

  -- a second row (the "refinement") to CAS-supersede the first.
  insert into memories (type, content, embedding, embedding_model, entity_ids, source, source_ref, confidence,
                        visibility, sensitivity, content_hash, idempotency_key, expires_at)
  values ('semantic'::memory_type, 'r10 smoke — Acme HQ Cambridge', v_vec::vector, 'text-embedding-3-small',
          array['11111111-1111-1111-1111-111111111111']::uuid[], 'ai_inferred'::memory_source, null, 0.8,
          'team'::visibility_tier, 'standard'::sensitivity_tier, 'r10hash-b', 'r10idem-b', null)
  returning id into v_id;
  raise notice '  [3] idempotency-keyed insert + enum casts + vector(1536) OK — new=% target=%', v_id, v_target;

  -- [4] CAS-supersede WHERE superseded_by IS NULL.
  update memories set superseded_by = v_id, updated_at = now() where id = v_target and superseded_by is null;
  assert (select superseded_by from memories where id = v_target) = v_id, 'CAS-supersede did not take';
  raise notice '  [4] CAS-supersede (WHERE superseded_by IS NULL) OK';

  -- an idempotent RE-insert of the same key is a no-op (ON CONFLICT DO NOTHING) — no duplicate, no error.
  insert into memories (type, content, embedding, embedding_model, entity_ids, source, source_ref, confidence,
                        visibility, sensitivity, content_hash, idempotency_key, expires_at)
  values ('semantic'::memory_type, 'r10 smoke dup', v_vec::vector, 'text-embedding-3-small',
          array['11111111-1111-1111-1111-111111111111']::uuid[], 'ai_inferred'::memory_source, null, 0.8,
          'team'::visibility_tier, 'standard'::sensitivity_tier, 'r10hash-a', 'r10idem-a', null)
  on conflict (idempotency_key) do nothing;
  assert (select count(*) from memories where idempotency_key = 'r10idem-a') = 1, 'idempotent re-insert created a duplicate';
  raise notice '  [4b] ON CONFLICT DO NOTHING idempotent re-insert is a no-op (no duplicate)';
end $$;

-- [5] the hard-conflict / halt quarantine row.
do $$
declare v_conf uuid;
begin
  insert into memory_conflicts (new_memory, conflicting_memory_ids, state)
  values ('{"content":"r10 smoke pending","source":"ai_inferred"}'::jsonb,
          array['11111111-1111-1111-1111-111111111111']::uuid[], 'pending')
  returning id into v_conf;
  assert v_conf is not null, 'memory_conflicts insert failed';
  raise notice '  [5] memory_conflicts quarantine insert OK — %', v_conf;
end $$;

-- [6] the WRITE event_types (0039) + baseline memory_written + authz_revoked_midtask write via ::event_type.
insert into event_log (event_type, entity_ids, summary, payload, created_at) values
  ('memory_written'::event_type,            array['11111111-1111-1111-1111-111111111111']::uuid[], 'r10 smoke', '{"p":1}'::jsonb, now()),
  ('memory_write_superseded'::event_type,   array[]::uuid[], 'r10 smoke', '{"p":1}'::jsonb, now()),
  ('memory_write_conflict'::event_type,     array[]::uuid[], 'r10 smoke', '{"p":1}'::jsonb, now()),
  ('memory_write_embed_failed'::event_type, array[]::uuid[], 'r10 smoke', '{"p":1}'::jsonb, now()),
  ('authz_revoked_midtask'::event_type,     array[]::uuid[], 'r10 smoke', '{"p":1}'::jsonb, now());
\echo '  [6] WRITE event_types (0039) + memory_written + authz_revoked_midtask insert via ::event_type OK — no 22P02'

-- [7] the agent-path access_audit insert (actor_type 'agent').
insert into access_audit (audit_type, actor_identity, actor_type, action, originating_user_id, reason, path_context)
  values ('memory_write', 'memory-agent', 'agent', 'write:personal', null, null, 'r10-task');
\echo '  [7] access_audit agent-path insert (actor_type ''agent'') OK'

-- [8] the write-path "most similar" reader query shape.
do $$
declare v_n int;
begin
  select count(*) into v_n from memories
   where entity_ids && array['11111111-1111-1111-1111-111111111111']::uuid[]
     and type = 'semantic'::memory_type and superseded_by is null and (expires_at is null or expires_at > now());
  raise notice '  [8] similar-reader query shape OK — n=%', v_n;
end $$;

\echo ''
\echo 'MEMORY-WRITE LIVE SMOKE: ALL ASSERTIONS PASSED'
rollback;
