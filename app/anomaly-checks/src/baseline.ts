// ISSUE-057 §8 step 5 — baseline learning from historical data (FR-6.ANM.005).
//
// Computes a per-anomaly baseline from accumulated history and PROPOSES a tighten/loosen of the
// threshold so it adapts to demonstrated normal behaviour. The shipped fixed thresholds are the
// starting point (FR-6.ANM.004); a baseline REFINES them — it never silently applies.
//
// AC-6.ANM.005.1 — the guardrail: a proposal is surfaced (recorded as a BaselineProposal). If the
// change would ALTER A GATE outcome (a check whose deployment severity is 'hard' — its threshold is a
// gate, not merely a signal), the proposal REQUIRES admin confirmation before it can be applied
// (never silent auto-apply — consistency with OPT.001's never-auto-change rule). A proposal that only
// tunes a SOFT signal is not gate-altering and can be surfaced without a gate-confirmation requirement.
//
// This slice computes + surfaces the proposal. The reusable learning MECHANISM (FR-6.OPT.002) and the
// candidate-surfacing UI are ISSUE-060 — consumed, not re-implemented here. `baseline_learning_enabled`
// (config.ts) is the deployment-wide gate on whether this runs at all.

import type { AnomalyKind, AnomalyThresholdsConfig } from './config.js';
import { ANOMALY_KINDS } from './config.js';
import type { AnomalyStore, BaselineProposal } from './store.js';

/** A window of historical observed metrics per anomaly kind (the "accumulated history"). */
export type History = Record<AnomalyKind, number[]>;

/**
 * Compute a baseline threshold from history for one kind. Strategy (deterministic, testable):
 *   - gte checks (volume/contradiction/scope/sentiment): the anomaly should fire above NORMAL, so the
 *     baseline is a high percentile of observed metrics (p95) — well above typical, below the outliers.
 *   - lte checks (confidence): the anomaly should fire below NORMAL, so the baseline is a LOW percentile
 *     (p05) of observed confidence.
 * Percentile is nearest-rank on the sorted sample.
 */
export function computeBaseline(kind: AnomalyKind, samples: number[]): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const pct = kind === 'confidence' ? 0.05 : 0.95;
  // nearest-rank: rank = ceil(pct * N), clamped to [1, N]
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil(pct * sorted.length)));
  return sorted[rank - 1]!;
}

/**
 * FR-6.ANM.005 — from accumulated history, propose a tighten/loosen for each kind whose baseline
 * differs from the current configured threshold, and record each proposal via the store. A proposal
 * whose kind is at 'hard' severity is GATE-ALTERING → it carries `gate_altering: true` so it CANNOT
 * be applied without admin confirmation (AC-6.ANM.005.1).
 *
 * Returns the recorded proposals. Does nothing (empty) if learning is disabled deployment-wide.
 */
export async function proposeBaselines(
  store: AnomalyStore,
  config: AnomalyThresholdsConfig,
  history: History,
): Promise<BaselineProposal[]> {
  if (!config.baseline_learning_enabled) return [];

  const out: BaselineProposal[] = [];
  for (const kind of ANOMALY_KINDS) {
    const proposed = computeBaseline(kind, history[kind]);
    if (proposed === null) continue;
    const current = config[kind].threshold;
    if (proposed === current) continue;

    // "tighten" = the check will fire MORE readily; "loosen" = LESS readily. Direction depends on the
    // comparator: for gte checks a LOWER threshold tightens; for lte (confidence) a HIGHER floor tightens.
    const gte = config[kind].comparator === 'gte';
    const tighter = gte ? proposed < current : proposed > current;
    const direction = tighter ? 'tighten' : 'loosen';

    // A 'hard'-severity check's threshold is a GATE (it routes to hard-approval), so changing it alters
    // a gate outcome → admin confirmation required. A 'soft' check is only a signal.
    const gate_altering = config[kind].severity === 'hard';

    out.push(
      await store.recordBaselineProposal({
        kind,
        current_threshold: current,
        proposed_threshold: proposed,
        direction,
        gate_altering,
      }),
    );
  }
  return out;
}

/**
 * Apply a baseline proposal to the config. AC-6.ANM.005.1 guard: a GATE-ALTERING proposal may only be
 * applied once it has been admin-CONFIRMED — otherwise this throws (never silent auto-apply). A
 * non-gate-altering (signal-only) proposal may be applied directly. Returns the new config object
 * (the caller persists it as the `anomaly_thresholds` row); the input config is not mutated.
 */
export function applyBaselineProposal(
  config: AnomalyThresholdsConfig,
  proposal: BaselineProposal,
): AnomalyThresholdsConfig {
  if (proposal.gate_altering && proposal.status !== 'confirmed' && proposal.status !== 'applied') {
    throw new Error(
      `ADMIN-CONFIRM REQUIRED: gate-altering baseline change for '${proposal.kind}' cannot be applied ` +
        `while status='${proposal.status}' (AC-6.ANM.005.1 — never silent auto-apply)`,
    );
  }
  const kind = proposal.kind as AnomalyKind;
  return {
    ...config,
    [kind]: { ...config[kind], threshold: proposal.proposed_threshold },
  };
}
