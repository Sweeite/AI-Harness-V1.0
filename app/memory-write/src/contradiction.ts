// ISSUE-024 (C2 WRT) — FR-2.WRT.002: the pre-write contradiction check (pure). Given a drafted candidate and the
// 3–5 most similar EXISTING live memories (supplied by a SimilarMemoryReader — the vector arm read, ISSUE-023's
// contract / ISSUE-025's query), classify the write:
//   • none — no conflicting live memory → write as-is.
//   • soft — the candidate refines/updates a same-type memory about the SAME entity set → write new AND
//            CAS-supersede the old (chain via superseded_by, never delete — AC-2.WRT.002.1).
//   • hard — the writer flags the candidate as DIRECTLY CONTRADICTING such a memory → DO NOT write to the live
//            set; quarantine into memory_conflicts for human review (AC-2.WRT.002.2), never silently overwrite.
//
// This is a LEXICAL/STRUCTURAL classifier (no LLM) — it is BOTH the unlocked pre-check AND the cheap on-race
// re-check inside the commit txn (ADR-004 §3: "re-run ONLY the cheap DB contradiction check, no LLM"). A
// SEMANTICALLY-contradicting racing write this lexical check misses is caught by the daily supersede backstop
// (FR-2.MNT.006, ISSUE-027) within ≤1 day — bounded + surfaced, not silent (component-02 L660).
//
// The hard/soft discriminator is the writer's explicit `contradicts` signal (the Sonnet judgment, decided while
// drafting against the similar set): a value the writer states REPLACES-because-contradicts is hard (quarantine,
// reversible via the human queue); a value that refines/adds is soft (supersede, reversible via the chain). We
// never AUTO-overwrite a flagged contradiction — losing a genuine contradiction silently is a #1 knowledge loss.

import type { MemoryRow } from '../../memory/src/store.ts';
import type { MemoryType } from '../../memory/src/entity-types.ts';
import { contentHash } from '../../memory/src/memory.ts';

export type ConflictKind = 'none' | 'soft' | 'hard';

/** A drafted candidate memory (pre-embedding, pre-commit) as the classifier needs to see it. */
export interface Candidate {
  type: MemoryType;
  content: string;
  entity_ids: string[];
  /** Explicit contradiction signal from the writer: this candidate CONTRADICTS (not merely refines) a same-slot
   *  prior memory. When it matches a same-type/same-entity-set live memory, the conflict is HARD. */
  contradicts?: boolean;
}

export interface Classification {
  kind: ConflictKind;
  /** For soft: the existing live memory ids to CAS-supersede. For hard: the conflicting_memory_ids to quarantine. */
  targetIds: string[];
  reason: string;
}

/** Same entity set (order-independent) — the resolution axis both memories must share to conflict. */
export function sameEntitySet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((x, i) => x === sb[i]);
}

/**
 * Classify the candidate against the similar set. Pure + deterministic. `similar` is the 3–5 most similar LIVE
 * memories (the reader already filtered superseded/expired; we defensively re-filter superseded here so the same
 * function is safe as the on-race re-check over a possibly-stale snapshot). Returns the conflict kind + targets.
 */
export function classifyConflict(candidate: Candidate, similar: readonly MemoryRow[]): Classification {
  const live = similar.filter((m) => m.superseded_by === null);
  const candHash = contentHash(candidate.content);

  // Candidates that would conflict at all: a same-type memory about the SAME entity set. (Cross-entity-set
  // similarity is a different fact, never a supersede target — that would fragment/merge knowledge, #1.)
  const sameSlot = live.filter((m) => m.type === candidate.type && sameEntitySet(m.entity_ids, candidate.entity_ids));

  // An exact-duplicate live memory (identical normalised content) is NOT a conflict — the idempotency key already
  // dedups it and re-superseding an identical memory would churn the chain. `none` (the commit insert no-ops).
  if (sameSlot.some((m) => m.content_hash === candHash)) {
    return { kind: 'none', targetIds: [], reason: 'exact duplicate of a live memory (idempotent no-op)' };
  }

  // Only DIFFERENT-content same-slot memories are candidates for supersede/quarantine.
  const differing = sameSlot.filter((m) => m.content_hash !== candHash);
  if (differing.length === 0) {
    return { kind: 'none', targetIds: [], reason: 'no same-slot live memory to supersede' };
  }

  if (candidate.contradicts) {
    return {
      kind: 'hard',
      targetIds: differing.map((m) => m.id),
      reason: `writer-flagged contradiction with ${differing.length} live same-slot memory(ies) — human review, never auto-overwritten`,
    };
  }
  return {
    kind: 'soft',
    targetIds: differing.map((m) => m.id),
    reason: `refines ${differing.length} same-slot live memory(ies) — supersede (chain preserved)`,
  };
}

/** True iff the on-race similar set gained a NEW differing same-slot live memory not among `knownTargetIds` — the
 *  case that invalidates the unlocked decision (a racing writer added a conflicting memory the writer never saw).
 *  Used inside the commit txn to decide whether to re-classify (ADR-004 §3).
 *
 *  M5 — this deliberately keys on NEW ARRIVALS only, not on "a known target became superseded". The latter is
 *  transitively covered: the sole writer supersedes only by INSERTING a new live head (which trips the new-arrival
 *  check), so a known target can go superseded-without-a-replacement only via a NON-writer path (expiry/erasure),
 *  where the now-stale `soft` decision's CAS (`WHERE superseded_by IS NULL`) simply affects 0 rows — a harmless
 *  no-op, never a lost or duplicated write. So flagging it isn't needed for correctness and flagging it eagerly
 *  would trigger a spurious reclassify; we leave it to the CAS guard. */
export function decisionStale(
  candidate: Candidate,
  currentSimilar: readonly MemoryRow[],
  knownTargetIds: readonly string[],
): boolean {
  const known = new Set(knownTargetIds);
  const live = currentSimilar.filter((m) => m.superseded_by === null);
  const candHash = contentHash(candidate.content);
  const sameSlotDiffering = live.filter(
    (m) => m.type === candidate.type && sameEntitySet(m.entity_ids, candidate.entity_ids) && m.content_hash !== candHash,
  );
  // A newly-arrived same-slot differing memory not previously known → re-decide.
  return sameSlotDiffering.some((m) => !known.has(m.id));
}
