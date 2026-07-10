// ISSUE-025 (C2 RET) — the RetrievalStore PORT + in-memory reference fake (house port+fake pattern, cf. app/memory,
// app/embeddings, app/maturity). Every live read/side-effect of the retrieval path goes through this port so the whole
// pipeline is unit-testable with NO live DB, and the in-memory fake is BOTH the test double AND the reference model the
// live pg adapter (supabase-store.ts) must match 1:1 (proven by the R10 smoke).
//
// The port is deliberately THIN — it returns RAW candidates (both arms) + the entity-type lookup + the observability
// sinks. It does NOT apply clearance: the clearance-before-ranking filter (clearance.ts) runs IN-PROCESS over the port's
// output, because the agent service_role path bypasses RLS and retrieval must be the authoritative filter (FR-2.RET.004).
// The two arms return everything the SQL predicates (entity membership / vector top-k / candidate filters) admit; the
// #2 clearance gate is the pipeline's job, never the store's.

import type { MemoryRow, EntityRow } from '../../memory/src/store.ts';

/** A candidate memory as the store returns it: the row + which arm(s) found it + its cosine similarity to the query
 *  probe (already computed by the store over the union, in [-1,1]; rank.ts maps it to [0,1] via (cos+1)/2). A candidate
 *  found by BOTH arms carries via:'both'. */
export interface RetrievalCandidate {
  memory: MemoryRow;
  via: 'keyword' | 'vector' | 'both';
  /** cosine similarity to the query embedding, in [-1,1]. Present for every union candidate (the store computes it for
   *  the whole union against the probe — the vector arm returns it natively, the keyword-only rows are scored by id). */
  similarity: number;
}

/** What the two search arms need: the resolved entity ids (keyword scope) + the task's query embedding (vector probe). */
export interface DualSearchQuery {
  /** Resolved entity ids that scope the keyword arm (FR-2.RET.001 output). Empty = no keyword arm (vector only). */
  entityIds: readonly string[];
  /** The task text's embedding (produced by @harness/embeddings for the query) — the vector-arm probe. */
  queryEmbedding: readonly number[];
  /** vector-arm top-k (~20) + the ef_search dial (CFG-ef_search) the retrieval-session contract sets. */
  vectorTopK: number;
  efSearch: number;
}

/** One event_log observability sample (event_type 'memory_read' — the established retrieval read signal that
 *  agent-health reads). Retrieval candidate counts + the answer-mode verdict are sampled here (FR-2.RET §8). */
export interface RetrievalEventSample {
  entityIds: string[];
  summary: string;
  payload: Record<string, unknown>;
}

/** One access_audit row for a Personal/Restricted candidate the requester was cleared to see (FR-1.AUD.001 sink,
 *  ISSUE-021 owns the table). audit_type = 'sensitive_view'. */
export interface SensitiveAccessAudit {
  actorIdentity: string;
  originatingUserId: string;
  memoryId: string;
  entityIds: string[];
  sensitivity: string;
  pathContext: string | null;
}

export interface RetrievalStore {
  /** The entity snapshot the FR-2.RET.001 extraction resolves task mentions against (READ-ONLY — retrieval never
   *  creates an entity). The live adapter reads the entities table; the fake returns its seed. */
  resolutionSnapshot(): Promise<EntityRow[]>;
  /** The KEYWORD arm: memories whose entity_ids intersect the query's entityIds, with the FR-2.RET.003 candidate
   *  predicates PUSHED DOWN to SQL where cheap (the pipeline re-applies them uniformly regardless — defence in depth).
   *  Returns raw rows (NO clearance filter — the pipeline owns #2). Empty entityIds → empty result. */
  keywordArm(q: DualSearchQuery): Promise<MemoryRow[]>;
  /** The VECTOR arm: the top-k memories by cosine over the ISSUE-023 HNSW index at ef_search, under the retrieval-
   *  session index-usage contract (supabase-store applies retrievalSessionSql before the `order by embedding <=> $probe`
   *  query). Returns rows + their cosine similarity. NO clearance filter (pipeline owns #2). */
  vectorArm(q: DualSearchQuery): Promise<Array<{ memory: MemoryRow; similarity: number }>>;
  /** cosine similarity (in [-1,1]) of each named memory to the query probe — used to score keyword-only candidates the
   *  vector arm did not return (so every union candidate has a vector-similarity signal for ranking). */
  similarityOf(memoryIds: readonly string[], queryEmbedding: readonly number[]): Promise<Map<string, number>>;
  /** entity id → entity type, for the candidates' entities (the clearance sensitivity/restricted clauses + the
   *  entity-match rank signal need it). */
  entityTypes(entityIds: readonly string[]): Promise<Map<string, string>>;
  /** The primary entity's stored Maturity (entities.maturity, 0–1 or null) — FR-2.RET.007 [Building] input. */
  entityMaturity(entityId: string): Promise<number | null>;
  /** event_log 'memory_read' observability sink (FR-2.RET §8). */
  appendReadEvent(e: RetrievalEventSample): Promise<void>;
  /** access_audit sink for sensitive (Personal/Restricted) candidate access (FR-1.AUD.001). */
  appendSensitiveAudit(a: SensitiveAccessAudit): Promise<void>;
}

