-- Client-silo migration 0031 — RLS ENFORCEMENT (ISSUE-020)
--
-- SCOPE (Rule 0 + the 009/020 boundary): 0002 stood up the RLS *substrate* — the four
-- SECURITY DEFINER STABLE helpers (user_perms / user_clearances / user_restricted / user_aal),
-- the default-deny baseline POLICY on every silo table, and the coverage assertion. THIS migration
-- authors the *enforcing* predicates that COMPOSE on that floor (FR-1.RLS.002 full / .003 / .005):
--   (1) the fifth helper — `user_visibility(uid)` — the visibility-tier resolver OD-168 keeps DISTINCT
--       from user_perms (a role attribute, NOT a can()-gate PERM node — so ISSUE-018's catalog is
--       untouched, per ISSUE-020 §5 "PERM: none newly created here"); its source is a new additive
--       `roles.visibility_tiers` column seeded from the design-doc L509-615 Memory-Access matrix.
--   (2) the row-access-subset READ predicate on `memories` (visibility ∩ sensitivity ∩ Restricted,
--       entity-type-scoped) and `entities` (Internal-Org walled) — FR-1.RLS.003; NO client_slug clause
--       (isolation is physical, ADR-001 — AC-1.RLS.003.2).
--   (3) the self/PERM-scoped human READ policies on the RBAC-self tables 020 §5 Touches
--       (roles / role_permissions / user_roles / sensitivity_clearances / restricted_grants /
--       access_audit) per rls-policies.md — each carrying the universal aal2 baseline.
--   (4) the `user_aal() = 'aal2'` baseline clause on EVERY protected table's human-path GRANT policy
--       (FR-1.RLS.005 / NFR-SEC.010) — authored on the new policies here AND retrofitted (via a
--       non-destructive ALTER POLICY) onto the grant policies authored before this slice existed
--       (profiles/0006, prompt_layers/0004, dynamic_field_values/0022, config_values/0003) which
--       predate the universal-aal2 rule. The aal2 text-lint (src/rls-lint.ts, create+alter aware) is
--       the CI teeth so no future grant policy ships without it.
--
-- NOT here (Rule 0):
--   * The harness-side mid-task authorization re-check (FR-1.RLS.007) + the RLS/harness divergence
--     signal (FR-1.RLS.008) — those are CODE (the agent/service_role path bypasses RLS by design), built
--     in app/rls-enforcement/ (TS), not SQL. This migration only adds the DB-side half + the
--     originating_user_id attribution column already present in access_audit (0001 baseline).
--   * The default-deny floor + the four base helpers (0002); can() gate (0018); clearance/Restricted
--     grant flows (0019); the memory_scope service_role retrieval filter (ISSUE-025 / C8).
--
-- The runner wraps this file in a transaction (transactional:true) — do NOT add BEGIN/COMMIT. Every
-- statement is re-runnable (migrations.md hard constraint) and NON-destructive (no DROP — the
-- expand-contract linter's rule, AC-NFR-INF.002.1): the column via ADD COLUMN IF NOT EXISTS, the seed
-- via an idempotent UPDATE, the helper via `create or replace function`, NEW policies via a
-- pg_policies-guarded `create policy` (skip-if-exists, the 0002 idiom), and the four pre-existing grant
-- policies patched in place via `alter policy … using (…)` (no drop; the policy's role + command are
-- unchanged, only the predicate gains the aal2 clause). All policies are `TO authenticated`
-- (service_role BYPASSES RLS by design, ADR-006 part 6 — its containment is harness RBAC + memory_scope,
-- never RLS: FR-1.RLS.004).

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. The fifth helper — user_visibility — and its role-attribute source (OD-168)
-- ══════════════════════════════════════════════════════════════════════════════
-- OD-168 (RESOLVED): a user holds a visibility tier via their ONE active role (user_roles, one-role-per
-- -user OD-029); the exact role→tier lookup is a Phase-4 build artifact — resolved here as a "small role
-- -attribute" (the OD-sanctioned alternative to a role_permissions convention), which keeps visibility
-- OUT of the PERM-node catalog homed in ISSUE-018 (§5). The mapping is the verbatim design-doc L509-615
-- "Memory Access" matrix: Global = all six roles · Team = all but Standard User · Private = Super Admin
-- + Admin. Additive column, default '{}' (a role with no seeded tiers holds none = fail-closed).

alter table public.roles
  add column if not exists visibility_tiers public.visibility_tier[] not null default '{}';

-- Idempotent seed by role NAME (the six seeded roles, 0001d). Re-running overwrites with the same set —
-- a fresh provision seeds these exact values; an operator retune is a later data edit (instant,
-- FR-1.RLS.006), owned by the role-management surface, not re-clobbered here on a no-op re-apply.
update public.roles set visibility_tiers = '{global,team,private}'::public.visibility_tier[] where name in ('Super Admin','Admin');
update public.roles set visibility_tiers = '{global,team}'::public.visibility_tier[]        where name in ('Finance','HR','Account Manager');
update public.roles set visibility_tiers = '{global}'::public.visibility_tier[]              where name = 'Standard User';

-- Returns the visibility tiers the user's active role holds (distinct from user_perms — OD-168). Same
-- live-read shape + SECURITY DEFINER STABLE `set search_path=''` discipline as the four 0002 helpers;
-- invoked as `(select user_visibility(auth.uid()))` so the `(select …)` wrapper forces a once-per-
-- statement initPlan (AF-067). No active role → no row → NULL → `= any(NULL)` is false = default-deny.
create or replace function public.user_visibility(uid uuid)
returns public.visibility_tier[]
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(r.visibility_tiers, array[]::public.visibility_tier[])
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  where ur.user_id = uid
    and ur.active;
$fn$;

-- ══════════════════════════════════════════════════════════════════════════════
-- 1b. Table-level SELECT grant to `authenticated` on the tables this slice opens
-- ══════════════════════════════════════════════════════════════════════════════
-- 0001c REVOKEd the baseline grants from anon/authenticated (default-deny by *privilege* as well as by
-- policy). A policy filters ROWS but the role still needs the table-level SELECT *privilege* or the read is
-- `permission denied` before RLS runs — so opening a table for the human path is always GRANT (privilege) +
-- POLICY (row filter) together, exactly as 0003/0004/0022 do for their tables. Read-only (writes stay
-- service_role / their owning issue); idempotent (re-GRANT is a no-op); the append-only sinks' DELETE stays
-- revoked (0001c). NB: `roles`/`role_permissions`/`user_roles`/`sensitivity_clearances`/`restricted_grants`
-- are also read by the SECURITY DEFINER helpers regardless — this grant is for the direct human RBAC-surface
-- read gated by the §4 policies.
grant select on
  public.memories, public.entities,
  public.roles, public.role_permissions, public.user_roles,
  public.sensitivity_clearances, public.restricted_grants, public.access_audit
  to authenticated;

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. memories — the row-access-subset READ predicate (FR-1.RLS.003, the marquee)
-- ══════════════════════════════════════════════════════════════════════════════
-- A human may READ a memory row iff ALL hold (each helper `(select …)`-wrapped / used in a select-group
-- so it is once-per-statement — AF-067; ISSUE-002 proved this exact composition p95 0.899 ms):
--   • aal2 (universal baseline, FR-1.RLS.005),
--   • the caller HOLDS the row's visibility tier (user_visibility),
--   • sensitivity: 'standard' is implicit-cleared; 'confidential'/'personal' require a matching
--     user_clearances tier whose entity_type_scope is Global (null) OR matches one of the row's entities'
--     types (entity-type-scoped clearance, FR-1.CLR.004); a 'restricted' row is NEVER admitted by a
--     clearance (Restricted is never a tier — it is the per-individual grant below),
--   • Restricted: a 'restricted' row additionally requires a LIVE per-individual grant (user_restricted,
--     revoked_at is null) on one of the row's entities (by id, or by entity_type).
-- NO client_slug / cross-deployment predicate — isolation is physical (ADR-001 / AC-1.RLS.003.2).
-- memories human-path WRITE is sole-writer service_role only (ADR-004) → no INSERT/UPDATE/DELETE policy
-- here; the default_deny floor denies the human write path, which is correct.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='memories' and policyname='memories_clearance_read') then
    execute $q$
      create policy memories_clearance_read on public.memories
        as permissive for select to authenticated
        using (
          (select public.user_aal()) = 'aal2'
          and (select public.user_visibility(auth.uid())) @> array[visibility]
          and (
            -- clause A gates ONLY the clearance tiers (confidential/personal). 'standard' is implicit-cleared;
            -- 'restricted' is NOT a clearance tier (clearance_tier ∈ confidential|personal) — it passes clause
            -- A and is gated instead by the live per-individual grant in clause B below. (A bug where clause A
            -- demanded a 'restricted' clearance would make every restricted row unreadable — caught by the
            -- capstone Restricted assertion.)
            sensitivity not in ('confidential','personal')
            or exists (
              select 1 from public.user_clearances(auth.uid()) uc
              where uc.tier::text = memories.sensitivity::text
                and (
                  uc.entity_type_scope is null
                  or uc.entity_type_scope in (
                    select e.type from public.entities e where e.id = any (memories.entity_ids)
                  )
                )
            )
          )
          and (
            sensitivity <> 'restricted'
            or exists (
              select 1 from public.user_restricted(auth.uid()) ur
              where ur.entity_id = any (memories.entity_ids)
                or (
                  ur.entity_type is not null
                  and ur.entity_type in (
                    select e.type from public.entities e where e.id = any (memories.entity_ids)
                  )
                )
            )
          )
        )
    $q$;
  end if;
