// ISSUE-066 (C8 COST.001/002/003 + NFR-COST.010) — cost-routing by complexity. Pure logic over the orchestrator's
// classification model (ISSUE-061), sharing the plan-build hot path with the cache. This slice FEEDS the C7 meter /
// C6 ladder — it never meters and never enforces (OD-068 boundary; COST.003 edge case).
//
// Three duties:
//   COST.001 — map classification → a cost tier (single / two-agent / full chain) and prefer the CHEAPEST tier that
//              satisfies the task, capped at chain_depth_limit (PLAN.003).
//   COST.002 — treat orchestrator_confidence_threshold as the cost/quality DIAL: a low-confidence (under-specified)
//              task is diverted to clarification BEFORE an expensive chain runs (reusing the ORC.006 path, not
//              redefining it). Raising the threshold → more clarification, fewer expensive chains.
//   COST.003 — emit the expected per-route CALL PROFILE (ADR-003 §4) to event_log so C7 can meter and C6 can apply
//              the ladder. Per-task-type from the first task (NFR-COST.010.1); re-rank/HyDE off by default (010.2).

import type { Classification } from '../../orchestrator/src/routing.ts';
import {
  type EventSink,
  type SecondarySink,
  EVT_COST_TIER,
  EVT_COST_SHAPE,
  emitEvent,
} from './store.ts';
import type { CostRoutingConfig } from './config.ts';

// ── COST.001 — the three cost tiers, cheapest → most expensive ──────────────────────────────────────────────────
export const COST_TIERS = ['single', 'two_agent', 'full_chain'] as const;
export type CostTier = (typeof COST_TIERS)[number];

/** The agent CAPACITY each tier can satisfy — the routing-cost ladder. `full_chain` is capped at chain_depth_limit
 *  (PLAN.003) at selection time. */
export function tierCapacity(tier: CostTier, chainDepthLimit: number): number {
  switch (tier) {
    case 'single':
      return 1;
    case 'two_agent':
      return 2;
    case 'full_chain':
      return Math.max(2, chainDepthLimit);
  }
}

/** How many specialists a classification NEEDS. A `single`-complexity task needs exactly one specialist (the cheapest
 *  route). A `multi` task needs at least two; the caller may pass a sharper estimate (e.g. the candidate/step count
 *  the orchestrator produced). Always ≥ 1 and capped at chain_depth_limit. */
export function neededAgents(classification: Classification, estimate: number | undefined, chainDepthLimit: number): number {
  const base = classification.complexity === 'single' ? 1 : Math.max(2, estimate ?? 2);
  return Math.min(Math.max(1, base), Math.max(1, chainDepthLimit));
}

/** COST.001 — select the CHEAPEST tier whose capacity satisfies the needed agents, capped at chain_depth_limit. A
 *  simple (single-complexity) task therefore always lands on `single`, never a full chain (AC-8.COST.001.1). */
export function selectCostTier(classification: Classification, cfg: CostRoutingConfig, estimate?: number): { tier: CostTier; needed: number } {
  const needed = neededAgents(classification, estimate, cfg.chainDepthLimit);
  const tier = COST_TIERS.find((t) => tierCapacity(t, cfg.chainDepthLimit) >= needed) ?? 'full_chain';
  return { tier, needed };
}

// ── COST.002 — the confidence threshold as the cost/quality dial ────────────────────────────────────────────────
/** The routing decision this slice adds on top of ORC.006: below the confidence threshold, an under-specified task is
 *  diverted to clarification BEFORE an expensive chain runs. At/above threshold, it routes at the selected cost tier.
 *  This does NOT redefine ORC.006 — it reuses its gate as the cost/quality control (integration note, §2). */
export type CostRoutingDecision =
  | { decision: 'route'; tier: CostTier; needed: number; confidence: number }
  | { decision: 'clarification'; confidence: number; threshold: number };

/** COST.002 — apply the confidence dial. Raising `cfg.confidenceThreshold` moves more (under-specified) tasks to the
 *  clarification branch and fewer to an expensive chain (AC-8.COST.002.1). */
export function routeByCost(classification: Classification, confidence: number, cfg: CostRoutingConfig, estimate?: number): CostRoutingDecision {
  if (confidence < cfg.confidenceThreshold) {
    return { decision: 'clarification', confidence, threshold: cfg.confidenceThreshold };
  }
  const { tier, needed } = selectCostTier(classification, cfg, estimate);
  return { decision: 'route', tier, needed, confidence };
}

/** COST.001 — record the chosen cost tier to event_log for cost attribution. */
export async function emitCostTier(
  events: EventSink,
  secondary: SecondarySink,
  taskTypeName: string,
  decision: CostRoutingDecision,
  entityIds: readonly string[],
): Promise<void> {
  const summary =
    decision.decision === 'route'
      ? `Task type '${taskTypeName}' routed at cost tier '${decision.tier}' (needs ${decision.needed} specialist(s); cheapest satisfying tier, COST.001).`
      : `Task type '${taskTypeName}' held for clarification — confidence ${decision.confidence.toFixed(3)} < threshold ${decision.threshold} — no expensive chain run (COST.002).`;
  await emitEvent(events, secondary, {
    event_type: EVT_COST_TIER,
    entity_ids: [...entityIds],
    summary,
    payload: { task_type_name: taskTypeName, ...decision },
  });
}

