-- Client-silo migration 0004 — PROMPT VERSION DISCIPLINE + prompt_layers RLS (ISSUE-042)
--
-- SCOPE (Rule 0 + the 008/009/042 boundary): 0001_baseline ALREADY created the prompt_layer_kind enum
-- and the prompt_layers + dynamic_field_values tables (verify-present, not re-create — ISSUE-042 §8
-- steps 1-2). 0001c ENABLED RLS + REVOKEd baseline grants; 0002 stood up the ADR-006 RLS substrate (the
-- four SECURITY DEFINER helpers + the `default_deny` PERMISSIVE-false floor on every table, incl.
-- prompt_layers). THIS migration is the ADDITIVE version-discipline layer ISSUE-042 owns:
--   (1) a BEFORE INSERT OR UPDATE OR DELETE trigger on prompt_layers that makes the table
--       APPEND-ONLY-BY-VERSION at the DB (schema.md §"Global rules"): no in-place mutation of an existing
--       version's content/layer/agent_id/version, no DELETE, and a non-empty change_reason on every row
--       (FR-4.STO.003). This is the belt to the app-code's braces (supabase-store never UPDATEs content)
--       so even a rogue path fails LOUD (#1 never lose knowledge · #3 never fail silently).
--   (2) an RLS read/write policy on prompt_layers, `TO authenticated`, gated on PERM-prompt.edit, that
--       OR-composes on top of the 0002 `default_deny` floor (permissive policies OR — rls-policies.md).
--       Every helper/auth call is `(select …)`-wrapped so it evaluates once per statement (AF-067;
--       auth_rls_initplan / AC-1.RLS.002.2), exactly the idiom src/rls-lint.ts enforces.
--
-- NOT here (Rule 0 — other slices own these):
--   * agents.system_prompt removal/derivation — C8 / ISSUE-061 (this slice only never depends on it).
--   * PERM-prompt.edit_principles + the principles floor — ISSUE-043; the node lands in C1 (ISSUE-018).
--   * The dynamic_field_values declaration/staleness semantics — ISSUE-044.
--   * The service_role agent/background path BYPASSES RLS by design (ADR-006 part 6) — the policy below is
--     `TO authenticated`; containment on the service path is harness RBAC + memory_scope (C8), not RLS.
--
-- ⚠️ NOT YET RUN LIVE. ISSUE-042 is an offline build; applying this to a silo + the live capstone
-- (results/issue-042-capstone.sql) is the Stage-2 checkpoint, run by the operator.
--
-- The runner wraps this file in a transaction (transactional:true in _journal.json) — do NOT add
-- BEGIN/COMMIT. Every statement is re-runnable (migrations.md hard constraint): the function via
-- `create or replace`, the trigger via a drop-if-exists+create, the policy via a pg_policies guard.

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. Version-discipline trigger (append-only-by-version — schema §"Global rules" / FR-4.STO.003)
-- ══════════════════════════════════════════════════════════════════════════════
-- search_path pinned to '' so a same-named object cannot shadow references (Supabase advisor hardening).
-- Fires regardless of role (incl. service_role) — the append-only guarantee cannot be bypassed by the
-- RLS-exempt writer, mirroring the audit-sink immutability idiom (schema.md §"Immutability enforcement").

create or replace function public.enforce_prompt_version_discipline() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- A prior version is knowledge about why/what changed — never destroy it (#1). Rollback is a NEW
    -- version equal to K (FR-4.STO.004), never a delete.
    raise exception 'prompt_layers: DELETE forbidden (append-only-by-version; rollback creates a new version, never deletes) — FR-4.STO.003/004';
  end if;

  if tg_op = 'UPDATE' then
    -- The identity + content of an existing version are immutable. An "edit" is an INSERT of a NEW row
    -- (higher version, previous_version_id link) — never an in-place mutation of these columns.
    if new.content is distinct from old.content
       or new.name is distinct from old.name
       or new.layer is distinct from old.layer
       or new.agent_id is distinct from old.agent_id
       or new.version is distinct from old.version
       or new.previous_version_id is distinct from old.previous_version_id
       or new.change_reason is distinct from old.change_reason
       or new.created_at is distinct from old.created_at
       or new.created_by is distinct from old.created_by then
      raise exception 'prompt_layers: in-place edit of a versioned row is forbidden (append-only-by-version) — insert a NEW version instead (FR-4.STO.003)';
    end if;
    -- Only `enabled` may flip in place (retire/re-enable an asset without a content change); that is not a
    -- knowledge-losing mutation. Everything else above is frozen.
    return new;
  end if;

  -- INSERT: every version row must carry a non-empty change_reason (mandatory reason — FR-4.STO.003).
  -- `text not null` already blocks NULL; this blocks empty/whitespace (AC-4.STO.003.2).
  if new.change_reason is null or btrim(new.change_reason) = '' then
    raise exception 'prompt_layers: change_reason is mandatory and must be non-empty (FR-4.STO.003 / AC-4.STO.003.2)';
  end if;
  return new;
end $$;

-- CREATE OR REPLACE TRIGGER (PG14+, silo is PG17) — idempotent + re-runnable with NO destructive DROP,
-- so it passes the expand-contract discipline gate (AC-NFR-INF.002.1; a bare `drop trigger` is a
-- destructive change reserved for a *_contract migration).
create or replace trigger t_prompt_version_discipline
  before insert or update or delete on public.prompt_layers
  for each row execute function public.enforce_prompt_version_discipline();

-- Belt-and-braces: 0001c already did `revoke all ... from anon, authenticated` on prompt_layers, so
-- `authenticated` holds no DELETE to begin with — this restated revoke is a documentation-of-intent no-op
-- (harmless, idempotent). The REAL DELETE guard is the trigger above, which fires for EVERY role incl.
-- service_role (a revoked privilege only means a DELETE never reaches the trigger; the trigger is what makes
-- the guarantee role-independent). service_role keeps its INSERT grant for the edit/rollback (new-version) path.
revoke delete on public.prompt_layers from authenticated;

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. prompt_layers RLS policy (PERM-prompt.edit gate — FR-4.STO.005, composes on 0002 default_deny)
-- ══════════════════════════════════════════════════════════════════════════════
-- A PERMISSIVE policy OR-ing with the 0002 `default_deny` floor: a caller who holds PERM-prompt.edit may
-- read/write prompt_layers; everyone else falls through to the deny floor (default-deny — rbac.md rule 1).
-- The permission lookup is `(select public.user_perms(auth.uid())) @> array['PERM-prompt.edit']` — the
-- `(select …)` wrapper forces once-per-statement evaluation (AF-067; the exact idiom rls-lint.ts checks).
--
-- NOTE (Rule 0): FR-4.STO.005 grants prompt-content editing to Super Admin AND Admin via PERM-prompt.edit;
-- the higher PERM-prompt.edit_principles (Super-Admin-only, principles block) is ISSUE-043's and is NOT
-- referenced here. View-history / rollback (PERM-prompt.view_history / .rollback) are enforced at the
-- harness/store layer (src/rbac.ts) over the same authenticated read this policy authorizes — they are
-- read-shape refinements of the SELECT, not separate table policies.
-- idempotent: CREATE POLICY has no IF NOT EXISTS — guard on pg_policies (re-runnable, migrations.md).

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'prompt_layers' and policyname = 'prompt_edit'
  ) then
    create policy prompt_edit on public.prompt_layers
      as permissive for all to authenticated
      using ((select public.user_perms(auth.uid())) @> array['PERM-prompt.edit'])
      with check ((select public.user_perms(auth.uid())) @> array['PERM-prompt.edit']);
  end if;
end $$;

-- Grant the base SELECT + INSERT privileges back to `authenticated` (0001c did a blanket `revoke all`). RLS
-- FILTERS rows; it does not GRANT table access — without this the prompt_edit policy above is unreachable
-- ("permission denied" before RLS runs). The human edit path is RLS-gated (rls-policies.md L66: PERM-prompt.edit),
-- so a PERM-holder may read the store and INSERT a new version; UPDATE/DELETE stay blocked (the version-discipline
-- trigger + the `revoke delete` above) so an "edit" can only ever be a new-version INSERT. service_role reads at
-- assembly (RLS-exempt). (aal2 baseline + full predicates → ISSUE-020.)
grant select, insert on public.prompt_layers to authenticated;
