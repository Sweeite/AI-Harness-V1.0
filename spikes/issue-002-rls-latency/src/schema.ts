// ISSUE-002 build order steps 2–4: permission tables + the four SECURITY DEFINER STABLE
// helpers + the memories table + the clearance-before-ranking RLS policy.
//
// The load-bearing thing under test (AF-067): a helper call wrapped in `(select …)`
// forces a per-statement initPlan (evaluated ONCE), whereas the bare call is re-evaluated
// PER ROW (Supabase's own benchmark: 178,000 ms → 12 ms). We create the policy in BOTH
// modes on the same table so the spike can measure the cliff directly.

import type pg from 'pg';
import { q } from './db.js';
import { PROFILE } from './config.js';

const DIM = PROFILE.EMBED_DIM;

export async function createExtensions(): Promise<void> {
  await q('create extension if not exists vector');
}

export async function dropAll(): Promise<void> {
  // Order: policy → table → helpers → perm tables. IF EXISTS everywhere (idempotent).
  await q('drop table if exists memories cascade');
  await q('drop table if exists restricted_grants cascade');
  await q('drop table if exists sensitivity_clearances cascade');
  await q('drop table if exists user_roles cascade');
  await q('drop table if exists role_permissions cascade');
  await q('drop table if exists roles cascade');
  await q('drop table if exists app_users cascade');
  for (const fn of [
    'user_perms(uuid)',
    'user_visibility(uuid)',
    'user_clearances(uuid)',
    'user_restricted(uuid)',
    'user_aal()',
  ]) {
    await q(`drop function if exists ${fn} cascade`);
  }
}

// auth.uid() — on Supabase this already exists (reads request.jwt.claims->>'sub'). Only
// create a shim if it's missing, so the spike is portable to plain Postgres too. We never
// clobber Supabase's own function.
export async function ensureAuthUid(): Promise<void> {
  await q(`
    do $$
    begin
      if not exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'auth' and p.proname = 'uid'
      ) then
        create schema if not exists auth;
        execute $f$
          create function auth.uid() returns uuid language sql stable as
          $b$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid $b$
        $f$;
        grant usage on schema auth to authenticated;
        grant execute on function auth.uid() to authenticated;
      end if;
    end $$;
  `);
}

export async function createPermTables(): Promise<void> {
  // A local subject table (the spike's stand-in for auth.users). Tiny, fully indexed.
  await q(`
    create table app_users (
      id   uuid primary key,
      aal  text not null default 'aal2'          -- every seeded user is aal2 (baseline gate)
    );
  `);
  await q(`
    create table roles (
      id          int primary key,
      name        text not null,
      visibility  text[] not null                -- visibility tiers this role may read (OD-169)
    );
  `);
  await q(`
    create table role_permissions (
      role_id  int not null references roles(id),
      perm     text not null,
      primary key (role_id, perm)
    );
  `);
  await q(`
    create table user_roles (
      user_id  uuid primary key references app_users(id),  -- one active role per user
      role_id  int not null references roles(id)
    );
  `);
  await q(`
    create table sensitivity_clearances (
      user_id      uuid not null references app_users(id),
      sensitivity  text not null,                -- 'normal' | 'personal' | 'restricted'
      primary key (user_id, sensitivity)
    );
  `);
  await q(`
    create table restricted_grants (
      grantee_user_id  uuid not null references app_users(id),
      entity_id        uuid not null,
      revoked_at       timestamptz,              -- null = live grant
      primary key (grantee_user_id, entity_id)
    );
  `);
  // Every policy-referenced column on the tiny tables is covered by the PKs above; add the
  // FK-side index the helpers join on.
  await q('create index on role_permissions (role_id)');
}

