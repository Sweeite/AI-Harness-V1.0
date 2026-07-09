-- ============================================================================
-- app/maturity — LIVE-ADAPTER SMOKE (ISSUE-030, C2 MAT)
-- R10 live-adapter hygiene sweep for src/supabase-store.ts (SupabaseMaturityStore).
--
-- WHAT THIS PROVES (replays the adapter's REAL query/DDL paths against the live silo; entities.maturity +
-- maturity_updated_at are baseline 0001, config_values is 0001, the maturity_recomputed event_type is 0040):
--   [1] setMaturity   — UPDATE entities SET maturity + maturity_updated_at executes against numeric(4,3) + timestamptz.
--   [2] liveMemories  — the slot-fill source read ($1 = any(entity_ids) AND superseded_by is null AND not-expired) runs.
--   [3] latch upsert  — the cold-start ONE-WAY LATCH upsert with the SQL-level OR-guard: a write of deactivated=false
--                       CANNOT clear an already-committed deactivated=true (AC-2.MAT.002.1 — the latch never re-arms,
--                       the two-interleaved-recomputes-around-a-dip case the verifier asked for, proven at the SQL level).
--   [4] loadConfig    — the config_values read of the five MAT knobs runs.
--   [5] emitRecomputed — the maturity_recomputed event (0040) writes to event_log via ::event_type with NO 22P02.
--
-- CONNECTS AS: postgres (rolbypassrls=t) via SILO_DB_URL. SAFETY: ONE txn, ROLLBACK at the end — NOTHING persists.
-- RUN:  source ~/.ai-harness-secrets.env
--       /opt/homebrew/opt/libpq/bin/psql "$SILO_DB_URL" -v ON_ERROR_STOP=1 -f app/maturity/results/live-smoke.sql
-- PREREQUISITE: migration 0040 applied. Expected tail: "MATURITY LIVE SMOKE: ALL ASSERTIONS PASSED" then ROLLBACK.
-- ============================================================================

\set ON_ERROR_STOP on
begin;

-- [1] setMaturity — UPDATE entities.maturity + stamp. Create a throwaway entity (rolled back) to target.
do $$
declare v_id uuid;
begin
  insert into entities (type, name, external_refs, is_internal_org)
  values ('Client', 'r10 maturity smoke', '{}'::jsonb, false)
  returning id into v_id;

  update entities set maturity = 0.625, maturity_updated_at = now() where id = v_id;
  assert (select maturity from entities where id = v_id) = 0.625, 'maturity did not round-trip as numeric(4,3)';
  assert (select maturity_updated_at from entities where id = v_id) is not null, 'maturity_updated_at not stamped';
  raise notice '  [1] setMaturity UPDATE (numeric(4,3) + timestamptz) OK';

  -- [2] liveMemoriesForEntity — the slot-fill source read shape.
  perform 1 from memories
    where v_id = any(entity_ids) and superseded_by is null and (expires_at is null or expires_at > now());
  raise notice '  [2] liveMemoriesForEntity read shape OK';
end $$;

-- [3] the cold-start ONE-WAY LATCH upsert + its OR-guard — the AC-2.MAT.002.1 no-re-arm proof at the SQL level.
do $$
declare v_final boolean;
begin
  -- first recompute commits deactivated=true (aggregate crossed 80%).
  insert into config_values (key, value) values ('r10_cold_start_latch', '{"deactivated":true,"phase":"full"}'::jsonb)
    on conflict (key) do update set value = jsonb_set(
      excluded.value, '{deactivated}',
      to_jsonb(coalesce((config_values.value->>'deactivated')::bool, false) or (excluded.value->>'deactivated')::bool)
    ), updated_at = now();

  -- a SECOND, interleaved recompute carries a STALE deactivated=false (computed off a later threshold dip) — the
  -- OR-guard must keep the committed true. This is exactly the lost-update the latch defends against (#1).
  insert into config_values (key, value) values ('r10_cold_start_latch', '{"deactivated":false,"phase":"proactive"}'::jsonb)
    on conflict (key) do update set value = jsonb_set(
      excluded.value, '{deactivated}',
      to_jsonb(coalesce((config_values.value->>'deactivated')::bool, false) or (excluded.value->>'deactivated')::bool)
    ), updated_at = now();

  select (value->>'deactivated')::bool into v_final from config_values where key = 'r10_cold_start_latch';
  assert v_final = true, 'the cold-start latch RE-ARMED — the OR-guard failed to preserve the committed deactivation (#1)';
  raise notice '  [3] cold-start one-way latch OR-guard OK — a stale false cannot clear a committed true (no re-arm)';
end $$;

-- [4] loadConfig — the five MAT knobs read shape (rows may or may not be seeded; the read must run).
do $$
declare v_n int;
begin
  select count(*) into v_n from config_values
   where key = any(array['expected_slots','cold_start_basic_threshold','cold_start_proactive_threshold','cold_start_full_threshold','retrieval_sufficiency_threshold']);
  raise notice '  [4] loadConfig read shape OK — % of 5 MAT knobs seeded in config_values', v_n;
end $$;

-- [5] emitRecomputed — the maturity_recomputed event (0040) writes via ::event_type with no 22P02.
insert into event_log (event_type, entity_ids, summary, payload, created_at)
  values ('maturity_recomputed'::event_type, array[]::uuid[], 'r10 smoke', '{"trigger":"on_write","filledCount":5,"expectedCount":8,"maturity":0.625}'::jsonb, now());
\echo '  [5] maturity_recomputed event_type (0040) insert via ::event_type OK — no 22P02'

\echo ''
\echo 'MATURITY LIVE SMOKE: ALL ASSERTIONS PASSED'
rollback;
