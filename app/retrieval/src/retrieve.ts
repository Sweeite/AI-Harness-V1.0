// ISSUE-025 (C2 RET) — the retrieval orchestrator: the C2 read path, composed in the ONE order the #2 invariant
// demands. Given a task it runs, IN SEQUENCE:
//   1. extract entities (FR-2.RET.001)         — resolve mentions read-only against the entity snapshot.
//   2. dual search (FR-2.RET.002)              — keyword arm (entity-scoped) ∪ vector arm (top-~20 cosine); attach a
//                                                 vector-similarity to every union candidate.
//   3. candidate filters (FR-2.RET.003)        — confidence floor / not-expired / not-superseded, UNIFORM to both arms.
//   4. CLEARANCE BEFORE RANKING (FR-2.RET.004) — drop every candidate the requester may not see (the #2 gate) + apply
//                                                 the OD-081 agent-scope narrowing; AUDIT sensitive (personal/restricted)
//                                                 visible candidates; SPLIT restricted out of the auto-injectable set.
//   5. rank + trim (FR-2.RET.005)              — score the cleared, non-restricted candidates; top CFG-memories_injected.
//   6. inject (FR-2.RET.006)                   — type-tagged Business Context; Restricted-never-auto-injected (2nd guard).
//   7. sufficiency signals (FR-2.RET.007)      — emit provenance (Cited) + the Sufficiency verdict / [Building] flag.
//   8. observability                            — memory_read sample (counts + verdict); access_audit for each sensitive
//                                                 visible candidate.
// The ordering is load-bearing: clearance runs on the FILTERED union BEFORE ranking, so no out-of-clearance memory is
// ever ranked, scored, ordered, or surfaced — a memory the requester cannot see leaves NO trace in the output (#2).

import type { EntityRow, MemoryRow } from '../../memory/src/store.ts';
import type { MaturityConfig } from '../../maturity/src/store.ts';
import { DEFAULT_COLD_START_BASIC, DEFAULT_COLD_START_FULL } from '../../maturity/src/store.ts';
import { computeSufficiency, type RetrievalSignal, type SufficiencyResult } from '../../maturity/src/sufficiency.ts';
import { extractEntities, type TaskMention } from './extract.ts';
import { applyCandidateFilters, type CandidateFilterCtx } from './candidate-filters.ts';
import { clearanceVerdict, type Requester, type EntityTypeLookup } from './clearance.ts';
import { rankAndTrim, type RankedMemory } from './rank.ts';
import { injectBusinessContext, type BusinessContext } from './inject.ts';
import { DEFAULT_RETRIEVAL_CONFIG, type RetrievalConfig } from './config.ts';
import type { RetrievalCandidate, RetrievalStore } from './store.ts';

/** The retrieval request: the task's entity mentions + the query embedding (probe) + the requester's live clearance +
 *  optional knobs. `nowIso` is injected (deterministic expiry/recency). `actorIdentity`/`originatingUserId` attribute
 *  the observability + audit rows. `touchedSlotsFilled` (optional) is the FR-2.RET.007 slot arm — omit to fall back to
 *  pure retrieval-quality sufficiency. `pathContext` labels the audit rows. */
export interface RetrievalRequest {
  mentions: readonly TaskMention[];
  queryEmbedding: readonly number[];
  requester: Requester;
  nowIso: string;
  actorIdentity: string;
  originatingUserId: string;
  vectorTopK?: number; // default 20 (FR-2.RET.002 "top-~20")
  touchedSlotsFilled?: boolean;
  pathContext?: string | null;
  config?: RetrievalConfig; // default DEFAULT_RETRIEVAL_CONFIG (loadConfig overrides at the live adapter)
}

