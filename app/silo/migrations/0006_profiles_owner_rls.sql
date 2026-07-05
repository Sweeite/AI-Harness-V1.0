-- Migration 0006 — profiles owner-reads-own RLS (ISSUE-013, C0 login/session). Stage-3.
--
-- SCOPE. The `profiles` TABLE already exists (0001_baseline.sql — id uuid pk references auth.users(id)
-- on delete cascade, email, name, active, created_at, last_active_at) and already carries the ISSUE-009
-- default-deny baseline policy (0002_rls_scaffold.sql: `default_deny … using(false)` TO authenticated).
-- This migration does NOT re-create the table; it registers the ADR-006 owner-reads-own access ON TOP OF
-- that default-deny floor (FR-0.AUTH.001 auth.uid() seam + the last_active_at session-activity path,
-- schema.md §1 / ISSUE-013 §8 step 1). Expand-contract: additive, re-runnable, no destructive change.
--
-- WHY these policies compose (not replace): 0002's default_deny is PERMISSIVE `using(false)`. Permissive
-- policies OR together, so an additional `as permissive for select using (auth.uid() = id)` OPENS exactly
-- the owner's own row and nothing else — the floor still denies every other row (#2). service_role BYPASSES
-- RLS by design (ADR-006); these policies are `TO authenticated` and never touch the service_role path
-- (the upsert-on-login + background/task-continuation writes run as service_role).
--
-- transactional:true — do NOT add BEGIN/COMMIT. Every statement is re-runnable (pg_policies existence guard).

-- 1. Owner-reads-own SELECT (FR-0.AUTH.001 / ADR-006 auth.uid() seam). `(select auth.uid())` forces a
--    once-per-statement initPlan (AF-067) so auth.uid() is not re-evaluated per row.
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

-- 2. Owner self-update of last_active_at / name (session-activity path). USING scopes which rows are
--    updatable; WITH CHECK forces the post-update row to still belong to the caller (no re-keying id to
--    another user, #2). `active` deactivation is an admin/service_role action (C1/ISSUE-018), NOT self-service.
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

-- 3. Coverage assertion — fail LOUD if either policy is missing after apply (a silent guard-bug would
--    leave the owner-read seam broken — #3).
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
