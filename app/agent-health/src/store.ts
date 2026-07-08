// ISSUE-065 (C8 HLTH) — the AgentHealthStore PORT + the in-memory reference fake, plus the constants + types
// the pure logic (health.ts), the live adapter (supabase-store.ts) and the index.ts non-drift `check` all share.
//
// This slice is a metric PRODUCER and NOTHING ELSE (FR-8.HLTH.004 / OD-078 / NFR-OBS.015 — flag-never-auto-
// correct). Deliberately, the port has:
//   • READS of the outcome signal (produced upstream by the orchestrator ORC.007, ISSUE-061, onto event_log) —
//     loadOutcomes — and READS of agents (memory_scope → scope tokens, and `enabled`, read-only) — loadScope /
//     isAgentEnabled. It reads `enabled` ONLY to prove, in a test, that a flagged agent is never disabled here.
//   • ONE write: upsertHealthMetrics — into agent_health_metrics (schema.md §9), stamping producer_heartbeat.
//   • NO method that mutates agents (no disable, no memory_scope edit). The absence of such a method is the
//     structural guarantee behind AC-8.HLTH.004.1 / AC-NFR-OBS.015.1: there is no code path in this slice that
//     can auto-correct or auto-disable an agent. A human takes that action via the registry-edit path
//     (agents.enabled, ISSUE-061/067), which lives in another slice entirely.
//
// The InMemoryAgentHealthStore fake is the reference model the live pg adapter (supabase-store.ts) must match
// 1:1 (proven by the R10 live smoke). All time is a caller-supplied logical `now` (epoch ms) — no Date.now()
// / no randomness (house determinism discipline, cf. app/loops-heartbeat).

// ── CFG defaults (config-registry.md §agents / §observability — the `check` guards these against drift) ────────
// The metric-production thresholds + the C7 poll cadence this slice's write rate must not outrun.
export const DEFAULT_DRIFT_THRESHOLD = 0.3; // CFG-drift_threshold — flag above this (config-registry: float 0–1)
export const DEFAULT_DEAD_AGENT_THRESHOLD = 0.5; // CFG-dead_agent_threshold — flag below this success/quality
export const DEFAULT_POLLING_INTERVAL_HEALTH_METRICS_S = 30; // CFG-polling_interval_health_metrics_s (C7 poll)

// The heartbeat staleness window: a producer whose heartbeat is older than this reads stale/unknown, never
// green (AC-8.HLTH.004.2 / NFR-OBS.005). It MUST exceed the producer cadence so a healthy producer is never
// mis-flagged. Defaulted at 3× the C7 poll interval; operator-tunable. NOTE: not yet a registered CFG key —
// flagged in the build report (sharedSpecEdits) so it lands in config-registry rather than as a silent magic
// number (Rule-0).
export const DEFAULT_HEARTBEAT_STALENESS_WINDOW_S = 3 * DEFAULT_POLLING_INTERVAL_HEALTH_METRICS_S; // 90s

// ── The answer-mode pill (schema.md §Types `answer_mode` enum) — a quality signal input for dead-agent (OD-078).
export const ANSWER_MODES = ['cited', 'inferred', 'unknown', 'building'] as const;
export type AnswerMode = (typeof ANSWER_MODES)[number];

export const HUMAN_DECISIONS = ['approved', 'rejected'] as const;
export type HumanDecision = (typeof HUMAN_DECISIONS)[number];

// ── The outcome signal this slice CONSUMES (produced by ORC.007 onto event_log; ISSUE-061 owns production). One
// completed/failed task attributed to the agent that ran it, with its optional answer-mode pill + human
// approval/rejection outcome (the three OD-078 quality signals). The live adapter derives these from event_log
// (task_completed/task_failed rows: agent_id in payload, answer_mode column, approval outcome in payload). ──────
export interface AgentOutcome {
  agentId: string;
  outcome: 'success' | 'failure'; // task_completed vs task_failed
  at: string; // ISO timestamp of the terminal event (feeds last_run)
  answerMode?: AnswerMode | null; // the pill on the AI output, if any
  humanDecision?: HumanDecision | null; // human approval/rejection outcome, if any
}

// ── The behaviour vs intended-scope inputs for specialisation-drift (FR-8.HLTH.002). `observedScopeTokens` is
// the agent's recent activity projected onto scope tokens (entity types touched / tools used, from event_log
// memory_read/tool_called events); `allowedScopeTokens` is the agent's declared least-privilege surface derived
// from agents.memory_scope + role. Drift = the fraction of recent activity that fell OUTSIDE the declared scope.
export interface AgentBehaviourSample {
  agentId: string;
  observedScopeTokens: string[]; // may contain repeats — each is one unit of observed activity
}
export interface AgentScope {
  agentId: string;
  allowedScopeTokens: string[]; // the declared memory_scope/role surface (deduped set semantics)
}

// ── What gets written to agent_health_metrics (schema.md §9). producerHeartbeat is stamped by the caller with
// the cycle's logical `now` — a successful producer run advances it; a stalled/failed run leaves it behind so
// the freshness reader flips the metric to stale, never carrying a last-known-good green (AC-8.HLTH.004.2). ─────
export interface HealthMetricsWrite {
  agentId: string;
  successRate: number | null; // null = no outcomes yet (unknown, NOT a green 0/1)
  failureRate: number | null;
  lastRun: string | null; // ISO; null = never run
  driftScore: number | null; // null = no behaviour signal (unknown, NOT a green 0)
  deadAgentFlag: boolean; // a FLAG only — never triggers a disable here (OD-078)
  routingMismatchCount?: number; // owned by LRN.002 (ISSUE-066); untouched here unless supplied
  producerHeartbeat: string; // ISO — the liveness stamp for this producer cycle
}

