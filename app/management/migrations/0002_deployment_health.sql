-- PROPOSED management-plane migration — deployment_health (+ ingest_deliveries dedup) + client_registry
-- lifecycle columns. ISSUE-012 (FR-10.MGT.002 / FR-7.MGM.001-005 / NFR-OBS.006).
--
-- SCOPE NOTE (Rule 0 / ISSUE-012 boundaries): this is a PROPOSAL, authored to the schema.md §13 DDL. It is
-- NOT added to app/management/migrations/ nor to any journal — the ORCHESTRATOR integrates it into the
-- management-plane migration chain and APPLIES it live against the operator-owned mgmt Supabase (the 💻
-- you-present half). This file exists so the live pg adapter (src/supabase-store.ts) has a concrete DDL to
-- be authored to; the offline suite proves the LOGIC against the in-memory reference model.
--
-- This lives in the MANAGEMENT-PLANE database (operator-owned), NOT a client silo. It NEVER touches
-- app/silo/migrations. deployment_health is push-fed operational metadata ONLY (ADR-001 §7) — no
-- business-data column exists here by construction (the allow-list boundary made physical).
--
-- Numbering: the next free tag after 0001_client_registry in the management chain is 0002_* — the
-- orchestrator assigns the final tag when integrating (kept as a proposal here so no journal drift).

-- ── client_registry lifecycle columns ISSUE-012 owns (extend 0001; expand-only) ─────────────────────
-- token_id correlates the mgmt-DB copy with the deployment's Railway-env copy across a rotation; token_active
-- gates authentication (a revoked token can no longer authenticate — AC-10.MGT.004.3). internal_token stays
-- encrypted-at-rest (0001 already declares it; the app serialises the AEAD {ciphertext,iv,tag} into it).
alter table client_registry
  add column if not exists token_id     uuid    not null default gen_random_uuid(),
  add column if not exists token_active boolean not null default true;

-- ── deployment_health — the push-fed operational-metadata store (schema.md §13) ─────────────────────
-- PK = client_slug → client_registry(client_slug) (FK). One row per deployment, upserted on each push.
-- last_push_at is stamped by the DB clock (now()) at ingest — SERVER-authoritative (AF-120), never the
-- reporter's asserted timestamp. There is deliberately NO status column here — status is server-authoritative
-- on client_registry (OD-162); a push never writes it.
create table if not exists deployment_health (
  client_slug          text primary key references client_registry (client_slug) on delete cascade,
  health_score         numeric,                      -- 0..1 operational health rollup
  queue_depth          integer,
  approval_queue_depth  integer,
  alert_counts         jsonb,                        -- {kind: count} operational rollup (counts ONLY, no text)
  core_version         text,
  last_migrated_at     timestamptz,
  connector_rollup     jsonb,                        -- per-connector operational status rollup (no payloads)
  cost_to_date         numeric,                      -- estimate-grade (ADR-003); UI always labels "estimate"
  plugin_version       text,
  backup_health        jsonb,                        -- Supabase Management API rollup (ADR-008); infra-plane
  log_write_failing    boolean not null default false, -- the deployment's own log-write health (#3 posture)
  last_push_at         timestamptz not null default now(), -- server-authoritative freshness anchor (AF-120)
  updated_at           timestamptz not null default now()
);

-- ── ingest_deliveries — idempotency ledger (dedup on re-delivery) ────────────────────────────────────
-- A replayed push (same delivery_id) must be a no-op, never a double-count (AC-10.MGT.002.x). UNIQUE on
-- (client_slug, delivery_id); the ingest INSERT ... ON CONFLICT DO NOTHING tells fresh-vs-replay by rowCount.
create table if not exists ingest_deliveries (
  client_slug  text not null references client_registry (client_slug) on delete cascade,
  delivery_id  text not null,
  received_at  timestamptz not null default now(),
  primary key (client_slug, delivery_id)
);

-- NOTE for the orchestrator's live capstone (results/live-owed.md):
--   • prove the migration applies clean under the mgmt chain (expand-only)
--   • prove ingest authenticates a real internal_token push and upserts deployment_health with a server
--     last_push_at (AF-120)
--   • prove the staleness sweep flips a silent deployment stale on server time (AF-118 heartbeat + AF-120)
--   • prove a rotation dual-updates (mgmt DB + Railway env) and a revoked token can no longer authenticate
--   • assert client_slug lives ONLY on management-plane tables (absent from every client-silo app table)
