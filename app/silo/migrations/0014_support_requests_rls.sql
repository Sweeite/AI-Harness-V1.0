-- Migration 0014 — support_requests RLS policies (ISSUE-016). Additive; composes on the 0002 default_deny floor.
--
-- support_requests + support_status already exist (0001_baseline.sql L107-116 / L28) and carry the 0002
-- default_deny PERMISSIVE-false floor (RLS enabled, no read/write grant). This migration adds the three
-- PERMISSIVE policies from rls-policies.md L51 that OR onto that floor: a pre-auth public INSERT-only intake,
-- a PERM-support.view read, and a PERM-support.resolve update. Auth calls are (select ...)-wrapped so they
-- evaluate once per statement (AF-067 initplan discipline; the src/rls-lint.ts idiom), matching 0003.
--
-- transactional:true -- do NOT add BEGIN/COMMIT. Re-runnable (pg_policies guards + IF NOT EXISTS index).

-- (a) PUBLIC INSERT-only intake -- the pre-auth "Trouble signing in?" form (FR-0.REC.002). anon/authenticated
--     may INSERT a pending, unassigned row but can NEVER SELECT existing rows (no read policy grants them).
--     This is the ONE table whose intake is intentionally NOT aal2-gated: it is pre-authentication, so the
--     universal aal2 baseline (rls-policies.md rule 5) does not apply to THIS insert.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'support_requests' and policyname = 'support_requests_public_insert') then
    execute $p$
      create policy support_requests_public_insert on public.support_requests
        as permissive for insert to anon, authenticated
        with check (status = 'pending' and assigned_to is null);
    $p$;
  end if;
end $$;

-- (b) Read -- PERM-support.view holders only (FR-0.REC.003 / AC-0.REC.003.1). aal2 baseline applies (rule 5).
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'support_requests' and policyname = 'support_requests_view') then
    execute $p$
      create policy support_requests_view on public.support_requests
        as permissive for select to authenticated
        using (
          (select public.user_perms(auth.uid())) @> array['PERM-support.view']
          and (select public.user_aal()) = 'aal2'
        );
    $p$;
  end if;
end $$;

-- (c) Update (status transitions) -- PERM-support.resolve holders only (FR-0.REC.005). aal2 baseline applies.
--     The legal-move + resolved-immutable enforcement is app-layer (SupabaseSupportStore.transition, guarded
--     by `where status = <from>`); this policy governs WHO may update, not WHICH transition.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'support_requests' and policyname = 'support_requests_resolve') then
    execute $p$
      create policy support_requests_resolve on public.support_requests
        as permissive for update to authenticated
        using (
          (select public.user_perms(auth.uid())) @> array['PERM-support.resolve']
          and (select public.user_aal()) = 'aal2'
        )
        with check (
          (select public.user_perms(auth.uid())) @> array['PERM-support.resolve']
          and (select public.user_aal()) = 'aal2'
        );
    $p$;
  end if;
end $$;

-- No DELETE policy -- support_requests is never deleted on the human path (resolved = immutable history,
-- FR-0.REC.005). The stale-sweep read (FR-0.REC.007) runs as service_role (bypasses RLS).

-- FR-0.REC.007 overdue computation reads (status, created_at) -> the supporting index
-- (support_requests_status_created_idx) is built CONCURRENTLY in 0017_stage4_indexes.sql (a CONCURRENTLY build
-- cannot run inside this transactional migration -- migration-discipline.md L39).
