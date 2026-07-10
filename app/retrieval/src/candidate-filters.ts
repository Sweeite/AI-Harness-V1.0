// ISSUE-025 (C2 RET) — FR-2.RET.003: the candidate filters, applied UNIFORMLY to both arms (OD-035). A candidate is
// admitted iff confidence >= CFG-retrieval_confidence_threshold (0.7) AND it is not expired (expires_at null-or-future)
// AND it is not superseded (superseded_by is null). The uniformity is the point: the design states these predicates
// explicitly for the keyword arm (design-doc L1714) but NOT the vector arm — OD-035 resolves that they apply equally,
// else a low-confidence / expired / SUPERSEDED memory re-enters through semantic similarity (a #1/#2 leak of stale
// knowledge that AC-2.RET.003.1 exists to forbid).
//
// The `system_pointer` admission rule (OD-035): a system_pointer memory is UNSCORED (confidence null — it points at
// authoritative live data rather than asserting a fact) and is admitted on its own rule — the confidence floor does
// not apply to it (it would fail a `confidence >= 0.7` test on a null). Expiry + supersession STILL apply (a pointer
// can be superseded or expire). It is excluded from the confidence RANK term downstream (rank.ts), not here.

import type { MemoryRow } from '../../memory/src/store.ts';

/** CFG-retrieval_confidence_threshold default (config-registry.md — LIVE, 0.7). The live value is read from config; this
 *  is the shipped default the fake + tests use. */
export const RETRIEVAL_CONFIDENCE_DEFAULT = 0.7;

/** `now` is injected (an ISO instant) so expiry is deterministic in tests + identical offline/live. */
export interface CandidateFilterCtx {
  confidenceFloor: number;
  nowIso: string;
}

/** Is a system-of-record pointer? Unscored (confidence null) and admitted on its own rule (no confidence floor). */
export function isSystemPointer(m: Pick<MemoryRow, 'source'>): boolean {
  return m.source === 'system_pointer';
}

function notExpired(m: Pick<MemoryRow, 'expires_at'>, nowIso: string): boolean {
  if (m.expires_at === null) return true;
  return m.expires_at > nowIso; // future expiry = still live; a past/equal instant = expired (dropped)
}

function notSuperseded(m: Pick<MemoryRow, 'superseded_by'>): boolean {
  return m.superseded_by === null;
}

/**
 * Admit a single candidate per FR-2.RET.003 (OD-035). Applied identically to BOTH arms. A system_pointer skips the
 * confidence floor (unscored) but still must be not-expired + not-superseded. Everything else needs confidence >= floor.
 */
export function admitsCandidate(m: MemoryRow, ctx: CandidateFilterCtx): boolean {
  if (!notSuperseded(m)) return false; // superseded is dead regardless of source (#1: never resurface stale)
  if (!notExpired(m, ctx.nowIso)) return false;
  if (isSystemPointer(m)) return true; // unscored pointer — admitted on its own rule (OD-035)
  return m.confidence !== null && m.confidence >= ctx.confidenceFloor;
}

/** Apply the candidate filters to a raw candidate list (either arm). Pure. */
export function applyCandidateFilters(candidates: readonly MemoryRow[], ctx: CandidateFilterCtx): MemoryRow[] {
  return candidates.filter((m) => admitsCandidate(m, ctx));
}
