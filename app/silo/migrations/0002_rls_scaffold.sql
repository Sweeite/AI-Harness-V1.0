-- Client-silo migration 0002 — RLS SCAFFOLD (ISSUE-009)
--
-- SCOPE (Rule 0 + the 008/009 boundary): 0001c ENABLED row-level security + REVOKEd the baseline
-- grants on every silo table (default-deny by absence of policy). THIS migration stands up the
-- ADR-006 RLS *substrate* that every downstream enforcement slice inherits:
--   (1) the four SECURITY DEFINER STABLE permission-lookup helper functions (rls-policies.md L26-40),
--   (2) an EXPLICIT default-deny baseline POLICY on every application table — so no table is reachable
--       without an explicit policy decision AND the 100%-coverage lint has a policy to count
--       (FR-1.RLS.001 / AC-1.RLS.001.1),
--   (3) a tail coverage assertion: every public base table has RLS enabled + >=1 policy, fail LOUD
--       otherwise (the runtime #2/#3 form of AC-NFR-SEC.010.1; the CI/text form is src/rls-lint.ts).
--
-- NOT here (Rule 0 — deferred by ISSUE-009 §2 "Out"):
--   * The per-table SENSITIVITY predicates (visibility ∩ sensitivity ∩ Restricted, the aal2 clause,
--     mid-task re-check) that COMPOSE on top of this baseline — ISSUE-020 (FR-1.RLS.002 full predicate
--     /.003/.005/.007/.008). ISSUE-020 adds `as permissive` reads that OR with the default_deny floor
--     below with NO re-author of the helpers or the baseline.
--   * `user_visibility` (rls-policies.md L32, OD-169) — its visibility-tier predicate is ISSUE-020's;
--     ISSUE-009 authors only the four helpers its §5 Touches names.
--   * The harness `can()` gate (ISSUE-018), the clearance/Restricted grant flows (ISSUE-019).
--
-- The agent / background path runs as `service_role`, which BYPASSES RLS by design (ADR-006 part 6 /
-- rls-policies.md L9-14). These policies are therefore `TO authenticated` — they never touch the
-- service_role path. Containment there is harness RBAC + per-agent memory_scope (C8), not RLS
-- (FR-1.RLS.004). No requirement may assume RLS guards a service_role write.
--
-- The runner wraps this file in a transaction (transactional:true in _journal.json) — do NOT add
-- BEGIN/COMMIT. Every statement is re-runnable (migrations.md hard constraint): functions via
-- `create or replace`, policies via a pg_policies existence guard.

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. Helper functions (SECURITY DEFINER, STABLE — invoked as `(select fn(auth.uid()))`)
-- ══════════════════════════════════════════════════════════════════════════════
-- Each is SECURITY DEFINER (reads the permission tables regardless of the caller's own RLS — the caller
-- is `authenticated`, whose baseline grants were REVOKEd in 0001c) and STABLE (no writes; the `(select
-- …)` wrapper at the call site is what forces a once-per-statement initPlan — AF-067; STABLE alone is
-- not enough). search_path is pinned to '' (empty) so an attacker cannot shadow `user_roles` etc. with
-- a same-named object on a mutable search_path — every reference below is fully schema-qualified.
-- (Supabase advisor: "Function Search Path Mutable" — a pinned search_path is the fix.)

-- Returns the set of PERM nodes the current user holds via their one active role (user_roles is
-- unique(user_id), one role per user in v1 — OD-029). Empty array = holds nothing = default-deny.
create or replace function public.user_perms(uid uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(rp.permission_node), array[]::text[])
  from public.user_roles ur
  join public.role_permissions rp on rp.role_id = ur.role_id
  where ur.user_id = uid
    and ur.active;
$$;

-- Returns the clearance tiers + entity-type scopes the user holds — both user-scoped rows and rows
-- granted to the user's active role (sensitivity_clearances is user- OR role-scoped, exactly one
-- subject per row — schema.md §2 / OD-027). entity_type_scope NULL = Global (FR-1.CLR.004). ISSUE-020
-- composes the full visibility ∩ sensitivity predicate on top of this primitive.
create or replace function public.user_clearances(uid uuid)
returns table (tier public.clearance_tier, entity_type_scope text)
language sql
stable
security definer
set search_path = ''
as $$
  select sc.tier, sc.entity_type_scope
  from public.sensitivity_clearances sc
  where sc.user_id = uid
     or sc.role_id in (
       select ur.role_id from public.user_roles ur
       where ur.user_id = uid and ur.active
     );
$$;

