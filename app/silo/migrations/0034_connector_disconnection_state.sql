-- Client-silo migration 0034 — connector disconnection state + escalation clock + paused-task set (ISSUE-038, C3 DSC)
--
-- ⚠️ AUTHORED, NOT YET APPLIED (offline overnight build, Session 79). Silo head is 0033; this is the next free
-- tag 0034. APPLY LIVE (operator-present, morning pass): `source ~/.ai-harness-secrets.env` then the migrate runner
-- against $SILO_DB_URL, then the ISSUE-038 R10 live-adapter smoke (app/disconnection-recovery/results/live-smoke.sql).
--
-- WHY THIS TABLE EXISTS (the referenced-not-defined durable substrate, ISSUE-038 §5 DATA):
--   FR-3.DSC.003.3 (persist the paused-task set across a runtime restart) and FR-3.DSC.004.2 (persist the escalation
--   clock across a restart) both need a DURABLE record that the schema does NOT already carry. Verified first-hand
--   (Session 79): `connector_credentials.state` is a single mutable status column (no detection timestamp / no clock /
--   no paused set); `connector_watches.degraded` is the FR-3.TRIG.005 watch-liveness flag (different flow);
--   `rate_limit_deferred` is the FR-3.RL.004 rate-deferral queue. Neither ISSUE-032 (connector runtime) nor ISSUE-048
--   (task_queue) owns a disconnection-state / escalation-timer / paused-set store. ISSUE-038 §5 says: "home it in the
--   connector state / C5 durable-timer substrate (ISSUE-032/048), do not invent a fresh table here WITHOUT checking
--   those own it." Checked — they don't. So the DSC slice (which owns the disconnection lifecycle policy) authors it.
--
-- ⚠️ UPSTREAM COUPLING (logged as [[OD-200]], do NOT silently paper over): `task_queue.status` has NO `paused`
--   value (its enum is pending/running/awaiting_approval/completed/failed/flagged, and `flagged` leaves ONLY by human
--   review — not auto-resumable). This table is the DSC-owned durable paused-SET (which tasks a disconnection stalled,
--   so they resume on reconnect and survive a restart); how the C5 task_status itself REPRESENTS "paused-by-connector"
--   is a C5/ISSUE-048 decision, deferred to OD-200 and the Checkpoint-5 integration. The DSC policy layer records the
--   set + drives resume through an injected seam so it never silently abandons a task regardless of that resolution.
--
-- Additive / expand-safe: two new enums + two new tables + explicit RLS. transactional:true (no CONCURRENTLY).

-- ── enums ─────────────────────────────────────────────────────────────────────────────────────────────
create type disconnection_scope  as enum ('system_wide','individual');   -- FR-3.DSC.001 classification
create type disconnection_status as enum ('open','resolved','escalated'); -- lifecycle of a disconnection record

-- ── the durable disconnection-state record (one per live disconnection of a connector). ─────────────────
create table connector_disconnection_state (
  id                uuid primary key default gen_random_uuid(),
  connector         text not null,                                   -- the connector that went down
  scope             disconnection_scope not null,                    -- system_wide vs individual (FR-3.DSC.001)
  affected_user_id  uuid references profiles(id),                    -- set for an individual lapse; null for system_wide
  cause             text not null,                                   -- 'failed_call' | 'dead_refresh' | 'revocation' (audit)
  status            disconnection_status not null default 'open',
  detected_at       timestamptz not null,                            -- LOAD-BEARING: the escalation clock runs from here (DSC.004.2)
  escalation_window interval not null,                               -- CFG snapshot AT detection → the clock is deterministic across a restart
  deferred_at       timestamptz,                                     -- modal deferred by an admin; does NOT stop the clock (DSC.002/004)
  escalated_at      timestamptz,                                     -- when the Super-Admin escalation fired (null until; #3 never-silent)
  resolved_at       timestamptz,                                     -- when reconnect/resolution closed it
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
-- The "one OPEN disconnection per (connector, scope, affected_user)" partial-unique guard is built CONCURRENTLY in
-- the companion migration 0035 (CONCURRENTLY cannot run inside a txn block — same split as 0001/0001b). Until it is
-- applied, the store enforces open-idempotency in code (lookup-then-insert); 0035 makes it a DB-level #1 guarantee.

-- ── the persisted paused-task set (FR-3.DSC.003.3 — survives a runtime restart; no task silently abandoned). ──
create table connector_disconnection_paused_tasks (
  id               uuid primary key default gen_random_uuid(),
  disconnection_id uuid not null references connector_disconnection_state(id) on delete cascade,
  task_id          uuid not null references task_queue(id),
  paused_at        timestamptz not null,
  resumed_at       timestamptz,                                      -- null while paused; set when auto-resume completes
  resume_halted    boolean not null default false,                  -- true if the resume-time authz re-check halted-and-escalated (DSC.003.2)
  created_at       timestamptz not null default now(),
  unique (disconnection_id, task_id)                                -- a task appears once per disconnection (idempotent pause)
);

-- ── RLS (discipline: every created table needs a policy — LINT 2). These are operator/service tables written by the
--    harness (service_role, RLS-bypass) and read by the ops dashboard THROUGH the app service layer (also service_role),
--    never by a direct end-user `authenticated` session — so an explicit pure DEFAULT-DENY policy is correct and
--    fail-closed (#2). A pure `using(false)` policy is aal2-exempt by the rls-lint's own rule (no human GRANT to gate).
--    If a future surface ever reads these tables in a direct `authenticated` session, add an aal2 + admin-perm policy
--    then (tracked, not silent) — the ops surface (ISSUE-078) reads them via the service adapter today.
alter table connector_disconnection_state enable row level security;
revoke all on connector_disconnection_state from authenticated;
create policy connector_disconnection_state_default_deny on connector_disconnection_state
  for all to authenticated using (false) with check (false);

alter table connector_disconnection_paused_tasks enable row level security;
revoke all on connector_disconnection_paused_tasks from authenticated;
create policy connector_disconnection_paused_tasks_default_deny on connector_disconnection_paused_tasks
  for all to authenticated using (false) with check (false);
