// ISSUE-027 (C2 MNT) — FR-2.MNT.001: the confidence lifecycle engine (pure, no I/O). Moves a memory's confidence
// over its life by a fixed signal→delta table, clamps to [floor, 1.0], and encodes the two freeze rules. Every
// mutation of a real memory's confidence in this slice is computed HERE and then applied through the single
// governed maintenance write port (store.setConfidence) with a cause-tagged confidence-change record (FR-2.MNT.016
// feedback log) — so a confidence never moves silently or off-band (#3).
//
// Deltas (design-doc-v4.md L1679–1695, component-02 FR-2.MNT.001):
//   UP    human verify            +0.10   (cap 1.0)
//         retrieval-and-use        +0.02
//         corroboration by memory  +0.05
//         corroboration by SoR     +0.05
//   DOWN  soft decay               ×0.95   (multiplicative toward the floor — the daily job, FR-2.MNT.002)
//         human flag/edit          −0.15
//         system-of-record contra  −0.20   (AND flags for review — it is evidence the brain is wrong, #1)
//         poor outcome after use   −0.05
//   SET   human direct write        1.0    (enters human_verified via the sole writer, FR-2.MNT.016)
//   FREEZE never decay human_verified; freeze a memory in active human review until resolved (L1695).

import type { MemoryRow } from '../../memory/src/store.ts';
import type { MaintenanceConfig } from './config.ts';

/** The cause tag on every confidence movement — the "why" in the FR-2.MNT.016 who/when/why log. */
export type ConfidenceCause =
  | 'human_verify'
  | 'retrieval_use'
  | 'corroboration_memory'
  | 'corroboration_sor'
  | 'soft_decay'
  | 'human_flag'
  | 'human_edit'
  | 'sor_contradiction'
  | 'poor_outcome'
  | 'human_direct_write';

/** The additive-delta signals (soft_decay is multiplicative, human_direct_write is a set — both handled below). */
const ADDITIVE_DELTAS: Readonly<Record<ConfidenceCause, number | null>> = Object.freeze({
  human_verify: +0.1,
  retrieval_use: +0.02,
  corroboration_memory: +0.05,
  corroboration_sor: +0.05,
  human_flag: -0.15,
  human_edit: -0.15,
  sor_contradiction: -0.2,
  poor_outcome: -0.05,
  soft_decay: null, // multiplicative
  human_direct_write: null, // set to 1.0
});

/** The signals that DOWN-move confidence (used by the amber/bulk drop detectors — only a drop can cross amber). */
export const DOWN_CAUSES: readonly ConfidenceCause[] = ['soft_decay', 'human_flag', 'human_edit', 'sor_contradiction', 'poor_outcome'];

/** The signals a caller may raise as a "confirmation" (relevance/feedback happy path). */
export const UP_CAUSES: readonly ConfidenceCause[] = ['human_verify', 'retrieval_use', 'corroboration_memory', 'corroboration_sor'];

/** Round to the memories.confidence numeric(4,3) precision so offline == live (cf. memory-write assignConfidence). */
function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/** Clamp into the lifecycle band [floor, 1.0] (FR-2.MNT.001 "capped at [floor, 1.0]"). */
function clampBand(x: number, floor: number): number {
  return Math.min(1, Math.max(floor, x));
}

/** True iff a memory's confidence must be FROZEN against an automated (non-human) signal: a `human_verified`
 *  memory is never decayed (L1695), and a memory in active human review is frozen until resolved. Human actions
 *  (verify/flag/edit/direct-write) are never frozen — they are the resolution. */
export function isFrozenAgainst(memory: MemoryRow, cause: ConfidenceCause, underReview: boolean): boolean {
  const humanAction = cause === 'human_verify' || cause === 'human_flag' || cause === 'human_edit' || cause === 'human_direct_write';
  if (humanAction) return false;
  // never decay a human_verified memory (the golden freeze — applies to EVERY automated signal, not just decay).
  if (memory.source === 'human_verified') return true;
  // a memory under active review is frozen against automated drift until a human resolves it.
  return underReview;
}

export interface ConfidenceOutcome {
  /** the new clamped/rounded confidence, or null iff the memory is unscored (system_pointer — never moved). */
  confidence: number | null;
  /** true iff the memory did NOT move (frozen, unscored, or a no-op at the clamp boundary). */
  frozen: boolean;
  /** true iff this signal also raises a review flag (a system-of-record contradiction — MNT.001.2). */
  flagForReview: boolean;
}

/**
 * Compute the next confidence for `memory` under `cause`. Pure + deterministic. Does NOT mutate — the caller
 * applies the result through the governed write port + logs it.
 *   • system_pointer (confidence === null) is UNSCORED — never moved (returns null, frozen).
 *   • a frozen memory (isFrozenAgainst) is returned unchanged.
 *   • soft_decay multiplies by the multiplier toward the floor; human_direct_write sets 1.0; all else adds the delta.
 *   • a system-of-record contradiction additionally raises the review flag.
 */
export function nextConfidence(memory: MemoryRow, cause: ConfidenceCause, cfg: MaintenanceConfig, underReview = false): ConfidenceOutcome {
  const flagForReview = cause === 'sor_contradiction';
  if (memory.confidence === null) return { confidence: null, frozen: true, flagForReview: false }; // unscored pointer
  if (isFrozenAgainst(memory, cause, underReview)) return { confidence: memory.confidence, frozen: true, flagForReview };

  let next: number;
  if (cause === 'human_direct_write') {
    next = 1.0;
  } else if (cause === 'soft_decay') {
    next = memory.confidence * cfg.softDecayMultiplier;
  } else {
    const delta = ADDITIVE_DELTAS[cause];
    next = memory.confidence + (delta ?? 0);
  }
  const clamped = round3(clampBand(next, cfg.confidenceFloor));
  return { confidence: clamped, frozen: clamped === memory.confidence && cause !== 'sor_contradiction', flagForReview };
}
