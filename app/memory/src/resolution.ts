// ISSUE-022 — deterministic entity resolution (FR-2.ENT.005 / AC-2.ENT.005.* / OD-033). THE #1-critical piece:
// resolve a mention to the correct EXISTING entity, or create a new one — and NEVER silently mis-link, because a
// wrong link fragments the brain (every retrieval about that entity silently sees half its knowledge — #1) and a
// false-merge collapses two clients into cross-contamination (#2). Pure functions over an entity snapshot; the
// store performs the actual create (resolveOrCreate below).
//
// Precedence (OD-033 option (a), delegated-resolved 2026-06-25):
//   1. external_refs match (a system id is authoritative) → link. Conflicting refs (the mention's ids point at
//      TWO existing entities) → ambiguous (those two are likely duplicates; flag, never pick one).
//   2. deterministic name+type match above a confidence threshold → link if exactly one; ambiguous if several.
//   3. no confident match → create new.
// Risk posture (deliberate, per NFR-PERF.004): the name match is CONSERVATIVE — a near-but-not-identical name is
// a NON-match (→ create a duplicate), because a false-split is recoverable (the FR-2.MNT.010 duplicate-cluster
// erosion scan + the merge queue catch it later) whereas a false-merge is an irreversible #2 leak. When in doubt,
// split and flag; never merge on a guess. Accuracy at scale is gated by AF-082 (EVAL) before auto-resolution is
// trusted.

import type { EntityRow, ExternalRefs, MemoryStore, EntityInput } from './store.ts';

/** Sourced from config `entity_match_confidence_threshold` (CFG-config.memory). A name is a match iff its
 *  normalised similarity to a same-type candidate is >= this. High by design (conservative — favour false-split
 *  over false-merge, #2). */
export const DEFAULT_NAME_MATCH_THRESHOLD = 0.9;

export interface Mention {
  name: string;
  type: string;
  external_refs?: ExternalRefs;
}

export interface Candidate {
  entityId: string;
  score: number; // 1.0 for an external_ref hit; the name similarity for a name/type hit
  via: 'external_ref' | 'name_type';
}

/** The resolution outcome. `ambiguous` is the never-silently-guess path (AC-2.ENT.005.2): the caller creates a
 *  new entity AND flags it for merge (create-and-flag) or holds it for human confirm — it must not pick a
 *  candidate itself. */
export type Resolution =
  | { kind: 'linked'; entityId: string; via: 'external_ref' | 'name_type'; score: number }
  | { kind: 'create'; reason: 'no_match' }
  | { kind: 'ambiguous'; candidates: Candidate[]; recommended: 'flag_for_merge' };

/** Normalise a name for deterministic comparison: lowercase, strip punctuation, collapse whitespace, trim. NOT
 *  suffix-stripping (removing Inc/LLC/Corp would risk merging distinct entities — a #2 hazard). */
export function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // punctuation → space
    .replace(/\s+/g, ' ')
    .trim();
}

/** Deterministic name similarity in [0,1]: 1.0 for an identical normalised name, else a Levenshtein ratio. */
export function nameSimilarity(a: string, b: string): number {
  const x = normaliseName(a);
  const y = normaliseName(b);
  if (x === y) return 1;
  if (x.length === 0 || y.length === 0) return 0;
  const dist = levenshtein(x, y);
  return 1 - dist / Math.max(x.length, y.length);
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let curr = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n]!;
}

/** The distinct existing entities that share ANY (system, id) pair with the mention's external_refs. */
function externalRefMatches(mention: Mention, entities: EntityRow[]): string[] {
  const refs = mention.external_refs ?? {};
  const hits = new Set<string>();
  for (const [system, id] of Object.entries(refs)) {
    if (id === undefined || id === null || id === '') continue;
    for (const e of entities) {
      if (e.external_refs[system] === id) hits.add(e.id);
    }
  }
  return [...hits];
}

/**
 * Resolve a mention against a snapshot of existing entities. Pure + deterministic (no I/O, no randomness).
 */
export function resolveEntity(mention: Mention, entities: EntityRow[], threshold: number = DEFAULT_NAME_MATCH_THRESHOLD): Resolution {
  // 1. external_refs — authoritative.
  const refHits = externalRefMatches(mention, entities);
  if (refHits.length === 1) {
    return { kind: 'linked', entityId: refHits[0]!, via: 'external_ref', score: 1 };
  }
  if (refHits.length > 1) {
    // The mention's ids point at two+ existing entities — likely duplicates. Flag; never silently pick one (#1).
    return { kind: 'ambiguous', candidates: refHits.map((entityId) => ({ entityId, score: 1, via: 'external_ref' as const })), recommended: 'flag_for_merge' };
  }

  // 2. deterministic name + type match (same type only).
  const nameHits: Candidate[] = [];
  for (const e of entities) {
    if (e.type !== mention.type) continue;
    const score = nameSimilarity(mention.name, e.name);
    if (score >= threshold) nameHits.push({ entityId: e.id, score, via: 'name_type' });
  }
  if (nameHits.length === 1) {
    return { kind: 'linked', entityId: nameHits[0]!.entityId, via: 'name_type', score: nameHits[0]!.score };
  }
  if (nameHits.length > 1) {
    // Several equally-plausible same-type names — ambiguous. Flag for merge, never guess (AC-2.ENT.005.2).
    nameHits.sort((a, b) => b.score - a.score || a.entityId.localeCompare(b.entityId)); // deterministic order
    return { kind: 'ambiguous', candidates: nameHits, recommended: 'flag_for_merge' };
  }

  // 3. no confident match → create new.
  return { kind: 'create', reason: 'no_match' };
}

/** The result of resolving-and-creating against the live store. `flaggedForMerge` marks the create-and-flag path
 *  the ambiguity case takes (never a silent link) — a downstream merge queue (FR-2.MNT.010, ISSUE-028) consumes
 *  it. `ambiguousWith` records the candidates the create was flagged against (for the human/merge review). */
export interface ResolveOutcome {
  entityId: string;
  created: boolean;
  flaggedForMerge: boolean;
  via: 'external_ref' | 'name_type' | 'created';
  ambiguousWith?: Candidate[];
}

/**
 * Resolve a mention against the store; on an ambiguous match, CREATE-AND-FLAG-FOR-MERGE (never silently link to
 * one candidate) — the safe realisation of OD-033's "never silently guess". On no match, create. On a confident
 * match, link. The new entity's type must be in the configured list (insertEntity enforces it).
 */
export async function resolveOrCreate(store: MemoryStore, mention: Mention, threshold: number = DEFAULT_NAME_MATCH_THRESHOLD): Promise<ResolveOutcome> {
  const entities = await store.listEntities();
  const res = resolveEntity(mention, entities, threshold);
  if (res.kind === 'linked') {
    return { entityId: res.entityId, created: false, flaggedForMerge: false, via: res.via };
  }
  // create (no_match) OR ambiguous (create-and-flag). Both create a new entity; ambiguous additionally flags it.
  const input: EntityInput = { type: mention.type, name: mention.name, external_refs: mention.external_refs };
  const created = await store.insertEntity(input);
  if (res.kind === 'ambiguous') {
    return { entityId: created.id, created: true, flaggedForMerge: true, via: 'created', ambiguousWith: res.candidates };
  }
  return { entityId: created.id, created: true, flaggedForMerge: false, via: 'created' };
}
