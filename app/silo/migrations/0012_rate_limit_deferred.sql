-- Migration 0012 — rate_limit_deferred: the persisted 95%-tier deferral queue (ISSUE-034). Additive.
--
-- FR-3.RL.004 / AC-3.RL.004.1-2 require the 95% pause tier to enqueue non-critical calls on a PERSISTED
-- queue that survives a runtime restart (no silent drop, #3) and, on drain, re-consults the idempotency
-- guard before re-firing a write. The baseline has rate_limit_tracker + idempotency_ledger but no deferral
-- queue -- an in-memory queue would violate the restart-durability AC. Net-new, intra-silo, NO client_slug
-- (physical isolation is the silo boundary, ADR-001 / FR-3.RL.007), mirroring the other C3 tables.
--
-- transactional:true -- do NOT add BEGIN/COMMIT. Re-runnable (IF NOT EXISTS + pg_policies guard).

create table if not exists rate_limit_deferred (                -- net-new (FR-3.RL.004 persisted 95% queue)
  id              uuid primary key default gen_random_uuid(),
  connector       text not null,
  window_label    text not null,                                -- the tracker window this call was paused against
  run_after       timestamptz not null,                         -- = the window reset_at at enqueue time
  risk_level      text,                                         -- carried across the pause so drain can re-route
  irreversible    boolean not null default false,               -- an irreversible write never queues (it halts);
                                                                 --   kept for drain-time assertion / completeness
  urgency         text not null,                                -- 'urgent' | 'background' (explicit, FR-3.RL.003)
  idempotency_key text,                                         -- present for writes -> drain re-consults the guard
  enqueued_at     timestamptz not null default now(),
  drained_at      timestamptz                                   -- null = pending; set when drained (survives restart)
);

-- The drainDue() scan index (rate_limit_deferred_due_idx) is built CONCURRENTLY in 0017_stage4_indexes.sql
-- (a CONCURRENTLY build cannot run inside this transactional migration -- migration-discipline.md L39).

-- ── RLS floor (mirror the 0002 scaffold: every table carries the default_deny PERMISSIVE-false policy so the
--    rls coverage lint is satisfied; the queue is written/read by the connector runtime as service_role,
--    which bypasses RLS by design -- ADR-006). Belt-and-braces REVOKE for the normal roles. ──────────────
alter table rate_limit_deferred enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'rate_limit_deferred' and policyname = 'default_deny'
  ) then
    execute 'create policy default_deny on public.rate_limit_deferred as permissive for all to authenticated using (false) with check (false);';
  end if;
end $$;

revoke all on rate_limit_deferred from anon, authenticated;
