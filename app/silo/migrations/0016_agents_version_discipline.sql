-- Migration 0016 — agents version-chain integrity (ISSUE-061 item D). Additive. #1 knowledge integrity.
--
-- REG.004 requires the agents version chain be append-only: an edit inserts a NEW version row (version =
-- prior+1, previous_version_id = prior.id); a prior version's lineage is never destroyed or rewritten. The
-- live adapter only ever INSERTs, and the app-side PermChecker + the 0002 default_deny RLS floor already gate
-- writes -- this trigger is the belt-and-suspenders DB floor for the service_role bypass path (mirrors
-- 0004_prompt_version_discipline for prompt_layers).
--
-- SCOPE (scope-honest, Rule 0): this migration freezes the UNAMBIGUOUS version-lineage columns (id, version,
-- previous_version_id, change_reason, created_at, created_by) and forbids DELETE. It does NOT yet freeze the
-- content columns (description / memory_scope / tools_allowed) into "edit == new version", because the agents
-- edit lifecycle (is an enable/disable toggle or a capability edit an in-place UPDATE or a version bump?) is
-- pinned by the agent-builder surface (ISSUE-067, build-order step 8) + OD-080's authority split, not here.
-- The `enabled` routing toggle (REG.005) is therefore left mutable in place. When 067 lands, extend this
-- trigger (or add the OD-080-split RLS write policy) to force capability edits through the version chain.
--
-- transactional:true -- do NOT add BEGIN/COMMIT. Re-runnable (create or replace + drop-if-exists).

create or replace function public.enforce_agents_version_lineage() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- A prior version is knowledge about what the agent was + why it changed -- never destroy it (#1). A
    -- rollback is a NEW version, never a delete.
    raise exception 'agents: DELETE forbidden (append-only by version; rollback creates a new version) -- FR-8.REG.004';
  end if;

  -- UPDATE: the version-lineage identity of an existing row is immutable. An "edit" is an INSERT of a NEW
  -- version (higher version, previous_version_id link) -- never an in-place rewrite of these columns.
  if new.id is distinct from old.id
     or new.version is distinct from old.version
     or new.previous_version_id is distinct from old.previous_version_id
     or new.change_reason is distinct from old.change_reason
     or new.created_at is distinct from old.created_at
     or new.created_by is distinct from old.created_by then
    raise exception 'agents: version-lineage columns are immutable (id/version/previous_version_id/change_reason/created_at/created_by) -- edit = a new version (FR-8.REG.004 / #1)';
  end if;

  return new;
end $$;

create or replace trigger trg_agents_version_lineage
  before update or delete on agents
  for each row execute function public.enforce_agents_version_lineage();
