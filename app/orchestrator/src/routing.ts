// ISSUE-061 (C8 ORC.001–007) — the seven-step routing engine + its supporting stores/sinks. The orchestrator
// routes and plans ONLY; it invokes no domain/action tool (ORC.001.1). The engine is deterministic + offline-
// testable: all randomness/time is caller-supplied. The seven steps (per §8.8):
//   1 dequeue + crash-window guard (ORC.001)   — read the task at the queue front; never dequeued-but-unplanned
//   2 classify (ORC.002)                        — domain/complexity/context/output; ambiguity lowers confidence
//   3 registry-read (ORC.003)                   — read enabled rows; route by DESCRIPTION, never a hardcoded map
//   4 score (ORC.004)                           — weighted routing score per candidate; log every score
//   5 build plan (ORC.005)                      — simple→single, complex→chain w/ deps+parallel+failure-mode
//   6 confidence-check (ORC.006 / OD-077)       — < threshold ⇒ clarification, awaiting-clarification, no execute
//   7 version + log + outcome (ORC.007)         — persist plan w/ version; outcome recorded; secondary-sink guard
//
// Boundaries this slice STOPS at (verify §5): the failure-mode taxonomy/semantics + outcome model (ISSUE-064),
// the memory-scope enforcement filter (ISSUE-063), failure-mode EXECUTION + the context envelope + run pipeline
// (ISSUE-050/052/053). This slice MARKS every step with a failure mode and WRITES the plan into the envelope's
// `execution_plan` field; it does not execute it. Routing-accuracy/confidence/outcome are AF-121/122/126 (EVAL).

import type { AgentDomain, AgentRegistry, AgentRow } from './registry.ts';

// ── §Classification (ORC.002) ────────────────────────────────────────────────────────────────────
export const COMPLEXITIES = ['single', 'multi'] as const;
export type Complexity = (typeof COMPLEXITIES)[number];
export const OUTPUT_TYPES = ['action', 'draft', 'summary', 'flag'] as const;
export type OutputType = (typeof OUTPUT_TYPES)[number];

/** The routing record's classification (ORC.002.1 — recorded on the record). `ambiguous` propagates to the
 * confidence check (ORC.002.2) — never silently defaulted. */
export interface Classification {
  domain: AgentDomain;
  complexity: Complexity;
  context: { entity_ids: string[]; memory_scope_hint?: string };
  output: OutputType;
  ambiguous: boolean; // when true, confidence is penalised (feeds ORC.006)
}

/** What the caller hands the orchestrator to classify. In production a Sonnet call derives this; offline the test
 * supplies a deterministic Classifier. */
export interface TaskInput {
  task_id: string;
  task_name: string;
  payload: unknown;
}
export interface Classifier {
  classify(task: TaskInput): Classification;
}

// ── §Scoring (ORC.004) — the four configurable weights (CFG-routing_weights; sum = 1.0). ──────────
export interface RoutingWeights {
  domain_match: number;
  complexity_fit: number;
  memory_scope_fit: number;
  tool_scope_fit: number;
}
export const DEFAULT_ROUTING_WEIGHTS: RoutingWeights = {
  domain_match: 0.35,
  complexity_fit: 0.25,
  memory_scope_fit: 0.2,
  tool_scope_fit: 0.2,
}; // config-registry.md §K App.A defaults

export function weightsSumToOne(w: RoutingWeights): boolean {
  const s = w.domain_match + w.complexity_fit + w.memory_scope_fit + w.tool_scope_fit;
  return Math.abs(s - 1.0) < 1e-9;
}

/** The engine's config knobs (CFG-* §K). Read at runtime — a changed weight takes effect on the NEXT task
 * (ORC.004.2) because the engine reads `config` fresh each route(). */
export interface RoutingConfig {
  confidenceThreshold: number; // CFG-orchestrator_confidence_threshold (0.75)
  chainDepthLimit: number; // CFG-chain_depth_limit (6)
  weights: RoutingWeights; // CFG-routing_weights
  parallelExecutionEnabled: boolean; // CFG-parallel_execution_enabled (false)
}
export const DEFAULT_ROUTING_CONFIG: RoutingConfig = {
  confidenceThreshold: 0.75,
  chainDepthLimit: 6,
  weights: DEFAULT_ROUTING_WEIGHTS,
  parallelExecutionEnabled: false,
};