export interface RetrievalResult {
  /** the resolved entity ids that seeded the keyword arm. */
  entityIds: string[];
  /** the primary entity (drives the [Building] Maturity read), or null. */
  primaryEntityId: string | null;
  /** the assembled, type-tagged Business Context (FR-2.RET.006). */
  context: BusinessContext;
  /** the ranked, injected set (top-N, non-restricted, cleared) with sub-signals — the provenance for the Cited pill. */
  ranked: RankedMemory[];
  /** the Sufficiency verdict / [Building] flag (FR-2.RET.007). C8 renders the pill. */
  sufficiency: SufficiencyResult;
  /** candidate-count telemetry (also emitted to memory_read). */
  counts: {
    keyword: number;
    vector: number;
    unionFiltered: number; // after candidate filters, before clearance
    cleared: number; // visible to the requester (incl. restricted, which are audited then excluded from injection)
    injectable: number; // cleared AND non-restricted (the ranking input)
    injected: number; // after top-N trim
    droppedByClearance: number; // filtered union that FAILED clearance (the #2 gate's work)
    sensitiveAudited: number;
  };
}

const VECTOR_TOP_K_DEFAULT = 20;

/** A union candidate under assembly (before it becomes a RetrievalCandidate with a known similarity). */
interface UnionEntry {
  memory: MemoryRow;
  via: 'keyword' | 'vector' | 'both';
  similarity?: number;
}

/** Build the dual-search union: keyword ∪ vector, deduped by id, via-merged; a keyword-only row's similarity is filled
 *  by a targeted similarityOf call so EVERY union candidate carries a vector-similarity signal for ranking. */
async function dualSearchUnion(store: RetrievalStore, req: RetrievalRequest, entityIds: string[]): Promise<{ candidates: RetrievalCandidate[]; keyword: number; vector: number }> {
  const q = {
    entityIds,
    queryEmbedding: req.queryEmbedding,
    vectorTopK: req.vectorTopK ?? VECTOR_TOP_K_DEFAULT,
    efSearch: (req.config ?? DEFAULT_RETRIEVAL_CONFIG).efSearch,
  };
  const [vec, kw] = await Promise.all([store.vectorArm(q), store.keywordArm(q)]);

  const byId = new Map<string, UnionEntry>();
  for (const { memory, similarity } of vec) byId.set(memory.id, { memory, via: 'vector', similarity });
  for (const memory of kw) {
    const ex = byId.get(memory.id);
    if (ex) ex.via = 'both';
    else byId.set(memory.id, { memory, via: 'keyword' });
  }

  const missing = [...byId.values()].filter((e) => e.similarity === undefined).map((e) => e.memory.id);
  if (missing.length > 0) {
    const sims = await store.similarityOf(missing, req.queryEmbedding);
    for (const e of byId.values()) if (e.similarity === undefined) e.similarity = sims.get(e.memory.id) ?? 0;
  }

  const candidates: RetrievalCandidate[] = [...byId.values()].map((e) => ({ memory: e.memory, via: e.via, similarity: e.similarity ?? 0 }));
  return { candidates, keyword: kw.length, vector: vec.length };
}

/** Build the EntityTypeLookup the clearance + entity-match steps need, from the candidates' entities. */
async function entityTypeLookup(store: RetrievalStore, candidates: readonly RetrievalCandidate[]): Promise<EntityTypeLookup> {
  const ids = new Set<string>();
  for (const c of candidates) for (const id of c.memory.entity_ids) ids.add(id);
  const map = await store.entityTypes([...ids]);
  return (id: string) => map.get(id);
}

/**
 * Run the full retrieval path. Deterministic given the store's data + the request. The clearance gate is
 * unconditional and runs before ranking — the safety property the whole slice exists to guarantee (FR-2.RET.004, #2).
 */
