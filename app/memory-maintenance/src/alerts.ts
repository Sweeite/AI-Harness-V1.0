// ISSUE-027 (C2 MNT) — FR-2.MNT.003: amber-zone + bulk-drop alert detectors (pure). The alerts make erosion
// VISIBLE (#3) rather than letting the brain quietly degrade: the amber flag fires BEFORE a memory drops below the
// 0.7 retrieval floor (config-registry audit H27: amber 0.75 > retrieval 0.7), and the bulk-drop alert catches a
// wholesale burst (a connector broke, a bad ingestion) the way a single amber flag never would.

import type { MaintenanceConfig } from './config.ts';

/** True iff a confidence move carried a memory from at-or-above the amber threshold to below it — the amber
 *  crossing that raises a proactive review flag (AC-2.MNT.003.1). A move already below amber does NOT re-fire
 *  (only the crossing is the event), and an UP move never fires. */
export function amberCrossed(oldConfidence: number, newConfidence: number, cfg: MaintenanceConfig): boolean {
  return oldConfidence >= cfg.amberZoneThreshold && newConfidence < cfg.amberZoneThreshold;
}

/**
 * True iff any window of `bulk_drop_alert_window_minutes` contains MORE THAN `bulk_drop_alert_count` confidence
 * drops (AC-2.MNT.003.2 — "11 memories dropping in 30 minutes → a systemic alert"). `dropTimesMs` is the epoch-ms
 * timestamps of the drops observed (any source — decay, feedback, contradiction). Pure + deterministic: sorts the
 * times and slides a window, firing when the count strictly exceeds the threshold within any window span.
 */
export function bulkDropFired(dropTimesMs: readonly number[], cfg: MaintenanceConfig): boolean {
  if (dropTimesMs.length <= cfg.bulkDropAlertCount) return false; // can't exceed the count at all
  const windowMs = cfg.bulkDropAlertWindowMinutes * 60 * 1000;
  const sorted = [...dropTimesMs].sort((a, b) => a - b);
  let start = 0;
  for (let end = 0; end < sorted.length; end++) {
    while (sorted[end]! - sorted[start]! > windowMs) start++;
    const countInWindow = end - start + 1;
    if (countInWindow > cfg.bulkDropAlertCount) return true;
  }
  return false;
}

/** A small stateful accumulator the decay/feedback path feeds each drop into; the scheduler asks it whether a bulk
 *  alert should fire for the current run (keeps the sliding-window logic in one pure place). */
export class BulkDropAccumulator {
  private readonly times: number[] = [];
  record(atMs: number): void {
    this.times.push(atMs);
  }
  get count(): number {
    return this.times.length;
  }
  fired(cfg: MaintenanceConfig): boolean {
    return bulkDropFired(this.times, cfg);
  }
  memoryTimes(): number[] {
    return [...this.times];
  }
}
