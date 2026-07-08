-- ISSUE-065 (agent-health) LIVE-SMOKE — replays the SupabaseAgentHealthStore read/write paths against the real
-- silo DDL. Target DB: SILO ($SILO_DB_URL, postgres/rolbypassrls — the system metric-producer path). Rolled
-- back (non-mutating) → safe to run live.
-- Run: psql "$SILO_DB_URL" -v ON_ERROR_STOP=1 -f app/agent-health/results/live-smoke.sql
-- Expect: ALL ASSERTIONS PASS, then ROLLBACK.
--
-- What it proves (the fake-passes-offline / live-adapter-throws class) — every statement below is the EXACT shape
-- SupabaseAgentHealthStore issues (supabase-store.ts), so any column/enum/cast/constraint drift throws HERE:
--   • upsertHealthMetrics  — the ONE write: insert ... on conflict (agent_id) do update, stamping
--                            producer_heartbeat; numeric success/failure/drift + boolean dead_agent_flag +
--                            routing_mismatch_count round-trip (schema.md §9 agent_health_metrics).
--   • on-conflict re-run   — a 2nd upsert advances producer_heartbeat AND preserves routing_mismatch_count when
--                            the producer passes NULL (LRN.002/ISSUE-066 owns that column — never clobbered here).
--   • loadHealthMetrics    — read-back of every column (numeric returns as text → TS parses).
--   • loadOutcomes / loadBehaviourSample / loadScope / isAgentEnabled — the READ shapes (agents read-only;
--                            event_log terminal + memory_read/tool_called projections) compile against live cols.
--   • FLAG-NEVER-AUTO-CORRECT (#2/OD-078): after writing dead_agent_flag=true, agents.enabled is UNCHANGED —
--                            this slice never writes agents.
--
-- FK note: agent_health_metrics.agent_id references agents(id) on delete cascade — a real agent row is seeded
-- in-txn to satisfy it, then rolled back.

\set ON_ERROR_STOP on
begin;

do $$
declare
  a_id            uuid;
  v_enabled       boolean;
  v_scope         jsonb;
  v_success       numeric;
  v_dead          boolean;
  v_rmc           int;
  v_beat1         timestamptz;
  v_beat2         timestamptz;
  n               bigint;
begin
  -- ── seed a real agent (satisfies the FK; agents requires name/description/memory_scope/change_reason) ────────
  insert into agents (name, description, memory_scope, change_reason)
    values ('smoke_health_agent', 'ISSUE-065 live-smoke agent',
            '{"scope_tokens":["leads","contacts"]}'::jsonb, 'issue-065 live-smoke')
    returning id into a_id;
  raise notice 'seed: agent id=%', a_id;

  -- ── (A) READ shapes the adapter uses ────────────────────────────────────────────────────────────────────
  -- loadScope: memory_scope->'scope_tokens'
  select (memory_scope->'scope_tokens') into v_scope from agents where id = a_id;
  if v_scope is null or jsonb_array_length(v_scope) <> 2 then
    raise exception 'FAIL A1: scope_tokens projection wrong: %', v_scope;
  end if;
  raise notice 'PASS A1: loadScope projection ok (%)', v_scope;

  -- isAgentEnabled
  select enabled into v_enabled from agents where id = a_id;
  if v_enabled is not true then raise exception 'FAIL A2: new agent not enabled'; end if;
  raise notice 'PASS A2: isAgentEnabled ok (enabled=%)', v_enabled;

  -- loadOutcomes shape (no rows expected; proves the columns/casts exist)
  perform event_type, created_at as at, answer_mode, (payload->>'human_decision')::text
    from event_log
   where event_type in ('task_completed','task_failed') and payload->>'agent_id' = a_id::text;
  raise notice 'PASS A3: loadOutcomes select shape compiles against live event_log';

  -- loadBehaviourSample shape
  perform unnest(coalesce(entity_ids,'{}'))::text
    from event_log
   where event_type in ('memory_read','tool_called') and payload->>'agent_id' = a_id::text;
  raise notice 'PASS A4: loadBehaviourSample select shape compiles';

  -- ── (B) upsertHealthMetrics — the ONE write (insert path) ──────────────────────────────────────────────
  insert into agent_health_metrics
      (agent_id, success_rate, failure_rate, last_run, drift_score, dead_agent_flag,
       routing_mismatch_count, producer_heartbeat, updated_at)
    values (a_id, 0.40, 0.60, now(), 0.75, true, coalesce(null, 0), now(), now())
    on conflict (agent_id) do update set
      success_rate=excluded.success_rate, failure_rate=excluded.failure_rate, last_run=excluded.last_run,
      drift_score=excluded.drift_score, dead_agent_flag=excluded.dead_agent_flag,
      routing_mismatch_count=coalesce(null, agent_health_metrics.routing_mismatch_count),
      producer_heartbeat=excluded.producer_heartbeat, updated_at=excluded.updated_at;
  select success_rate, dead_agent_flag, producer_heartbeat into v_success, v_dead, v_beat1
    from agent_health_metrics where agent_id = a_id;
  if v_success <> 0.40 or v_dead <> true or v_beat1 is null then
    raise exception 'FAIL B1: insert round-trip wrong (success=%, dead=%, beat=%)', v_success, v_dead, v_beat1;
  end if;
  raise notice 'PASS B1: upsert insert round-trip ok (success=%, dead=%, heartbeat stamped)', v_success, v_dead;

  -- simulate LRN.002 (ISSUE-066) having set a routing_mismatch_count this slice must NOT clobber
  update agent_health_metrics set routing_mismatch_count = 7 where agent_id = a_id;

  -- ── (C) on-conflict re-run: advances heartbeat, PRESERVES routing_mismatch_count when producer passes NULL ──
  perform pg_sleep(0.01);
  insert into agent_health_metrics
      (agent_id, success_rate, failure_rate, last_run, drift_score, dead_agent_flag,
       routing_mismatch_count, producer_heartbeat, updated_at)
    values (a_id, 0.90, 0.10, now(), 0.10, false, coalesce(null, 0), clock_timestamp(), clock_timestamp())
    on conflict (agent_id) do update set
      success_rate=excluded.success_rate, failure_rate=excluded.failure_rate, last_run=excluded.last_run,
      drift_score=excluded.drift_score, dead_agent_flag=excluded.dead_agent_flag,
      routing_mismatch_count=coalesce(null, agent_health_metrics.routing_mismatch_count),
      producer_heartbeat=excluded.producer_heartbeat, updated_at=excluded.updated_at;
  select routing_mismatch_count, producer_heartbeat into v_rmc, v_beat2
    from agent_health_metrics where agent_id = a_id;
  if v_rmc <> 7 then
    raise exception 'FAIL C1: routing_mismatch_count clobbered by health producer (got %, expected 7)', v_rmc;
  end if;
  if v_beat2 <= v_beat1 then
    raise exception 'FAIL C2: producer_heartbeat did not advance on re-run';
  end if;
  raise notice 'PASS C1/C2: routing_mismatch_count preserved (=7, LRN.002-owned) + heartbeat advanced';

  -- ── (D) FLAG-NEVER-AUTO-CORRECT: writing dead_agent_flag never disabled the agent (#2 / OD-078) ────────────
  select enabled into v_enabled from agents where id = a_id;
  if v_enabled is not true then
    raise exception 'FAIL D1: agent got disabled — this slice must never write agents.enabled';
  end if;
  raise notice 'PASS D1: agent still enabled after dead_agent_flag written (flag-never-auto-correct)';

  -- ── (E) sanity ─────────────────────────────────────────────────────────────────────────────────────────
  select count(*) into n from agent_health_metrics where agent_id = a_id;
  if n <> 1 then raise exception 'FAIL E1: expected exactly 1 metric row, found %', n; end if;
  raise notice 'PASS E1: exactly one agent_health_metrics row (upsert, not duplicate)';

  raise notice 'ALL ASSERTIONS PASS';
end $$;

rollback;
