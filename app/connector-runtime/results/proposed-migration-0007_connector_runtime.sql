-- PROPOSED client-silo migration 0007 — C3 CONNECTOR RUNTIME + TOOL REGISTRY (ISSUE-032)
--
-- STATUS: PROPOSED — authored offline in the ISSUE-032 fan-out package (app/connector-runtime).
-- The orchestrator lands this into app/silo/migrations/0007_connector_runtime.sql + registers the tag
-- in _journal.json at integration time. It is authored to the schema.md §4 "Tools & Connectors (C3)"
-- DDL and §Types (tool_category, credential_state) as the single source of truth (Rule 0) — every
-- column/type/default/constraint below is transcribed VERBATIM from spec/04-data-model/schema.md;
-- do NOT diverge here. supabase-store.ts in this package is authored to exactly this DDL.
--
-- SCOPE (Rule 0 + the ISSUE-032 §2 in/out boundary): this migration creates the FOUR C3 tables +
-- their two enums, and lays the versioned-table discipline + registry-completeness triggers on `tools`.
-- It creates the SHELLS only for connector_credentials / rate_limit_tracker — the token-refresh LOGIC
-- (ISSUE-033), rate-limit BEHAVIOUR (ISSUE-034) and write-tool LIMITS (ISSUE-035) are OTHER slices and
-- are NOT here. idempotency_ledger is net-new and fully owned here (FR-3.CONN.004).
--
-- NOT here (Rule 0 — other slices / global migrations own these):
--   * The 0001 baseline extensions (pgcrypto for gen_random_uuid()) — assumed present (this is 0007).
--   * The 0002 default_deny RLS floor substrate + the four SECURITY DEFINER helpers — assumed present.
--   * Token refresh Layer-1/2/3 atomic rotate-persist (FR-3.TOK.*) — ISSUE-033.
--   * Rate-limit 80/95/429 tiers + backoff + halt-escalate (FR-3.RL.*) — ISSUE-034.
--   * The seven write-tool hard limits (FR-3.ACT.002) — ISSUE-035.
--
-- REG.004 / Global rule (schema.md §"Global rules" L15-19): NO `client_slug` (or any client-identity
-- column) on ANY of these four tables. Cross-client isolation is PHYSICAL (one Supabase per client,
-- ADR-001/006). None of the columns below is client_slug; no policy here filters by it (AC-3.REG.004.1).
--
-- ⚠️ NOT YET RUN LIVE. Applying this to a silo is a 💻 live-infra step owed to the operator session /
-- Checkpoint 3. The InMemoryConnectorRuntimeStore is the proven offline reference model.
--
-- The runner wraps this file in a transaction (transactional:true) — do NOT add BEGIN/COMMIT. Every
-- statement is re-runnable (migrations.md hard constraint): types via a pg_type guard, tables via
-- `create table if not exists`, the function via `create or replace`, triggers via `create or replace
-- trigger` (PG14+; the silo is PG17).

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. Types (schema.md §Types "Tools (C3)", L109-110) — verbatim, idempotent-guarded
-- ══════════════════════════════════════════════════════════════════════════════
do $$
begin
  if not exists (select 1 from pg_type where typname = 'tool_category') then
    create type tool_category as enum ('read','write');
  end if;
  if not exists (select 1 from pg_type where typname = 'credential_state') then
    create type credential_state as enum ('active','degraded','revoked','expired');
  end if;
end $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. Tables (schema.md §4 "Tools & Connectors (C3)", L390-438) — VERBATIM
-- ══════════════════════════════════════════════════════════════════════════════