// ── COST.003 — the per-route call profile (ADR-003 §4) that C7 meters ───────────────────────────────────────────
/** The expected call profile of a routing decision (ADR-003 §4). Estimate-grade, fail-safe (rounds toward MORE calls):
 *   • one orchestrator DECISION call (the Sonnet route/classify),
 *   • one call per SPECIALIST in the plan,
 *   • per memory-WRITE the plan produces: exactly 1 Sonnet (the writer) wrapped in ≤3 Haiku (selective/contradiction/
 *     sensitivity pre-checks) — up to four calls, dominated by the Sonnet writer.
 *  C8 emits this shape ONLY; C7 meters actual per-call token cost, C6 applies the ladder (OD-068 boundary). */
export interface CallProfile {
  orchestrator_decision_calls: number; // always 1 per routing decision
  specialist_calls: number; // one per specialist in the plan
  sonnet_write_calls: number; // exactly 1 per memory-write (the writer)
  haiku_write_calls: number; // ≤ 3 per memory-write (the pre-checks)
  total_calls: number;
}

export const MAX_HAIKU_PER_WRITE = 3; // ADR-003 §4 — ≤3 Haiku pre-checks wrapping the one Sonnet writer

/** Compute the expected call profile for a routing decision. `specialistCount` = agents in the plan (the tier's
 *  needed count on the route branch, 0 on clarification). `writeCount` = memory-writes the plan is expected to
 *  produce; `haikuPerWrite` defaults to the full ≤3 (fail-safe round-up per ADR-003 §3 — overcount, never under). */
export function computeCallProfile(specialistCount: number, writeCount: number, haikuPerWrite: number = MAX_HAIKU_PER_WRITE): CallProfile {
  if (specialistCount < 0 || writeCount < 0) throw new Error('computeCallProfile: counts must be non-negative');
  const haiku = Math.min(Math.max(0, Math.trunc(haikuPerWrite)), MAX_HAIKU_PER_WRITE); // clamp to the ADR-003 ≤3 ceiling
  const sonnet_write_calls = writeCount; // exactly 1 Sonnet per written memory
  const haiku_write_calls = writeCount * haiku;
  const orchestrator_decision_calls = 1;
  const specialist_calls = specialistCount;
  const total_calls = orchestrator_decision_calls + specialist_calls + sonnet_write_calls + haiku_write_calls;
  return { orchestrator_decision_calls, specialist_calls, sonnet_write_calls, haiku_write_calls, total_calls };
}

/** True iff a profile honours the ADR-003 §4 shape (≤1 Sonnet + ≤3 Haiku PER write; exactly one orchestrator
 *  decision call). The check gate + COST.003 test assert this so a drift from the cost model is caught. */
export function profileHonoursAdr003(profile: CallProfile, writeCount: number): boolean {
  return (
    profile.orchestrator_decision_calls === 1 &&
    profile.sonnet_write_calls === writeCount &&
    profile.haiku_write_calls <= MAX_HAIKU_PER_WRITE * writeCount &&
    profile.total_calls ===
      profile.orchestrator_decision_calls + profile.specialist_calls + profile.sonnet_write_calls + profile.haiku_write_calls
  );
}

/** COST.003 + NFR-COST.010.1 — emit the per-route cost shape for C7 to meter, tagged with `task_type_name` so cost is
 *  aggregated PER TASK TYPE from the first task (not retrofitted). Carries the config posture (re-rank/HyDE off) so the
 *  NFR-COST.010.2 default-off state is auditable in the signal. C8 does not meter or enforce (OD-068). */
export async function emitCostShape(
  events: EventSink,
  secondary: SecondarySink,
  taskTypeName: string,
  profile: CallProfile,
  cfg: CostRoutingConfig,
  entityIds: readonly string[] = [],
): Promise<void> {
  await emitEvent(events, secondary, {
    event_type: EVT_COST_SHAPE,
    entity_ids: [...entityIds],
    summary: `Cost shape for task type '${taskTypeName}': ${profile.total_calls} expected call(s) (1 orchestrator + ${profile.specialist_calls} specialist + ${profile.sonnet_write_calls} Sonnet-write + ${profile.haiku_write_calls} Haiku-write) — recorded for C7 metering (COST.003; C8 does not meter/enforce, OD-068).`,
    payload: {
      task_type_name: taskTypeName, // NFR-COST.010.1 — the per-task-type aggregation key, from the first task
      profile,
      rerank_enabled: cfg.rerankEnabled, // NFR-COST.010.2 — audit the default-off posture
      hyde_enabled: cfg.hydeEnabled,
      meters: false, // OD-068 — C8 FEEDS the meter; it never meters
      enforces: false, // OD-068 — C8 never enforces the ladder
    },
  });
}
