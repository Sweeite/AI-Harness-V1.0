// ISSUE-023 / AF-019 spike — the clearance-filtered vector top-k (the hot path). The RLS predicate gates the pgvector
// ANN scan; the probe is a BOUND PARAMETER ($1::vector) so an HNSW index scan can engage (mirrors production — the app
// computes the query embedding once and sends it).

import type pg from 'pg';
import { q } from './db.js';
import { PROFILE } from './config.js';

const DIM = PROFILE.EMBED_DIM;

// A probe drawn NEAR a random cluster centroid (a realistic query landing in a cluster's neighbourhood), so the top-k
// has a well-defined cleared set. Computed server-side over af019_centroids (l2_normalize(centroid + small noise)).
// This is the correct probe for a RECALL measurement — a uniform-random probe is equidistant to every cluster (the
// artifact that made the first run's recall 0).
export async function sampleProbe(): Promise<string> {
  const r = await q<{ p: string }>(
    `select l2_normalize(c.vec + nz.noise)::text as p
       from af019_centroids c
       join lateral (select array(select (random() - 0.5) * 2 * $1 from generate_series(1, $2))::vector as noise) nz on true
      order by random() limit 1`,
    [PROFILE.CLUSTER_NOISE, DIM],
  );
  return r.rows[0]!.p;
}

const TOPK_SQL = (k: number) => `select id from af019_memories order by embedding <=> $1::vector limit ${k}`;

/** The top-k memory ids for a probe under the caller's RLS predicate (the current session mode governs seqscan/index). */
export async function topKIds(client: pg.PoolClient, probe: string, k: number): Promise<string[]> {
  const res = await client.query<{ id: string }>(TOPK_SQL(k), [probe]);
  return res.rows.map((r) => r.id);
}

/** EXPLAIN (ANALYZE) the top-k — returns { execMs, usesSeqScan, usesIndex } for the planner-cliff measurement. */
export async function explainTopK(client: pg.PoolClient, probe: string, k: number): Promise<{ execMs: number; usesSeqScan: boolean; usesIndex: boolean }> {
  const res = await client.query(`explain (analyze, timing off, format json) ${TOPK_SQL(k)}`, [probe]);
  const plan = (res.rows[0] as any)['QUERY PLAN'][0];
  const s = JSON.stringify(plan);
  return {
    execMs: plan['Execution Time'] as number,
    usesSeqScan: /Seq Scan/.test(s),
    usesIndex: /af019_memories_embedding_hnsw|Index Scan/.test(s),
  };
}
