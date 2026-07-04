-- Canary target schema 0001 — the MINIMAL landing schema the live canary seed writes into.
--
-- SCOPE NOTE (Rule 0 — read before assuming this is the product schema): this is a THROWAWAY,
-- canary-only precondition, created to give the live SupabaseSeed (FR-10.PRV.003 live half) a target
-- during the AF-004 provisioning run. It is the exact analogue of app/management/0001_client_registry.sql:
-- ISSUE-007 §8 authorizes standing up the minimal precondition a provisioning step needs, WITHOUT
-- owning the real DDL. The real per-silo schema — entities/memories with pgvector + HNSW, RLS
-- (default-deny), the entity_ids trigger, the expand-contract embedding_v2 slot, and the product's
-- own (chat) `messages` table — is owned by ISSUE-008 (the 0001 baseline) + spec/04-data-model/.
-- When ISSUE-008's baseline migration runs, RESET this canary silo first (drop these tables) and let
-- the real baseline own them. Do NOT treat this file as schema source of truth (that is schema.md).
--
-- Deliberately minimal vs schema.md §entities/§memories:
--   • text columns instead of the real enums (memory_type/…): a throwaway target needs no enum wiring.
--   • NO RLS: this silo holds only synthetic corpus data; default-deny RLS is ISSUE-009's gate (#2).
--     Flagged, not silent — recorded in ISSUE-007 §10 + the seed evidence file.
--   • The corpus `messages` are COMMS (email/slack/ghl_sms), which do NOT map to the product's chat
--     `messages` table (schema.md §11). This canary table mirrors the fixture's comms shape only.
-- Idempotent (create … if not exists / unique idempotency_key) so a re-apply + re-seed converge.

create extension if not exists vector;

create table if not exists entities (
  id              uuid primary key,
  type            text not null,
  name            text not null,
  is_internal_org boolean not null default false,   -- singleton per deployment (FR-2.ENT.003)
  created_at      timestamptz not null default now()
);

-- Canary comms corpus (email/slack/ghl_sms) — the routing/known-answer fixtures. NOT the product
-- chat `messages` table (schema.md §11); named per the corpus vocabulary on this throwaway silo.
create table if not exists messages (
  id             uuid primary key,
  channel        text not null,
  from_entity_id uuid,
  subject        text,
  body           text not null,
  entity_ids     uuid[] not null,
  created_at     timestamptz not null default now()
);

create table if not exists memories (
  id              uuid primary key,
  type            text not null,
  content         text not null,
  embedding       vector(1536) not null,                          -- OpenAI text-embedding-3-small (never null — FR-2.WRT.007)
  embedding_model text not null default 'text-embedding-3-small',
  entity_ids      uuid[] not null,
  source          text not null,
  confidence      numeric(4,3),                                   -- 0–1; null only for system_pointer
  visibility      text not null,
  sensitivity     text not null,
  idempotency_key text not null unique,                           -- DB-level idempotency: retried seed = no-op (ON CONFLICT DO NOTHING; ADR-004 §4)
  created_at      timestamptz not null default now(),
  check (cardinality(entity_ids) >= 1),                           -- ≥1 entity (AC-2.MEM.002.2)
  check (source = 'system_pointer' or confidence is not null)     -- confidence required unless a pointer
);