end $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. entities — Internal-Org walled from client-facing (FR-1.RLS.003)
-- ══════════════════════════════════════════════════════════════════════════════
-- entities carry no sensitivity column; the wall is structural: an is_internal_org row (the agency's own
-- "self" entity + internal knowledge subjects, default sensitivity 'confidential' — memory tags.ts
-- INTERNAL_ORG_DEFAULT_SENSITIVITY) is readable only by a caller holding a Confidential clearance
-- (any scope); client-facing entities (is_internal_org=false) are readable by any aal2 human (their
-- governing sensitivity lives on the linked memory rows, gated in §2). Human write = none (service_role
-- only); default_deny covers it.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='entities' and policyname='entities_internal_org_read') then
    execute $q$
      create policy entities_internal_org_read on public.entities
        as permissive for select to authenticated
        using (
          (select public.user_aal()) = 'aal2'
          and (
            not is_internal_org
            or exists (
              select 1 from public.user_clearances(auth.uid()) uc where uc.tier = 'confidential'
            )
          )
        )
    $q$;
  end if;
end $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. RBAC-self READ policies (rls-policies.md per-table summary) — all aal2-gated
-- ══════════════════════════════════════════════════════════════════════════════
-- Each authored idempotently (skip-if-exists). Human WRITE paths (assign_role, grant_clearance, …) are
-- ISSUE-021's surface work → the default_deny floor holds them until that slice authors them.
--   • roles / role_permissions: any aal2 authenticated may READ (the RBAC surface reads them; the
--     SECURITY DEFINER helpers read them regardless).
--   • user_roles: self-row OR a User-Management-category node holder (PERM-user.*).
--   • sensitivity_clearances: self-row OR PERM-user.grant_clearance holder.
--   • restricted_grants: self-row (the grantee) OR PERM-user.grant_restricted holder (Super Admin).
--   • access_audit: PERM-compliance.view_audit holder (append-only; the enforce_audit_append_only
--     trigger blocks UPDATE/DELETE regardless of role, so no human write policy).
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='roles' and policyname='roles_read') then
    execute $q$ create policy roles_read on public.roles
      as permissive for select to authenticated
      using ((select public.user_aal()) = 'aal2') $q$;
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='role_permissions' and policyname='role_permissions_read') then
    execute $q$ create policy role_permissions_read on public.role_permissions
      as permissive for select to authenticated
      using ((select public.user_aal()) = 'aal2') $q$;
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='user_roles' and policyname='user_roles_self_or_usermgmt_read') then
    execute $q$
      create policy user_roles_self_or_usermgmt_read on public.user_roles
        as permissive for select to authenticated
        using (
          (select public.user_aal()) = 'aal2'
          and (
            user_id = (select auth.uid())
            or exists (
              select 1 from unnest((select public.user_perms(auth.uid()))) n where n like 'PERM-user.%'
            )
          )
        )
    $q$;
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='sensitivity_clearances' and policyname='sensitivity_clearances_self_or_grantor_read') then
    execute $q$
      create policy sensitivity_clearances_self_or_grantor_read on public.sensitivity_clearances
        as permissive for select to authenticated
        using (
          (select public.user_aal()) = 'aal2'
          and (
            user_id = (select auth.uid())
            or (select public.user_perms(auth.uid())) @> array['PERM-user.grant_clearance']
          )
        )
    $q$;
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='restricted_grants' and policyname='restricted_grants_self_or_grantor_read') then
    execute $q$
      create policy restricted_grants_self_or_grantor_read on public.restricted_grants
        as permissive for select to authenticated
        using (
          (select public.user_aal()) = 'aal2'
          and (
            grantee_user_id = (select auth.uid())
            or (select public.user_perms(auth.uid())) @> array['PERM-user.grant_restricted']
          )
        )
    $q$;
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='access_audit' and policyname='access_audit_view') then
    execute $q$
      create policy access_audit_view on public.access_audit
        as permissive for select to authenticated
        using (
          (select public.user_aal()) = 'aal2'
          and (select public.user_perms(auth.uid())) @> array['PERM-compliance.view_audit']
        )
    $q$;
  end if;
