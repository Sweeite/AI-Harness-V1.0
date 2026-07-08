// ISSUE-065 (C8 HLTH) — the pure metric-production logic + the cycle orchestration.
//
// Everything here is FLAG-ONLY. No function disables, rewrites, or otherwise corrects an agent (OD-078 /
// NFR-OBS.015). The orchestrator (runHealthCycle) reads the outcome/behaviour signal, computes the metrics,
// and writes ONLY agent_health_metrics — stamping producer_heartbeat on a successful per-agent run and, on a
// per-agent failure, deliberately NOT stamping it so the freshness reader flips that agent to stale rather
// than carrying forward a last-known-good green (AC-8.HLTH.002.2 / AC-8.HLTH.004.2 — #3 "no news ≠ good news").
//
// Sources: FR-8.HLTH.001 (L3589/L3217/L3578), FR-8.HLTH.002 (L3642/L3563/L2847), FR-8.HLTH.003 (L3644),
// FR-8.HLTH.004 (L3575–3592/L3217), OD-078, NFR-OBS.005/.015.

import {
  type AgentHealthStore,
  type AgentOutcome,
  type AgentBehaviourSample,
  type AgentScope,
  DEFAULT_DRIFT_THRESHOLD,
  DEFAULT_DEAD_AGENT_THRESHOLD,
  DEFAULT_HEARTBEAT_STALENESS_WINDOW_S,
} from './store.ts';

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// 1. Aggregation — success/failure rate + last-run (FR-8.HLTH.001)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface Aggregation {
  successRate: number | null; // null = no outcomes (unknown, NOT a green 0/1)
  failureRate: number | null;
  lastRun: string | null;
  total: number;
}

/** Roll a set of task outcomes into per-agent rates + last-run. Zero outcomes ⇒ all null (unknown, never a
 *  fabricated 0/1) so a never-run agent is not shown as either perfectly healthy or dead (#3). */
