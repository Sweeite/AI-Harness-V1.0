// ISSUE-058 — the PURE decision core: the cost-ladder rungs + dispositions (FR-6.RTL.004 / NFR-COST.001-004/007)
// and the rate-limit breach ladder (FR-6.RTL.003). No I/O here; every function is a pure decision. The
// coordinator (store.ts RateCostLadder) ties these to the guardrail_log sink so #3 holds (nothing decides silently).
//
// Ownership boundary (OD-068 / NFR-COST.004): C7 METERS spend + emits the per-rung signal; C6 (here) DECIDES
// the disposition; C5 EXECUTES the throttle/kill on the run pipeline. This module NEVER mutates a run or a
// queue — it returns data. `decideCostRung` deliberately takes the rung FROM the C7 signal (it does not meter);
// `classifyCostRung` is the shared ladder-threshold definition a test (or C7's meter) uses to turn a spend
// number into the rung signal.

import type { CapId } from './caps.ts';

// ── Cost-ladder thresholds (ADR-003 §2, config-registry.md L206-209; OD-164 key-name reconciliation) ─────────
export const COST_CONFIG_KEYS = Object.freeze({
  softDaily: 'cost_ladder_soft_threshold_daily_usd',
  softWeekly: 'cost_ladder_soft_threshold_weekly_usd',
  throttle: 'cost_ladder_throttle_threshold',
  hardKill: 'cost_ladder_hard_kill_threshold',
} as const);

export interface CostThresholds {
  softDailyUsd: number;
  softWeeklyUsd: number;
  throttleDailyUsd: number;
  hardKillDailyUsd: number;
}

// AF-001 (GREEN 2026-07-03: $2.09/day measured) anchors these defaults to measured reality, not a guess.
export const DEFAULT_COST_THRESHOLDS: Readonly<CostThresholds> = Object.freeze({
  softDailyUsd: 50,
  softWeeklyUsd: 200,
  throttleDailyUsd: 75,
  hardKillDailyUsd: 100,
});

export type CostRung = 'ok' | 'soft' | 'throttle' | 'hard_kill';

/**
 * Validate a per-deployment threshold set. Auto-actions are DAILY-anchored (ADR-003 §2): the weekly soft
 * alert is human-attention only, so it is not ordered against the daily rungs. The daily rungs must be
 * strictly increasing soft < throttle < hard-kill (a mis-ordered ladder would skip or invert a rung).
 */
export function validateCostThresholds(t: CostThresholds): { ok: true } | { ok: false; reason: string } {
  for (const [k, v] of Object.entries(t)) {
    if (!Number.isFinite(v) || v < 0) return { ok: false, reason: `${k}: ${v} must be a finite, non-negative currency amount.` };
  }
  if (!(t.softDailyUsd < t.throttleDailyUsd && t.throttleDailyUsd < t.hardKillDailyUsd)) {
    return {
      ok: false,
      reason: `daily rungs must be strictly increasing soft(${t.softDailyUsd}) < throttle(${t.throttleDailyUsd}) < hard-kill(${t.hardKillDailyUsd}); a mis-ordered ladder skips a rung.`,
    };
  }
  return { ok: true };
}

/**
 * The DAILY rung a spend level has reached (the auto-action ladder). This is the shared ladder-threshold
 * definition — C7's meter uses it to emit the rung signal; a test uses it to drive a synthetic spend series.
 * Returns the HIGHEST rung reached (no rung is skipped — a jump straight to hard-kill still passes through
 * being ≥ soft and ≥ throttle, so a caller stepping spend upward sees soft, then throttle, then hard-kill).
 */
export function classifyCostRung(dailyUsd: number, t: CostThresholds = DEFAULT_COST_THRESHOLDS): CostRung {
  if (!Number.isFinite(dailyUsd) || dailyUsd < 0) {
    throw new Error(`classifyCostRung: dailyUsd must be a finite, non-negative estimate, got ${dailyUsd} (a blind meter must not be read as $0 — NFR-COST.005).`);
  }
  if (dailyUsd >= t.hardKillDailyUsd) return 'hard_kill';
  if (dailyUsd >= t.throttleDailyUsd) return 'throttle';
  if (dailyUsd >= t.softDailyUsd) return 'soft';
  return 'ok';
}

/** The weekly soft alert is human-attention only — no weekly auto-throttle at v1 (ADR-003 §2). */
export function weeklySoftAlert(weeklyUsd: number, t: CostThresholds = DEFAULT_COST_THRESHOLDS): boolean {
  return Number.isFinite(weeklyUsd) && weeklyUsd >= t.softWeeklyUsd;
}

// ── Work classification (ADR-003 §2 critical/never-killed set + NFR-COST.002/003) ────────────────────────────
export const CRITICAL_WORK = [
  'human_initiated', // a user-facing request
  'urgent_fast_loop', // new leads, flagged messages, overdue tasks
  'human_approved',
  'guardrail_security',
  'user_facing',
] as const;
export const NON_CRITICAL_WORK = [
  'proactive_suggestion',
  'insight_agent',
  'self_improvement',
  'consolidation',
  'medium_loop',
  'low_priority_task',
] as const;

