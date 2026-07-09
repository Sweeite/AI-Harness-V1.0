// ISSUE-067 (surface-09) — the SEEDED signals for the agent Builder, rendered through the honest seam on the
// dev-auth path (no live DB — the walking-skeleton "see it" goal; the live @harness/orchestrator / agent-health /
// execution-plans adapters are the per-deployment concern). NO client_slug anywhere (ADR-001 §3 — the slug survives
// only inside the bare `name`, OD-177/OD-096). Every row's shape MIRRORS the real tables (agents / agent_health_metrics
// / execution_plans / prompt_layers) so the render exercises the true fields; the load-bearing invariants (reject-at-
// write hard limits, OD-080 authority, memory_scope shape) are the REAL agent-bridge kernels, not re-encoded here.
//
// The seed carries every honest-state edge on purpose: a drift-flagged agent (still enabled — never auto-changed), a
// dead-agent-flagged agent (still enabled — never auto-disabled), a stalled-heartbeat agent (STALE, never last-known
// green), an agent whose health probe can't be confirmed (badges read "—", never green/0), a disabled agent (retained
// + shown), and an agent with no `core` prompt layer (assembly-halt note, never a blank).

import {
  InMemoryToolClassifier,
  DEFAULT_STEP_FAILURE_MODE,
  type AgentDomain,
  type MemoryScope,
  type StepFailureMode,
  type ToolClassifier,
} from './agents-seam.ts';

// ── C3 `tools` (id + coarse category + the reject-at-write hard-limit class tag). ─────────────────────────
export interface DemoTool {
  id: string;
  label: string;
  category: 'read' | 'write';
  /** the C3-identity hard-limit class (memory_write / autonomous_send / transaction), or null = benign. */
  hardLimitClass: 'memory_write' | 'autonomous_send' | 'transaction' | null;
}

export const DEMO_TOOLS: readonly DemoTool[] = [
  { id: 'tool-web-search', label: 'Web search', category: 'read', hardLimitClass: null },
  { id: 'tool-crm-read', label: 'CRM read', category: 'read', hardLimitClass: null },
  { id: 'tool-calendar-read', label: 'Calendar read', category: 'read', hardLimitClass: null },
  { id: 'tool-draft-email', label: 'Draft email (to approval queue)', category: 'write', hardLimitClass: null },
  { id: 'tool-draft-doc', label: 'Draft document', category: 'write', hardLimitClass: null },
  { id: 'tool-send-email', label: 'Send email (autonomous)', category: 'write', hardLimitClass: 'autonomous_send' },
  { id: 'tool-initiate-payment', label: 'Initiate payment', category: 'write', hardLimitClass: 'transaction' },
  { id: 'tool-memory-write', label: 'Memory write', category: 'write', hardLimitClass: 'memory_write' },
];

/** The offline reference tool classifier (id → forbidden class) — the SAME kernel the greyed picker + save-time deny
 *  use, so what the UI greys and what the write denies are byte-identical (OD-140, no drift). */
export function demoClassifier(): ToolClassifier {
  return new InMemoryToolClassifier(
    DEMO_TOOLS.filter((t) => t.hardLimitClass !== null).map((t) => [t.id, t.hardLimitClass!] as const),
  );
}

export const TOOL_LABEL: Record<string, string> = Object.fromEntries(DEMO_TOOLS.map((t) => [t.id, t.label]));

// ── agent_health_metrics (per-agent badges — success/failure rate, last-run, drift, dead-agent, heartbeat). ─
export interface DemoHealth {
  successRate: number; // 0..1
  failureRate: number; // 0..1
  lastRun: string;
  driftScore: number; // 0..1 — higher = more drift from scope
  driftFlag: boolean; // raised for HUMAN review; nothing auto-changed (HLTH.002.1)
  deadAgentFlag: boolean; // flagged; the agent stays ENABLED until a human decides (HLTH.003.2 / OD-078)
  producerHeartbeat: 'fresh' | 'stalled'; // a stalled producer → STALE, never last-known-good green (HLTH.004.2)
  heartbeatAsOf: string;
  /** 'unknown' ⇒ this agent's health probe could not be confirmed → badges render "—"/"health unavailable",
   *  NEVER a fabricated green/0 (the can't-confirm case, OD-198 ③ at per-agent granularity). */
  readState: 'ok' | 'unknown';
}