// The four helpers, SECURITY DEFINER STABLE, search_path pinned. Owned by the connection
// role so they read the permission tables regardless of the authenticated caller's grants
// — that's the whole point of SECURITY DEFINER (rls-policies.md §Helper functions).
export async function createHelpers(): Promise<void> {
  await q(`
    create function user_perms(uid uuid) returns text[]
      language sql stable security definer set search_path = public as $$
      select coalesce(array_agg(rp.perm), '{}')
      from user_roles ur join role_permissions rp on rp.role_id = ur.role_id
      where ur.user_id = uid
    $$;
  `);
  await q(`
    create function user_visibility(uid uuid) returns text[]
      language sql stable security definer set search_path = public as $$
      select coalesce(r.visibility, '{}')
      from user_roles ur join roles r on r.id = ur.role_id
      where ur.user_id = uid
    $$;
  `);
  await q(`
    create function user_clearances(uid uuid) returns text[]
      language sql stable security definer set search_path = public as $$
      select coalesce(array_agg(sc.sensitivity), '{}')
      from sensitivity_clearances sc where sc.user_id = uid
    $$;
  `);
  await q(`
    create function user_restricted(uid uuid) returns uuid[]
      language sql stable security definer set search_path = public as $$
      select coalesce(array_agg(rg.entity_id), '{}')
      from restricted_grants rg where rg.grantee_user_id = uid and rg.revoked_at is null
    $$;
  `);
  await q(`
    create function user_aal() returns text
      language sql stable security definer set search_path = public as $$
      select coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'aal', 'aal1')
    $$;
  `);
  await q('grant execute on function user_perms(uuid) to authenticated');
  await q('grant execute on function user_visibility(uuid) to authenticated');
  await q('grant execute on function user_clearances(uuid) to authenticated');
  await q('grant execute on function user_restricted(uuid) to authenticated');
  await q('grant execute on function user_aal() to authenticated');
}

export async function createMemories(): Promise<void> {
  // memories-shaped copy (schema.md `memories` row / FR-2.MEM.002). Only the columns the
  // clearance predicate + ranking touch — this is a spike fixture, not the real schema.
  await q(`
    create table memories (
      id           uuid primary key default gen_random_uuid(),
      content      text not null,
      embedding    vector(${DIM}) not null,
      entity_ids   uuid[] not null,
      visibility   text not null,                -- 'global' | 'team' | 'private'
      sensitivity  text not null,                -- 'normal' | 'personal' | 'restricted'
      content_tsv  tsvector generated always as (to_tsvector('english', content)) stored,
      created_at   timestamptz not null default now()
    );
  `);
  // Index EVERY policy-referenced column (AF-067 binding rule) + the ranking indexes.
  await q('create index on memories (visibility)');
  await q('create index on memories (sensitivity)');
  await q('create index on memories using gin (entity_ids)');
  await q('create index on memories using gin (content_tsv)');
  await q('grant select on memories to authenticated');
  await q('alter table memories enable row level security');
}

// Built AFTER the corpus is loaded so the HNSW graph is dense (building it empty then
// inserting 50k rows produces a poor graph and a misleading scan time).
export async function createHnsw(): Promise<void> {
  await q(
    'create index memories_embedding_hnsw on memories using hnsw (embedding vector_cosine_ops)',
  );
}

// The clearance-before-ranking policy, in one of two modes. WRAPPED = the AF-067 rule
// (helper wrapped in `(select …)` → per-statement initPlan). BARE = the footgun (helper
// called directly → re-evaluated per row). Same predicate, same table; we swap them to
// measure the cliff.
export type PolicyMode = 'wrapped' | 'bare';

function predicate(mode: PolicyMode): string {
  const w = (call: string) => (mode === 'wrapped' ? `(select ${call})` : call);
  // visibility ∩ sensitivity ∩ Restricted, + aal2 baseline (rls-policies.md rule 5).
  // Membership uses the array-containment operator `array[x] <@ <arr>` rather than
  // `x = any(<arr>)`: with a `(select …)` scalar subquery, `= any(subquery)` would be
  // parsed as the subquery-ANY form (comparing text = text[]). `<@` keeps the initPlan
  // wrapping and types correctly.
  return `
        array[visibility]  <@ ${w('user_visibility(auth.uid())')}
    and array[sensitivity] <@ ${w('user_clearances(auth.uid())')}
    and (sensitivity <> 'restricted' or entity_ids && ${w('user_restricted(auth.uid())')})
    and ${w('user_aal()')} = 'aal2'
  `;
}

export async function setPolicy(mode: PolicyMode): Promise<void> {
  await q('drop policy if exists memories_clearance on memories');
  await q(`
    create policy memories_clearance on memories
      for select to authenticated
      using (${predicate(mode)});
  `);
}

// Convenience for the once-per-statement / cliff EXPLAIN comparison.
export async function withPolicy<T>(
  mode: PolicyMode,
  fn: () => Promise<T>,
): Promise<T> {
  await setPolicy(mode);
  return fn();
}

export type PgClient = pg.PoolClient;
