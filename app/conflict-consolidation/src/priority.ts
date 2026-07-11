// ISSUE-028 — FR-2.MNT.008: the conflict-resolution priority rules. A PURE, deterministic resolver that produces the
// *suggested* resolution shown on the Conflicts queue and consumed by the write-time hard-conflict branch (ISSUE-024)
// and the daily supersede safety-net (ISSUE-027). It NEVER auto-applies — it only suggests; a human decides (#1).
//
// The five rules (FR-2.MNT.008, component-02-memory.md L997), applied in order:
//   1. human_verified always wins.
//   2. system_of_record beats ai_inferred.
//   3. more recent beats older (SAME source type).
//   4. higher confidence beats lower (SAME age).
//   5. genuinely ambiguous → flag for human and inject both with a note (OD-032).
//
// Note on the source vocabulary: the live `memory_source` enum is ('ai_inferred','human_verified','system_pointer').
// We map the rule's "system_of_record" to source='system_pointer' (the golden-rule pointer to a system of record,
// schema §3). Every CROSS-source pair is decided by rule 1 or 2 (human_verified vs anything → rule 1; system_pointer
// vs ai_inferred → rule 2), so rules 3/4 only ever compare SAME-source memories — exactly their stated qualifier.

/** The facts the resolver needs about one memory — a subset of the live `memories` row. Existing rows read from the
 *  DB carry the coarse `memories.source` (ai_inferred / human_verified / system_pointer); the held NEW candidate can
 *  additionally carry `system_of_record` (its finer write-time provenance is still intact pre-write — this is where
 *  rule 2 can genuinely fire, since a system_of_record row collapses to `ai_inferred` once WRITTEN, schema §3). */
export interface MemoryFacts {
  id: string;
  source: 'ai_inferred' | 'human_verified' | 'system_pointer' | 'system_of_record';
  /** ISO timestamp — `memories.created_at`. */
  createdAt: string;
  /** `memories.confidence` (0–1); null only for a system_pointer. */
  confidence: number | null;
}

export type ResolutionKind = 'keep_new' | 'keep_existing' | 'keep_both_with_note';

/** The suggested resolution attached to a quarantined conflict (`memory_conflicts.suggested_resolution`, jsonb). */
export interface SuggestedResolution {
  kind: ResolutionKind;
  /** the winning memory id when kind is keep_new / keep_existing; null for keep_both_with_note. */
  winnerId: string | null;
  /** true when the outcome is genuine ambiguity (rule 5) — a human must be flagged; both stay live + injected. */
  humanFlagged: boolean;
  /** which of the five rules decided it (1–5); 5 = genuine ambiguity. */
  ruleApplied: 1 | 2 | 3 | 4 | 5;
  /** a short human-readable reason for the surface / audit trail. */
  note: string;
}

/** Compare two memories by the priority cascade. Returns 1 if `a` wins, -1 if `b` wins, 0 if genuinely ambiguous.
 *  Also reports WHICH rule decided it (for provenance). Symmetric: compare(a,b) === -compare(b,a). */
export function compareAuthority(a: MemoryFacts, b: MemoryFacts): { winner: 1 | -1 | 0; rule: 1 | 2 | 3 | 4 | 5 } {
  // Rule 1 — human_verified always wins (only decisive when exactly ONE side is human_verified).
  const aHV = a.source === 'human_verified';
  const bHV = b.source === 'human_verified';
  if (aHV !== bHV) return { winner: aHV ? 1 : -1, rule: 1 };

  // Rule 2 — a system-of-record row (the golden-rule system_pointer, or a held candidate still tagged
  // system_of_record) beats a purely ai_inferred one.
  const aSOR = a.source === 'system_pointer' || a.source === 'system_of_record';
  const bSOR = b.source === 'system_pointer' || b.source === 'system_of_record';
  const aAI = a.source === 'ai_inferred';
  const bAI = b.source === 'ai_inferred';
  if (aSOR && bAI) return { winner: 1, rule: 2 };
  if (bSOR && aAI) return { winner: -1, rule: 2 };

  // Rules 3–4 carry an explicit qualifier: recency compares memories of the SAME source type, confidence at the
  // SAME age. If, after rules 1–2, the two are STILL different source classes (e.g. system_of_record vs
  // system_pointer), they are not ranked by recency/confidence — that is genuine ambiguity (rule 5). #1: never
  // auto-pick across authority classes we cannot rank.
  if (a.source !== b.source) return { winner: 0, rule: 5 };

  // Rule 3 — more recent beats older (same source type).
  const at = Date.parse(a.createdAt);
  const bt = Date.parse(b.createdAt);
  if (at !== bt) return { winner: at > bt ? 1 : -1, rule: 3 };

  // Rule 4 — higher confidence beats lower (same age). null (system_pointer) is treated as equal/uncomparable.
  const ac = a.confidence;
  const bc = b.confidence;
  if (ac != null && bc != null && ac !== bc) return { winner: ac > bc ? 1 : -1, rule: 4 };

  // Rule 5 — genuinely ambiguous.
  return { winner: 0, rule: 5 };
}

/** Produce the suggested resolution for a held NEW memory conflicting with one or more EXISTING live memories.
 *
 *  Safety posture (#1 — never auto-drop knowledge on a guess): we only suggest keep_new when the new memory
 *  strictly beats EVERY conflicting existing memory; we suggest keep_existing only when some existing memory
 *  strictly beats the new one AND the new one beats none; anything else (a tie anywhere, or a mixed win/tie) is
 *  genuine ambiguity → keep_both_with_note + a human flag. The human always makes the final call. */
export function suggestResolution(newMem: MemoryFacts, existing: MemoryFacts[]): SuggestedResolution {
  if (existing.length === 0) {
    // No live conflicting memory remains (e.g. all already superseded) — nothing to contradict; keep the new one.
    return { kind: 'keep_new', winnerId: newMem.id, humanFlagged: false, ruleApplied: 1, note: 'no live conflicting memory remains' };
  }

  const cmps = existing.map((e) => compareAuthority(newMem, e));
  const newBeatsAll = cmps.every((c) => c.winner === 1);
  const anExistingBeatsNew = cmps.some((c) => c.winner === -1);
  const newBeatsNone = cmps.every((c) => c.winner !== 1);

  if (newBeatsAll) {
    // The strongest deciding rule across the set (lowest rule number = most authoritative reason).
    const rule = cmps.reduce<1 | 2 | 3 | 4 | 5>((min, c) => (c.rule < min ? c.rule : min), 5);
    return { kind: 'keep_new', winnerId: newMem.id, humanFlagged: false, ruleApplied: rule, note: `new memory wins by rule ${rule}` };
  }

  if (anExistingBeatsNew && newBeatsNone) {
    // Pick the strongest existing winner as the suggested survivor.
    let winnerId = existing[0]!.id;
    let rule: 1 | 2 | 3 | 4 | 5 = 5;
    for (let i = 0; i < existing.length; i++) {
      const c = cmps[i]!;
      if (c.winner === -1 && c.rule < rule) {
        rule = c.rule;
        winnerId = existing[i]!.id;
      }
    }
    return { kind: 'keep_existing', winnerId, humanFlagged: false, ruleApplied: rule, note: `existing memory wins by rule ${rule}` };
  }

  // Rule 5 — genuine ambiguity (a tie somewhere, or new wins some but not all with no clear loser). Both stay live
  // and are injected with a note; a human is flagged. Never auto-pick when truly ambiguous (#1).
  return { kind: 'keep_both_with_note', winnerId: null, humanFlagged: true, ruleApplied: 5, note: 'genuinely ambiguous — both retained + injected with a note, human flagged' };
}