// ── cosine similarity (shared by the fake + any in-code scoring) ──────────────────────────────────────────
/** cosine similarity in [-1,1]; 0 for a zero-magnitude vector (degenerate — never NaN, #3). */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ── In-memory reference fake ──────────────────────────────────────────────────────────────────────────────
/** The fake holds a memory + entity snapshot and computes the two arms in-process, EXACTLY as the SQL does:
 *   • keyword arm = rows sharing >=1 entity id with the query, candidate-filtered.
 *   • vector arm  = top-k by cosine over ALL rows (the HNSW analogue), candidate-filtered.
 *  It applies the candidate filters (FR-2.RET.003) so it mirrors the pushed-down SQL, but NEVER clearance (the
 *  pipeline owns that). This makes a green offline suite predict live behaviour (R10). */
export class InMemoryRetrievalStore implements RetrievalStore {
  readonly readEvents: RetrievalEventSample[] = [];
  readonly sensitiveAudits: SensitiveAccessAudit[] = [];

  constructor(
    private memories: MemoryRow[] = [],
    private entities: EntityRow[] = [],
  ) {}

  seedMemories(rows: MemoryRow[]): void {
    this.memories = rows.map((m) => ({ ...m, entity_ids: [...m.entity_ids], embedding: [...m.embedding] }));
  }
  seedEntities(rows: EntityRow[]): void {
    this.entities = rows.map((e) => ({ ...e, external_refs: { ...e.external_refs } }));
  }

  private clone(m: MemoryRow): MemoryRow {
    return { ...m, entity_ids: [...m.entity_ids], embedding: [...m.embedding] };
  }

  async resolutionSnapshot(): Promise<EntityRow[]> {
    return this.entities.map((e) => ({ ...e, external_refs: { ...e.external_refs } }));
  }

  async keywordArm(q: DualSearchQuery): Promise<MemoryRow[]> {
    if (q.entityIds.length === 0) return [];
    const scope = new Set(q.entityIds);
    return this.memories.filter((m) => m.entity_ids.some((id) => scope.has(id))).map((m) => this.clone(m));
  }

  async vectorArm(q: DualSearchQuery): Promise<Array<{ memory: MemoryRow; similarity: number }>> {
    return this.memories
      .map((m) => ({ memory: this.clone(m), similarity: cosineSimilarity(m.embedding, q.queryEmbedding) }))
      // stable, deterministic order: similarity desc, then id — the ANN analogue's top-k.
      .sort((a, b) => b.similarity - a.similarity || a.memory.id.localeCompare(b.memory.id))
      .slice(0, q.vectorTopK);
  }

  async similarityOf(memoryIds: readonly string[], queryEmbedding: readonly number[]): Promise<Map<string, number>> {
    const want = new Set(memoryIds);
    const out = new Map<string, number>();
    for (const m of this.memories) {
      if (want.has(m.id)) out.set(m.id, cosineSimilarity(m.embedding, queryEmbedding));
    }
    return out;
  }

  async entityTypes(entityIds: readonly string[]): Promise<Map<string, string>> {
    const want = new Set(entityIds);
    const out = new Map<string, string>();
    for (const e of this.entities) if (want.has(e.id)) out.set(e.id, e.type);
    return out;
  }

  async entityMaturity(entityId: string): Promise<number | null> {
    return this.entities.find((e) => e.id === entityId)?.maturity ?? null;
  }

  /** Test-seam: a well-formed EntityRow for seeding (id/type/name + optional refs/maturity). */
  static entity(partial: Pick<EntityRow, 'id' | 'type' | 'name'> & Partial<EntityRow>): EntityRow {
    return {
      external_refs: {},
      is_internal_org: false,
      maturity: null,
      maturity_updated_at: null,
      created_at: new Date(0).toISOString(),
      ...partial,
    };
  }

  async appendReadEvent(e: RetrievalEventSample): Promise<void> {
    this.readEvents.push({ ...e, entityIds: [...e.entityIds], payload: { ...e.payload } });
  }
  async appendSensitiveAudit(a: SensitiveAccessAudit): Promise<void> {
    this.sensitiveAudits.push({ ...a, entityIds: [...a.entityIds] });
  }
}