// ── C8 `agents` registry row (+ config-derived model + C4 Layer-1 read-through + demo version trail). ──────
export interface DemoVersion {
  id: string;
  version: number;
  previous_version_id: string | null;
  change_reason: string;
  /** true ⇒ a capability change (memory_scope / tools_allowed / enabled) — flagged as an authority change (REG.004). */
  capabilityChange: boolean;
  updatedAt: string;
  summary: string;
}

export interface DemoAgent {
  id: string; // current-version id (the version chain's head)
  name: string; // bare role slug — NO client_slug (AC-8.REG.001.3)
  domain: AgentDomain;
  description: string; // the routing signal (REG.001.2) — edited here fixes mis-routing (ORC.003.1)
  memory_scope: MemoryScope;
  tools_allowed: string[]; // → tools.id
  max_tokens: number | null;
  enabled: boolean;
  version: number;
  previous_version_id: string | null;
  isOrchestrator: boolean;
  /** read-only, config-derived — NOT an agents.model column (FR-8.REG.001 defines none; model is complexity-routed,
   *  FR-8.COST.001, sourced from surface-01 config). */
  model: string;
  /** the C4 prompt_layers Layer-1 read-through (layer='core'). null ⇒ no core layer → "assembly will halt"
   *  (FR-4.LYR.004), never a blank that looks fine (AC-8.REG.002.1). */
  layer1: string | null;
  health: DemoHealth;
  history: DemoVersion[]; // immutable version trail, newest first (Section C)
}

function v(
  id: string,
  version: number,
  previous_version_id: string | null,
  change_reason: string,
  capabilityChange: boolean,
  updatedAt: string,
  summary: string,
): DemoVersion {
  return { id, version, previous_version_id, change_reason, capabilityChange, updatedAt, summary };
}

