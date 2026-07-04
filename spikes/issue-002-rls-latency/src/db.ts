// Thin DB layer. One direct (session-mode) connection; the spike runs each retrieval in
// a transaction so `set local role authenticated` + the JWT-claims GUC scope to that
// statement exactly as they do on the production human path.

import 'dotenv/config';
import pg from 'pg';
import { PROFILE } from './config.js';

const { Pool } = pg;

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    '\n  DATABASE_URL is not set. Copy .env.example → .env and paste the Supabase\n' +
      '  DIRECT connection string (session mode, port 5432).\n',
  );
  process.exit(1);
}

// vector(1536) comes back as a bracketed string; keep it as text (we only order by it).
export const pool = new Pool({
  connectionString: url,
  max: 4,
  // Supabase requires TLS; the direct host presents a valid cert.
  ssl: url.includes('supabase.') ? { rejectUnauthorized: false } : undefined,
});

export async function q<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(sql, params as any[]);
}

export type AsUserOpts = {
  // Force the HNSW index path. pgvector's planner mis-costs a filtered vector search under
  // an RLS predicate and falls back to a full Seq Scan (the AF-019 concern — pgvector
  // applies the clearance filter AFTER the ANN scan). The production retrieval path MUST
  // run on the vector index; ISSUE-023 owns making the planner pick it automatically
  // (partial indexes / cost tuning / iterative scan). For the p95 measurement we run the
  // intended index path explicitly and record the default-planner cliff separately.
  forceIndex?: boolean;
};

// Run `fn` inside a transaction whose session GUCs are set to impersonate `uid` on the
// authenticated (RLS-enforced) role. This is exactly how Supabase RLS is exercised: set
// the role + the request.jwt.claims GUC, then every query in the txn sees `auth.uid()`.
export async function asUser<T>(
  uid: string,
  aal: 'aal1' | 'aal2',
  fn: (client: pg.PoolClient) => Promise<T>,
  opts: AsUserOpts = {},
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('set local role authenticated');
    const claims = JSON.stringify({ sub: uid, role: 'authenticated', aal });
    await client.query('select set_config($1,$2,true)', ['request.jwt.claims', claims]);
    await client.query('select set_config($1,$2,true)', [
      'hnsw.ef_search',
      String(PROFILE.EF_SEARCH),
    ]);
    if (opts.forceIndex) {
      await client.query(`set local hnsw.iterative_scan = 'relaxed_order'`);
      await client.query(`set local enable_seqscan = off`);
    }
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
