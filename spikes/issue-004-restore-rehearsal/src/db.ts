// ISSUE-004 build order step: thin pg connection helpers for SOURCE and TARGET(s).
//
// Each restore target / the source gets its own direct (session-mode) pool. Use the DIRECT
// connection (port 5432), NOT the transaction pooler (6543): the seed/restore/assert steps
// run DDL, `create extension`, and read the whole restored DB in sessions where
// session-scoped state must persist — the transaction pooler can break that (same caveat as
// ISSUE-002's GUCs). We do NOT read connection strings from any hard-coded default: every
// URL is an operator-provided env var (isolation contract for a "you-present" spike).

import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

// Build a pool for an operator-provided connection string. `label` is only for error text.
export function poolFor(url: string, label: string): pg.Pool {
  if (!url) {
    // Should never happen — main.ts gates on presence first — but fail loud, not silent.
    throw new Error(`internal: empty connection string for ${label}`);
  }
  return new Pool({
    connectionString: url,
    max: 4,
    // Supabase requires TLS; the direct host presents a valid cert. `rejectUnauthorized:
    // false` matches the ISSUE-002 harness (Supabase's chain isn't always in the default
    // store); the connection is still encrypted.
    ssl: url.includes('supabase.') ? { rejectUnauthorized: false } : undefined,
  });
}

export async function q<T extends pg.QueryResultRow = pg.QueryResultRow>(
  pool: pg.Pool,
  sql: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(sql, params as any[]);
}

// Read the server version + pgvector extension version from a pool (for the evidence env
// block, and to fail loud if pgvector is missing on a target we're about to assert on).
export async function readEnv(
  pool: pg.Pool,
): Promise<{ serverVersion: string; pgvector: string }> {
  const v = await q<{ v: string }>(pool, `select current_setting('server_version') as v`);
  let pgv = '(not installed)';
  try {
    const r = await q<{ extversion: string }>(
      pool,
      `select extversion from pg_extension where extname='vector'`,
    );
    pgv = r.rows[0]?.extversion ?? '(not installed)';
  } catch {
    // extension query failed (permissions / not present) — leave as not installed.
  }
  return { serverVersion: v.rows[0].v, pgvector: pgv };
}

export async function closeAll(pools: pg.Pool[]): Promise<void> {
  await Promise.all(pools.map((p) => p.end().catch(() => {})));
}
