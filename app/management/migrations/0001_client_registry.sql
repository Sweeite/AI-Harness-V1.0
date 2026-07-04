-- Management-plane migration 0001 — client_registry (+ client_status enum)
--
-- SCOPE NOTE (Rule 0): ISSUE-012 (FR-10.MGT.001) owns the client_registry table's full lifecycle —
-- status transition machinery + internal_token rotate/revoke. This migration creates ONLY the table
-- + enum, as the minimal precondition ISSUE-007 §8 explicitly authorizes sequencing first ("at
-- minimum its client_registry DDL"), so the provisioning INSERT (FR-10.PRV.001) has a target during
-- the AF-004 run. The column set is copied verbatim from spec/04-data-model/schema.md §13 — do NOT
-- diverge here; that file is the schema source of truth. When ISSUE-012 builds, it OWNS this table.
--
-- This lives in the MANAGEMENT-PLANE database (operator-owned), NOT a client silo. secret_manifest
-- is a per-silo table (client's own Supabase) and is intentionally not created here.

create type client_status as enum ('initialising', 'active', 'offboarding', 'frozen');

create table client_registry (
  id                       uuid primary key default gen_random_uuid(),
  client_slug              text not null unique,             -- the ONLY valid client_slug in the product
  client_name              text not null,
  railway_url              text,
  internal_token           text not null,                    -- encrypted; never returned to a surface
  core_version             text,                             -- push-updated (FR-7.MGM.001)
  region                   text not null default 'ap-southeast-2',
  status                   client_status not null default 'initialising',  -- server-authoritative
  created_at               timestamptz not null default now(),
  offboarding_initiated_at timestamptz,
  offboarding_at           timestamptz
);