/** A per-candidate routing score (ORC.004.1) — recorded (the signal ISSUE-065/066 consume). */
export interface CandidateScore {
  agent_id: string;
  agent_name: string;
  domain_match: number;
  complexity_fit: number;
  memory_scope_fit: number;
  tool_scope_fit: number;
  total: number; // weighted sum
}

// ── §Plan (ORC.005) — the execution plan written into the C5 envelope. The per-step failure-mode TAXONOMY is
// owned by ISSUE-064; this slice guarantees every step CARRIES one (marked, not interpreted). ─────────────
export const STEP_FAILURE_MODES = ['halt_escalate', 'retry', 'skip'] as const;
export type StepFailureMode = (typeof STEP_FAILURE_MODES)[number];

export interface PlanStep {
  index: number;
  agent_id: string;
  agent_name: string;
  depends_on: number[]; // indices of prerequisite steps
  parallel_eligible: boolean;
  failure_mode: StepFailureMode; // EVERY step carries one (ORC.005.2 / PLAN.001) — default halt_escalate (PLAN.002)
}
export interface ExecutionPlan {
  task_type_name: string;
  steps: PlanStep[];
  parallel: boolean; // whether any step is parallel-eligible AND parallel execution is enabled
}

/** The C5 context envelope this slice WRITES the plan into (ORC.005.3). C5 (ISSUE-050) owns the envelope
 * machinery; the orchestrator only sets `execution_plan`. Modelled as a seam the fake implements. */
export interface EnvelopeSink {
  setExecutionPlan(taskId: string, plan: ExecutionPlan): void;
}

// ── §Plan store (ORC.007 / co-owned execution_plans, ISSUE-064). Append-only versioned plan store. ──
export interface PlanStore {
  /** Persist a NEW plan version for a task type; links previous_version_id; returns the version id. */
  saveVersion(plan: ExecutionPlan, previousVersionId: string | null, now: number): Promise<{ id: string; version: number }>;
  /** Record the outcome of an executed plan version (per-step success/failure/skip). ORC.007.1. */
  recordOutcome(planVersionId: string, outcome: PlanOutcome, now: number): Promise<void>;
  /** Retrieve a plan version (for the re-plan link + audit). */
  getVersion(id: string): Promise<{ id: string; version: number; plan: ExecutionPlan; previous_version_id: string | null } | null>;
}
export interface PlanOutcome {
  status: 'success' | 'failure' | 'partial';
  per_step: { index: number; result: 'success' | 'failure' | 'skip' }[];
}

// ── §event_log seam (C7 / ISSUE-011). The engine EMITS every classification/candidate-set/score/plan/confidence/
// outcome here (§8.9 observability). The port mirrors the event_log append shape (schema.md §8). ────────
export const ORC_EVENT_TYPES = [
  'routing_classified',
  'routing_candidates',
  'routing_scored',
  'routing_planned',
  'routing_low_confidence',
  'routing_clarification_escalated',
  'routing_chain_trimmed',
  'routing_outcome',
  'routing_unroutable',
  'routing_crash_recovered',
] as const;
export type OrcEventType = (typeof ORC_EVENT_TYPES)[number];

export interface RoutingEvent {
  task_id: string;
  event_type: OrcEventType;
  entity_ids: string[];
  summary: string; // plain-English, never empty (mirrors AC-7.LOG.002.2)
  payload: Record<string, unknown>;
}
export interface EventSink {
  append(ev: RoutingEvent): Promise<void>;
}

/** The SECONDARY sink (ORC.007.2 / L8) — distinct from the primary event_log channel, used ONLY to surface a
 * PRIMARY-sink write failure ("the reporter of failures must not be the thing that failed"). Never the happy path. */
export interface SecondarySink {
  reportPrimaryFailure(ev: RoutingEvent, cause: unknown, now: number): Promise<void>;
}

// ── §Task-queue seam (C5 / ISSUE-048). The engine reads the task at the front (ORC.001), and on low confidence
// sets the awaiting-clarification status (ORC.006). Modelled as the narrow slice the engine touches. ─────
export interface QueueGate {
  /** The task currently at the front (already RBAC/clearance-cleared, §preconditions). Null if empty. */
  front(): Promise<TaskInput | null>;
  /** Return the task to a re-routable (pending) state — the crash-window recovery (ORC.001.3) + unroutable halt. */
  returnToRoutable(taskId: string, now: number): Promise<void>;
  /** Set the task to awaiting-clarification (ORC.006). Does NOT execute the plan. */
  setAwaitingClarification(taskId: string, now: number): Promise<void>;
  /** Escalate an unanswered clarification past the window (ORC.006.2 / OD-077). Never auto-proceeds. */
  escalateStaleClarifications(now: number): Promise<string[]>;
}

