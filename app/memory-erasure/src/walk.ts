// ISSUE-029 §8 steps 2-3 — target resolution → the transitive walk → the delete-vs-retain classification.
//
// The walk computes the transitive erasure CLOSURE from the target's Personal rows, then classifies every reached
// row. The classification is the #1/#2 crux:
//
//   • DERIVED row (derived_from non-empty — a merge FR-2.MNT.005 / summary FR-2.MNT.007 row): always HARD-DELETE.
//     A derived row is by definition RECOMPUTABLE from its surviving sources, so deleting it can never lose primary
//     knowledge (#1-safe), and it GUARANTEES no erased Personal content survives re-tagged Standard/Confidential
//     inside it (AC-2.MNT.017.3, the #2 residue this forbids). The "re-generate without it" half of the AC is then
//     realised by ISSUE-027's normal merge/summary cadence re-deriving from the surviving sources — NOT re-derived
//     inline here (an inline LLM re-derivation risks re-embedding the erased content mid-erasure, a #2 hazard).
//
//   • PRIMARY single-entity row (entity_ids === [target]): HARD-DELETE. Unambiguously only the target's data.
//
//   • PRIMARY multi-entity row (target + other entities): RETAIN + hand to scrubbing (AC-NFR-CMP.005.2 literal —
//     "multi-entity retained + passed to scrubbing"). Hard-deleting it would destroy OTHER subjects' original data
//     (#1); silently keeping it would leave the target's Personal content as residue (#2). So it is retained AND
//     surfaced as an owed content-scrub leg — a loud hand-off (the free-text scrub is C10/ISSUE-082, out of this
//     slice's scope), never a silent drop (#3). The erasure is NOT reported fully done while a scrub is owed.

import type { ErasureRow, ErasureStore } from './store.ts';

export interface WalkResult {
  /** rows to hard-delete: derived rows + the target's single-entity primaries + their lineage. */
  deleteSet: ErasureRow[];
  /** multi-entity primary rows that REFERENCE the target — retained + owed to C10 scrubbing (surfaced, never
   *  silently deleted or kept). */
  retainForScrub: ErasureRow[];
  /** primary rows pulled into the closure via the supersede graph that do NOT reference the target — i.e. ANOTHER
   *  subject's independent rows (e.g. a sibling source consolidation CAS-superseded into a shared merge). These are
   *  NOT the target's data (FR-2.MNT.017 remit) and must NEVER be hard-deleted (#1 — that destroys another subject's
   *  memory). They are excluded from erasure; if one references a to-be-deleted row via superseded_by, the orchestrator
   *  un-supersedes it (restores it live) rather than deleting it. */
  excluded: ErasureRow[];
  /** the full closure (delete + retain + excluded), for the completeness re-read. */
  closure: ErasureRow[];
}

function isDerived(r: ErasureRow): boolean {
  return r.derived_from.length > 0;
}

/** A primary (non-derived) row that references ONLY the erased target — safe to hard-delete outright. */
export function isSingleEntityTarget(r: ErasureRow, targetEntityId: string): boolean {
  return !isDerived(r) && r.entity_ids.length === 1 && r.entity_ids[0] === targetEntityId;
}

/** Compute the transitive erasure closure + classification for a target.
 *  Closure = target's Personal rows ∪ their full superseded chains ∪ rows derived from anything in the set, to a
 *  fixpoint (a derived row can itself be a source of a further-derived row). */
export async function computeErasureWalk(store: ErasureStore, targetEntityId: string): Promise<WalkResult> {
  const closure = new Map<string, ErasureRow>();
  const add = (rows: ErasureRow[]): boolean => {
    let grew = false;
    for (const r of rows) if (!closure.has(r.id)) { closure.set(r.id, r); grew = true; }
    return grew;
  };

  // 1. the target's Personal memory rows (semantic + episodic evidence + procedural).
  add(await store.resolveTargetMemories(targetEntityId));

  // 2. iterate to a fixpoint: expand the supersede chains + the derived-from edges of everything reached so far.
  //    Bounded by the graph size — every pass either grows the closure or stops (grew === false).
  let grew = true;
  while (grew) {
    const ids = [...closure.keys()];
    const chain = await store.walkSupersededChain(ids);
    const derived = await store.findDerivedFrom(ids);
    grew = add(chain);
    grew = add(derived) || grew;
  }

  // 3. classify per-row (path-independent → testable). The closure is seeded from rows referencing the target and
  //    grown via (a) the supersede graph — BOTH directions — and (b) the derived_from edge. The BOTH-directions walk
  //    means the closure can contain ANOTHER subject's independent row: consolidation CAS-supersedes every source
  //    (S_alice AND S_bob) into a shared merge D, so the backward supersede edge from D reaches S_bob when erasing
  //    alice. S_bob is NOT alice's data (FR-2.MNT.017 remit is "the target's Personal data") and MUST NOT be deleted
  //    (#1). So the classifier re-applies the references-target gate to every non-derived row — it never assumes
  //    chain-membership implies target-ownership.
  const deleteSet: ErasureRow[] = [];
  const retainForScrub: ErasureRow[] = [];
  const excluded: ErasureRow[] = [];
  for (const r of closure.values()) {
    const referencesTarget = r.entity_ids.includes(targetEntityId);
    if (isDerived(r)) {
      deleteSet.push(r); // derived → folded target content + recomputable from surviving sources → always delete (no residue; AC-2.MNT.017.3)
    } else if (referencesTarget && r.entity_ids.length === 1) {
      deleteSet.push(r); // single-entity primary — unambiguously only the target's data
    } else if (referencesTarget) {
      retainForScrub.push(r); // multi-entity primary → hand to C10 scrubbing (AC-NFR-CMP.005.2); never delete (#1)
    } else {
      excluded.push(r); // ANOTHER subject's primary row reached via the supersede graph → never delete (#1), never scrub
    }
  }

  return { deleteSet, retainForScrub, excluded, closure: [...closure.values()] };
}