export const DEMO_AGENTS: readonly DemoAgent[] = [
  {
    id: 'agent-orchestrator', name: 'orchestrator', domain: 'client', isOrchestrator: true,
    description: 'The routing brain — plans task graphs and delegates to specialists; performs no domain work itself.',
    memory_scope: { tiers: ['semantic', 'episodic', 'procedural', 'entity'], entity_model: true, tool_registry: true },
    tools_allowed: [], max_tokens: null, enabled: true, version: 3, previous_version_id: 'agent-orchestrator-v2',
    model: 'complexity-routed (default_model / lightweight_model — surface-01)',
    layer1: 'You are the orchestrator. Decompose the task, choose the cheapest chain that satisfies it, and delegate.',
    health: { successRate: 0.991, failureRate: 0.009, lastRun: '09:21', driftScore: 0.04, driftFlag: false, deadAgentFlag: false, producerHeartbeat: 'fresh', heartbeatAsOf: '09:21', readState: 'ok' },
    history: [
      v('agent-orchestrator', 3, 'agent-orchestrator-v2', 'sharpen delegation prompt for two-agent chains', false, '2026-07-08', 'description tuning'),
      v('agent-orchestrator-v2', 2, 'agent-orchestrator-v1', 'widen memory scope to procedural tier', true, '2026-06-30', 'capability: memory_scope'),
      v('agent-orchestrator-v1', 1, null, 'seed (canonical roster)', true, '2026-06-01', 'initial'),
    ],
  },
  {
    id: 'agent-comms', name: 'comms', domain: 'comms', isOrchestrator: false,
    description: 'Drafts outbound communications for human review. Never sends autonomously — output lands as an approval-queue draft.',
    memory_scope: { tiers: ['semantic', 'episodic'], entity_model: true, tool_registry: false, note: 'brand voice + client history' },
    tools_allowed: ['tool-crm-read', 'tool-draft-email'], max_tokens: 4096, enabled: true, previous_version_id: 'agent-comms-v1', version: 2,
    model: 'complexity-routed (lightweight_model for drafts)',
    layer1: 'You are the Comms specialist. Draft on-brand outbound messages for human approval. You never send.',
    health: { successRate: 0.973, failureRate: 0.027, lastRun: '09:18', driftScore: 0.08, driftFlag: false, deadAgentFlag: false, producerHeartbeat: 'fresh', heartbeatAsOf: '09:19', readState: 'ok' },
    history: [
      v('agent-comms', 2, 'agent-comms-v1', 'add CRM-read for personalisation context', true, '2026-07-02', 'capability: tools_allowed'),
      v('agent-comms-v1', 1, null, 'seed (canonical roster)', true, '2026-06-01', 'initial'),
    ],
  },
  {
    id: 'agent-finance', name: 'finance', domain: 'finance', isOrchestrator: false,
    description: 'Read-heavy finance analysis under a finance-scoped Confidential clearance. Never initiates a transaction — a payment-implying task becomes a human flag.',
    memory_scope: { tiers: ['semantic', 'entity'], entity_model: true, tool_registry: false, note: 'finance records only' },
    tools_allowed: ['tool-crm-read'], max_tokens: 4096, enabled: true, version: 1, previous_version_id: null,
    model: 'complexity-routed (default_model)',
    layer1: 'You are the Finance specialist. Analyse finance records. You never transact; you flag for a human.',
    health: { successRate: 0.998, failureRate: 0.002, lastRun: '08:55', driftScore: 0.03, driftFlag: false, deadAgentFlag: false, producerHeartbeat: 'fresh', heartbeatAsOf: '09:20', readState: 'ok' },
    history: [v('agent-finance', 1, null, 'seed (canonical roster)', true, '2026-06-01', 'initial')],
  },
  {
    id: 'agent-memory', name: 'memory', domain: 'memory', isOrchestrator: false,
    description: 'The sole memory-writer (ADR-004 single writer). All other agents route memory writes through it.',
    memory_scope: { tiers: ['semantic', 'episodic', 'procedural', 'entity'], entity_model: true, tool_registry: false },
    tools_allowed: ['tool-memory-write'], max_tokens: 2048, enabled: true, version: 1, previous_version_id: null,
    model: 'complexity-routed (lightweight_model)',
    layer1: 'You are the Memory agent. You are the only writer to long-term memory. Consolidate carefully.',
    health: { successRate: 0.999, failureRate: 0.001, lastRun: '09:20', driftScore: 0.02, driftFlag: false, deadAgentFlag: false, producerHeartbeat: 'fresh', heartbeatAsOf: '09:21', readState: 'ok' },
    history: [v('agent-memory', 1, null, 'seed (canonical roster)', true, '2026-06-01', 'initial')],
  },
  {
    id: 'agent-research', name: 'research', domain: 'research', isOrchestrator: false,
    description: 'Read-only information gathering, placed first in any chain that needs context.',
    memory_scope: { tiers: ['semantic'], entity_model: true, tool_registry: false },
    tools_allowed: ['tool-web-search', 'tool-crm-read'], max_tokens: 8192, enabled: true, version: 4, previous_version_id: 'agent-research-v3',
    model: 'complexity-routed (default_model)',
    layer1: 'You are the Research specialist. Gather and cite; you do not act.',
    // DRIFT flagged for human review — nothing auto-changed, agent stays enabled (HLTH.002.1 / HLTH.003.2).
    health: { successRate: 0.94, failureRate: 0.06, lastRun: '09:05', driftScore: 0.71, driftFlag: true, deadAgentFlag: false, producerHeartbeat: 'fresh', heartbeatAsOf: '09:20', readState: 'ok' },
    history: [
      v('agent-research', 4, 'agent-research-v3', 'note: outputs drifting toward opinion — under review', false, '2026-07-07', 'description tuning'),
      v('agent-research-v3', 3, 'agent-research-v2', 'add web-search tool', true, '2026-06-20', 'capability: tools_allowed'),
      v('agent-research-v2', 2, 'agent-research-v1', 'raise max_tokens for long reports', false, '2026-06-10', 'tuning'),
      v('agent-research-v1', 1, null, 'seed (canonical roster)', true, '2026-06-01', 'initial'),
    ],
  },
  {
    id: 'agent-client', name: 'client', domain: 'client', isOrchestrator: false,
    description: 'Client-relationship domain — owns the client-facing relationship context.',
    memory_scope: { tiers: ['semantic', 'episodic', 'entity'], entity_model: true, tool_registry: false },
    tools_allowed: ['tool-crm-read', 'tool-calendar-read'], max_tokens: 4096, enabled: true, version: 1, previous_version_id: null,
    model: 'complexity-routed (default_model)',
    layer1: 'You are the Client specialist. Maintain relationship context and next-best-actions.',
    // DEAD-AGENT flagged (no successful run in the window) but STILL ENABLED — never auto-disabled (HLTH.003.2 / OD-078).
    health: { successRate: 0.0, failureRate: 0.0, lastRun: '2026-07-06', driftScore: 0.12, driftFlag: false, deadAgentFlag: true, producerHeartbeat: 'fresh', heartbeatAsOf: '09:20', readState: 'ok' },
    history: [v('agent-client', 1, null, 'seed (canonical roster)', true, '2026-06-01', 'initial')],
  },
  {
    id: 'agent-ops', name: 'ops', domain: 'ops', isOrchestrator: false,
    description: 'Operational coordination — schedules and tracks internal execution.',
    memory_scope: { tiers: ['procedural', 'entity'], entity_model: true, tool_registry: false },
    tools_allowed: ['tool-calendar-read'], max_tokens: 4096, enabled: true, version: 1, previous_version_id: null,
    model: 'complexity-routed (lightweight_model)',
    layer1: 'You are the Ops specialist. Coordinate scheduling and internal follow-through.',
    // STALLED producer heartbeat → health reads STALE, never last-known-good green (HLTH.004.2).
    health: { successRate: 0.96, failureRate: 0.04, lastRun: '07:41', driftScore: 0.05, driftFlag: false, deadAgentFlag: false, producerHeartbeat: 'stalled', heartbeatAsOf: '07:41', readState: 'ok' },
    history: [v('agent-ops', 1, null, 'seed (canonical roster)', true, '2026-06-01', 'initial')],
  },
  {
    id: 'agent-campaign', name: 'campaign', domain: 'campaign', isOrchestrator: false,
    description: 'Campaign planning and execution — paused pending a strategy refresh.',
    memory_scope: { tiers: ['semantic', 'episodic'], entity_model: true, tool_registry: false },
    tools_allowed: ['tool-crm-read', 'tool-draft-doc'], max_tokens: 4096, enabled: false, version: 2, previous_version_id: 'agent-campaign-v1',
    model: 'complexity-routed (default_model)',
    layer1: 'You are the Campaign specialist. Plan and execute campaigns within brand + budget guardrails.',
    // DISABLED — retained + shown; excluded from routing (REG.005.1). Its row + history persist.
    health: { successRate: 0.9, failureRate: 0.1, lastRun: '2026-07-03', driftScore: 0.09, driftFlag: false, deadAgentFlag: false, producerHeartbeat: 'fresh', heartbeatAsOf: '09:18', readState: 'ok' },
    history: [
      v('agent-campaign', 2, 'agent-campaign-v1', 'disable pending strategy refresh', true, '2026-07-03', 'capability: enabled=false'),
      v('agent-campaign-v1', 1, null, 'seed (canonical roster)', true, '2026-06-01', 'initial'),
    ],
  },
  {
    id: 'agent-insight', name: 'insight', domain: 'insight', isOrchestrator: false,
    description: 'Slow-loop-only cross-cutting insight. Read-all, no write, not selectable on demand.',
    memory_scope: { tiers: ['semantic', 'episodic', 'procedural', 'entity'], entity_model: true, tool_registry: false },
    tools_allowed: ['tool-web-search'], max_tokens: 8192, enabled: true, version: 1, previous_version_id: null,
    model: 'complexity-routed (default_model)',
    // NO 'core' Layer-1 → "assembly will halt", never a blank (AC-8.REG.002.1 / FR-4.LYR.004).
    layer1: null,
    // Health probe cannot be confirmed → badges read "—"/"health unavailable", NEVER green/0 (badge-read failure).
    health: { successRate: 0, failureRate: 0, lastRun: '—', driftScore: 0, driftFlag: false, deadAgentFlag: false, producerHeartbeat: 'fresh', heartbeatAsOf: '—', readState: 'unknown' },
    history: [v('agent-insight', 1, null, 'seed (canonical roster)', true, '2026-06-01', 'initial')],
  },
];

