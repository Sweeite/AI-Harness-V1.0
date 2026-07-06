-- Migration 0015 — guardrail_log redaction-tombstone (ISSUE-077). Additive. 🔴 audit-immutability change-control.
--
-- FR-7.LOG.007.4 / OD-074 require the SAME one-way redaction-tombstone on guardrail_log that event_log already
-- has: a compliance erasure scrubs `description` in place (to the sentinel '[redacted]') and stamps redacted_at,
-- while RETAINING the security event + its audit metadata (#1). 0001_baseline (H43 fix) deliberately gave
-- guardrail_log NO redacted_at column, and the append-only trigger's redaction branch (the final elsif) is
-- unreachable for guardrail_log because it already matches the outer `if tg_table_name = 'guardrail_log'`. So
-- two additive changes are owed:
--   1. add guardrail_log.redacted_at (the one-way tombstone target), and
--   2. add a THIRD whitelisted branch (c) INSIDE the guardrail_log block of enforce_audit_append_only().
--
-- ⚠️ CHANGE-CONTROL (OD-074, kin to OD-180/OD-182). This amends the LIVE audit-immutability function -- a
-- #1/#3 invariant. Every pre-existing branch (the (a) forward status transition, the (b) OD-182 escalation
-- stamp, the injection_quarantine block, the other-sink redaction elsif) is preserved BYTE-FOR-BYTE; only the
-- new guardrail_log branch (c) is added. The allowance is strictly one-way (redacted_at null->ts), scrubs only
-- `description` to the fixed sentinel, and pins every other field immutable -- so it is distinguishable from a
-- covert content rewrite (which leaves redacted_at null and is rejected). Mirror into schema.md §7 + §Global
-- rules (Rule 0). transactional:true -- do NOT add BEGIN/COMMIT. Re-runnable (IF NOT EXISTS + create or replace).

-- ── 1. The one-way tombstone target (reverses the 0001 H43 exclusion now that C7/ISSUE-077 owns the erasure). ──
alter table guardrail_log add column if not exists redacted_at timestamptz;   -- one-way redaction-tombstone target

-- ── 2. Re-create the shared append-only function, adding ONLY guardrail_log branch (c). ──────────────────────
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
    -- (a) forward status transition (pre-existing; task_id NULL-safe).
    if old.status = 'pending' and new.status in ('approved','rejected','modified')
       and new.description = old.description and new.task_id is not distinct from old.task_id then
      return new;
    end if;
    -- (b) OD-182 monotonic escalation stamp: escalated_at null->ts on a still-pending row; status/description/
    --     task_id/guardrail_type/reviewers unchanged; action_blocked only false->true.
    if old.escalated_at is null and new.escalated_at is not null
       and new.status = old.status
       and new.description = old.description and new.task_id is not distinct from old.task_id
       and new.guardrail_type = old.guardrail_type
       and new.reviewed_by is not distinct from old.reviewed_by
       and new.reviewed_at is not distinct from old.reviewed_at
       and (new.action_blocked = old.action_blocked or (old.action_blocked = false and new.action_blocked = true)) then
      return new;
    end if;
    -- (c) OD-074 / FR-7.LOG.007.4 one-way redaction-tombstone: redacted_at null->ts, description scrubbed to the
    --     sentinel, every OTHER field immutable. The ONLY in-place content mutation guardrail_log permits;
    --     distinguishable from tampering (redacted_at is set) -- the C7 export integrity check (AC-7.LOG.007.3)
    --     treats it as an authorized redaction (NFR-CMP.007), not a tamper.
    if old.redacted_at is null and new.redacted_at is not null
       and new.description = '[redacted]'
       and new.status = old.status
       and new.task_id is not distinct from old.task_id
       and new.guardrail_type = old.guardrail_type
       and new.action_blocked = old.action_blocked
       and new.reviewed_by is not distinct from old.reviewed_by
       and new.reviewed_at is not distinct from old.reviewed_at
       and new.escalated_at is not distinct from old.escalated_at
       and new.created_at = old.created_at then
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