end $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- 5. aal2 RETROFIT onto grant policies authored before the universal-aal2 rule
-- ══════════════════════════════════════════════════════════════════════════════
-- FR-1.RLS.005 is universal (no protected table reachable at aal1, save the support_requests pre-auth
-- intake). These four policies predate this slice and lack the clause; ALTER POLICY patches the
-- predicate IN PLACE (non-destructive — role + command unchanged). They are created by 0003/0004/0006/
-- 0022, which run before 0031, so the policies exist when this runs (fresh provision AND live silo).
-- ALTER POLICY is idempotent (re-applies the same predicate). The `(select …)` initPlan wrapping (AF-067)
-- and the key-group / PERM-node semantics are byte-preserved; only the aal2 conjunct is added.
alter policy profiles_owner_read on public.profiles
  using ((select auth.uid()) = id and (select public.user_aal()) = 'aal2');

alter policy profiles_owner_update on public.profiles
  using ((select auth.uid()) = id and (select public.user_aal()) = 'aal2')
  with check ((select auth.uid()) = id and (select public.user_aal()) = 'aal2');

alter policy prompt_edit on public.prompt_layers
  using ((select public.user_perms(auth.uid())) @> array['PERM-prompt.edit'] and (select public.user_aal()) = 'aal2')
  with check ((select public.user_perms(auth.uid())) @> array['PERM-prompt.edit'] and (select public.user_aal()) = 'aal2');