-- Returns the active Restricted grants (entity/type scoped) for the user — soft-deleted rows
-- (revoked_at not null) are excluded, so a revoke takes effect on the next query (FR-1.RLS.006).
-- Restricted is a named-individual grant only (grantee_user_id) — never role-scoped, never a default.
create or replace function public.user_restricted(uid uuid)
returns table (entity_id uuid, entity_type text)
language sql
stable
security definer
set search_path = ''
as $$
  select rg.entity_id, rg.entity_type
  from public.restricted_grants rg
  where rg.grantee_user_id = uid
    and rg.revoked_at is null;
$$;

-- Returns the current session's Authenticator Assurance Level ('aal1' | 'aal2') from the live JWT —
-- NOT a cached snapshot (FR-1.RLS.006). ISSUE-020's per-table predicates AND this with `= 'aal2'`
-- (FR-1.RLS.005, NFR-SEC.010) so no protected table is reachable at aal1. Missing claim => 'aal1'
-- (fail-closed: absence of a proven step-up is treated as the lower assurance, #2).
create or replace function public.user_aal()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal',
    'aal1'
  );
$$;

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. Default-deny baseline policy on EVERY application table (FR-1.RLS.001)
-- ══════════════════════════════════════════════════════════════════════════════
-- A generic PERMISSIVE `using(false)` policy named `default_deny`, scoped `TO authenticated`, on every
-- silo table. Rationale for PERMISSIVE-false (not RESTRICTIVE): permissive policies OR together, so a
-- downstream real read (`as permissive for select using(<pred>)`, ISSUE-020) opens access; the floor
-- itself grants nothing (false). A RESTRICTIVE floor would AND and block every table forever. The floor
-- exists so (a) every table carries >=1 explicit policy for the coverage gate, and (b) a table that is
-- never human-readable (webhook_secrets, connector_credentials, agent_result_cache, signal_weights,
-- webhook_replay_cache) has its final, correct policy right here — deny.
--
-- The table list is IDENTICAL to 0001c's silo_tables (the tables RLS was enabled on). If the two ever
-- drift, the tail coverage assertion (§3) and the live coverage lint (src/rls-lint.ts) fail LOUD.

do $$
declare
  t text;
  silo_tables text[] := array[
    'profiles','support_requests','webhook_secrets','webhook_replay_cache',
    'roles','role_permissions','user_roles','sensitivity_clearances',
    'entities','restricted_grants','access_audit','memories',
    'ingestion_queue','memory_conflicts','consolidation_approvals',
    'tools','connector_credentials','rate_limit_tracker','idempotency_ledger',
    'agents','prompt_layers','dynamic_field_values',
    'task_queue','task_graph_versions','task_history','execution_plans',
    'guardrail_log','injection_quarantine',
    'event_log','notifications','config_audit_log','push_subscriptions',
    'agent_health_metrics','agent_result_cache',
    'proactive_suggestions','commands','signal_weights',
    'conversations','messages',
    'config_values','secret_manifest',
    'deletion_requests','connector_deletion_flags','deployment_settings'
  ];
begin
  foreach t in array silo_tables loop
    -- fail loud if a listed table is missing — a silent skip would leave a table with no policy (#2/#3).
    if to_regclass('public.' || t) is null then
      raise exception 'RLS scaffold: expected silo table public.% not found (0001 baseline drift)', t;
    end if;
    -- idempotent: CREATE POLICY has no IF NOT EXISTS, so guard on pg_policies (re-runnable per migrations.md).
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t and policyname = 'default_deny'
    ) then
      execute format(
        'create policy default_deny on public.%I as permissive for all to authenticated using (false) with check (false);',
        t
      );
    end if;
  end loop;
end $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. Coverage assertion (runtime #2/#3 gate — AC-NFR-SEC.010.1 / AF-079)
-- ══════════════════════════════════════════════════════════════════════════════
-- Every public base table must have RLS ENABLED and >=1 policy. A table reachable without an explicit
-- policy decision is a silent authorization hole (#2). 0001c asserts RLS-enabled; this asserts the
-- POLICY exists. Fail the migration LOUD rather than ship a coverage gap. (The CI/text form that catches
-- this pre-merge, with no DB, is src/rls-lint.ts, wired into `npm run check`.)
do $$
declare
  uncovered text;
begin
  select string_agg(c.relname, ', ')
    into uncovered
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relrowsecurity = true
    and not exists (
      select 1 from pg_policies p
      where p.schemaname = 'public' and p.tablename = c.relname
    );
  if uncovered is not null then
    raise exception 'RLS coverage incomplete — these public tables have RLS enabled but NO policy (silent-deny/opacity risk, #2/#3): %', uncovered;
  end if;
end $$;
