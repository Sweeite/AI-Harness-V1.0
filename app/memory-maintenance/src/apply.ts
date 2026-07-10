// ISSUE-027 (C2 MNT) — the single governed confidence-mutation path. Every job that moves a real memory's
// confidence (decay, feedback, relevance corroboration, the lifecycle signals) calls applyConfidenceChange — it
// computes the new value with the pure engine (FR-2.MNT.001), applies it through the sole-writer maintenance port
// (store.setConfidence — never a raw update), and logs a cause-tagged who/when/why record (FR-2.MNT.016). A
// system-of-record contradiction additionally raises a soft-conflict review flag (MNT.001.2). This is where the
// "no confidence moves silently or off the sole-writer path" invariant is actually enforced (#3).

import type { MemoryRow } from '../../memory/src/store.ts';
import type { MaintenanceConfig } from './config.ts';
import { nextConfidence, type ConfidenceCause } from './confidence-lifecycle.ts';
import { amberCrossed } from './alerts.ts';
import type { MaintenanceStore } from './store.ts';

export interface ApplyResult {
  /** true iff the confidence actually changed (a frozen/unscored/no-op move returns false). */
  moved: boolean;
  oldConfidence: number | null;
  newConfidence: number | null;
  /** true iff this change carried the memory from ≥ amber down across the amber threshold (fires an amber flag). */
  crossedAmber: boolean;
  /** true iff a review flag was raised (system-of-record contradiction). */
  flaggedForReview: boolean;
}

/**
 * Apply one confidence signal to `memory` through the governed port + log it. `actor` is the human user id or the
 * `service_role` job name (never a blank 'system'); `reason` is the human-readable why. Idempotent-safe: a frozen
 * or unscored memory is a logged no-op (moved:false), never a silent skip.
 */
export async function applyConfidenceChange(
  store: MaintenanceStore,
  memory: MemoryRow,
  cause: ConfidenceCause,
  actor: string,
  reason: string,
  cfg: MaintenanceConfig,
  opts: { underReview?: boolean; nowIso?: string } = {},
): Promise<ApplyResult> {
  const nowIso = opts.nowIso ?? new Date().toISOString();
  const outcome = nextConfidence(memory, cause, cfg, opts.underReview ?? false);
  const oldConfidence = memory.confidence;

  const moved = outcome.confidence !== null && outcome.confidence !== oldConfidence;
  if (moved) {
    await store.setConfidence(memory.id, outcome.confidence as number);
    await store.confidenceChanged({ memoryId: memory.id, oldConfidence, newConfidence: outcome.confidence, cause, actor, reason, at: nowIso });
    memory.confidence = outcome.confidence; // keep the caller's local view in sync for downstream crossing checks
  }

  const crossedAmber = moved && oldConfidence !== null && outcome.confidence !== null && amberCrossed(oldConfidence, outcome.confidence, cfg);

  if (outcome.flagForReview) {
    // A system-of-record contradiction is evidence the brain is wrong — flag it for review (MNT.001.2), even if the
    // confidence was frozen (a human_verified memory contradicted by a SoR still deserves the flag, #1).
    await store.task({ kind: 'soft_conflict', targetId: memory.id, action: 'review', detail: `system-of-record contradiction (${reason})`, at: nowIso });
  }
  return { moved, oldConfidence, newConfidence: outcome.confidence, crossedAmber, flaggedForReview: outcome.flagForReview };
}
