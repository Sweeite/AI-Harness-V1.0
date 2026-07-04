// ISSUE-004 build order step: seed representative data into the SOURCE project IF IT IS EMPTY,
// so the backup being rehearsed has something meaningful to restore. Idempotent — a second run
// detects existing spike data and skips.
//
// What we seed:
//  1. `vector` extension + a `memories` table with a vector(1536) embedding column and rows
//     (embeddings generated SERVER-SIDE via generate_series so we never ship ~77M floats over
//     the wire — same trick as ISSUE-002). Embeddings are RANDOM: correct here, because AF-069
//     proves the embeddings SURVIVE THE RESTORE (non-null, right dimension, similarity query
//     works), not that they are relevant. Relevance is AF-002/ISSUE-025, out of scope.
//  2. Rows in `auth.users` (the Supabase-managed identity table) — a restored DB with no users
//     is unusable, so the rehearsal must assert these come back. We insert the minimal set of
//     NOT-NULL columns Supabase's auth schema requires; if the operator's project already has
//     real auth.users, we DO NOT touch them (we only add if below the target count).
//
// This runs against the operator's REAL source project — it only ADDS spike rows to an empty
// project; it never drops or rewrites operator data.

import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { q } from './db.js';
import { PROFILE } from './config.js';

export interface SeedResult {
  seeded: boolean; // true if we inserted (source was empty), false if we found existing data
  memoriesCount: number;
  authUsersCount: number;
}

// The marker table tells a re-run "this source is already seeded" (idempotency).
const MEMORIES_TABLE = 'memories';

async function tableExists(pool: pg.Pool, name: string): Promise<boolean> {
  const r = await q<{ exists: boolean }>(
    pool,
    `select exists (
       select 1 from information_schema.tables
       where table_schema='public' and table_name=$1
     ) as exists`,
    [name],
  );
  return r.rows[0].exists;
}

async function memoriesCount(pool: pg.Pool): Promise<number> {
  const r = await q<{ n: string }>(pool, `select count(*)::text as n from ${MEMORIES_TABLE}`);
  return Number.parseInt(r.rows[0].n, 10);
}

async function authUsersCount(pool: pg.Pool): Promise<number> {
  const r = await q<{ n: string }>(pool, `select count(*)::text as n from auth.users`);
  return Number.parseInt(r.rows[0].n, 10);
}

async function seedMemories(pool: pg.Pool): Promise<void> {
  await q(pool, 'create extension if not exists vector');
  await q(
    pool,
    `create table if not exists ${MEMORIES_TABLE} (
       id         uuid primary key default gen_random_uuid(),
       content    text not null,
       embedding  vector(${PROFILE.EMBED_DIM}) not null,
       created_at timestamptz not null default now()
     )`,
  );

  const vocab = [
    'contract', 'invoice', 'meeting', 'client', 'support',
    'pricing', 'renewal', 'onboarding', 'incident', 'roadmap',
  ];
  const total = PROFILE.N_MEMORIES;
  const batch = 1_000;
  let loaded = 0;
  while (loaded < total) {
    const n = Math.min(batch, total - loaded);
    await q(
      pool,
      `insert into ${MEMORIES_TABLE} (content, embedding)
       select
         'memory ' || g || ' about ' || ($2::text[])[1 + floor(random() * array_length($2,1))::int],
         (select array(select random() from generate_series(1, $3))::vector)
       from generate_series(1, $1) g`,
      [n, vocab, PROFILE.EMBED_DIM],
    );
    loaded += n;
    process.stdout.write(`\r        seeded ${loaded}/${total} memories`);
  }
  process.stdout.write('\n');
  await q(pool, `analyze ${MEMORIES_TABLE}`);
}

// Insert into auth.users up to N_AUTH_USERS. We only fill columns that are NOT NULL in the
// Supabase auth schema and safe to synthesize; the goal is "rows exist + count matches +
// resolvable after restore", not a working login. If the project already has >= target real
// users, we insert nothing.
async function seedAuthUsers(pool: pg.Pool, existing: number): Promise<void> {
  const want = PROFILE.N_AUTH_USERS;
  if (existing >= want) return;
  const toAdd = want - existing;
  for (let i = 0; i < toAdd; i++) {
    const id = randomUUID();
    const email = `spike-${id.slice(0, 8)}@issue-004.invalid`;
    await q(
      pool,
      `insert into auth.users
         (instance_id, id, aud, role, email, encrypted_password,
          created_at, updated_at)
       values
         ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2,
          crypt('spike-not-a-real-login', gen_salt('bf')),
          now(), now())
       on conflict (id) do nothing`,
      [id, email],
    );
  }
}

export async function seedSourceIfEmpty(pool: pg.Pool): Promise<SeedResult> {
  // pgcrypto for gen_salt/crypt used above (Supabase ships it; enable if plain PG).
  await q(pool, 'create extension if not exists pgcrypto');

  const hasMemories = await tableExists(pool, MEMORIES_TABLE);
  const memCount = hasMemories ? await memoriesCount(pool) : 0;
  const authCount = await authUsersCount(pool);

  // "Empty" for our purposes = no spike memories table with rows. If the operator pointed us
  // at a project that already holds a representative corpus, we assert against it as-is.
  if (hasMemories && memCount > 0) {
    return { seeded: false, memoriesCount: memCount, authUsersCount: authCount };
  }

  await seedMemories(pool);
  await seedAuthUsers(pool, authCount);

  return {
    seeded: true,
    memoriesCount: await memoriesCount(pool),
    authUsersCount: await authUsersCount(pool),
  };
}
