// ISSUE-023 (C2 VEC) — the VectorAdmin port + in-memory reference model. This is the DB-touching surface of the slice:
// the HNSW index-presence assertion (AC-2.VEC.001.1), the reconcile-gate counts (AC-2.VEC.003.2), the model-change DDL
// steps (FR-2.VEC.003), and a retrieval-session EXPLAIN diagnostic that PROVES the AF-019 contract forces the index
// (used by the R10 smoke + the AF-019 spike; production retrieval query construction is ISSUE-025's).
//
// The embed-on-write STEP itself is pure (embed.ts) and the memory INSERT is ISSUE-024's (sole writer) — so this port
// deliberately does NOT insert memories. The in-memory model is the proven contract; supabase-store.ts is the live pg
// adapter over the SAME port.

import type { ModelChangeOps, ModelChangePhase } from './model-change.ts';
import { EF_SEARCH_DEFAULT } from './retrieval-session.ts';

/** The documented HNSW parameters (FR-2.VEC.001 / indexes.md). The check gate + the live assertion compare against these. */
export const HNSW_PARAMS = { m: 16, efConstruction: 64, method: 'hnsw', opclass: 'vector_cosine_ops' } as const;

export interface HnswIndexInfo {
  name: string;
  method: string; // 'hnsw'
  column: string; // 'embedding'
  m: number | null;
  efConstruction: number | null;
  opclass: string | null; // 'vector_cosine_ops'
}

/** Does this index carry the documented HNSW parameters? Used by the assertion + the smoke. */
export function hnswParamsMatch(info: HnswIndexInfo | null): boolean {
  return (
    info != null &&
    info.method === HNSW_PARAMS.method &&
    info.m === HNSW_PARAMS.m &&
    info.efConstruction === HNSW_PARAMS.efConstruction
  );
}

/** Result of the retrieval-session EXPLAIN diagnostic — did the AF-019 contract keep the scan off the seqscan? */
export interface RetrievalPlanProbe {
  usesSeqScan: boolean;
  usesHnswIndex: boolean;
  raw?: unknown;
}

export interface VectorAdmin extends ModelChangeOps {
  /** AC-2.VEC.001.1 — the live HNSW index on memories.embedding, or null if absent. */
  hnswIndexInfo(): Promise<HnswIndexInfo | null>;
  /** EXPLAIN the clearance-filtered vector top-k under the AF-019 retrieval-session contract — proves index-not-seqscan. */
  explainRetrieval(ef?: number): Promise<RetrievalPlanProbe>;
}

// ── the in-memory reference model. A tiny corpus of rows with the v2 backfill flags + a configurable index-info. ──
export interface FakeMemoryRow {
  id: string;
  embeddingModel: string;
  hasValidV2: boolean; // whether embedding_v2 is populated + valid under the target model
  live: boolean; // a superseded/expired row is not "live"; only live rows gate the reconcile (FR-2.VEC.003)
}

export interface VectorBacking {
  rows: FakeMemoryRow[];
  index: HnswIndexInfo | null;
  phase: ModelChangePhase | 'idle';
}

export function newVectorBacking(index: HnswIndexInfo | null = defaultFakeIndex()): VectorBacking {
  return { rows: [], index, phase: 'idle' };
}

export function defaultFakeIndex(): HnswIndexInfo {
  return {
    name: 'memories_embedding_hnsw',
    method: 'hnsw',
    column: 'embedding',
    m: HNSW_PARAMS.m,
    efConstruction: HNSW_PARAMS.efConstruction,
    opclass: HNSW_PARAMS.opclass,
  };
}

export class InMemoryVectorAdmin implements VectorAdmin {
  constructor(private readonly backing: VectorBacking) {}

  async hnswIndexInfo(): Promise<HnswIndexInfo | null> {
    return this.backing.index ? { ...this.backing.index } : null;
  }

  async explainRetrieval(_ef: number = EF_SEARCH_DEFAULT): Promise<RetrievalPlanProbe> {
    // The reference model always plans onto the index — the contract's job. The LIVE proof (that the real planner does)
    // is the supabase adapter + the AF-019 spike; this fake asserts the SHAPE the smoke checks.
    return { usesSeqScan: false, usesHnswIndex: this.backing.index != null };
  }

  async expand(_newModel: string): Promise<void> {
    this.backing.phase = 'expand';
    // idempotent: the embedding_v2 slot + its (fake) index become available; no rows carry a valid v2 yet.
  }

  async backfill(newModel: string): Promise<{ embedded: number }> {
    this.backing.phase = 'backfill';
    let embedded = 0;
    for (const r of this.backing.rows) {
      if (r.live && !r.hasValidV2) {
        r.hasValidV2 = true;
        r.embeddingModel = newModel;
        embedded++;
      }
    }
    return { embedded };
  }

  async liveRowCount(): Promise<number> {
    return this.backing.rows.filter((r) => r.live).length;
  }

  async validV2Count(): Promise<number> {
    return this.backing.rows.filter((r) => r.live && r.hasValidV2).length;
  }

  async switchReads(_newModel: string): Promise<void> {
    this.backing.phase = 'switch_reads';
  }

  async contract(_newModel: string): Promise<void> {
    this.backing.phase = 'contract';
  }
}

// Test/seed helpers on the in-memory corpus.
export function seedRows(backing: VectorBacking, spec: { live: number; superseded?: number; model?: string }): void {
  const model = spec.model ?? 'text-embedding-3-small';
  let n = backing.rows.length;
  for (let i = 0; i < spec.live; i++) backing.rows.push({ id: `m-${++n}`, embeddingModel: model, hasValidV2: false, live: true });
  for (let i = 0; i < (spec.superseded ?? 0); i++) backing.rows.push({ id: `m-${++n}`, embeddingModel: model, hasValidV2: false, live: false });
}