// ── Exact rejection / marker messages. ──────────────────────────────────────────────────────────
export const ERR_UNROUTABLE = (taskId: string) =>
  `orchestrator: task '${taskId}' is unroutable — halting and escalating, not silently consumed (AC-8.ORC.001.2 / #3)`;
export const ERR_HARDCODED_ROUTE =
  'orchestrator: a hardcoded task→agent mapping is rejected — routing is data-driven; fix the agent DESCRIPTION, not code (AC-8.ORC.003.1)';
export const ERR_CHAIN_TOO_DEEP = (n: number, limit: number) =>
  `orchestrator: plan chain depth ${n} exceeds chain_depth_limit ${limit} — trimming and lowering confidence (PLAN.003)`;

/** The outcome of a single route() call. Exactly one of {plan+executed-ready} or {clarification} — never both,
 * never a silent auto-proceed below threshold (#3). */
export interface RouteResult {
  task_id: string;
  classification: Classification;
  candidates: AgentRow[];
  scores: CandidateScore[];
  plan: ExecutionPlan | null; // null iff below-threshold clarification path
  confidence: number;
  planVersionId: string | null; // set when the plan is persisted (≥ threshold)
  outcome: 'planned' | 'clarification' | 'unroutable';
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// The orchestrator engine. Pure logic over the injected seams; no live DB, no Date.now/random.
// ───────────────────────────────────────────────────────────────────────────────────────────────────
export class OrchestratorEngine {
  constructor(
    private readonly deps: {
      registry: AgentRegistry;
      classifier: Classifier;
      queue: QueueGate;
      plans: PlanStore;
      envelope: EnvelopeSink;
      events: EventSink;
      secondary: SecondarySink;
      config: () => RoutingConfig; // read FRESH each route() so a config change takes effect next task (ORC.004.2)
    },
  ) {}

  /** Reject a proposed hardcoded task→agent rule (ORC.003.1). Called by the code-review gate; a runtime attempt
   * to bypass description-driven routing throws. There is intentionally NO hardcoded-map parameter on route(). */
  static rejectHardcodedRoute(): never {
    throw new Error(ERR_HARDCODED_ROUTE);
  }

  /** The full seven-step route of the task at the queue front. Deterministic given the injected seams. */
  async route(now: number): Promise<RouteResult | null> {
    const cfg = this.deps.config();

    // ── Step 1: dequeue + crash-window guard (ORC.001) ────────────────────────────────────────────
    const task = await this.deps.queue.front();
    if (task === null) return null; // empty queue

    try {
      return await this.routeTask(task, cfg, now);
    } catch (err) {
      // ORC.001.3 crash-window: an interruption between dequeue and plan-persist must leave the task
      // RE-ROUTABLE — never dequeued-but-unplanned. Return it and log the recovery, then re-raise a
      // routable-only signal by resolving with unroutable-marked result is wrong (that would swallow a bug);
      // instead we restore state + log, then rethrow so the caller sees the failure (#3 never silent).
      await this.deps.queue.returnToRoutable(task.task_id, now);
      await this.safeAppend(
        {
          task_id: task.task_id,
          event_type: 'routing_crash_recovered',
          entity_ids: [task.task_id],
          summary: `Routing interrupted for task '${task.task_name}' — task returned to a re-routable state (idempotent re-route, ORC.001.3).`,
          payload: { task_id: task.task_id, error: String(err) },
        },
        now,
      );
      throw err;
    }
  }

