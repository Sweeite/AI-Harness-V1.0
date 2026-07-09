// ISSUE-023 / AF-019 spike — the af019_-prefixed fixture: permission tables + the four SECURITY DEFINER STABLE helpers
// + the af019_memories table + the WRAPPED clearance-before-ranking RLS policy (the production AF-067 form, every helper
// call in a `(select …)`). Everything is prefixed so the spike is safe against the live silo (it never touches the real
// `memories`). The predicate is byte-identical in shape to ISSUE-002's (visibility ∩ sensitivity ∩ Restricted ∩ aal2).

import { q } from './db.js';
import { PROFILE } from './config.js';

const DIM = PROFILE.EMBED_DIM;

export async function createExtensions(): Promise<void> {
  await q('create extension if not exists vector');
}

export async function dropAll(): Promise<void> {
  await q('drop table if exists af019_memories cascade');
  await q('drop table if exists af019_centroids cascade');
  await q('drop table if exists af019_restricted_grants cascade');
  await q('drop table if exists af019_sensitivity_clearances cascade');
  await q('drop table if exists af019_user_roles cascade');
  await q('drop table if exists af019_role_permissions cascade');
  await q('drop table if exists af019_roles cascade');
  await q('drop table if exists af019_app_users cascade');
  for (const fn of [
    'af019_user_perms(uuid)',
    'af019_user_visibility(uuid)',
    'af019_user_clearances(uuid)',
    'af019_user_restricted(uuid)',
    'af019_user_aal()',
  ]) {
    await q(`drop function if exists ${fn} cascade`);
  }
}

// auth.uid() — on the silo Supabase's own function exists (reads request.jwt.claims->>'sub'); never clobber it.
export async function ensureAuthUid(): Promise<void> {
  await q(`
    do $$
    begin
      if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='auth' and p.proname='uid') then
        create schema if not exists auth;
        execute $f$ create function auth.uid() returns uuid language sql stable as $b$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub','')::uuid $b$ $f$;
        grant usage on schema auth to authenticated;
        grant execute on function auth.uid() to authenticated;
      end if;
    end $$;
  `);
}

export async function createPermTables(): Promise<void> {
  await q(`create table af019_app_users (id uuid primary key, aal text not null default 'aal2')`);
  await q(`create table af019_roles (id int primary key, name text not null, visibility text[] not null)`);
  await q(`create table af019_role_permissions (role_id int not null references af019_roles(id), perm text not null, primary key (role_id, perm))`);
  await q(`create table af019_user_roles (user_id uuid primary key references af019_app_users(id), role_id int not null references af019_roles(id))`);
  await q(`create table af019_sensitivity_clearances (user_id uuid not null references af019_app_users(id), sensitivity text not null, primary key (user_id, sensitivity))`);
  await q(`create table af019_restricted_grants (grantee_user_id uuid not null references af019_app_users(id), entity_id uuid not null, revoked_at timestamptz, primary key (grantee_user_id, entity_id))`);
  await q('create index on af019_role_permissions (role_id)');
}

export async function createHelpers(): Promise<void> {
  await q(`create function af019_user_perms(uid uuid) returns text[] language sql stable security definer set search_path=public as $$
    select coalesce(array_agg(rp.perm),'{}') from af019_user_roles ur join af019_role_permissions rp on rp.role_id=ur.role_id where ur.user_id=uid $$`);
  await q(`create function af019_user_visibility(uid uuid) returns text[] language sql stable security definer set search_path=public as $$
    select coalesce(r.visibility,'{}') from af019_user_roles ur join af019_roles r on r.id=ur.role_id where ur.user_id=uid $$`);
  await q(`create function af019_user_clearances(uid uuid) returns text[] language sql stable security definer set search_path=public as $$
    select coalesce(array_agg(sc.sensitivity),'{}') from af019_sensitivity_clearances sc where sc.user_id=uid $$`);
  await q(`create function af019_user_restricted(uid uuid) returns uuid[] language sql stable security definer set search_path=public as $$
    select coalesce(array_agg(rg.entity_id),'{}') from af019_restricted_grants rg where rg.grantee_user_id=uid and rg.revoked_at is null $$`);
  await q(`create function af019_user_aal() returns text language sql stable security definer set search_path=public as $$
    select coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'aal','aal1') $$`);
  for (const fn of ['af019_user_perms(uuid)', 'af019_user_visibility(uuid)', 'af019_user_clearances(uuid)', 'af019_user_restricted(uuid)', 'af019_user_aal()']) {
    await q(`grant execute on function ${fn} to authenticated`);
  }
}

export async function createMemories(): Promise<void> {
  await q(`
    create table af019_memories (
      id uuid primary key default gen_random_uuid(),
      content text not null,
      embedding vector(${DIM}) not null,
      entity_ids uuid[] not null,
      visibility text not null,
      sensitivity text not null,
      content_tsv tsvector generated always as (to_tsvector('english', content)) stored,
      created_at timestamptz not null default now()
    )`);
  await q('create index on af019_memories (visibility)');
  await q('create index on af019_memories (sensitivity)');
  await q('create index on af019_memories using gin (entity_ids)');
  await q('grant select on af019_memories to authenticated');
  await q('alter table af019_memories enable row level security');
}

// Built AFTER the corpus is loaded so the HNSW graph is dense — the DOCUMENTED params (FR-2.VEC.001 / indexes.md).
export async function createHnsw(): Promise<void> {
  await q(`create index af019_memories_embedding_hnsw on af019_memories using hnsw (embedding vector_cosine_ops) with (m = 16, ef_construction = 64)`);
}

// The WRAPPED clearance-before-ranking policy (the production AF-067 form). Membership uses `array[x] <@ (select …)`
// (not `= any`) so the scalar-subquery initPlan wrapping types correctly (ISSUE-002 note).
export async function setPolicy(): Promise<void> {
  await q('drop policy if exists af019_memories_clearance on af019_memories');
  await q(`
    create policy af019_memories_clearance on af019_memories
      for select to authenticated
      using (
            array[visibility]  <@ (select af019_user_visibility(auth.uid()))
        and array[sensitivity] <@ (select af019_user_clearances(auth.uid()))
        and (sensitivity <> 'restricted' or entity_ids && (select af019_user_restricted(auth.uid())))
        and (select af019_user_aal()) = 'aal2'
      )`);
}