/** The health map keyed by agent id — read as a SEPARATE seeded read (agent_health_metrics is its own table with its
 *  own freshness; a failed health read shows honest placeholders while the fleet still lists agents). */
export function demoHealthMap(): Record<string, DemoHealth> {
  return Object.fromEntries(DEMO_AGENTS.map((a) => [a.id, a.health]));
}

// ── C5/C8 `execution_plans` (versioned plans per task type; per-step failure mode; human-decided rollback). ─
export interface DemoPlanStep {
  order: number;
  label: string;
  /** null ⇒ no explicit mode → the halt-and-escalate safe default is shown (AC-8.PLAN.002.1). */
  failureMode: StepFailureMode | null;
}
export interface DemoPlan {
  id: string;
  taskType: string;
  version: number;
  previous_version_id: string | null;
  steps: DemoPlanStep[];
  updatedAt: string;
  /** true ⇒ this plan's latest read is uncertain/stale → rollback is DISABLED (never act on uncertain state). */
  uncertain: boolean;
}

export const DEMO_PLANS: readonly DemoPlan[] = [
  {
    id: 'plan-weekly-report', taskType: 'weekly_client_report', version: 3, previous_version_id: 'plan-weekly-report-v2', updatedAt: '2026-07-05', uncertain: false,
    steps: [
      { order: 1, label: 'research: gather week activity', failureMode: 'retry' },
      { order: 2, label: 'insight: summarise trends', failureMode: 'skip_and_continue' },
      { order: 3, label: 'comms: draft report to approval queue', failureMode: null }, // → halt-and-escalate default
    ],
  },
  {
    id: 'plan-onboard-client', taskType: 'onboard_new_client', version: 1, previous_version_id: null, updatedAt: '2026-06-14', uncertain: true,
    steps: [
      { order: 1, label: 'client: build relationship profile', failureMode: 'halt_and_escalate' },
      { order: 2, label: 'ops: schedule kickoff', failureMode: null }, // → halt-and-escalate default
    ],
  },
];

