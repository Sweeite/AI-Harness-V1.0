// ISSUE-023 / AF-019 spike — thin DB layer. One direct (session-mode) connection; each retrieval runs in a transaction
// so `set local role authenticated` + the JWT-claims GUC scope to that statement exactly as the production human path.
//
// The four session MODES the spike compares (the crux — which planner posture forces the HNSW index under RLS):
//   default        — the RLS predicate present, NO retrieval-session help. This is the ISSUE-002 cliff (seqscan).
//   iterative_only — + hnsw.iterative_scan='relaxed_order' (does that alone tip the planner onto the index?).
//   contract       — the FULL ISSUE-023 contract: ef_search + iterative_scan + enable_seqscan=off (the guarantee).
//   exact          — enable_indexscan=off (force a true full-scan ordering) — the recall GROUND TRUTH, not a candidate.

import pg from 'pg';
import { PROFILE } from './config.js';

const { Pool } = pg;

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('\n  DATABASE_URL is not set. Run with: DATABASE_URL="$SILO_DB_URL" (the af019_* fixture is isolated).\n');
  process.exit(1);
}

export const pool = new Pool({
  connectionString: url,
  max: 4,
  ssl: url.includes('supabase.') ? { rejectUnauthorized: false } : undefined,
});

export async function q<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(sql, params as any[]);
}

export type SessionMode = 'default' | 'iterative_only' | 'contract' | 'exact';

export async function applyMode(client: pg.PoolClient, mode: SessionMode, ef: number): Promise<void> {
  // ef_search always set (it is the recall dial; harmless on the seqscan path).
  await client.query('select set_config($1,$2,true)', ['hnsw.ef_search', String(ef)]);
  if (mode === 'iterative_only') {
    await client.query(`set local hnsw.iterative_scan = 'relaxed_order'`);
  } else if (mode === 'contract') {
    await client.query(`set local hnsw.iterative_scan = 'relaxed_order'`);
    await client.query(`set local enable_seqscan = off`);
  } else if (mode === 'exact') {
    // GROUND TRUTH: force a real full-scan ordering (no HNSW approximation) so top-k is exact under the RLS predicate.
    await client.query(`set local enable_indexscan = off`);
    await client.query(`set local enable_bitmapscan = off`);
    await client.query(`set local enable_seqscan = on`);
  }
}

// Impersonate `uid` on the authenticated (RLS-enforced) role for the duration of `fn`, with the session mode applied.
export async function asUser<T>(
  uid: string,
  aal: 'aal1' | 'aal2',
  mode: SessionMode,
  ef: number,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('set local role authenticated');
    const claims = JSON.stringify({ sub: uid, role: 'authenticated', aal });
    await client.query('select set_config($1,$2,true)', ['request.jwt.claims', claims]);
    await applyMode(client, mode, ef);
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function close(): Promise<void> {
  await pool.end();
}

export const DIM = PROFILE.EMBED_DIM;
