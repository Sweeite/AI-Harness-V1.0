// ISSUE-002 build order step 1 (declared profile — the extrapolation basis).
//
// The corpus profile is CONTESTABLE BY DESIGN (mirrors ISSUE-001's profile.ts). It is
// the load envelope the latency claim is measured against. If you think the numbers are
// wrong, change them here and re-run — the PASS/FAIL is only as good as this profile.
//
// Grounding:
// - Users/roles: the ADR-001 isolation envelope — "≤~20 users/silo, ~6 roles, tiny
//   fully-indexed permission tables" (performance.md §NFR-INFRA envelope; ISSUE-002 §2).
//   The permission tables being TINY is *why* the live-RLS lookup is plausible — the
//   helper reads a handful of rows, once per statement.
// - Memories: "a large memory batch" on the retrieval hot path (ISSUE-002 §1). A silo
//   accumulates memories over its life; 50k is a deliberately generous batch so the
//   pgvector scan + clearance predicate are stressed well past a fresh deployment. This
//   is the number most worth contesting.
// - ef_search / top-k: CFG-ef_search default 40, CFG-memories_injected_per_task default 7
//   (config-registry.md; ISSUE-002 §5) — set to DEFAULTS during measurement, not tuned
//   here (ef_search tuning is ISSUE-023 / AF-019).
// - Iterations: p95 needs a decent sample; 200 retrievals across random users/vectors.

function envInt(name: string, dflt: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return dflt;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) throw new Error(`${name} must be an integer, got: ${v}`);
  return n;
}

export const PROFILE = {
  N_MEMORIES: envInt('N_MEMORIES', 50_000),
  N_USERS: envInt('N_USERS', 20),
  N_ROLES: envInt('N_ROLES', 6),
  N_ENTITIES: envInt('N_ENTITIES', 200),
  ITERATIONS: envInt('ITERATIONS', 200),

  // Retrieval knobs — DEFAULTS, not tuned (ISSUE-002 §5).
  EF_SEARCH: 40, // CFG-ef_search default
  TOP_K: 7, // CFG-memories_injected_per_task default
  CANDIDATE_K: 50, // per-arm candidate pool for the dual-search (vector arm + keyword arm)

  EMBED_DIM: 1536, // vector(1536) — schema.md `memories` row / FR-2.MEM.002
} as const;

// Distribution of the clearance dimensions across the corpus. Realistic-ish and
// contestable: most knowledge is broadly visible/normal; a minority is team/private and
// personal/restricted. This shape drives how selective the RLS predicate is — a MORE
// selective predicate (more restricted rows) is HARDER for pgvector recall (AF-019, out
// of scope here) but does not change the initPlan-overhead claim this spike proves.
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

// The paper targets this spike measures against (performance.md §NFR-PERF.001 / .003).
// These are BUILDER-FACING TARGETS TO TEST AGAINST, not measured SLOs — AF-067 is the
// sole authority on whether they hold (NFR-PERF.001 Notes).
export const TARGETS = {
  INITPLAN_MS_PER_STATEMENT: 50, // < ~50 ms/statement (AC-NFR-PERF.001.1)
  RETRIEVAL_P95_MS: 2000, // end-to-end p95 < 2 s (AC-NFR-PERF.003.2)
} as const;
