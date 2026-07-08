-- ISSUE-078 — R10 live-adapter smoke for SupabaseOpsDashboardStore.appendAccessAudit.
-- Proves the ONE live side effect this surface owns — the access_audit append every export/sensitive view
-- performs — round-trips against the real silo schema (append-only sink, service_role writer). Rolled back:
-- it asserts and leaves NO residue. Run against a client silo (has access_audit; 0001_baseline).
--
-- Usage (from the Mac, full session): psql "$SILO_DATABASE_URL" -v ON_ERROR_STOP=1 -f results/live-smoke.sql

begin;

-- 1. The adapter's INSERT (mirrors the $1..$8 parameterised insert in supabase-store.ts).
insert into public.access_audit
  (audit_type, actor_identity, actor_type, action, target_entity_id, target_type, reason, path_context)
values
  ('dashboard_export', 'smoke-operator', 'system', 'export:guardrail_log', null, 'guardrail_log',
   'ISSUE-078 R10 smoke', 'surface-05/guardrail-log');

-- 2. Assert exactly one row landed with the expected shape.
do $$
declare n int;
begin
  select count(*) into n from public.access_audit
   where actor_identity = 'smoke-operator' and audit_type = 'dashboard_export' and actor_type = 'system';
  if n <> 1 then raise exception 'R10 smoke FAILED: expected 1 access_audit row, found %', n; end if;
end $$;

-- 3. Assert the sink is append-only: an UPDATE to the row must be rejected by the immutability trigger
--    (schema.md §Immutability — the audit sink cannot be silently rewritten, #1/#3).
do $$
begin
  begin
    update public.access_audit set action = 'tampered' where actor_identity = 'smoke-operator';
    raise exception 'R10 smoke FAILED: access_audit UPDATE was NOT rejected (append-only broken)';
  exception when others then
    if sqlerrm like '%R10 smoke FAILED%' then raise; end if;
    -- any other error = the trigger rejected the mutation as designed; good.
    raise notice 'append-only trigger correctly rejected the UPDATE: %', sqlerrm;
  end;
end $$;

-- Leave no residue.
rollback;
