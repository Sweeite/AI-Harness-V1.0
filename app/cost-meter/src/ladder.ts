// ISSUE-074 §8 step 5 — the four-rung cost-ladder trigger (FR-7.COST.003 → NFR-COST.001). Pure evaluation:
// given the current daily + weekly estimated spend and the four LIVE thresholds, decide WHICH rungs are
// breached and WHAT C7 does at each. C7's contract is narrow (NFR-COST.004):
//   - soft_daily ($50) / soft_weekly ($200): C7 fires the cost_threshold_breach ALERT (a notifications row).
//   - throttle ($75) / hard_kill ($100): C7 EMITS A BREACH SIGNAL to the C6 cost-ladder guardrail. C7 does
//     NOT throttle and does NOT kill — C6 decides, C5 executes. The signal carries enforced_by_c7=false so no
//     consumer can misread it as enforcement (AC-NFR-COST.004.2).
// "No rung skipped or silent" (AC-NFR-COST.001.2): evaluation returns EVERY breached rung, in ladder order —
// if spend jumps straight past throttle to the kill level, BOTH throttle and hard_kill are reported (a higher
// rung never masks a lower one), and each carries an explicit action so none is silent.

import type { CostLadderConfig, Rung, RungAction, LadderBreachSignal } from './types.ts';

export interface RungBreach {
  rung: Rung;
  action: RungAction; // 'alert' for soft rungs, 'signal' for throttle/kill
  window: 'daily' | 'weekly';
  estimated_usd: number;
  threshold_usd: number;
}

export interface LadderEvaluation {
  breaches: RungBreach[]; // every breached rung, in ladder order (soft_daily → soft_weekly → throttle → hard_kill)
  /** The C6 breach signals C7 emits (throttle/kill rungs only). Empty when only soft rungs (or none) breach. */
  signals: LadderBreachSignal[];
}

/** Guard the config is a coherent ascending ladder. A mis-ordered ladder (e.g. throttle above hard-kill)
 *  would let a rung be un-reachable = silently skipped (#3) — reject it loudly rather than mis-fire. */
export function assertLadderOrdered(cfg: CostLadderConfig): void {
  const { cost_ladder_soft_threshold_daily_usd: soft, cost_ladder_throttle_threshold: thr, cost_ladder_hard_kill_threshold: kill } = cfg;
  for (const [name, v] of Object.entries(cfg)) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      throw new Error(`cost-ladder config '${name}' must be a finite USD amount ≥ 0 (got ${String(v)})`);
    }
  }
  if (!(soft < thr && thr < kill)) {
    throw new Error(
      `cost-ladder is not strictly ascending soft(${soft}) < throttle(${thr}) < hard_kill(${kill}) — a rung would be unreachable/silently skipped (AC-NFR-COST.001.2 / #3)`,
    );
  }
}

/**
 * Evaluate the ladder against the current window spend. `dailyUsd` drives the three daily rungs (soft-daily,
 * throttle, hard-kill — all daily-anchored per ADR-003 §2); `weeklyUsd` drives the weekly soft alert only
 * (the weekly rung is human-attention, no auto-throttle at v1 — ADR-003 §2). A rung breaches when spend is
 * STRICTLY GREATER than its threshold (crossing it — at exactly the threshold it has not yet been exceeded;
 * FR-7.COST.004 "exceeding" / NFR-COST.001).
 */
export function evaluateLadder(dailyUsd: number, weeklyUsd: number, cfg: CostLadderConfig, now: string): LadderEvaluation {
  assertLadderOrdered(cfg);
  const breaches: RungBreach[] = [];
  const signals: LadderBreachSignal[] = [];

  // Order matters — push in ladder order so a higher rung never hides a lower one (no silent skip).
  if (dailyUsd > cfg.cost_ladder_soft_threshold_daily_usd) {
    breaches.push({ rung: 'soft_daily', action: 'alert', window: 'daily', estimated_usd: dailyUsd, threshold_usd: cfg.cost_ladder_soft_threshold_daily_usd });
  }
  if (weeklyUsd > cfg.cost_ladder_soft_threshold_weekly_usd) {
    breaches.push({ rung: 'soft_weekly', action: 'alert', window: 'weekly', estimated_usd: weeklyUsd, threshold_usd: cfg.cost_ladder_soft_threshold_weekly_usd });
  }
  if (dailyUsd > cfg.cost_ladder_throttle_threshold) {
    breaches.push({ rung: 'throttle', action: 'signal', window: 'daily', estimated_usd: dailyUsd, threshold_usd: cfg.cost_ladder_throttle_threshold });
    signals.push({ rung: 'throttle', window: 'daily', estimated_usd: dailyUsd, threshold_usd: cfg.cost_ladder_throttle_threshold, emitted_at: now, enforced_by_c7: false });
  }
  if (dailyUsd > cfg.cost_ladder_hard_kill_threshold) {
    breaches.push({ rung: 'hard_kill', action: 'signal', window: 'daily', estimated_usd: dailyUsd, threshold_usd: cfg.cost_ladder_hard_kill_threshold });
    signals.push({ rung: 'hard_kill', window: 'daily', estimated_usd: dailyUsd, threshold_usd: cfg.cost_ladder_hard_kill_threshold, emitted_at: now, enforced_by_c7: false });
  }

  return { breaches, signals };
}