  private async routeTask(task: TaskInput, cfg: RoutingConfig, now: number): Promise<RouteResult> {
    // ── Step 2: classify (ORC.002) ──────────────────────────────────────────────────────────────
    const classification = this.deps.classifier.classify(task);
    await this.safeAppend(
      {
        task_id: task.task_id,
        event_type: 'routing_classified',
        entity_ids: classification.context.entity_ids,
        summary: `Task '${task.task_name}' classified: domain=${classification.domain}, complexity=${classification.complexity}, output=${classification.output}${classification.ambiguous ? ' (ambiguous — confidence penalised)' : ''}.`,
        payload: { ...classification },
      },
      now,
    );

    // ── Step 3: registry-read — description-driven candidates (ORC.003) ───────────────────────────
    const candidates = await this.deps.registry.candidates(classification.domain);
    await this.safeAppend(
      {
        task_id: task.task_id,
        event_type: 'routing_candidates',
        entity_ids: [task.task_id],
        summary: `Read ${candidates.length} enabled candidate(s) for domain '${classification.domain}' by description (never a hardcoded map).`,
        payload: { candidate_ids: candidates.map((c) => c.id), candidate_names: candidates.map((c) => c.name) },
      },
      now,
    );

    // No enabled agent for the domain → low confidence → clarification (REG.005.2 / ORC.006), never a silent drop.
    if (candidates.length === 0) {
      return this.clarify(task, classification, [], [], 0, now);
    }

    // ── Step 4: score (ORC.004) ───────────────────────────────────────────────────────────────────
    const scores = candidates.map((c) => this.score(c, classification, cfg.weights));
    scores.sort((a, b) => b.total - a.total);
    await this.safeAppend(
      {
        task_id: task.task_id,
        event_type: 'routing_scored',
        entity_ids: [task.task_id],
        summary: `Scored ${scores.length} candidate(s); top='${scores[0]?.agent_name}' total=${scores[0]?.total.toFixed(3)}.`,
        payload: { scores },
      },
      now,
    );

    // Confidence = top score, penalised for ambiguity + near-ties (ORC.002.2/ORC.004 tie lowers confidence) AND
    // for an over-depth chain that must be trimmed (PLAN.003 — the truncation surfaces as a confidence drop).
    const confidence = this.confidenceOf(scores, classification, cfg);
    const overDepth = scores.length > cfg.chainDepthLimit;

    // ── Step 5: build plan (ORC.005) ─────────────────────────────────────────────────────────────
    const plan = this.buildPlan(task, classification, scores, cfg);

    // logic-sweep fix (routing.ts:506): PLAN.003 — a chain that exceeds chain_depth_limit is trimmed AND the
    // truncation is SURFACED (cost signal logged), never silently sliced (#3). The confidence penalty above drops
    // the task to the clarification path below; here we log the depth-limit hit so the drop is explained.
    if (overDepth) {
      await this.safeAppend(
        {
          task_id: task.task_id,
          event_type: 'routing_chain_trimmed',
          entity_ids: [task.task_id],
          summary: `Plan chain depth ${scores.length} exceeds chain_depth_limit ${cfg.chainDepthLimit} — trimmed to ${plan.steps.length} step(s) and confidence lowered so the task drops to clarification (never silently truncated, PLAN.003).`,
          payload: { candidate_count: scores.length, chain_depth_limit: cfg.chainDepthLimit, trimmed_to: plan.steps.length },
        },
        now,
      );
    }

    // ── Step 6: confidence-check (ORC.006 / OD-077) ──────────────────────────────────────────────
    if (confidence < cfg.confidenceThreshold) {
      return this.clarify(task, classification, candidates, scores, confidence, now);
    }

    // ── Step 7: version + log + outcome-ready (ORC.007) ──────────────────────────────────────────
    // Write the plan into the C5 envelope (ORC.005.3) — C8 does not execute it.
    this.deps.envelope.setExecutionPlan(task.task_id, plan);
    const saved = await this.deps.plans.saveVersion(plan, null, now);
    await this.safeAppend(
      {
        task_id: task.task_id,
        event_type: 'routing_planned',
        entity_ids: [task.task_id],
        summary: `Plan v${saved.version} built (${plan.steps.length} step(s), ${plan.parallel ? 'parallel-eligible' : 'sequential'}); confidence=${confidence.toFixed(3)} ≥ ${cfg.confidenceThreshold}. Handed to C5 for execution.`,
        payload: { plan_version_id: saved.id, version: saved.version, steps: plan.steps, confidence },
      },
      now,
    );

    return {
      task_id: task.task_id,
      classification,
      candidates,
      scores,
      plan,
      confidence,
      planVersionId: saved.id,
      outcome: 'planned',
    };
  }

