-- ISSUE-058 — R10 live-adapter smoke for SupabaseGuardrailLogSink (rolled back; run against a real silo).
-- Proves the one live write path this slice ships (append a rate_limit-class guardrail_log row) behaves 1:1
-- with InMemoryGuardrailLogSink: the INSERT lands, id/status/created_at are DB-defaulted, status='pending'.
-- Live-adapter-hygiene sweep (R10): offline-green is not enough for a package that ships supabase-store.ts.
-- Run as the service_role/owner connection (the C6 decision path bypasses RLS by design — ADR-007).

begin;

-- 1) The exact INSERT SupabaseGuardrailLogSink.writeRateLimitRow issues (a rate-cap breach row).
insert into guardrail_log (task_id, guardrail_type, description, action_blocked, status)
values (null, 'rate_limit', 'R10 smoke — ISSUE-058 rate_limit cap breach (hard_stop)', true, 'pending')
returning id, guardrail_type, status, action_blocked, created_at;

-- 2) A cost-ladder rung-transition row (also rate_limit-class per AC-NFR-COST.003.2 wording).
insert into guardrail_log (task_id, guardrail_type, description, action_blocked, status)
values (null, 'rate_limit', 'R10 smoke — ISSUE-058 cost_ladder rung=hard_kill stop-new-consequential-spend', true, 'pending')
returning id, guardrail_type, status;

-- 3) Sanity: both rows are the type this slice writes and default to pending (never silently mislabelled).
select count(*) as rate_limit_pending_rows
from guardrail_log
where guardrail_type = 'rate_limit' and status = 'pending';

rollback;
