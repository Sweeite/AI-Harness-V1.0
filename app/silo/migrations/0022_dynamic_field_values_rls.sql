-- Migration 0022 — dynamic_field_values RLS: close the missing-grant gap the Checkpoint-3 adversarial
-- review caught (session 72). prompt_layers got an additive RLS policy + grant in 0004 (PERM-prompt.edit);
-- dynamic_field_values (ISSUE-044) never got the equivalent. Left with only the 0002 blanket `default_deny`
-- and no GRANT to `authenticated`, ANY authenticated-role caller (the ISSUE-044 operator dynamic-value
-- editor) got "permission denied for table dynamic_field_values" before RLS even ran. service_role reads at
-- assembly time (RLS-exempt, ADR-006) were unaffected, which is why this went unnoticed until the operator
-- editor path was actually reviewed.
--
-- PERM node: spec/04-data-model/rls-policies.md L67 is the canonical answer — PERM-config.prompts (Super
-- Admin only per app/rbac/src/catalog.ts). app/prompt-layer-context/results/proposed-shared-spec.md had
-- proposed PERM-prompt.edit instead; rls-policies.md wins per Rule 0 (spec is the source of truth over a
-- package's own results/ proposal note).
--
-- transactional:true -- do NOT add BEGIN/COMMIT. Re-runnable (no IF NOT EXISTS on CREATE POLICY -> guard on
-- pg_policies, same idiom as 0004).

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'dynamic_field_values' and policyname = 'config_prompts_edit'
  ) then
    create policy config_prompts_edit on public.dynamic_field_values
      as permissive for all to authenticated
      using ((select public.user_perms(auth.uid())) @> array['PERM-config.prompts'])
      with check ((select public.user_perms(auth.uid())) @> array['PERM-config.prompts']);
  end if;
end $$;

-- RLS filters rows; it does not grant table access — without this the policy above is unreachable
-- ("permission denied" before RLS runs), same as the 0004 prompt_layers precedent.
grant select, insert, update on public.dynamic_field_values to authenticated;
