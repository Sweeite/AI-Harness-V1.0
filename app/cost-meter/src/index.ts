// @harness/cost-meter — ISSUE-074 (C7 cost meter). Public surface: the CostMeterStore port + in-memory fake
// reference model, the live pg adapter, and the pure estimator/ladder helpers. Consumers: ISSUE-058 (C6
// rate-limit + cost-ladder enforcement) consumes the LadderBreachSignal this meter emits; ISSUE-066
// (orchestrator learning + cost-routing) consumes aggregateByTaskType; the ops cost dashboard (ISSUE-078,
// Phase 3) renders windowSpend + the lit rung — those are the seams this slice STOPS at (it meters + signals,
// it never enforces — NFR-COST.004).
//
// The `check` CLI runs the offline build-time gates (no DB, no network):
//   (1) fail-safe estimator — the round-up bias holds: a fractional-cent cost rounds UP, and a model with
//       both input/output rates is priced at the HIGHER rate (never the optimistic cheaper side).
//   (2) sentinel ≠ 0 — a cost_unknown event is counted as unknown, never a silent $0.
//   (3) ladder integrity — the four rungs exist at the ADR-003 defaults 50/200/75/100, strictly ascending,
//       and C7 emits enforced_by_c7=false on every signal (C7 never claims enforcement).

import { fileURLToPath } from 'node:url';

import { estimate, estimateEventCents, failSafeRatePer1k, isSentinel, centsToUsd, type EstimateResult } from './estimator.ts';
import { evaluateLadder, assertLadderOrdered, type LadderEvaluation, type RungBreach } from './ladder.ts';
import {
  LADDER_DEFAULTS,
  RUNGS,
  UNATTRIBUTED_TASK_TYPE,
  COST_THRESHOLD_BREACH,
  type EventLogCostRow,
  type PriceTable,
  type ModelPrice,
  type CostLadderConfig,
  type NotificationInput,
  type NotificationRow,
  type LadderBreachSignal,
  type Rung,
  type RungAction,
  type TaskTypeRow,
} from './types.ts';

export { InMemoryCostMeterStore } from './store.ts';
export type { CostMeterStore, MeterResult, TaskTypeCost, WindowSpend } from './store.ts';
export { SupabaseCostMeterStore } from './supabase-store.ts';
export { estimate, estimateEventCents, failSafeRatePer1k, isSentinel, centsToUsd };
export type { EstimateResult };
export { evaluateLadder, assertLadderOrdered };
export type { LadderEvaluation, RungBreach };
export {
  LADDER_DEFAULTS,
  RUNGS,
  UNATTRIBUTED_TASK_TYPE,
  COST_THRESHOLD_BREACH,
};
export type {
  EventLogCostRow,
  PriceTable,
  ModelPrice,
  CostLadderConfig,
  NotificationInput,
  NotificationRow,
  LadderBreachSignal,
  Rung,
  RungAction,
  TaskTypeRow,
};

interface Finding {
  gate: string;
  message: string;
}

function checkEstimator(): Finding[] {
  const findings: Finding[] = [];
  const pt: PriceTable = { sonnet: { input: 0.003, output: 0.015 } };
  // Higher-of-input/output: sonnet must be priced at 0.015/1k, not 0.003.
  const rate = failSafeRatePer1k(pt.sonnet!);
  if (rate !== 0.015) findings.push({ gate: 'estimator-roundup', message: `failSafeRatePer1k picked ${rate}, expected the higher 0.015 (ADR-003 §3 round-up)` });
  // Round UP: 1 token at 0.015/1k = $0.000015 = 0.0015¢ → must ceil to 1¢, never floor to 0.
  const c = estimateEventCents({ id: 'e', task_id: null, event_type: 'tool_called', cost_tokens: 1, cost_unknown: false, model: 'sonnet', created_at: '2026-07-05T00:00:00Z' }, pt);
  if (c !== 1) findings.push({ gate: 'estimator-roundup', message: `a sub-cent cost rounded to ${c}¢, expected 1¢ (fail-safe round-up, never floor to 0)` });
  return findings;
}

function checkSentinel(): Finding[] {
  const findings: Finding[] = [];
  const pt: PriceTable = { sonnet: { input: 0.003, output: 0.015 } };
  const res: EstimateResult = estimate(
    [
      { id: 'a', task_id: null, event_type: 'tool_called', cost_tokens: null, cost_unknown: true, model: 'sonnet', created_at: '2026-07-05T00:00:00Z' },
      { id: 'b', task_id: null, event_type: 'tool_called', cost_tokens: 100000, cost_unknown: false, model: 'unpriced_model', created_at: '2026-07-05T00:00:00Z' },
    ],
    pt,
  );
  if (res.cents !== 0) findings.push({ gate: 'sentinel', message: `sentinel/unpriced events added ${res.cents}¢ — must contribute NO silent cost` });
  if (res.unknownCount !== 2) findings.push({ gate: 'sentinel', message: `unknownCount=${res.unknownCount}, expected 2 — a cost_unknown/unpriced event must surface, never be a silent 0 (#3)` });
  return findings;
}

function checkLadder(): Finding[] {
  const findings: Finding[] = [];
  const d = LADDER_DEFAULTS;
  if (d.cost_ladder_soft_threshold_daily_usd !== 50 || d.cost_ladder_soft_threshold_weekly_usd !== 200 || d.cost_ladder_throttle_threshold !== 75 || d.cost_ladder_hard_kill_threshold !== 100) {
    findings.push({ gate: 'ladder-defaults', message: `ladder defaults ≠ 50/200/75/100 (ADR-003 §2 / AC-NFR-COST.001.1)` });
  }
  if (RUNGS.length !== 4) findings.push({ gate: 'ladder-rungs', message: `expected 4 rungs, found ${RUNGS.length}` });
  try {
    assertLadderOrdered(d);
  } catch (e) {
    findings.push({ gate: 'ladder-order', message: `default ladder is not strictly ascending: ${(e as Error).message}` });
  }
  // C7 never enforces: every emitted signal carries enforced_by_c7=false.
  const ev: LadderEvaluation = evaluateLadder(150, 0, d, '2026-07-05T00:00:00Z'); // past kill
  if (ev.signals.length === 0) findings.push({ gate: 'ladder-signal', message: `$150/day did not emit any throttle/kill signal` });
  for (const s of ev.signals) {
    if (s.enforced_by_c7 !== false) findings.push({ gate: 'ladder-enforce', message: `a signal claimed enforced_by_c7=${String(s.enforced_by_c7)} — C7 must never enforce (AC-NFR-COST.004.2)` });
  }
  return findings;
}

function runCheck(): Finding[] {
  const findings = [...checkEstimator(), ...checkSentinel(), ...checkLadder()];
  if (findings.length === 0) {
    console.log('✓ cost-meter check: fail-safe round-up holds · sentinel never a silent 0 · four rungs at 50/200/75/100 ascending · C7 emits, never enforces.');
  } else {
    console.error(`✗ cost-meter check: ${findings.length} finding(s):`);
    for (const f of findings) console.error(`  [${f.gate}] ${f.message}`);
  }
  return findings;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cmd = process.argv[2] ?? 'check';
  if (cmd === 'check') {
    process.exit(runCheck().length === 0 ? 0 : 1);
  }
  console.error(`unknown command '${cmd}' — use: check`);
  process.exit(2);
}