export function aggregateOutcomes(outcomes: readonly AgentOutcome[]): Aggregation {
  const total = outcomes.length;
  if (total === 0) return { successRate: null, failureRate: null, lastRun: null, total: 0 };
  let successes = 0;
  let lastRun: string | null = null;
  for (const o of outcomes) {
    if (o.outcome === 'success') successes += 1;
    if (lastRun === null || o.at > lastRun) lastRun = o.at; // ISO strings sort lexicographically = chronologically
  }
  const successRate = successes / total;
  return { successRate, failureRate: 1 - successRate, lastRun, total };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// 2. Dead-agent / low-quality signal (FR-8.HLTH.003, quality per OD-078)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// OD-078 quality signal = task success/failure + answer-mode-pill distribution + human approval/rejection.
// We combine the AVAILABLE signals into a [0,1] quality score (higher = healthier):
//   • successRate                         (always present when there are outcomes)
//   • answerQuality  = (cited+inferred)/(cited+inferred+unknown)   — 'building' is transient, excluded
//   • approvalRate   = approvals/(approvals+rejections)
// The score is the mean of whichever signals are present. With ONLY success/failure data the score == the
// success rate, so the CFG-dead_agent_threshold "0.5 success-rate" default reads exactly as documented; the
// pill + approval signals only sharpen it when present. A null score (no outcomes at all) is NOT dead — it is
// unknown (never flag on absence of evidence — #3).

export interface QualityBreakdown {
  score: number | null;
  successRate: number | null;
  answerQuality: number | null; // null = no cited/inferred/unknown pills observed
  approvalRate: number | null; // null = no human decisions observed
}

export function computeQuality(outcomes: readonly AgentOutcome[]): QualityBreakdown {
  if (outcomes.length === 0) {
    return { score: null, successRate: null, answerQuality: null, approvalRate: null };
  }
  const { successRate } = aggregateOutcomes(outcomes);

  let cited = 0;
  let inferred = 0;
  let unknown = 0;
  let approvals = 0;
  let rejections = 0;
  for (const o of outcomes) {
    if (o.answerMode === 'cited') cited += 1;
    else if (o.answerMode === 'inferred') inferred += 1;
    else if (o.answerMode === 'unknown') unknown += 1;
    // 'building' and null are not terminal quality evidence — excluded from the pill signal.
    if (o.humanDecision === 'approved') approvals += 1;
    else if (o.humanDecision === 'rejected') rejections += 1;
  }

  const pillDenom = cited + inferred + unknown;
  const answerQuality = pillDenom > 0 ? (cited + inferred) / pillDenom : null;
  const decisionDenom = approvals + rejections;
  const approvalRate = decisionDenom > 0 ? approvals / decisionDenom : null;

  const signals = [successRate, answerQuality, approvalRate].filter((s): s is number => s !== null);
  const score = signals.length > 0 ? signals.reduce((a, b) => a + b, 0) / signals.length : null;
  return { score, successRate, answerQuality, approvalRate };
}

/** Dead-agent FLAG (never a disable). True iff a computable quality score falls BELOW the threshold. A null
 *  score (no evidence) is never dead — absence of evidence is not evidence of death (#3). */
export function isDeadAgent(quality: QualityBreakdown, threshold: number): boolean {
  return quality.score !== null && quality.score < threshold;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// 3. Specialisation-drift (FR-8.HLTH.002)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// drift_score = the fraction of recent activity that fell OUTSIDE the declared scope. 0 = fully on-scope,
// 1 = entirely off-scope. null when it CANNOT be computed (no behaviour signal, or no declared scope) — the
// caller surfaces that as unknown/absent rather than a fabricated 0 (AC-8.HLTH.002.2 / #3).

export interface DriftResult {
  driftScore: number | null;
  flagged: boolean;
  reason: string; // why null / why flagged — always plain-English, never silent
}

export function computeDrift(
  sample: AgentBehaviourSample | null,
  scope: AgentScope | null,
  threshold: number,
): DriftResult {
  if (scope === null) {
    return { driftScore: null, flagged: false, reason: 'no declared memory_scope — drift not computable (surfaced, not 0)' };
  }
  if (sample === null || sample.observedScopeTokens.length === 0) {
    return { driftScore: null, flagged: false, reason: 'no behaviour signal in window — drift unknown (surfaced, not 0)' };
  }
  const allowed = new Set(scope.allowedScopeTokens);
  let outside = 0;
  for (const tok of sample.observedScopeTokens) if (!allowed.has(tok)) outside += 1;
  const driftScore = outside / sample.observedScopeTokens.length;
  const flagged = driftScore > threshold;
  return {
    driftScore,
    flagged,
    reason: flagged
      ? `drift ${driftScore.toFixed(3)} > threshold ${threshold} — flagged for human review (nothing auto-changed)`
      : `drift ${driftScore.toFixed(3)} within threshold ${threshold}`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// 4. Producer liveness / freshness (FR-8.HLTH.004 / NFR-OBS.005) — stale, never green
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
export type MetricFreshness = 'fresh' | 'stale' | 'unknown';

/** A never-stamped heartbeat reads 'unknown'; an overdue one reads 'stale'; only a within-window heartbeat is
 *  'fresh'. A stalled/absent producer is NEVER 'fresh' — that is the whole #3 mechanism (AC-8.HLTH.004.2). */
export function evaluateFreshness(
  producerHeartbeat: string | null,
  nowMs: number,
  stalenessWindowS: number = DEFAULT_HEARTBEAT_STALENESS_WINDOW_S,
): MetricFreshness {
  if (producerHeartbeat === null) return 'unknown';
  const beatMs = Date.parse(producerHeartbeat);
  if (Number.isNaN(beatMs)) return 'unknown'; // an unparseable stamp is not proof of life
  const ageS = (nowMs - beatMs) / 1000;
  // A future-dated heartbeat (beat ahead of the reader's clock ⇒ negative age) is NOT proof of life: it can only
  // come from clock skew or a bad stamp, and "> stalenessWindowS" would never fire on it, silently rendering an
  // anomalous producer as 'fresh' (a fail-OPEN in the very check whose job is to fail-closed). Fail-safe: an age
  // we cannot trust reads 'unknown' (can't confirm), never green (#3 — no news is not good news).
  if (ageS < 0) return 'unknown';
  if (ageS > stalenessWindowS) return 'stale';
  return 'fresh';
}

/** A reader's view of a metric row: the numeric health is exposed ONLY when the producer heartbeat is fresh.
 *  When stale/unknown the values are withheld (null) so a caller/renderer can never paint a green from a dead
 *  producer's last-known-good sample (AC-NFR-OBS.005.1). The flags are likewise withheld — a stale dead_agent
 *  flag is not a current judgement. */
export interface HealthMetricView {
  agentId: string;
  freshness: MetricFreshness;
  successRate: number | null;
  failureRate: number | null;
  driftScore: number | null;
  deadAgentFlag: boolean | null; // null when not fresh — an old flag is not carried forward as a live one
  lastRun: string | null; // last_run is shown even when stale (it is itself a staleness cue, not a health value)
  routingMismatchCount: number | null;
  producerHeartbeat: string | null;
}

import { type HealthMetricsRow } from './store.ts';

export function viewMetric(
  row: HealthMetricsRow | null,
  nowMs: number,
  stalenessWindowS: number = DEFAULT_HEARTBEAT_STALENESS_WINDOW_S,
): HealthMetricView | null {
  if (row === null) return null;
  const freshness = evaluateFreshness(row.producerHeartbeat, nowMs, stalenessWindowS);
  const fresh = freshness === 'fresh';
  return {
    agentId: row.agentId,
    freshness,
    successRate: fresh ? row.successRate : null,
    failureRate: fresh ? row.failureRate : null,
    driftScore: fresh ? row.driftScore : null,
    deadAgentFlag: fresh ? row.deadAgentFlag : null,
    lastRun: row.lastRun,
    routingMismatchCount: fresh ? row.routingMismatchCount : null,
    producerHeartbeat: row.producerHeartbeat,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// 5. The cycle orchestrator (FR-8.HLTH.001/002/003/004) — reads, computes, writes agent_health_metrics ONLY.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface HealthCycleConfig {
  driftThreshold?: number; // CFG-drift_threshold (default 0.3)
  deadAgentThreshold?: number; // CFG-dead_agent_threshold (default 0.5)
}

export interface AgentCycleResult {
  agentId: string;
  ok: boolean; // false ⇒ this agent's producer step failed → heartbeat NOT stamped → reads stale next poll
  driftFlagged: boolean;
  deadAgentFlagged: boolean;
  error?: string; // a per-agent failure, surfaced loudly (never swallowed) — the report is the loud channel
}

export interface HealthCycleReport {
  atMs: number;
  producedFor: number; // agents whose metrics were written this cycle
  failed: number; // agents whose producer step failed (surfaced, not silently green)
  results: AgentCycleResult[];
}

/**
 * Run one producer cycle across all agents. For each agent: aggregate outcomes, compute drift + dead-agent
 * flags, and upsert agent_health_metrics stamping producer_heartbeat = nowIso. This slice NEVER disables or
 * auto-corrects an agent — it only writes the metric store (AC-8.HLTH.004.1 / NFR-OBS.015).
 *
 * A per-agent failure is recorded in the report AND leaves that agent's heartbeat un-advanced, so the freshness
 * reader flips it to stale on the next poll (AC-8.HLTH.002.2 / AC-8.HLTH.004.2) rather than presenting a
 * carried-forward green. Errors are surfaced, never swallowed (#3).
 */
export async function runHealthCycle(
  store: AgentHealthStore,
  nowMs: number,
  cfg: HealthCycleConfig = {},
): Promise<HealthCycleReport> {
  const driftThreshold = cfg.driftThreshold ?? DEFAULT_DRIFT_THRESHOLD;
  const deadAgentThreshold = cfg.deadAgentThreshold ?? DEFAULT_DEAD_AGENT_THRESHOLD;
  const nowIso = new Date(nowMs).toISOString();

  const agentIds = await store.listAgentIds();
  const results: AgentCycleResult[] = [];
  let producedFor = 0;
  let failed = 0;

  for (const agentId of agentIds) {
    try {
      const outcomes = await store.loadOutcomes(agentId);
      const agg = aggregateOutcomes(outcomes);
      const quality = computeQuality(outcomes);
      const deadAgentFlagged = isDeadAgent(quality, deadAgentThreshold);

      const [sample, scope] = await Promise.all([
        store.loadBehaviourSample(agentId),
        store.loadScope(agentId),
      ]);
      const drift = computeDrift(sample, scope, driftThreshold);

      await store.upsertHealthMetrics({
        agentId,
        successRate: agg.successRate,
        failureRate: agg.failureRate,
        lastRun: agg.lastRun,
        driftScore: drift.driftScore,
        deadAgentFlag: deadAgentFlagged, // a FLAG — the agent stays enabled (never disabled here)
        producerHeartbeat: nowIso, // liveness stamp — only a SUCCESSFUL run advances it
      });
      producedFor += 1;
      results.push({ agentId, ok: true, driftFlagged: drift.flagged, deadAgentFlagged });
    } catch (err) {
      // The producer step for THIS agent failed. Do NOT stamp its heartbeat — its metric will read stale next
      // poll (absence surfaced, not silently green — AC-8.HLTH.002.2). Record it loudly; never swallow (#3).
      failed += 1;
      results.push({
        agentId,
        ok: false,
        driftFlagged: false,
        deadAgentFlagged: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { atMs: nowMs, producedFor, failed, results };
}
