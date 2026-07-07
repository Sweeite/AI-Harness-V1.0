-- Management-plane migration 0003 — operator-side backup & DR log (ISSUE-085 / ADR-008). Additive.
--
-- SCOPE NOTE (Rule 0 / mgmt-plane boundary, mirroring 0002's header): this lives in the MANAGEMENT-PLANE
-- database (operator-owned, ai-harness-mgmt), NOT a client silo, and NEVER touches app/silo/migrations. The
-- management chain has no _journal.json / discipline runner — the ORCHESTRATOR applies these files live
-- against the operator-owned mgmt Supabase (the 💻 you-present half). This file exists so the live pg/CLI
-- adapter (app/backup-dr/src/backup-dr-live.ts) has a concrete DDL to be authored to; the offline suite
-- proves the LOGIC against the in-memory reference model.
--
-- It is the operator-side backup log the BackupDrStore port models: recovery posture per silo, the logged
-- downgrade exceptions (NFR-DR.001 — a below-hourly move is never a silent default), the hourly off-platform
-- snapshot log (NFR-DR.002), the tested restore-rehearsal evidence (NFR-DR.003/005), and the compliance
-- off-platform purge-flag receive-leg (NFR-DR.009). The five backup-health FIELDS ride the existing
-- deployment_health.backup_health jsonb (ISSUE-012 / schema.md §13) — NO column added there.

create type recovery_tier      as enum ('daily_in_project', 'hourly_off_platform', 'pitr');   -- ≡ config-registry §M
create type dr_project_status   as enum ('active', 'paused', 'billing_at_risk');
create type rehearsal_result    as enum ('passed', 'failed');
create type rehearsal_trigger   as enum ('monthly', 'migration-release', 'manual');

create table silo_backup_posture (
  client_slug     text primary key references client_registry(client_slug),
  recovery_tier   recovery_tier not null default 'hourly_off_platform',   -- NFR-DR.001 default (never below hourly silently)
  destination     jsonb,                                                  -- OffPlatformDestination (NFR-DR.002)
  project_status  dr_project_status not null default 'active',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
-- NFR-DR.001: a move to 'daily_in_project' (below hourly) MUST record a backup_downgrade_log row -- enforced
-- app-side by setRecoveryTier (refuses the move without a logged reason; proven in app/backup-dr tests).

create table backup_downgrade_log (                                       -- NFR-DR.001 logged downgrade exceptions
  id          uuid primary key default gen_random_uuid(),
  client_slug text not null references silo_backup_posture(client_slug),
  from_tier   recovery_tier not null,
  to_tier     recovery_tier not null,
  reason      text not null,
  logged_by   text not null,                                              -- Super Admin actor (PERM-config.infra)
  at          timestamptz not null default now()
);

create table off_platform_snapshot_log (                                  -- NFR-DR.002 hourly off-platform copies
  snapshot_id text primary key,
  client_slug text not null references silo_backup_posture(client_slug),
  taken_at    timestamptz not null,
  destination jsonb not null,                                             -- client-owned / different-region / lifecycle-independent
  encrypted   boolean not null,                                           -- always true (NFR-SEC.017)
  size_bytes  bigint
);

create table restore_rehearsal_log (                                      -- NFR-DR.003 tested-restore evidence
  rehearsal_id             text primary key,
  client_slug              text not null references silo_backup_posture(client_slug),
  ran_at                   timestamptz not null,
  result                   rehearsal_result not null,
  restored_into            text not null,                                 -- THROWAWAY project ref (never prod)
  db_queryable             boolean not null,
  pgvector_memory_complete boolean not null,
  auth_rows_complete       boolean not null,
  measured_rto_seconds     numeric,                                       -- MEASURED (NFR-DR.005), null on fail
  trigger                  rehearsal_trigger not null,
  detail                   text not null
);

create table off_platform_purge_flag (                                    -- NFR-DR.009 receive-leg ledger
  flag_id              text primary key,                                  -- UNIQUE => idempotent receive
  client_slug          text not null references silo_backup_posture(client_slug),
  target_ref           text not null,                                     -- the erased target
  raised_at            timestamptz not null,                              -- when C2 erasure raised the flag
  erasure_effective_at timestamptz not null,
  status               text not null default 'open' check (status in ('open', 'cleared')),
  received_at          timestamptz not null,
  cleared_at           timestamptz,
  confirmed_by         text
);