-- tools — the registry. Versioned-by-version (Global rule): version + previous_version_id +
-- change_reason NOT NULL. `enabled=false` hides from AI selection without deleting history (FR-3.REG.001).
create table if not exists tools (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  description         text not null,                    -- non-empty (drives AI selection — FR-3.REG.002)
  category            tool_category not null,
  risk_level          text,
  requires_approval   boolean not null default false,
  connector           text not null,
  scopes              text[],
  config              jsonb not null default '{}',
  enabled             boolean not null default true,    -- false hides from AI, keeps history
  version             int not null default 1,
  previous_version_id uuid references tools(id),
  change_reason       text not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- connector_credentials — OAuth tokens (distinct from webhook_secrets). SHELL ONLY: the `state` enum
-- + shape the runtime reads; refresh logic is ISSUE-033. access_token/refresh_token are Vault-encrypted;
-- service_role decrypt only (ADR-008 in-DB → backed up).
create table if not exists connector_credentials (
  id            uuid primary key default gen_random_uuid(),
  connector     text not null,
  access_token  text not null,                          -- Vault-encrypted; service_role decrypt only
  refresh_token text,                                    -- Vault-encrypted
  expires_at    timestamptz,
  scopes        text[],
  state         credential_state not null default 'active',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- rate_limit_tracker — SHELL ONLY: the shape the runtime composes over; tier/backoff behaviour is
-- ISSUE-034. unique(connector, window_label) makes a window row a single authoritative counter.
create table if not exists rate_limit_tracker (
  id              uuid primary key default gen_random_uuid(),
  connector       text not null,
  window_label    text not null,                        -- e.g. ghl_burst_10s, ghl_daily
  window_start    timestamptz not null,
  window_duration interval not null,
  call_limit      int not null,
  calls_made      int not null default 0,
  reset_at        timestamptz not null,
  updated_at      timestamptz not null default now(),
  unique (connector, window_label)
);

-- idempotency_ledger — net-new (FR-3.CONN.004). The durable pre-call INTENT record: the runtime commits
-- a row keyed on the deterministic idempotency_key BEFORE the external call; a retry with the same key
-- collides on the PK and the prior `result` is returned instead of re-firing the external side effect.
-- A crash after the external call but before `result` is written leaves a row with result=NULL (intent
-- recorded, outcome unknown) — the retry path MUST NOT re-fire on such a row (AC-3.CONN.004.4): intent
-- alone suppresses the second effect. `result` is filled in-place once the call completes.
create table if not exists idempotency_ledger (
  idempotency_key text primary key,                      -- deterministic per external write
  connector       text not null,
  result          jsonb,
  created_at      timestamptz not null default now()
);

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. tools version-discipline + registry-completeness trigger
--    (schema.md §"Global rules" versioned-tables + FR-3.REG.001/003)
-- ══════════════════════════════════════════════════════════════════════════════
-- Mirrors the 0004 prompt_layers discipline exactly, at the tools grain:
--   * APPEND-ONLY-BY-VERSION: no in-place mutation of a version's identity/content columns; DELETE
--     forbidden (a prior version is knowledge — #1). Only `enabled` may flip in place (retire/re-enable).
--   * change_reason mandatory + non-empty on every version (FR-3.REG.003 / AC-3.REG.003.2).
--   * registry completeness (FR-3.REG.001 / AC-3.REG.001.1 / AC-3.CONN.001.1): description must be
--     non-empty (drives selection — an empty-description tool is unselectable, so it is not registrable).
-- Fires regardless of role (incl. service_role) — the guarantee cannot be bypassed by the RLS-exempt
-- writer, mirroring the audit-sink immutability idiom (schema.md §"Immutability enforcement").
create or replace function public.enforce_tool_version_discipline() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'tools: DELETE forbidden (append-only-by-version; retire via enabled=false, rollback creates a new version) — FR-3.REG.003';
  end if;

  if tg_op = 'UPDATE' then
    -- Identity + contract of an existing version are immutable. An "edit" is an INSERT of a NEW row
    -- (higher version, previous_version_id link) — never an in-place mutation of these columns.
    if new.name is distinct from old.name
       or new.description is distinct from old.description
       or new.category is distinct from old.category
       or new.risk_level is distinct from old.risk_level
       or new.requires_approval is distinct from old.requires_approval
       or new.connector is distinct from old.connector
       or new.scopes is distinct from old.scopes
       or new.config is distinct from old.config
       or new.version is distinct from old.version
       or new.previous_version_id is distinct from old.previous_version_id
       or new.change_reason is distinct from old.change_reason
       or new.created_at is distinct from old.created_at then
      raise exception 'tools: in-place edit of a versioned row is forbidden (append-only-by-version) — insert a NEW version instead (FR-3.REG.003)';
    end if;
    -- Only `enabled` (and its updated_at) may flip in place.
    return new;
  end if;

  -- INSERT: registry-completeness + mandatory change_reason.
  if new.description is null or btrim(new.description) = '' then
    raise exception 'tools: description is mandatory and must be non-empty (drives AI selection; no partially-defined tool) — FR-3.REG.001/002';
  end if;
  if new.change_reason is null or btrim(new.change_reason) = '' then
    raise exception 'tools: change_reason is mandatory and must be non-empty (FR-3.REG.003 / AC-3.REG.003.2)';
  end if;
  -- A non-initial version MUST link its predecessor (FR-3.REG.003 / AC-3.REG.003.1).
  if new.version > 1 and new.previous_version_id is null then
    raise exception 'tools: a version > 1 must set previous_version_id (append-only-by-version) — FR-3.REG.003';
  end if;
  return new;
end $$;

create or replace trigger t_tool_version_discipline
  before insert or update or delete on public.tools
  for each row execute function public.enforce_tool_version_discipline();

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. idempotency_ledger append-guard: the pre-call intent record is durable and never silently
--    overwritten (FR-3.CONN.004 / AC-3.CONN.004.4). The `result` column may be filled ONCE
--    (NULL → value); once a result is recorded it is frozen. The key itself never changes; a
--    duplicate key insert is a PK collision (the retry-suppression signal), never an overwrite.
-- ══════════════════════════════════════════════════════════════════════════════
create or replace function public.enforce_idempotency_ledger_immutable() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'idempotency_ledger: DELETE forbidden (the intent record is a #1/#3 durability guarantee)';
  end if;
  if new.idempotency_key is distinct from old.idempotency_key
     or new.connector is distinct from old.connector
     or new.created_at is distinct from old.created_at then
    raise exception 'idempotency_ledger: key/connector/created_at are immutable — only result may be filled once';
  end if;
  if old.result is not null and new.result is distinct from old.result then
    raise exception 'idempotency_ledger: result is write-once (already recorded) — a completed outcome cannot be rewritten';
  end if;
  return new;
end $$;

create or replace trigger t_idempotency_ledger_immutable
  before update or delete on public.idempotency_ledger
  for each row execute function public.enforce_idempotency_ledger_immutable();

-- ══════════════════════════════════════════════════════════════════════════════
-- 5. REG.004 reconciliation (AC-3.REG.004.1): NONE of the four C3 tables carries a client_slug column,
--    and NO policy here filters by client_slug. Isolation is physical (ADR-001/006). This is asserted
--    by the CI client_slug-absent lint (mirrors the C1 reconciliation) — no code lands here for it.
-- ══════════════════════════════════════════════════════════════════════════════
-- (intentionally no policy referencing client_slug — its ABSENCE is the assertion)
