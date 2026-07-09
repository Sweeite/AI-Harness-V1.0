// ISSUE-023 (C2 VEC) — FR-2.VEC.001 + NFR-PERF.002/.009: the RETRIEVAL-SESSION index-usage CONTRACT. This is the
// AF-019 fix, codified. ISSUE-002 (AF-067 spike, 2026-07-04, 50k rows on real Supabase) MEASURED the cliff real:
// with the RLS clearance predicate present, the pgvector planner mis-costs the filtered vector search and defaults to
// a full Seq Scan (19,415 ms) instead of the HNSW index (63 ms) — a ~308x cliff. The HNSW index composes correctly
// with RLS; the planner just won't PICK it under a filter, and the post-ANN clearance filter can starve recall.
//
// The contract every retrieval transaction MUST establish before the `order by embedding <=> $probe limit k` query:
//   1. set local hnsw.ef_search = <ef>            — the recall/latency dial (CFG-ef_search, LIVE, 10-500, default 40).
//   2. set local hnsw.iterative_scan = 'relaxed_order'
//        pgvector >=0.8 iterative scans: when the post-scan RLS filter drops candidates, the index KEEPS returning
//        batches until `limit` cleared rows are found — this is the recall fix (AF-019: filter applies AFTER the ANN
//        scan, so without iteration an aggressive predicate starves recall). 'relaxed_order' trades strict global
//        ordering for throughput; retrieval RE-RANKS the union afterwards (ISSUE-025), so relaxed order is fine here.
//   3. set local enable_seqscan = off             — the planner-forcing. This is the blunt-but-CORRECT guarantee that
//        the ANN scan runs on the index, not a 19s seqscan. It is `set local` = scoped to THIS transaction only (it
//        NEVER changes the planner globally), and the retrieval hot path is a single-table vector top-k, so removing
//        the seqscan option cannot mis-plan a join. Chosen over cost-tuning (fragile across pgvector versions) and a
//        partial index (does not generalise across clearance predicates). The AF-019 spike sets the production ef_search.
//
// All three are `set local` → they live and die with the retrieval txn (db-layer discipline mirrors ISSUE-002 asUser).
// This module is PURE (returns the SQL); the live adapter (supabase-store.ts) applies it, and the AF-019 spike proves
// it forces the index + holds recall at 50k. ISSUE-025 (retrieval) consumes `retrievalSessionSql`.

export const EF_SEARCH_MIN = 10; // CFG-ef_search range floor (config-registry.md).
export const EF_SEARCH_MAX = 500; // CFG-ef_search range ceiling.
export const EF_SEARCH_DEFAULT = 40; // CFG-ef_search default (the safe default the spike may raise).

export class EfSearchRangeError extends Error {
  constructor(readonly value: number) {
    super(`embeddings: ef_search ${value} is outside the CFG-ef_search range [${EF_SEARCH_MIN}, ${EF_SEARCH_MAX}]`);
    this.name = 'EfSearchRangeError';
  }
}

/**
 * Validate an ef_search value against the CFG-ef_search bounds. STRICT (throws) — a config value out of range is an
 * operator error that must surface, not be silently clamped (a silently-clamped dial hides a mis-set config = #3).
 * Use `raiseEfSearch` for the deliberate raise-not-drop tuning path, which clamps at the ceiling on purpose.
 */
export function assertEfSearch(value: number): number {
  if (!Number.isInteger(value) || value < EF_SEARCH_MIN || value > EF_SEARCH_MAX) {
    throw new EfSearchRangeError(value);
  }
  return value;
}

/**
 * NFR-PERF.009 raise-not-drop posture: when recall is thin under the clearance predicate, RAISE ef_search (never drop
 * the predicate). Returns the raised value, clamped at the ceiling (EF_SEARCH_MAX) — you cannot tune past the range,
 * and the answer to thin recall is more search, never less clearance filtering (a #2 leak).
 */
export function raiseEfSearch(current: number, by: number): number {
  const base = Number.isInteger(current) ? current : EF_SEARCH_DEFAULT;
  return Math.min(EF_SEARCH_MAX, Math.max(EF_SEARCH_MIN, base + Math.max(0, Math.trunc(by))));
}

/**
 * The ordered `set local` statements the retrieval transaction must run BEFORE the vector query. Pure — no I/O. The
 * order does not matter to Postgres (they are independent GUCs) but is kept stable (ef_search, iterative_scan,
 * enable_seqscan) for readable EXPLAIN / smoke assertions. `ef` is validated against the CFG bounds.
 */
export function retrievalSessionSql(ef: number = EF_SEARCH_DEFAULT): string[] {
  const efSearch = assertEfSearch(ef);
  return [
    `set local hnsw.ef_search = ${efSearch}`,
    `set local hnsw.iterative_scan = 'relaxed_order'`,
    `set local enable_seqscan = off`,
  ];
}

/** A minimal exec seam so the pure module can drive a real client without importing pg. */
export type SessionExec = (sql: string) => Promise<unknown>;

/** Apply the retrieval-session contract on an already-open transaction/client. Used by the live adapter + the smoke.
 * The caller owns begin/commit; these `set local` GUCs scope to that txn. */
export async function applyRetrievalSession(exec: SessionExec, ef: number = EF_SEARCH_DEFAULT): Promise<void> {
  for (const stmt of retrievalSessionSql(ef)) {
    await exec(stmt);
  }
}
