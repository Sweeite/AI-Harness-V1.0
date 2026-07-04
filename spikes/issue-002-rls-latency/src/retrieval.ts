// ISSUE-002 build order step 5: the retrieval hot path. The RLS clearance predicate gates
// the pgvector ANN scan — that scan is the hot path AF-067 is about. We measure the
// clearance-filtered vector top-k (HNSW-backed):
//
//     select id from memories order by embedding <=> $1::vector limit 7
//
// under the `authenticated` role, so the visibility ∩ sensitivity ∩ Restricted ∩ aal2
// predicate filters BEFORE ranking (FR-2.RET.004). The keyword arm of the "dual search"
// is a separate GIN-indexed lookup (already ms-fast); blending the two arms into a final
// ranked set is retrieval/ranking work owned by ISSUE-025, and optimising the combined
// query's PLAN under RLS is ISSUE-023 (AF-019) — neither changes the RLS-predicate latency
// characteristic this spike measures.
//
// The probe embedding is a BOUND PARAMETER ($1::vector) — an HNSW index scan only engages
// against a param/const, and this mirrors production (the app computes the query embedding
// once and sends it). Random probe is correct for a LATENCY measurement (ISSUE-002 §2).

import type pg from 'pg';
import { PROFILE } from './config.js';

const DIM = PROFILE.EMBED_DIM;
const K = PROFILE.TOP_K;

const HOTPATH_SQL = `select id from memories order by embedding <=> $1::vector limit ${K}`;

export function randomProbe(): string {
  const parts = new Array(DIM);
  for (let i = 0; i < DIM; i++) parts[i] = Math.random().toFixed(6);
  return `[${parts.join(',')}]`;
}

export async function retrieve(client: pg.PoolClient): Promise<number> {
  const res = await client.query(HOTPATH_SQL, [randomProbe()]);
  return res.rowCount ?? 0;
}

// EXPLAIN (ANALYZE, FORMAT JSON) of the hot path. `timing` on = per-node timings (for the
// initPlan-overhead breakdown); off = lower overhead, still reports server-side Execution
// Time (for the p95 sampling, which wants DB-side latency, not client↔DB network).
export async function explainHotpath(
  client: pg.PoolClient,
  timing = true,
): Promise<any> {
  const res = await client.query(
    `explain (analyze, verbose, timing ${timing ? 'on' : 'off'}, format json) ${HOTPATH_SQL}`,
    [randomProbe()],
  );
  return (res.rows[0] as any)['QUERY PLAN'][0];
}
