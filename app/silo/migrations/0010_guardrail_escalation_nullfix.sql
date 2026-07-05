-- Migration 0010 — NULL-safe fix for the guardrail_log branches of enforce_audit_append_only() (OD-182). 🔴
--
-- 0009 (and the pre-existing 0005 forward-status branch) compared `new.task_id = old.task_id`. task_id is
-- NULLABLE (an anomaly/injection guardrail row need not be tied to a task), so for a null-task row that
-- equality is `NULL = NULL → NULL` (not TRUE) — the whole AND chain is NULL, the branch is NOT taken, and a
-- legitimate forward status transition OR an OD-182 escalation stamp on a null-task row is wrongly rejected
-- as an in-place tamper. Caught by the OD-182 live proof (PASS A, FAIL B). Fix: `is not distinct from` (the
-- NULL-safe equality) on the nullable `task_id` in BOTH guardrail_log branches. Every other clause unchanged.
-- transactional:true — re-creates the function only; no data touched. Idempotent (create or replace).

create or replace function enforce_audit_append_only() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if current_setting('app.retention_prune', true) = 'on' then
      return old;
    end if;
    raise exception 'audit sink %: DELETE forbidden (append-only; retention prune must set app.retention_prune)', tg_table_name;
  end if;                                               -- UPDATE: allow only whitelisted mutations

  if tg_table_name = 'guardrail_log' then
    -- (a) forward status transition (pre-existing; task_id now NULL-safe).
    if old.status = 'pending' and new.status in ('approved','rejected','modified')
       and new.description = old.description and new.task_id is not distinct from old.task_id then
      return new;
    end if;
    -- (b) OD-182 monotonic escalation stamp: escalated_at null→ts on a still-pending row; status/description/
    --     task_id/guardrail_type/reviewers unchanged; action_blocked only false→true.
    if old.escalated_at is null and new.escalated_at is not null
       and new.status = old.status
       and new.description = old.description and new.task_id is not distinct from old.task_id
       and new.guardrail_type = old.guardrail_type
       and new.reviewed_by is not distinct from old.reviewed_by
       and new.reviewed_at is not distinct from old.reviewed_at
       and (new.action_blocked = old.action_blocked or (old.action_blocked = false and new.action_blocked = true)) then
      return new;
    end if;

  elsif tg_table_name = 'injection_quarantine' then
    if new.quarantined_content = old.quarantined_content
       and new.guardrail_log_id = old.guardrail_log_id
       and new.source_tool = old.source_tool
       and new.source_record_id is not distinct from old.source_record_id
       and new.created_at = old.created_at
       and (old.human_decision is null or new.human_decision = old.human_decision)
       and (old.escalated_at  is null or new.escalated_at  = old.escalated_at)
       and (new.human_decision is null or new.human_decision in ('discard','approved_safe')) then
      return new;
    end if;

  elsif new.redacted_at is not null and old.redacted_at is null then
    return new;                                         -- one-way redaction-tombstone on the other sinks (OD-074)
  end if;

  raise exception 'audit sink %: in-place UPDATE forbidden (append-only / tamper-evident)', tg_table_name;
end $$;
