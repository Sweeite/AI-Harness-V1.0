-- Migration 0021 — task_queue append-only: close the no-delete gap the Checkpoint-3 adversarial review
-- caught (session 72). 0001c_rls.sql:70 revoked DELETE on event_log/guardrail_log/access_audit/
-- config_audit_log from anon/authenticated/service_role, but task_queue (FR-5.QUE.001 / CLAUDE.md Rule 0
-- §1 "task_queue no-delete") was never added to that list — service_role (the role the harness runtime
-- authenticates as) still held DELETE. Confirmed live: task_history.task_id FKs task_queue ON DELETE
-- CASCADE, so a single permitted DELETE would have silently taken the task's whole audit trail with it —
-- no error, no signal (#1 + #3). This migration is the belt-and-braces the other append-only sinks already
-- have; it changes no application code, only the grant.
--
-- transactional:true -- do NOT add BEGIN/COMMIT.

revoke delete on public.task_queue from anon, authenticated, service_role;
