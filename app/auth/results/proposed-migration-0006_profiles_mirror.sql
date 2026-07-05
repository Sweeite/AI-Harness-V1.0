-- PROPOSED client-silo migration 0006 — profiles mirror RLS (ISSUE-013, C0 login/session).
--
-- ⚠️ PROPOSAL ONLY — authored in app/auth/results/ per the Stage-3 fan-out contract. It is NOT added to
--    app/silo/migrations/ or _journal.json here; the orchestrator integrates it (as tag 0006) at Stage-3
--    checkpoint time. Author supabase-store.ts to THIS DDL.
--
-- SCOPE. The `profiles` TABLE already exists (0001_baseline.sql L97 — id uuid pk references auth.users(id)
-- on delete cascade, email, name, active, created_at, last_active_at) and already carries the ISSUE-009
-- default-deny baseline policy (0002_rls_scaffold.sql: `default_deny … using(false)` TO authenticated).
-- This migration therefore does NOT re-create the table; it registers the ADR-006 owner-reads-own access
-- ON TOP OF that default-deny floor (FR-0.AUTH.001 auth.uid() seam + the session-activity last_active_at
-- path, schema.md §1 / ISSUE-013 §8 step 1). Expand-contract: additive, re-runnable, no destructive change.
--
-- WHY these policies compose (not replace): 0002's default_deny is PERMISSIVE `using(false)`. Permissive
-- policies OR together, so an additional `as permissive for select using (auth.uid() = id)` OPENS exactly
-- the owner's own row and nothing else — the floor still denies every other row (#2). A RESTRICTIVE policy
-- would have AND-ed and blocked everything, so PERMISSIVE is correct here (same rationale as rls-policies.md
-- / 0002 §2).
--
-- service_role BYPASSES RLS by design (ADR-006) — these policies are `TO authenticated` and never touch the
-- service_role path (the upsert-on-login + the background/task-continuation writes run as service_role).
--
-- The runner wraps this file in a transaction (transactional:true). Do NOT add BEGIN/COMMIT. Every
-- statement is re-runnable (migrations.md): policies via a pg_policies existence guard.

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. Owner-reads-own SELECT (FR-0.AUTH.001 / ADR-006 auth.uid() seam)
-- ══════════════════════════════════════════════════════════════════════════════
-- A user may read ONLY their own profile row. `(select auth.uid())` — the subselect wrapper forces a
-- once-per-statement initPlan (AF-067) so the auth.uid() call is not re-evaluated per row.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_owner_read'
  ) then
    create policy profiles_owner_read on public.profiles
      as permissive for select to authenticated
      using ((select auth.uid()) = id);
  end if;
end $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. Owner self-update of last_active_at / name (session-activity path)
-- ══════════════════════════════════════════════════════════════════════════════
-- The session-activity bump (touchLastActive) is an authenticated self-write. Scope it to the owner's own
-- row via both USING (which existing rows are visible to update) and WITH CHECK (the post-update row must
-- still belong to the caller — prevents re-keying id to another user, #2). `active` deactivation is an
-- admin action owned by C1/ISSUE-018 (a Super-Admin PERM path), NOT self-service — this policy does not
-- grant a self toggle of `active` (the column stays writable only via the service_role/admin path).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_owner_update'
  ) then
    create policy profiles_owner_update on public.profiles
      as permissive for update to authenticated
      using ((select auth.uid()) = id)
      with check ((select auth.uid()) = id);
  end if;
end $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. Coverage assertion (belt-and-braces — the profiles policies are actually present)
-- ══════════════════════════════════════════════════════════════════════════════
-- Fail LOUD if either policy is missing after this migration (a silent no-op guard bug would leave the
-- owner-read seam broken — #3). RLS-enabled + default_deny were asserted by 0001c/0002; this asserts the
-- two additive policies landed.
do $$
declare
  missing text[] := array[]::text[];
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='profiles_owner_read') then
    missing := missing || 'profiles_owner_read';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='profiles_owner_update') then
    missing := missing || 'profiles_owner_update';
  end if;
  if array_length(missing, 1) is not null then
    raise exception '0006 profiles mirror: expected owner policies missing after apply: % (#3)', array_to_string(missing, ', ');
  end if;
end $$;

-- NOTE ON auth.uid()=id AND the profiles.id → auth.users(id) FK (already in baseline): the on-delete-cascade
-- means deleting an auth.users row (right-to-erasure / offboarding) removes the mirror row automatically —
-- the erasure workflow (C10) relies on this cascade, so it is not re-declared here.
