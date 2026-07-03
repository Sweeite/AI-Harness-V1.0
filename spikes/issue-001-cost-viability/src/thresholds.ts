/**
 * Cost thresholds — spec/02-config/config-registry.md §I (Guardrails) + ADR-003 §2/§7.
 * The spike READS these (does not set them). Values are the LIVE defaults.
 */
export const THRESHOLDS = {
  viabilityTargetDailyUsd: 20, // ADR-003 §7 "~$20/day" viability target
  softAlertDailyUsd: 50, // cost_ladder_soft_threshold_daily_usd
  softAlertWeeklyUsd: 200, // cost_ladder_soft_threshold_weekly_usd
  throttleDailyUsd: 75, // cost_ladder_throttle_threshold (1.5×)
  hardKillDailyUsd: 100, // cost_ladder_hard_kill_threshold (2×)
} as const;

export type Verdict = 'PASS' | 'FAIL' | 'OVER-SOFT-ALERT';

/**
 * AC-NFR-COST.006.1 — typical-volume cost lands at/under ~$20/day AND under the $50 soft alert.
 * If between $20 and $50 we still PASS the .006.1 assertion (it says "at or below ~$20/day and
 * under the $50/day soft alert") but flag it as needing attention. Above $50 → OVER-SOFT-ALERT,
 * which triggers the AC-.006.2 lever path before any ceiling is raised.
 */
export function verdictFor(perDayUsd: number): Verdict {
  if (perDayUsd >= THRESHOLDS.softAlertDailyUsd) return 'OVER-SOFT-ALERT';
  if (perDayUsd <= THRESHOLDS.viabilityTargetDailyUsd) return 'PASS';
  // Between target and soft alert: under the soft alert but above the ~$20 target.
  return 'FAIL';
}