export type WorkClass = (typeof CRITICAL_WORK)[number] | (typeof NON_CRITICAL_WORK)[number];

const CRITICAL_SET: ReadonlySet<string> = new Set(CRITICAL_WORK);
export function isCritical(w: WorkClass): boolean {
  return CRITICAL_SET.has(w);
}

// ── Cost-ladder disposition (C6 DECIDES; C5 executes — this is data, never an action) ─────────────────────────
export type CostDispositionAction = 'alert' | 'throttle' | 'hard_kill';

export interface CostRungSignal {
  /** The rung C7's meter emitted (OD-068 — C6 does not meter; it decides on the signal). */
  rung: Exclude<CostRung, 'ok'>;
  /** Optional estimate that produced the signal (for the loud log description only). */
  estimatedDailyUsd?: number;
  source?: string; // e.g. 'C7'
}

export interface CostDisposition {
  rung: Exclude<CostRung, 'ok'>;
  action: CostDispositionAction;
  /** Work classes C5 should defer/queue (throttle) or kill (hard-kill). */
  affectedWorkClasses: readonly WorkClass[];
  /** Work classes that still run untouched. */
  allowedWorkClasses: readonly WorkClass[];
  reduceLoopCadence: boolean;
  stopNewConsequentialSpend: boolean;
  flag: boolean;
  /** Invariant marker (AC-6.RTL.004.3 / AC-NFR-COST.003.2 / #2): a cost rung never relaxes a hard limit. */
  readonly relaxesHardLimit: false;
}

/** C6's decision for a cost rung (AC-6.RTL.004.1/.2/.3, AC-NFR-COST.001/002/003). Pure — C5 executes it. */
export function decideCostRung(signal: CostRungSignal): CostDisposition {
  switch (signal.rung) {
    case 'soft':
      // Alert only, work continues — no throttle yet (AC-6.RTL.004.1 / AC-NFR-COST.001.2).
      return {
        rung: 'soft',
        action: 'alert',
        affectedWorkClasses: [],
        allowedWorkClasses: [...CRITICAL_WORK, ...NON_CRITICAL_WORK],
        reduceLoopCadence: false,
        stopNewConsequentialSpend: false,
        flag: false,
        relaxesHardLimit: false,
      };
    case 'throttle':
      // Defer/queue non-critical, slow the loops; user-facing + urgent untouched (AC-6.RTL.004.2 / NFR-COST.002).
      return {
        rung: 'throttle',
        action: 'throttle',
        affectedWorkClasses: NON_CRITICAL_WORK,
        allowedWorkClasses: CRITICAL_WORK,
        reduceLoopCadence: true,
        stopNewConsequentialSpend: false,
        flag: true,
        relaxesHardLimit: false,
      };
    case 'hard_kill':
      // Kill non-critical; only urgent/human-initiated/human-approved/guardrail run (AC-6.RTL.004.3 / NFR-COST.003).
      return {
        rung: 'hard_kill',
        action: 'hard_kill',
        affectedWorkClasses: NON_CRITICAL_WORK,
        allowedWorkClasses: CRITICAL_WORK,
        reduceLoopCadence: true,
        stopNewConsequentialSpend: true,
        flag: true,
        relaxesHardLimit: false,
      };
    default:
      // Fail LOUD, never fall through to `undefined` (#3). TypeScript excludes 'ok'/garbage, but a real C7
      // runtime signal carrying an out-of-band rung must throw an explicit reject here rather than let the
      // switch return undefined — the caller (recordCostRung) would otherwise deref `disposition.rung` and
      // crash AFTER deciding to skip the audit write, i.e. a fail-quiet decision with no guardrail_log row.
      throw new Error(
        `decideCostRung: unknown cost rung '${String((signal as { rung: unknown }).rung)}' — refusing to emit an undefined disposition (#3).`,
      );
  }
}

// ── Per-work decision (drives NFR-COST.002.2 / NFR-COST.003.1 + the never-relax-a-hard-limit guard) ──────────
export type WorkOutcome = 'run' | 'defer' | 'kill' | 'escalate' | 'halt_escalate';

export interface WorkContext {
  workClass: WorkClass;
  /** An irreversible or already-billed action — at the hard rung it halts-and-escalates, never proceeds. */
  irreversibleOrBilled?: boolean;
  /** A critical, in-flight task that cannot proceed — it escalates, it is never silently dropped. */
  inFlightBlocked?: boolean;
  /** The action is blocked by a hard limit (FR-6.HRD.*). A cost rung can NEVER turn this into 'run' (#2). */
  hardLimitBlocked?: boolean;
}

/**
 * What happens to ONE piece of work at a given cost rung (AC-NFR-COST.002.2 / .003.1). Ordering of the guards
 * is load-bearing:
 *   1. hardLimitBlocked → halt_escalate ALWAYS — a cost rung never overrides/relaxes a hard limit (#2).
 *   2. irreversibleOrBilled at hard-kill → halt_escalate — never auto-proceed / never auto-retry (AC-6.RTL.004.3).
 *   3. critical/user-facing → run (or escalate if a critical in-flight cannot proceed — never silently dropped).
 *   4. non-critical → defer (throttle) / kill (hard-kill).
 */
