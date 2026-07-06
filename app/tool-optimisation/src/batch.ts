// ISSUE-036 §8 step 3 — FR-3.OPT.003: batch reads where the connector supports it.
//
// Where a connector declares a batch endpoint + limit, group batch-eligible READS to that documented
// limit. Clamp/REJECT an over-limit batch (no over-large batch — AC-3.OPT.003.1 / FR-3.OPT.003 Edge).
// Connectors WITHOUT batching fall through to INDIVIDUAL calls under the rate tiers (FR-3.RL.*,
// ISSUE-034 — deferred here, we only expose the fallback shape). Batch limits are PER-CONNECTOR
// parameters (issue §5 Connectors; Gmail per-API batch, recommend ≤50 — google-gmail.md §4 L86; the
// global batch endpoint was retired 2020, per-API only).
//
// Deterministic + pure: no I/O, no clock. Given N reads and a connector's batch capability, produce the
// group plan the caller then executes.

/** A connector's batching capability (a per-connector parameter, supplied by ISSUE-039/040/041). */
export interface BatchCapability {
  /** Does this connector expose a batch endpoint at all? */
  batchable: boolean;
  /** The connector's DOCUMENTED batch limit (max reads per batch). Ignored when !batchable. */
  limit: number;
}

export class OverLimitBatchError extends Error {}

export type BatchPlan =
  | { mode: 'batched'; groups: number[][]; limit: number } // each group = indices of reads to send together
  | { mode: 'individual'; count: number }; // no batching → one call per read (defers to rate tiers)

/**
 * Plan how to issue `readCount` eligible reads against a connector.
 *  • batchable → groups of size ≤ limit (the last group is the remainder). Every group is within the
 *    documented limit (AC-3.OPT.003.1).
 *  • not batchable → individual calls (FR-3.OPT.003 Branch; the rate tiers, ISSUE-034, govern pacing).
 */
export function planBatches(readCount: number, cap: BatchCapability): BatchPlan {
  if (readCount < 0 || !Number.isInteger(readCount)) {
    throw new Error(`planBatches: readCount must be a non-negative integer, got ${readCount}`);
  }
  if (!cap.batchable) {
    return { mode: 'individual', count: readCount };
  }
  if (!Number.isInteger(cap.limit) || cap.limit < 1) {
    throw new Error(`planBatches: a batchable connector must declare an integer limit ≥ 1, got ${cap.limit}`);
  }
  const groups: number[][] = [];
  for (let start = 0; start < readCount; start += cap.limit) {
    const end = Math.min(start + cap.limit, readCount);
    const group: number[] = [];
    for (let i = start; i < end; i += 1) group.push(i);
    groups.push(group);
  }
  return { mode: 'batched', groups, limit: cap.limit };
}

/**
 * Validate a caller-proposed batch (a single group of read indices) against the connector's limit.
 * REJECTS an over-limit batch outright — the caller must re-plan via planBatches, never send an
 * over-large batch (FR-3.OPT.003 Edge — "no over-large batch"). This is the fail-closed guard on the
 * boundary where a connector might hand us a too-big group.
 */
export function assertWithinLimit(batchSize: number, cap: BatchCapability): void {
  if (!cap.batchable) {
    throw new OverLimitBatchError(
      `connector does not support batching — issue individual calls, do not batch (FR-3.OPT.003)`,
    );
  }
  if (batchSize > cap.limit) {
    throw new OverLimitBatchError(
      `batch of ${batchSize} exceeds the connector's documented limit ${cap.limit} — rejected (AC-3.OPT.003.1)`,
    );
  }
}

/**
 * Clamp an over-limit batch to the connector's limit, returning the accepted slice AND the overflow the
 * caller must schedule as further batches. (An alternative to a hard reject where the caller opts to
 * split rather than fail — both satisfy "no over-large batch".)
 */
export function clampBatch<T>(reads: T[], cap: BatchCapability): { accepted: T[]; overflow: T[] } {
  if (!cap.batchable) throw new OverLimitBatchError('connector does not support batching (FR-3.OPT.003)');
  if (reads.length <= cap.limit) return { accepted: reads, overflow: [] };
  return { accepted: reads.slice(0, cap.limit), overflow: reads.slice(cap.limit) };
}
