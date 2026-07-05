-- Client-silo migration 0005 — RETENTION-PRUNE WHITELIST on the audit-sink immutability trigger
-- (ISSUE-010 / ISSUE-011 shared fix · OD-180 · change-control on NFR-CMP.006)
--
-- WHY: 0001_baseline's enforce_audit_append_only() forbids DELETE on the four append-only sinks
-- (event_log, guardrail_log, access_audit, config_audit_log) UNCONDITIONALLY. A BEFORE DELETE row
-- trigger fires for EVERY role (incl. service_role and the table owner) — privilege cannot bypass it.
-- So the retention pruning FR-7.LOG.006 / AC-7.LOG.008.2 mandates (delete rows past the window, never
-- below the audit/compliance floor) is literally un-runnable: the live prune() always throws. The spec
-- already states retention is "a separate privileged job" but never gave that job a way through the
-- immutability wall. The Stage-2 fan-out verification (session 66) caught this on BOTH sinks; the
-- offline InMemory reference models masked it (a plain Map.delete). Operator chose Option A.
--
-- WHAT (OD-180, chosen 2026-07-05): add a TRANSACTION-LOCAL whitelist branch. A DELETE is allowed on an
-- audit sink ONLY when the executing transaction has set `app.retention_prune = 'on'` (via `set local`,
-- so it auto-resets at COMMIT/ROLLBACK and can never leak past the one job transaction). Every other
-- DELETE — any normal path, any role, service_role included — is still rejected exactly as before.
-- Immutability for normal writes is UNCHANGED; the only new capability is a self-declared retention job.
--
-- FLOOR SAFETY (#1): the trigger gates only THAT a delete happens inside a retention transaction — it
-- does NOT compute the floor. Never-prune-below-floor + never-prune-a-referenced-row stays the retention
-- JOB's responsibility (app-code, tested in ISSUE-010/011); the job selects only past-floor row ids and
-- deletes them within the flagged transaction. This is deliberate: the floor is per-sink/per-config
-- policy, not a table-level invariant the trigger can know.
--
-- TAMPER SURFACE (#2), stated plainly: anyone who can (a) hold a DELETE grant on a sink AND (b) run
-- `set local app.retention_prune='on'` can delete audit rows. Mitigations already in place: 0001c did
-- `revoke delete` on all four sinks from anon+authenticated, so ONLY service_role (the harness itself)
-- can DELETE at all; the GUC is a SECOND, explicit, per-transaction opt-in that makes a retention delete
-- auditable-by-construction (the job that sets it is the only intended setter). A stricter external
-- monitor on retention volume is an ops concern (AF-139 family), not this trigger's job.
--
-- The runner wraps this file in a transaction (transactional:true). This migration is ADDITIVE and
-- re-runnable: it `create or replace`s the one function (no DROP — passes the expand-contract discipline
-- gate AC-NFR-INF.002.1) and re-binds NO triggers (the four t_append_only triggers already point at this
-- function name, so replacing the body updates all four atomically).
--
-- ⚠️ NOT YET RUN LIVE. Applying 0005 + proving it (normal DELETE still rejected; a `set local`-flagged
-- retention delete succeeds; floor rows survive) is the Stage-2 checkpoint, operator-run.

create or replace function enforce_audit_append_only() returns trigger
  language plpgsql
  set search_path = ''                                  -- hardening: unqualified names cannot be shadowed
as $$
begin
  if tg_op = 'DELETE' then
    -- Retention-prune whitelist (OD-180): a self-declared retention job may delete, transaction-locally.
    -- `current_setting(…, true)` = missing_ok → NULL when unset (never errors); NULL <> 'on' → still forbidden.
    if current_setting('app.retention_prune', true) = 'on' then
      return old;                                       -- allow this delete (floor enforced by the job, not here)
    end if;
    raise exception 'audit sink %: DELETE forbidden (append-only; retention prune must set app.retention_prune)', tg_table_name;
  end if;                                               -- UPDATE: allow only whitelisted mutations
  -- BUGFIX (Stage-2 checkpoint, session 66): the guardrail_log forward-transition MUST be an OUTER `if
  -- tg_table_name='guardrail_log'` — the previous `... and old.status=…` inline AND made PL/pgSQL evaluate
  -- `old.status` on EVERY sink, and event_log/access_audit/config_audit_log have no `status` column, so a
  -- redaction-tombstone UPDATE on those three raised "record old has no field status" (breaking AC-7.LOG.006.3
  -- / AC-7.LOG.008.4 / the compliance-erasure path) instead of being allowed. This 0005 replacement fixes it.
  if tg_table_name = 'guardrail_log' then
    if old.status = 'pending' and new.status in ('approved','rejected','modified')
       and new.description = old.description and new.task_id = old.task_id then
      return new;                                       -- forward status transition (still append-only in spirit)
    end if;
  elsif new.redacted_at is not null and old.redacted_at is null then
    return new;                                         -- one-way redaction-tombstone (FR-7.LOG.006 / OD-074)
  end if;
  raise exception 'audit sink %: in-place UPDATE forbidden (append-only / tamper-evident)', tg_table_name;
end $$;
