// ISSUE-027 (C2 MNT) — FR-2.MNT.004: hard expiry. The WRITER sets `expires_at` at write time (ISSUE-024); RETRIEVAL
// enforces the exclusion (ISSUE-025). This slice owns the CONTRACT both sides share: an expired memory is EXCLUDED
// from retrieval, but NEVER deleted (consistent with decay-never-deletes) — it remains in-table, recoverable, and a
// future `expires_at` bump can bring it back. This is the single source of truth for "is this memory expired at
// time t", so the maintenance view and the retrieval view can never silently disagree.

import type { MemoryRow } from '../../memory/src/store.ts';

/** True iff the memory's `expires_at` has passed at `nowMs` (a null expiry never expires — most memories). */
export function isExpired(memory: MemoryRow, nowMs: number): boolean {
  return memory.expires_at !== null && Date.parse(memory.expires_at) <= nowMs;
}

/** True iff a memory is admissible to retrieval on the EXPIRY axis alone (the FR-2.MNT.004 contract RET applies
 *  alongside its confidence-floor + not-superseded filters). Excluded, not deleted. */
export function retrievableByExpiry(memory: MemoryRow, nowMs: number): boolean {
  return !isExpired(memory, nowMs);
}

/** Partition a candidate set into {retrievable, excluded} by expiry at `nowMs` — the maintenance-side realisation of
 *  the exclusion RET enforces. Neither side is deleted; `excluded` rows are still present + recoverable. */
export function excludeExpired(memories: readonly MemoryRow[], nowMs: number): { retrievable: MemoryRow[]; excluded: MemoryRow[] } {
  const retrievable: MemoryRow[] = [];
  const excluded: MemoryRow[] = [];
  for (const m of memories) (isExpired(m, nowMs) ? excluded : retrievable).push(m);
  return { retrievable, excluded };
}