// A row as read back from agent_health_metrics.
export interface HealthMetricsRow {
  agentId: string;
  successRate: number | null;
  failureRate: number | null;
  lastRun: string | null;
  driftScore: number | null;
  deadAgentFlag: boolean;
  routingMismatchCount: number;
  producerHeartbeat: string | null; // null = a producer has never stamped it → reads unknown (never green)
  updatedAt: string;
}

// ── The port. Async-shaped so the pg adapter matches the fake exactly. ────────────────────────────────────────
export interface AgentHealthStore {
  /** The agents to produce metrics for (agents rows — read-only). */
  listAgentIds(): Promise<string[]>;
  /** Outcome signal for one agent (from event_log terminal events — produced by ORC.007). */
  loadOutcomes(agentId: string): Promise<AgentOutcome[]>;
  /** Recent behaviour projected onto scope tokens (null = no behaviour signal → drift unknown, not 0). */
  loadBehaviourSample(agentId: string): Promise<AgentBehaviourSample | null>;
  /** The agent's declared least-privilege scope (null = missing → drift cannot be computed → surfaced, not 0). */
  loadScope(agentId: string): Promise<AgentScope | null>;
  /** READ-ONLY. Proves the flag-never-disable invariant: a flagged agent is still enabled afterwards. */
  isAgentEnabled(agentId: string): Promise<boolean>;
  /** The ONE write — upsert agent_health_metrics, stamping producer_heartbeat. NEVER touches agents. */
  upsertHealthMetrics(m: HealthMetricsWrite): Promise<void>;
  /** Read back the metric row (for the freshness reader + C7). */
  loadHealthMetrics(agentId: string): Promise<HealthMetricsRow | null>;
}

// ── In-memory reference fake — the semantics the live adapter must match 1:1. ─────────────────────────────────
export class InMemoryAgentHealthStore implements AgentHealthStore {
  private readonly outcomes = new Map<string, AgentOutcome[]>();
  private readonly behaviour = new Map<string, AgentBehaviourSample>();
  private readonly scopes = new Map<string, AgentScope>();
  private readonly enabled = new Map<string, boolean>();
  private readonly metrics = new Map<string, HealthMetricsRow>();
  /** Observability of writes for tests — every upsert appended in order (the fake never loses a write, #1). */
  readonly writes: HealthMetricsWrite[] = [];

  // ── Seed helpers (test-only) ──
  /** Register an agent (enabled by default). An agent must exist before metrics are produced for it. */
  setAgent(agentId: string, opts: { enabled?: boolean; scope?: string[] } = {}): void {
    this.enabled.set(agentId, opts.enabled ?? true);
    if (opts.scope) this.scopes.set(agentId, { agentId, allowedScopeTokens: [...opts.scope] });
  }
  setOutcomes(agentId: string, outcomes: AgentOutcome[]): void {
    this.outcomes.set(agentId, outcomes.map((o) => ({ ...o })));
  }
  setBehaviour(agentId: string, observedScopeTokens: string[]): void {
    this.behaviour.set(agentId, { agentId, observedScopeTokens: [...observedScopeTokens] });
  }

  async listAgentIds(): Promise<string[]> {
    return [...this.enabled.keys()];
  }
  async loadOutcomes(agentId: string): Promise<AgentOutcome[]> {
    return (this.outcomes.get(agentId) ?? []).map((o) => ({ ...o }));
  }
  async loadBehaviourSample(agentId: string): Promise<AgentBehaviourSample | null> {
    const b = this.behaviour.get(agentId);
    return b ? { agentId: b.agentId, observedScopeTokens: [...b.observedScopeTokens] } : null;
  }
  async loadScope(agentId: string): Promise<AgentScope | null> {
    const s = this.scopes.get(agentId);
    return s ? { agentId: s.agentId, allowedScopeTokens: [...s.allowedScopeTokens] } : null;
  }
  async isAgentEnabled(agentId: string): Promise<boolean> {
    const e = this.enabled.get(agentId);
    if (e === undefined) throw new Error(`agent '${agentId}' not found — cannot read enabled state`);
    return e;
  }

  async upsertHealthMetrics(m: HealthMetricsWrite): Promise<void> {
    this.writes.push({ ...m });
    const prev = this.metrics.get(m.agentId);
    this.metrics.set(m.agentId, {
      agentId: m.agentId,
      successRate: m.successRate,
      failureRate: m.failureRate,
      lastRun: m.lastRun,
      driftScore: m.driftScore,
      deadAgentFlag: m.deadAgentFlag,
      // routing_mismatch_count is owned by LRN.002 (ISSUE-066); preserve it if this producer didn't supply it.
      routingMismatchCount: m.routingMismatchCount ?? prev?.routingMismatchCount ?? 0,
      producerHeartbeat: m.producerHeartbeat,
      updatedAt: m.producerHeartbeat,
    });
  }
  async loadHealthMetrics(agentId: string): Promise<HealthMetricsRow | null> {
    const r = this.metrics.get(agentId);
    return r ? { ...r } : null;
  }
}
