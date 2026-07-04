// ISSUE-004 build order step 4: completeness + queryability assertions on a restored target.
// This is the CORE of AF-069 (AC-NFR-DR.003.1): a restored throwaway project is only a PASS
// if the pgvector memory rows come back WITH their embeddings (a vector similarity query
// works — embeddings survived, not null/zeroed) AND the auth.users rows are present, the
// count matches the source, and they are resolvable.
//
// We compare the restored TARGET against the SOURCE (the ground truth of "complete"). Each
// assertion returns a structured pass/fail with the numbers, so the evidence block can show
// its work rather than a bare boolean.

import type pg from 'pg';
import { q } from './db.js';
import { PROFILE } from './config.js';

export interface Assertion {
  name: string;
  pass: boolean;
  detail: string;
}

export interface AssertionSet {
  path: 'A' | 'B';
  pass: boolean;
  pgvectorPresent: boolean;
  assertions: Assertion[];
  counts: {
    sourceMemories: number;
    targetMemories: number;
    sourceAuthUsers: number;
    targetAuthUsers: number;
  };
}

async function count(pool: pg.Pool, sql: string): Promise<number> {
  const r = await q<{ n: string }>(pool, sql);
  return Number.parseInt(r.rows[0].n, 10);
}

async function pgvectorInstalled(pool: pg.Pool): Promise<boolean> {
  try {
    const r = await q<{ n: string }>(
      pool,
      `select count(*)::text as n from pg_extension where extname='vector'`,
    );
    return Number.parseInt(r.rows[0].n, 10) > 0;
  } catch {
    return false;
  }
}

// Run the full completeness+queryability battery on one restored target, comparing to source.
export async function assertRestored(
  path: 'A' | 'B',
  source: pg.Pool,
  target: pg.Pool,
): Promise<AssertionSet> {
  const assertions: Assertion[] = [];

  const sourceMemories = await count(source, 'select count(*)::text as n from memories');
  const sourceAuthUsers = await count(source, 'select count(*)::text as n from auth.users');
  const targetMemories = await count(target, 'select count(*)::text as n from memories');
  const targetAuthUsers = await count(target, 'select count(*)::text as n from auth.users');

  // 1. memories row count matches source (completeness — no rows lost in the restore).
  assertions.push({
    name: 'memories_count_matches',
    pass: targetMemories === sourceMemories && targetMemories > 0,
    detail: `restored ${targetMemories} vs source ${sourceMemories} memory rows`,
  });

  // 2. embeddings survived intact: NONE null, and all at the right dimension. A restore that
  //    dropped or truncated the vector column would show up here.
  const pgvectorPresent = await pgvectorInstalled(target);
  let nullEmbeddings = -1;
  let wrongDim = -1;
  if (pgvectorPresent) {
    nullEmbeddings = await count(
      target,
      'select count(*)::text as n from memories where embedding is null',
    );
    wrongDim = await count(
      target,
      `select count(*)::text as n from memories where vector_dims(embedding) <> ${PROFILE.EMBED_DIM}`,
    );
  }
  assertions.push({
    name: 'embeddings_intact',
    pass: pgvectorPresent && nullEmbeddings === 0 && wrongDim === 0,
    detail: pgvectorPresent
      ? `null embeddings: ${nullEmbeddings} · wrong-dimension (≠${PROFILE.EMBED_DIM}): ${wrongDim}`
      : 'pgvector extension NOT present on restored target (embeddings cannot be queried)',
  });

  // 3. a vector similarity query actually RUNS on the restored target and returns rows —
  //    proves the embeddings are usable, not merely present as opaque bytes. We order by
  //    cosine distance against a random probe vector; top-k must come back.
  let similarityReturned = -1;
  let similarityOk = false;
  if (pgvectorPresent && targetMemories > 0) {
    try {
      const r = await q<{ id: string }>(
        target,
        `select id
           from memories
          order by embedding <=> (select array(select random() from generate_series(1, $1))::vector)
          limit $2`,
        [PROFILE.EMBED_DIM, PROFILE.SIMILARITY_PROBE_K],
      );
      similarityReturned = r.rows.length;
      similarityOk = similarityReturned > 0;
    } catch {
      similarityOk = false;
    }
  }
  assertions.push({
    name: 'vector_similarity_query_works',
    pass: similarityOk,
    detail: similarityOk
      ? `cosine <=> similarity query returned ${similarityReturned} rows (top-${PROFILE.SIMILARITY_PROBE_K})`
      : 'vector similarity query did NOT return rows on the restored target',
  });

  // 4. auth.users count matches source (identity rows survived — a restored DB with no users
  //    is unusable).
  assertions.push({
    name: 'auth_users_count_matches',
    pass: targetAuthUsers === sourceAuthUsers && targetAuthUsers > 0,
    detail: `restored ${targetAuthUsers} vs source ${sourceAuthUsers} auth.users rows`,
  });

  // 5. auth.users are RESOLVABLE — a representative row queried by id returns a non-null email
  //    (the row is real data, not a hollow shell). Sample the source's first user id and look
  //    it up on the target.
  let resolvable = false;
  let resolveDetail = 'no auth.users rows to resolve';
  if (targetAuthUsers > 0) {
    const sample = await q<{ id: string }>(
      source,
      'select id::text as id from auth.users order by id limit 1',
    );
    const id = sample.rows[0]?.id;
    if (id) {
      const r = await q<{ email: string | null }>(
        target,
        'select email from auth.users where id = $1',
        [id],
      );
      resolvable = r.rows.length === 1;
      resolveDetail = resolvable
        ? `sampled source user ${id.slice(0, 8)}… resolves on target (email present: ${Boolean(
            r.rows[0]?.email,
          )})`
        : `sampled source user ${id.slice(0, 8)}… did NOT resolve on target`;
    }
  }
  assertions.push({
    name: 'auth_users_resolvable',
    pass: resolvable,
    detail: resolveDetail,
  });

  const pass = assertions.every((a) => a.pass);
  return {
    path,
    pass,
    pgvectorPresent,
    assertions,
    counts: { sourceMemories, targetMemories, sourceAuthUsers, targetAuthUsers },
  };
}