export function decideForWork(rung: CostRung, ctx: WorkContext): WorkOutcome {
  if (ctx.hardLimitBlocked) return 'halt_escalate'; // #2 — the cost layer defers to the hard-limit gate, always
  if (rung === 'ok' || rung === 'soft') {
    // Work continues at soft; a critical in-flight that cannot proceed still escalates (never dropped).
    return isCritical(ctx.workClass) && ctx.inFlightBlocked ? 'escalate' : 'run';
  }
  if (rung === 'hard_kill' && ctx.irreversibleOrBilled) return 'halt_escalate';
  if (isCritical(ctx.workClass)) {
    return ctx.inFlightBlocked ? 'escalate' : 'run';
  }
  // non-critical
  return rung === 'throttle' ? 'defer' : 'kill';
}

// ── Rate-limit breach ladder (FR-6.RTL.003) ──────────────────────────────────────────────────────────────────
export type RateBreachSeverity = 'soft' | 'throttle' | 'hard';
export type RateBreachOutcome = 'alert_continue' | 'throttle_non_critical' | 'hard_stop' | 'halt_escalate';

export interface RateBreachInput {
  cap: CapId;
  severity: RateBreachSeverity;
  /** An irreversible/billed action at its cap → halt-and-escalate, excluded from auto-retry (AC-6.RTL.003.2). */
  irreversibleOrBilled?: boolean;
}

export interface RateBreachDecision {
  cap: CapId;
  outcome: RateBreachOutcome;
  /** false whenever the action halts-and-escalates — it must NOT be placed on auto-retry (AC-6.RTL.003.2). */
  autoRetryEligible: boolean;
  /** Whether the offending action is blocked (drives guardrail_log.action_blocked). */
  actionBlocked: boolean;
}

/**
 * C6's one consistent breach response, invoked by ANY home owner's counter (AC-6.RTL.002.1) — the response
 * does not diverge per owner. An irreversible/billed action at cap always halts-and-escalates (consumes C3's
 * ISSUE-034 halt-escalate hook) and is excluded from auto-retry; otherwise the soft→throttle→hard-stop ladder
 * applies (AC-6.RTL.003.1).
 */
export function decideRateBreach(input: RateBreachInput): RateBreachDecision {
  if (input.irreversibleOrBilled) {
    return { cap: input.cap, outcome: 'halt_escalate', autoRetryEligible: false, actionBlocked: true };
  }
  switch (input.severity) {
    case 'soft':
      return { cap: input.cap, outcome: 'alert_continue', autoRetryEligible: true, actionBlocked: false };
    case 'throttle':
      return { cap: input.cap, outcome: 'throttle_non_critical', autoRetryEligible: true, actionBlocked: false };
    case 'hard':
      return { cap: input.cap, outcome: 'hard_stop', autoRetryEligible: false, actionBlocked: true };
    default:
      // Fail LOUD on an out-of-band severity — never fall through to `undefined` (#3). A breach whose severity
      // the type system can't vouch for (runtime garbage from a counter) must reject explicitly, not return
      // an undefined decision the coordinator would then log/act on incoherently.
      throw new Error(
        `decideRateBreach: unknown severity '${String((input as { severity: unknown }).severity)}' — refusing to emit an undefined decision (#3).`,
      );
  }
}

// ── Controls-before-gates precedence (NFR-COST.007 / ADR-003 §6-§7) ──────────────────────────────────────────
// The cost-lever order pulled BEFORE the ceiling is raised (ADR-003 §7, the doc's highest-leverage tunable last).
export const COST_LEVER_ORDER = [
  'model_routing',
  'selective_writing_gate',
  'loop_idle_gating',
  'memory_injection_limit',
  'orchestrator_confidence_threshold',
] as const;

// v1 keeps EXACTLY ONE cost model-gate — the Haiku selective-writing gate; no gate costs more than it saves
// (AC-NFR-COST.007.2 / ADR-003 §6).
export const COST_MODEL_GATES = ['haiku_selective_writing'] as const;

// ── Coverage-gap posture — "gate, don't promote" (NFR-SEC.005 / FR-6.HRD.004 seam) ───────────────────────────
export interface CoverageGapRouting {
  capability: string;
  gate: 'hard_approval';
  rateCapped: true;
  autoAllowed: false; // never silently auto-allowed (#2)
  reachableOnlyViaHumanStep: true;
}

/**
 * A newly-identified dangerous capability outside the seven hard limits is routed to hard-approval + a rate
 * cap and is reachable only via an authorized human step — NEVER silently auto-allowed (AC-NFR-SEC.005.1).
 * This is the "gate, don't promote" path: it does not create an eighth hard limit (that needs change-control).
 */
export function routeNewDangerousCapability(capability: string): CoverageGapRouting {
  if (!capability || !capability.trim()) {
    throw new Error('routeNewDangerousCapability: a capability name is required (a nameless capability cannot be gated).');
  }
  return { capability, gate: 'hard_approval', rateCapped: true, autoAllowed: false, reachableOnlyViaHumanStep: true };
}
