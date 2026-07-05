-- Migration 0009 — guardrails append-only extension (ISSUE-060 + ISSUE-059). Stage-3. 🔴 audit-immutability.
--
-- The guardrail_log + injection_quarantine TABLES, the guardrail_type/guardrail_status/quarantine_decision
-- enums, and the guardrail_log no-override CHECK all already exist (0001_baseline.sql). guardrail_log is
-- already bound to the shared append-only trigger t_append_only (baseline L709). This migration adds only
-- what the baseline lacked, all additive:
--   1. Re-creates enforce_audit_append_only() to ALSO cover injection_quarantine (a #1 shadow-retain sink
--      that baseline never bound) AND to permit a monotonic ESCALATION stamp on guardrail_log (OD-182).
--   2. Binds t_append_only to injection_quarantine (new) + revokes normal-role DELETE on it.
--
-- ⚠️ CHANGE-CONTROL / OD-182 (2026-07-05). This amends the LIVE audit-immutability function — a #1/#3
-- invariant (kin to OD-180). The escalation whitelist is the reason: ISSUE-057 markEscalated and ISSUE-059
-- escalateStale must stamp `escalated_at` on a still-`pending` row so a stale/un-actioned quarantine is
-- escalated rather than silently abandoned (AC-6.ANM.003.2 / AC-6.INJ.006.4). Without this the UPDATE hits
-- `in-place UPDATE forbidden` and rolls back → the never-silently-abandon guarantee fails at the DB layer.
-- The allowance is strictly MONOTONIC and content-preserving: escalated_at only null→timestamp, decision only
-- write-once, the shadow-retained content / linkage / created_at NEVER change, action_blocked only false→true.
-- Every pre-existing branch is preserved byte-for-byte. Mirror into schema.md §Global rules (Rule 0 — done).
-- transactional:true — do NOT add BEGIN/COMMIT.

-- ── 1. Re-create the shared append-only function (additive branches only) ────────────────────────────
create or replace function enforce_audit_append_only() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- Retention-prune whitelist (OD-180): a self-declared retention job may delete, transaction-locally.
    if current_setting('app.retention_prune', true) = 'on' then
      return old;
    end if;
    raise exception 'audit sink %: DELETE forbidden (append-only; retention prune must set app.retention_prune)', tg_table_name;
  end if;                                               -- UPDATE: allow only whitelisted mutations

  if tg_table_name = 'guardrail_log' then
    -- (a) forward status transition (pre-existing, byte-for-byte).
    if old.status = 'pending' and new.status in ('approved','rejected','modified')
       and new.description = old.description and new.task_id = old.task_id then
      return new;
    end if;
    -- (b) OD-182 monotonic escalation stamp: escalated_at null→ts on a still-pending row; status/description/
    --     task_id/guardrail_type/reviewers unchanged; action_blocked may only escalate false→true.
    if old.escalated_at is null and new.escalated_at is not null
       and new.status = old.status
       and new.description = old.description and new.task_id = old.task_id
       and new.guardrail_type = old.guardrail_type
       and new.reviewed_by is not distinct from old.reviewed_by
       and new.reviewed_at is not distinct from old.reviewed_at
       and (new.action_blocked = old.action_blocked or (old.action_blocked = false and new.action_blocked = true)) then
      return new;
    end if;

  elsif tg_table_name = 'injection_quarantine' then
    -- Shadow-retained content is immutable forever (#1). A review decision + an escalation stamp are the
    -- only legitimate mutations, both WRITE-ONCE/monotonic. A `discard` decision does NOT delete the row.
    if new.quarantined_content = old.quarantined_content
       and new.guardrail_log_id = old.guardrail_log_id
       and new.source_tool = old.source_tool
       and new.source_record_id is not distinct from old.source_record_id
       and new.created_at = old.created_at
       and (old.human_decision is null or new.human_decision = old.human_decision)   -- decision write-once
       and (old.escalated_at  is null or new.escalated_at  = old.escalated_at)        -- escalation stamp write-once
       and (new.human_decision is null or new.human_decision in ('discard','approved_safe')) then
      return new;
    end if;

  elsif new.redacted_at is not null and old.redacted_at is null then
    return new;                                         -- one-way redaction-tombstone on the other sinks (OD-074)
  end if;

  raise exception 'audit sink %: in-place UPDATE forbidden (append-only / tamper-evident)', tg_table_name;
end $$;

-- ── 2. Bind t_append_only to injection_quarantine (new; guardrail_log is already bound in baseline and now
--       auto-uses the re-created function). Belt-and-braces DELETE revoke for normal roles. ──────────────
create or replace trigger t_append_only before update or delete on injection_quarantine
  for each row execute function enforce_audit_append_only();

revoke delete on injection_quarantine from anon, authenticated;