  /** ORC.001.2 — an unroutable task halts-and-escalates + logs (never silently consumed). Called when planning
   * is impossible (distinct from below-threshold clarification, which is a recoverable pause). */
  async haltUnroutable(task: TaskInput, now: number): Promise<void> {
    await this.deps.queue.returnToRoutable(task.task_id, now);
    await this.safeAppend(
      {
        task_id: task.task_id,
        event_type: 'routing_unroutable',
        entity_ids: [task.task_id],
        summary: `Task '${task.task_name}' is unroutable — halted and escalated (never silently consumed, ORC.001.2).`,
        payload: { task_id: task.task_id },
      },
      now,
    );
  }

  /** ORC.006 — below-threshold (or no-candidate) clarification: raise a request, set awaiting-clarification, do
   * NOT execute. Records the low-confidence event. */
  private async clarify(
    task: TaskInput,
    classification: Classification,
    candidates: AgentRow[],
    scores: CandidateScore[],
    confidence: number,
    now: number,
  ): Promise<RouteResult> {
    await this.deps.queue.setAwaitingClarification(task.task_id, now);
    await this.safeAppend(
      {
        task_id: task.task_id,
        event_type: 'routing_low_confidence',
        entity_ids: [task.task_id],
        summary: `Routing confidence ${confidence.toFixed(3)} below threshold — raised a human clarification request; task set to awaiting-clarification and NOT executed (ORC.006 / OD-077).`,
        payload: { confidence, candidate_count: candidates.length },
      },
      now,
    );
    return {
      task_id: task.task_id,
      classification,
      candidates,
      scores,
      plan: null, // never a plan on the clarification path (#3 no silent auto-proceed)
      confidence,
      planVersionId: null,
      outcome: 'clarification',
    };
  }

  /** ORC.006.2 / OD-077 — escalate every clarification unanswered past its window. Never auto-proceeds, never
   * silently parks. Returns the escalated task ids + logs each. */
  async escalateStaleClarifications(now: number): Promise<string[]> {
    const escalated = await this.deps.queue.escalateStaleClarifications(now);
    for (const taskId of escalated) {
      await this.safeAppend(
        {
          task_id: taskId,
          event_type: 'routing_clarification_escalated',
          entity_ids: [taskId],
          summary: `Clarification for task '${taskId}' unanswered past its window — escalated (never auto-proceeded, never dropped; OD-077).`,
          payload: { task_id: taskId },
        },
        now,
      );
    }
    return escalated;
  }

  /** ORC.007.1 — record a plan version's outcome. A re-plan after clarification links to the original via
   * previous_version_id (ORC.007 branch). */
  async recordOutcome(planVersionId: string, outcome: PlanOutcome, now: number): Promise<void> {
    try {
      await this.deps.plans.recordOutcome(planVersionId, outcome, now);
    } catch (err) {
      // ORC.007.2 / L8 — the outcome write failed; surface via the SECONDARY sink (distinct channel), never drop.
      await this.deps.secondary.reportPrimaryFailure(
        {
          task_id: planVersionId,
          event_type: 'routing_outcome',
          entity_ids: [planVersionId],
          summary: `Outcome write FAILED for plan version '${planVersionId}' — surfaced via the secondary sink (the reporter of failures must not be the thing that failed; ORC.007.2).`,
          payload: { plan_version_id: planVersionId, outcome, error: String(err) },
        },
        err,
        now,
      );
      throw err;
    }
    await this.safeAppend(
      {
        task_id: planVersionId,
        event_type: 'routing_outcome',
        entity_ids: [planVersionId],
        summary: `Outcome recorded against plan version '${planVersionId}': ${outcome.status}.`,
        payload: { plan_version_id: planVersionId, outcome },
      },
      now,
    );
  }

  /** Persist a RE-PLAN linked to the original plan version (ORC.007 branch — a re-planned task after clarification
   * gets a new record linked to the original). */
  async saveReplan(plan: ExecutionPlan, originalVersionId: string, now: number): Promise<{ id: string; version: number }> {
    return this.deps.plans.saveVersion(plan, originalVersionId, now);
  }