export const DEFAULT_FAILURE_MODE: StepFailureMode = DEFAULT_STEP_FAILURE_MODE;

export const STEP_FAILURE_LABEL: Record<StepFailureMode, string> = {
  retry: 'retry',
  skip_and_continue: 'skip & continue',
  halt_and_escalate: 'halt & escalate',
};

// ── Orchestration & routing readout (Section D) — read-only; edited on surface-01 #agents. ────────────────
export interface DemoRouting {
  orchestratorConfidenceThreshold: number | null;
  chainDepthLimit: number | null;
  defaultModel: string | null;
  lightweightModel: string | null;
  cacheWindows: Array<{ label: string; value: string | null }>;
  routingWeights: Array<{ agent: string; weight: number | null }>;
  /** the LRN.002 routing-mismatch pointer → links to the implicated agent's Builder (its description may need updating). */
  routingMismatch: { taskType: string; implicatedAgent: string; note: string } | null;
}

export const DEMO_ROUTING: DemoRouting = {
  orchestratorConfidenceThreshold: 0.62,
  chainDepthLimit: 4,
  defaultModel: 'default_model',
  lightweightModel: 'lightweight_model',
  cacheWindows: [
    { label: 'plan cache window', value: '15m' },
    { label: 'routing cache window', value: '5m' },
    { label: 'model-choice cache', value: null }, // missing → renders "—", never a fabricated default
  ],
  routingWeights: [
    { agent: 'research', weight: 1.2 },
    { agent: 'comms', weight: 1.0 },
    { agent: 'finance', weight: 0.9 },
    { agent: 'client', weight: 1.0 },
    { agent: 'campaign', weight: null }, // disabled agent — no live weight → "—"
  ],
  routingMismatch: {
    taskType: 'weekly_client_report',
    implicatedAgent: 'agent-research',
    note: 'Tasks of type "weekly_client_report" are consistently rerouted away from research — its description may need updating.',
  },
};
