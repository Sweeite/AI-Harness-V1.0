// ISSUE-023 / AF-019 spike — the load envelope. The AF-019 LOAD gate: does the ISSUE-023 retrieval-session contract
// (hnsw.ef_search + hnsw.iterative_scan='relaxed_order' + enable_seqscan=off) FORCE the HNSW index under the RLS
// clearance predicate at scale (resolving the ISSUE-002 ~308x seqscan cliff), AND keep recall@10 acceptable — and what
// production ef_search value that implies (raise-not-drop). Shares the ISSUE-002 50k profile so the two are comparable.
//
// ALL objects are `af019_`-prefixed — this spike NEVER touches the real `memories` table (it can run against the live
// silo safely; it drops only its own af019_* objects).

function envInt(name: string, dflt: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return dflt;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) throw new Error(`${name} must be an integer, got: ${v}`);
  return n;
}

export const PREFIX = 'af019_';

export const PROFILE = {
  N_MEMORIES: envInt('N_MEMORIES', 50_000), // the ISSUE-002 corpus size — the contestable load number.
  N_USERS: envInt('N_USERS', 20),
  N_ROLES: 6,
  N_ENTITIES: envInt('N_ENTITIES', 200),

  EMBED_DIM: 1536, // vector(1536) — schema.md memories row.
  TOP_K: 10, // recall@10 (the AF-019 recall metric).

  // Clustered corpus (recall is only meaningful with real nearest-neighbour structure — see seed.ts). 200 near-orthogonal
  // unit centroids + per-component noise U[-CLUSTER_NOISE, CLUSTER_NOISE]. CLUSTER_NOISE=0.01 → noise L2 norm ~0.23 vs
  // the unit centroid → tight, separated clusters with a genuine "10 nearest" (recall rises with ef, so it can be tuned).
  N_CENTROIDS: envInt('N_CENTROIDS', 200),
  CLUSTER_NOISE: Number.parseFloat(process.env.CLUSTER_NOISE ?? '0.01'),

  // ef_search sweep — CFG-ef_search default (40) and up. Production ef = the LOWEST sweep value with recall >= target
  // (raise-not-drop; never drop the clearance predicate).
  EF_SWEEP: (process.env.EF_SWEEP ?? '40,80,120,200').split(',').map((s) => Number.parseInt(s.trim(), 10)),
  RECALL_PROBES: envInt('RECALL_PROBES', 12), // exact top-10 is a full seqscan per probe (~seconds) — keep modest.
  P95_ITERATIONS: envInt('P95_ITERATIONS', 100),
} as const;

export const TARGETS = {
  RECALL_AT_10: 0.9, // production ef = the lowest sweep value clearing this under the RLS predicate.
  RETRIEVAL_P95_MS: 2000, // NFR-PERF.003 end-to-end budget the index path must live within.
} as const;

// Distribution of the clearance dimensions (mirrors ISSUE-002). A MORE selective predicate is HARDER for HNSW recall —
// exactly the AF-019 starvation risk the iterative scan must survive.
export const DISTRIBUTION = {
  visibility: [
    { value: 'global', weight: 0.6 },
    { value: 'team', weight: 0.3 },
    { value: 'private', weight: 0.1 },
  ],
  sensitivity: [
    { value: 'normal', weight: 0.7 },
    { value: 'personal', weight: 0.2 },
    { value: 'restricted', weight: 0.1 },
  ],
} as const;