alter policy config_prompts_edit on public.dynamic_field_values
  using ((select public.user_perms(auth.uid())) @> array['PERM-config.prompts'] and (select public.user_aal()) = 'aal2')
  with check ((select public.user_perms(auth.uid())) @> array['PERM-config.prompts'] and (select public.user_aal()) = 'aal2');

alter policy config_values_read on public.config_values
  using (
    (select public.user_perms(auth.uid())) @> array[ (select public.config_key_group(key)) ]
    and (select public.user_aal()) = 'aal2'
  );

-- ══════════════════════════════════════════════════════════════════════════════
-- 6. Tail assertion — every protected GRANT policy carries the aal2 clause (live #2/#3 gate)
-- ══════════════════════════════════════════════════════════════════════════════
-- The runtime form of AC-1.RLS.005.1 / AF-076: scan pg_policies for any `authenticated` policy that
-- GRANTS (qual is not the bare default-deny `false`) yet whose qual omits user_aal — a silent aal1 hole.
-- The support_requests pre-auth intake (public INSERT, FR-0.REC.002) is the ONE documented exemption.
-- Fail the migration LOUD rather than ship the gap. (The pre-merge text form is src/rls-lint.ts.)
do $$
declare
  offending text;
begin
  select string_agg(p.tablename || '.' || p.policyname, ', ')
    into offending
  from pg_policies p
  where p.schemaname = 'public'
    and 'authenticated' = any (p.roles)
    and coalesce(p.qual, '') !~* 'false'          -- pure default-deny needs no aal2
    and coalesce(p.qual, '') !~* 'user_aal'       -- ...but a granting policy must gate on aal2
    and not (p.tablename = 'support_requests' and p.cmd = 'INSERT');  -- the documented pre-auth exemption
  if offending is not null then
    raise exception 'aal2 coverage gap — these authenticated GRANT policies omit the user_aal()=''aal2'' clause (silent aal1 bypass, #2/#3): %', offending;
  end if;
end $$;