export async function retrieve(store: RetrievalStore, req: RetrievalRequest): Promise<RetrievalResult> {
  const config = req.config ?? DEFAULT_RETRIEVAL_CONFIG;

  // 1. entity extraction (read-only resolution).
  const snapshot: EntityRow[] = await store.resolutionSnapshot();
  const { entityIds, primaryEntityId, hadAmbiguous } = extractEntities(req.mentions, snapshot);

  // 2. dual search → union with per-candidate similarity.
  const { candidates, keyword, vector } = await dualSearchUnion(store, req, entityIds);

  // 3. candidate filters — uniform to both arms (OD-035).
  const filterCtx: CandidateFilterCtx = { confidenceFloor: config.retrievalConfidenceThreshold, nowIso: req.nowIso };
  const filtered = candidates.filter((c) => applyCandidateFilters([c.memory], filterCtx).length === 1);

  // 4. CLEARANCE BEFORE RANKING (the #2 gate) + sensitive-access audit + restricted split.
  const typeOf = await entityTypeLookup(store, filtered);
  const cleared: RetrievalCandidate[] = [];
  const injectable: RetrievalCandidate[] = [];
  const sensitiveToAudit: RetrievalCandidate[] = [];
  let droppedByClearance = 0;
  for (const c of filtered) {
    const v = clearanceVerdict(c.memory, typeOf, req.requester);
    if (!v.visible) {
      droppedByClearance++;
      continue; // out of clearance / out of agent scope → never ranked, never surfaced (#2)
    }
    cleared.push(c);
    if (v.sensitiveTouch) sensitiveToAudit.push(c); // personal/restricted VISIBLE candidate → audited (FR-1.AUD.001)
    if (!v.restricted) injectable.push(c); // restricted is cleared-to-view but NEVER auto-injectable (FR-2.RET.006)
  }

  // 5. rank + trim the injectable (cleared, non-restricted) set.
  const taskEntityIds = new Set(entityIds);
  const ranked = rankAndTrim(injectable, { taskEntityIds, nowIso: req.nowIso, config });

  // 6. inject as type-tagged Business Context (2nd Restricted guard inside).
  const context = injectBusinessContext(ranked);

  // 7. sufficiency signals (FR-2.RET.007). relevance = normalised vector-similarity; confidence = the memory's
  //    confidence (a system_pointer's is authoritative → 1.0). Surfaced = the injected set.
  const surfaced: RetrievalSignal[] = ranked.map((r) => ({
    relevance: r.vectorSimilarity,
    confidence: r.candidate.memory.confidence ?? 1,
  }));
  const primaryMaturity = primaryEntityId === null ? null : await store.entityMaturity(primaryEntityId);
  const sufficiencyCfg: MaturityConfig = {
    expectedSlots: {},
    coldStartBasicThreshold: DEFAULT_COLD_START_BASIC,
    coldStartProactiveThreshold: config.coldStartProactiveThreshold,
    coldStartFullThreshold: DEFAULT_COLD_START_FULL,
    retrievalSufficiencyThreshold: config.retrievalSufficiencyThreshold,
  };
  const sufficiency = computeSufficiency(
    { surfaced, touchedSlotsFilled: req.touchedSlotsFilled, primaryEntityMaturity: primaryMaturity },
    sufficiencyCfg,
  );

  const counts = {
    keyword,
    vector,
    unionFiltered: filtered.length,
    cleared: cleared.length,
    injectable: injectable.length,
    injected: context.memories.length,
    droppedByClearance,
    sensitiveAudited: sensitiveToAudit.length,
  };

  // 8. observability — one memory_read sample (counts + verdict); one access_audit per sensitive visible candidate.
  await store.appendReadEvent({
    entityIds,
    summary: `retrieval verdict=${sufficiency.verdict} injected=${counts.injected} cleared=${counts.cleared} dropped=${counts.droppedByClearance}`,
    payload: {
      counts,
      verdict: sufficiency.verdict,
      building: sufficiency.building,
      hadAmbiguous,
      provenanceIds: context.provenanceIds,
      droppedRestrictedAtInject: context.droppedRestricted,
    },
  });
  for (const c of sensitiveToAudit) {
    await store.appendSensitiveAudit({
      actorIdentity: req.actorIdentity,
      originatingUserId: req.originatingUserId,
      memoryId: c.memory.id,
      entityIds: [...c.memory.entity_ids],
      sensitivity: c.memory.sensitivity,
      pathContext: req.pathContext ?? null,
    });
  }

  return { entityIds, primaryEntityId, context, ranked, sufficiency, counts };
}
