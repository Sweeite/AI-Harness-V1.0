-- Migration 0008 — connector-runtime discipline triggers (ISSUE-032, C3). Stage-3.
--
-- The `tools`, `connector_credentials`, `rate_limit_tracker`, `idempotency_ledger` TABLES + the
-- tool_category / credential_state enums already exist (0001_baseline.sql), and `tools` already carries the
-- versioned-table columns (version, previous_version_id, change_reason). This migration adds only the two
-- ENFORCEMENT triggers that were not in the baseline — genuinely additive (verified absent from 0001–0007):
--   1. tools version-discipline + registry-completeness (FR-3.REG.001/003) — mirrors the 0004 prompt_layers
--      discipline at the tools grain.
--   2. idempotency_ledger write-once immutability (FR-3.CONN.004 / AC-3.CONN.004.4).
-- Both fire regardless of role (incl. the RLS-exempt service_role writer), mirroring the audit-sink
-- immutability idiom — the guarantee cannot be bypassed. transactional:true; create-or-replace = idempotent.

-- 1. tools version-discipline + registry-completeness (schema.md §Global rules versioned-tables).
--    APPEND-ONLY-BY-VERSION: a prior version is knowledge (#1). Only `enabled`/`updated_at` may flip in place;
--    an "edit" is an INSERT of a new version row. change_reason + non-empty description mandatory on insert.
create or replace function public.enforce_tool_version_discipline() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'tools: DELETE forbidden (append-only-by-version; retire via enabled=false, rollback creates a new version) — FR-3.REG.003';
  end if;

  if tg_op = 'UPDATE' then
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
    return new;                                        -- only enabled / updated_at may flip in place
  end if;

  -- INSERT: registry-completeness + mandatory change_reason.
  if new.description is null or btrim(new.description) = '' then
    raise exception 'tools: description is mandatory and must be non-empty (drives AI selection; no partially-defined tool) — FR-3.REG.001/002';
  end if;
  if new.change_reason is null or btrim(new.change_reason) = '' then
    raise exception 'tools: change_reason is mandatory and must be non-empty (FR-3.REG.003 / AC-3.REG.003.2)';
  end if;
  if new.version > 1 and new.previous_version_id is null then
    raise exception 'tools: a version > 1 must set previous_version_id (append-only-by-version) — FR-3.REG.003';
  end if;
  return new;
end $$;

create or replace trigger t_tool_version_discipline
  before insert or update or delete on public.tools
  for each row execute function public.enforce_tool_version_discipline();

-- 2. idempotency_ledger append-guard: the pre-call intent record is durable and never silently overwritten
--    (FR-3.CONN.004 / AC-3.CONN.004.4). `result` may be filled ONCE (NULL → value); the key/connector/created_at
--    are immutable; a duplicate-key insert is a PK collision (the retry-suppression signal), never an overwrite.
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