  // ── scoring internals (ORC.004) ─────────────────────────────────────────────────────────────────
  private score(agent: AgentRow, c: Classification, w: RoutingWeights): CandidateScore {
    // Deterministic, description-driven-adjacent fits in [0,1]. (The live routing uses the LLM signal — AF-121 —
    // over the same four factors; this deterministic model proves the WEIGHTING + recording contract offline.)
    const domain_match = 1; // candidates are already domain-filtered; a matched-domain agent scores 1 here
    const complexity_fit = c.complexity === 'multi' ? 0.8 : 1; // single-agent tasks fit a specialist perfectly
    const memory_scope_fit = agent.memory_scope.tiers.includes('semantic') ? 1 : 0.5;
    const tool_scope_fit = c.output === 'action' ? (agent.tools_allowed.length > 0 ? 1 : 0.5) : 1;
    const total =
      w.domain_match * domain_match +
      w.complexity_fit * complexity_fit +
      w.memory_scope_fit * memory_scope_fit +
      w.tool_scope_fit * tool_scope_fit;
    return {
      agent_id: agent.id,
      agent_name: agent.name,
      domain_match,
      complexity_fit,
      memory_scope_fit,
      tool_scope_fit,
      total,
    };
  }

  private confidenceOf(scores: CandidateScore[], c: Classification, cfg: RoutingConfig): number {
    if (scores.length === 0) return 0;
    let conf = scores[0]!.total;
    // ambiguous classification lowers confidence (ORC.002.2)
    if (c.ambiguous) conf *= 0.6;
    // a near-tie between the top two lowers confidence (ORC.004 tie/near-tie branch)
    if (scores.length >= 2 && scores[0]!.total - scores[1]!.total < 0.05) conf *= 0.9;
    // logic-sweep fix (routing.ts:506): PLAN.003 — a chain that would exceed chain_depth_limit is trimmed; the
    // trim must LOWER confidence so the task drops to clarification rather than being silently truncated (#3). We
    // force it below any valid threshold (weights sum to 1, so a top score ≤ 1 and confidenceThreshold ≤ 1).
    if (scores.length > cfg.chainDepthLimit) conf = 0;
    return conf;
  }

  // ── plan build internals (ORC.005) ──────────────────────────────────────────────────────────────
  private buildPlan(task: TaskInput, c: Classification, scores: CandidateScore[], cfg: RoutingConfig): ExecutionPlan {
    const top = scores[0]!;
    if (c.complexity === 'single') {
      // ORC.005.1 — simple task → single agent, one step, a failure mode (default halt_escalate, PLAN.002).
      return {
        task_type_name: task.task_name,
        parallel: false,
        steps: [
          {
            index: 0,
            agent_id: top.agent_id,
            agent_name: top.agent_name,
            depends_on: [],
            parallel_eligible: false,
            failure_mode: 'halt_escalate',
          },
        ],
      };
    }
    // ORC.005.2 — complex task → ordered chain with deps, parallel marks, EVERY step a failure mode. We build a
    // representative chain from the ranked candidates (research-first when info-gathering, SPC.002 note), capped
    // at chain_depth_limit (PLAN.003). The concrete taxonomy/deps semantics land in ISSUE-064; here every step
    // is MARKED (never left without a failure mode — the #2/#3-honest default is halt_escalate).
    // PLAN.003 — cap the chain at chain_depth_limit. The trim is NOT silent: when scores.length exceeds the limit,
    // confidenceOf() forces confidence to 0 so route() drops the task to clarification and logs a routing_chain_trimmed
    // cost signal (logic-sweep fix, routing.ts:506) — the over-limit branch below no longer no-ops.
    const ranked = scores.slice(0, Math.max(1, cfg.chainDepthLimit));
    const steps: PlanStep[] = ranked.map((s, i) => ({
      index: i,
      agent_id: s.agent_id,
      agent_name: s.agent_name,
      depends_on: i === 0 ? [] : [i - 1], // sequential default chain; parallel marks below
      parallel_eligible: cfg.parallelExecutionEnabled && i > 0, // only opt-in parallel, and never the first step
      failure_mode: 'halt_escalate',
    }));
    return {
      task_type_name: task.task_name,
      parallel: steps.some((s) => s.parallel_eligible),
      steps,
    };
  }

  // ── observability: primary sink write, with the crash-safe wrapper. A failure to WRITE the routing event is
  // itself surfaced via the secondary sink (never silently dropped, #3) — but does not abort the route. ──────
  private async safeAppend(ev: RoutingEvent, now: number): Promise<void> {
    try {
      await this.deps.events.append(ev);
    } catch (err) {
      await this.deps.secondary.reportPrimaryFailure(ev, err, now);
    }
  }
}
