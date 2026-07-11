// ISSUE-082 §8 step 4 — Step 1: identify all affected records (FR-10.DEL.002 / AC-10.DEL.002.*).
//
// Two classes, the #1↔#2 balance:
//   • (a) DETERMINISTIC — the target's entity record + every memory whose entity_ids[] contains the target entity_id.
//     Certain → auto-actioned by the C2 walk (FR-10.DEL.003). No fuzzy judgement.
//   • (b) PROBABILISTIC — memories that name the target only in the CONTENT field (no entity_id), found via a
//     recall-oriented keyword sweep over name variants + known identifiers. NEVER auto-actioned — surfaced for human
//     confirmation before any redaction (AC-10.DEL.002.2). A false negative here leaves PII un-erased (#2) → the
//     sweep is recall-oriented + reviewed; a false positive would over-delete (#1) → class (b) is never auto-actioned.
//
// ⚠️ FEASIBILITY: AF-134 — the recall of name/identifier matching. Keyword matching over content is the offline,
// deterministic floor; the SEMANTIC arm (embedding search for paraphrased mentions) is the C2/embeddings seam and is
// the load-bearing recall question the AF-134 EVAL measures. This module makes the un-found risk explicit (it returns
// the candidate set for review + records per-class counts), it never claims completeness on the probabilistic arm.

import type { DeletionWorkflowStore, WorkflowMemoryRow } from './store.ts';

/** What the workflow knows about the subject for the recall-oriented content sweep (FR-10.DEL.002 class b). */
export interface ErasureSubject {
  /** the subject's name as recorded (e.g. "John Smith"). */
  name?: string;
  /** known identifiers — email, phone, external handles. Included in the sweep (AC-10.DEL.002.3). */
  identifiers?: string[];
}

export interface IdentificationResult {
  /** class (a) — memory ids whose entity_ids[] contains the target (auto-actioned by C2). */
  deterministicMemoryIds: string[];
  /** whether the target entity record exists (to be hard-deleted in Step 3). */
  entityExists: boolean;
  /** class (b) — content-only matches, SURFACED FOR HUMAN CONFIRMATION, never auto-actioned (AC-10.DEL.002.2). */
  probabilisticCandidates: WorkflowMemoryRow[];
  /** the search terms the probabilistic sweep ran (recall-oriented; recorded for the AF-134 EVAL + audit). */
  searchTerms: string[];
  /** per-class counts recorded against the request (observability, FR-10.DEL.002). */
  counts: { deterministic: number; probabilistic: number };
}

/** Expand a subject into a recall-oriented set of search terms (AC-10.DEL.002.3 — "known identifiers + plausible name
 *  variants"). Recall-biased on purpose: extra terms cost a human a review, a missing term costs un-erased PII (#2).
 *   - the full name
 *   - each name part (given / family)
 *   - "initial + family" (J Smith / JSmith)
 *   - "given + family-initial" (John S)
 *   - every provided identifier verbatim (email / phone / handle)
 *  Deduped; empty/1-char tokens dropped (they'd match everything → #1 over-surfacing, and are not a meaningful
 *  identifier). Matching is case-insensitive downstream (ILIKE / the `gi` regex), so terms are kept in their original
 *  case. This broad set is for FINDING (surfacing candidates for human review) ONLY — never for the actual redaction
 *  (see redactionTerms, which is deliberately narrow to avoid nuking an unrelated "John" in a confirmed row). */
export function expandSearchTerms(subject: ErasureSubject): string[] {
  const terms = new Set<string>();
  const add = (t: string | undefined): void => {
    const v = (t ?? '').trim();
    if (v.length >= 2) terms.add(v);
  };

  const name = (subject.name ?? '').trim();
  if (name) {
    add(name);
    const parts = name.split(/\s+/).filter((p) => p.length >= 2);
    for (const p of parts) add(p);
    if (parts.length >= 2) {
      const given = parts[0]!;
      const family = parts[parts.length - 1]!;
      add(`${given[0]}${family}`); // JSmith
      add(`${given[0]} ${family}`); // J Smith
      add(`${given} ${family[0]}`); // John S
    }
  }
  for (const id of subject.identifiers ?? []) add(id);

  return [...terms];
}

/** The NARROW term set used for the actual `[REDACTED]` scrub (FR-10.DEL.004) — deliberately precise, NOT the
 *  recall-biased expansion. The finding sweep is recall-biased (bare given/family names, initials) because a false
 *  negative there just costs a human a review; but REDACTING against those broad terms would whole-word-replace an
 *  unrelated "John" or "Smith" belonging to a THIRD party in a retained business record — destroying other people's
 *  data + legitimate context (#1, the verify M1 finding). So redaction targets only unambiguous forms: the full name
 *  (as a unit) + every provided identifier (email / phone / handle). Span-level precision is the Phase-3 surface's
 *  refinement; this is the #1-safe package default. */
export function redactionTerms(subject: ErasureSubject): string[] {
  const terms = new Set<string>();
  const name = (subject.name ?? '').trim();
  if (name.length >= 2) terms.add(name); // the full name as one unit (longest-first redaction keeps it intact)
  for (const id of subject.identifiers ?? []) {
    const v = (id ?? '').trim();
    if (v.length >= 2) terms.add(v);
  }
  return [...terms];
}

/** Run Step-1 identification. Deterministic set is enumerated exactly; the probabilistic set is enumerated and
 *  returned FOR CONFIRMATION (this function does not action it). */
export async function identifyAffectedRecords(store: DeletionWorkflowStore, targetEntityId: string, subject: ErasureSubject): Promise<IdentificationResult> {
  const deterministicMemoryIds = await store.deterministicMemoryIds(targetEntityId);
  const entityExists = await store.entityExists(targetEntityId);
  const searchTerms = expandSearchTerms(subject);
  // the probabilistic sweep EXCLUDES rows already deterministically matched (they are handled by the C2 walk; class b
  // is only the content-only mentions). If there are no search terms, there is nothing to sweep (the subject gave no
  // name/identifier) — we return an empty candidate set rather than matching everything.
  const probabilisticCandidates = searchTerms.length === 0 ? [] : await store.probabilisticContentMatches(searchTerms, deterministicMemoryIds);

  return {
    deterministicMemoryIds,
    entityExists,
    probabilisticCandidates,
    searchTerms,
    counts: { deterministic: deterministicMemoryIds.length, probabilistic: probabilisticCandidates.length },
  };
}
