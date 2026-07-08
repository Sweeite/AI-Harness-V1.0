-- Management-plane migration 0004 — offboarding_records + the offboarding workflow state + two-person deletion auth
-- (ISSUE-083, C10 OFF). Hand-applied to the MANAGEMENT DB (no journal/runner — the mgmt plane is operator-owned;
-- ADR-001 §7). Apply: psql "$MGMT_DATABASE_URL" -f app/management/migrations/0004_offboarding_records.sql
--
-- ⚠️ AUTHORED, NOT YET APPLIED (offline overnight build, Session 79). Mgmt head was 0003_backup_dr.
--
-- WHY: FR-10.OFF.006 needs the offboarding compliance meta-record on the management plane; FR-10.OFF.005.4 needs the
-- per-step progress written there BEFORE each destructive step (crash-resumable, evidence never lost). schema.md §13
-- defines `offboarding_records` but NO migration created it yet (verified Session 79). This creates it + the
-- workflow-state machine + the NFR-SEC.015 two-person deletion auth (mirroring the client-side deletion_requests
-- three-distinct-identity CHECK) — enforced at the DB layer so a single person can never both authorise and execute
-- the sensitive deletion (#2).
--
-- DESIGN NOTE (Rule 0): the fine-grained offboarding states `freeze_pending` (AC-10.OFF.004.5) and `deletion_failed`
-- (AC-10.OFF.005.2) are tracked HERE as an offboarding_records.workflow_state enum, NOT as new client_status values —
-- client_status stays the four server-authoritative values ('initialising','active','offboarding','frozen') that the
-- C5 dispatch gate reads (OD-162); overloading it with workflow sub-states would leak build-internal state into the
-- dispatch contract. The workflow_state is the C10 offboarding machine; client_registry.status is the coarse public state.

create type offboarding_workflow_state as enum (
  'initiated',        -- Step 1: Super-Admin trigger fired (client_registry.status → offboarding)
  'export_verified',  -- Step 2: full export generated + row-count/checksum reconciled PASS (fail-closed gate)
  'delivered',        -- Step 2: encrypted time-limited link delivered
  'acknowledged',     -- Step 2: client signed off receipt (export_acknowledged_at) — gates the retention clock
  'frozen',           -- Step 3: retention freeze confirmed (deployment_settings.frozen_at written to the client silo)
  'freeze_pending',   -- Step 3 fail-safe: the cross-project freeze write could not be confirmed (retry+escalate)
  'deleting',         -- Step 4: hard-delete + deprovision sequence in progress
  'deletion_failed',  -- Step 4 fail-safe: a sub-step failed → never marked complete, no auto-rollback, escalated
  'completed'         -- Step 5: compliance meta-record written; the sequence is airtight-complete
);

create table offboarding_records (                            -- mgmt DB; NO client business data (compliance evidence only)
  id                        uuid primary key default gen_random_uuid(),
  client_slug               text not null references client_registry(client_slug),
  workflow_state            offboarding_workflow_state not null default 'initiated',
  -- the nine FR-10.OFF.006 meta-record fields (offboarding_at is client_registry's; here it is offboarding_initiated_at):
  offboarding_initiated_at  timestamptz,
  export_delivered_at       timestamptz,
  export_acknowledged_at    timestamptz,
  retention_window_end      timestamptz,
  deletion_executed_at      timestamptz,
  deletion_executed_by      uuid,
  systems_deprovisioned     text[] not null default '{}',      -- Supabase/Railway/credentials/tokens/backup — appended as each completes
  tokens_revoked            text[] not null default '{}',
  -- export verification evidence (FR-10.OFF.002): the reconciliation result that gated destruction.
  export_verified_at        timestamptz,
  export_row_counts         jsonb,                             -- per-table {live, exported} — the reconciliation proof
  -- NFR-SEC.015 two-person auth on the Step-4 sensitive deletion (mirrors deletion_requests' three-distinct pattern):
  deletion_authorized_by    uuid,
  deletion_second_authoriser uuid,                             -- ≠ authorized_by, ≠ executor
  -- backup purge (FR-10.OFF.005.6): raised at Step 4, tracked until the off-platform destination confirms purge.
  backup_purge_flagged_at   timestamptz,
  backup_purge_confirmed_at timestamptz,
  freeze_pending_since      timestamptz,                       -- set while a freeze write is unconfirmed (AC-10.OFF.004.5)
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  -- two-person auth: three DISTINCT non-null identities before a deletion can be marked executed (#2).
  -- NULL-PERMISSIVE pairwise `<>` (NOT `is distinct from`): `a <> b` evaluates to NULL when either side is NULL, and
  -- a CHECK passes on NULL — so the Step-1 insert (both auth fields NULL) and any partial pre-fill are ALLOWED, while
  -- two SAME non-null people evaluate to FALSE and are REJECTED. (`is distinct from` would return FALSE for the
  -- both-NULL initial row and wrongly reject the very first insert — the deletion_requests comment's "allows pre-fill
  -- nulls" intent is only actually delivered by plain `<>`.) The all-non-null-at-executed CHECK closes the gate.
  check (deletion_authorized_by <> deletion_second_authoriser),
  check (deletion_executed_by <> deletion_authorized_by),
  check (deletion_executed_by <> deletion_second_authoriser),
  check (deletion_executed_at is null
         or (deletion_authorized_by is not null and deletion_second_authoriser is not null and deletion_executed_by is not null))
);
create unique index offboarding_records_client_uniq on offboarding_records (client_slug);  -- one offboarding per client
