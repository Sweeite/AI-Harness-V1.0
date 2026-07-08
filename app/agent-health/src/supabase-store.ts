// ISSUE-065 (C8 HLTH) — the LIVE pg adapter for AgentHealthStore. Runs as the service_role/owner connection
// (a system metric producer). NOT exercised by the offline suite — its behaviour is proven by the R10
// live-adapter smoke (results/live-smoke.sql, rolled back). Every method mirrors an InMemoryAgentHealthStore
// method 1:1, authored to the schema.md §9 agent_health_metrics DDL (already in the 0001 baseline) + the
// event_log terminal-event contract produced by ORC.007 (ISSUE-061).
//
// This adapter reads agents (memory_scope/enabled) READ-ONLY and reads event_log outcomes; its ONLY write is
// the agent_health_metrics upsert. It has NO statement that mutates agents — the structural guarantee behind
// flag-never-auto-correct (AC-8.HLTH.004.1 / NFR-OBS.015).

import type { Pool } from 'pg';
import {
  type AgentHealthStore,
  type AgentOutcome,
  type AgentBehaviourSample,
  type AgentScope,
  type HealthMetricsWrite,
  type HealthMetricsRow,
  type AnswerMode,
  type HumanDecision,
} from './store.ts';

export class SupabaseAgentHealthStore implements AgentHealthStore {
  constructor(private readonly pool: Pool) {}

  async listAgentIds(): Promise<string[]> {
    const r = await this.pool.query<{ id: string }>(`select id from public.agents`);
    return r.rows.map((row) => row.id);
  }

  async loadOutcomes(agentId: string): Promise<AgentOutcome[]> {
    // Terminal task events attributed to this agent. ORC.007 stamps the agent id into event_log.payload
    // ('agent_id') on task_completed/task_failed; the answer-mode pill is the event_log.answer_mode column;
    // the human approval/rejection outcome (OD-078) is carried in payload ('human_decision').
    const r = await this.pool.query<{
      event_type: 'task_completed' | 'task_failed';
      at: string;
      answer_mode: AnswerMode | null;
      human_decision: HumanDecision | null;
    }>(
      `select event_type,
              created_at as at,
              answer_mode,
              (payload->>'human_decision')::text as human_decision
         from public.event_log
        where event_type in ('task_completed','task_failed')
          and payload->>'agent_id' = $1
        order by created_at asc`,
      [agentId],
    );
    return r.rows.map((row) => ({
      agentId,
      outcome: row.event_type === 'task_completed' ? 'success' : 'failure',
      at: new Date(row.at).toISOString(),
      answerMode: row.answer_mode,
      humanDecision:
        row.human_decision === 'approved' || row.human_decision === 'rejected' ? row.human_decision : null,
    }));
  }

  async loadBehaviourSample(agentId: string): Promise<AgentBehaviourSample | null> {
    // Recent activity projected onto scope tokens: the entity types the agent read + the tools it called, from
    // event_log memory_read/tool_called events. NOTE: the exact projection is the AF-123 EVAL fast-follow — the
    // mechanism is here; the accuracy of "these tokens = real drift vs noise" is proven by the eval, not offline.
    const r = await this.pool.query<{ token: string }>(
      `select unnest(coalesce(entity_ids, '{}'))::text as token
         from public.event_log
        where event_type in ('memory_read','tool_called')
          and payload->>'agent_id' = $1`,
      [agentId],
    );
    if (r.rowCount === 0) return null; // no behaviour signal → drift surfaced as unknown, not fabricated 0
    return { agentId, observedScopeTokens: r.rows.map((row) => row.token) };
  }

  async loadScope(agentId: string): Promise<AgentScope | null> {
    // The declared least-privilege surface from agents.memory_scope (jsonb). Convention: memory_scope carries a
    // 'scope_tokens' string array (entity types / tool ids the agent is scoped to). Absent → null (not computable).
    const r = await this.pool.query<{ scope_tokens: string[] | null }>(
      `select (memory_scope->'scope_tokens') as scope_tokens
         from public.agents
        where id = $1`,
      [agentId],
    );
    if (r.rowCount === 0) return null;
    const tokens = r.rows[0]!.scope_tokens;
    if (tokens === null) return null; // no declared tokens → drift not computable (surfaced, not 0)
    return { agentId, allowedScopeTokens: tokens };
  }

  async isAgentEnabled(agentId: string): Promise<boolean> {
    const r = await this.pool.query<{ enabled: boolean }>(
      `select enabled from public.agents where id = $1`,
      [agentId],
    );
    if (r.rowCount === 0) throw new Error(`agent '${agentId}' not found — cannot read enabled state`);
    return r.rows[0]!.enabled;
  }

  async upsertHealthMetrics(m: HealthMetricsWrite): Promise<void> {
    // The ONE write. producer_heartbeat is stamped from the caller's cycle time. routing_mismatch_count is
    // owned by LRN.002 (ISSUE-066) — only overwritten when this producer explicitly supplies it, else left as-is.
    await this.pool.query(
      `insert into public.agent_health_metrics
         (agent_id, success_rate, failure_rate, last_run, drift_score, dead_agent_flag,
          routing_mismatch_count, producer_heartbeat, updated_at)
       values ($1, $2, $3, $4, $5, $6, coalesce($7, 0), $8, $8)
       on conflict (agent_id) do update set
         success_rate           = excluded.success_rate,
         failure_rate           = excluded.failure_rate,
         last_run               = excluded.last_run,
         drift_score            = excluded.drift_score,
         dead_agent_flag        = excluded.dead_agent_flag,
         routing_mismatch_count = coalesce($7, public.agent_health_metrics.routing_mismatch_count),
         producer_heartbeat     = excluded.producer_heartbeat,
         updated_at             = excluded.updated_at`,
      [
        m.agentId,
        m.successRate,
        m.failureRate,
        m.lastRun,
        m.driftScore,
        m.deadAgentFlag,
        m.routingMismatchCount ?? null,
        m.producerHeartbeat,
      ],
    );
  }

  async loadHealthMetrics(agentId: string): Promise<HealthMetricsRow | null> {
    const r = await this.pool.query<{
      agent_id: string;
      success_rate: string | null;
      failure_rate: string | null;
      last_run: string | null;
      drift_score: string | null;
      dead_agent_flag: boolean;
      routing_mismatch_count: number;
      producer_heartbeat: string | null;
      updated_at: string;
    }>(
      `select agent_id, success_rate, failure_rate, last_run, drift_score, dead_agent_flag,
              routing_mismatch_count, producer_heartbeat, updated_at
         from public.agent_health_metrics
        where agent_id = $1`,
      [agentId],
    );
    if (r.rowCount === 0) return null;
    const row = r.rows[0]!;
    // pg returns `numeric` as string — parse back to number|null so the fake and the live row match 1:1.
    const num = (v: string | null): number | null => (v === null ? null : Number(v));
    return {
      agentId: row.agent_id,
      successRate: num(row.success_rate),
      failureRate: num(row.failure_rate),
      lastRun: row.last_run === null ? null : new Date(row.last_run).toISOString(),
      driftScore: num(row.drift_score),
      deadAgentFlag: row.dead_agent_flag,
      routingMismatchCount: row.routing_mismatch_count,
      producerHeartbeat: row.producer_heartbeat === null ? null : new Date(row.producer_heartbeat).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }
}
