-- ISSUE-060 — migration 0009_guardrails (PROPOSED; the orchestrator mirrors this into app/silo/migrations +
-- app/silo/migrations/_journal.json and applies it live at the Stage-3 checkpoint — do NOT apply from an
-- offline builder). Authored to spec/04-data-model/schema.md §Types + §7 Guardrails + §Global rules.
--
-- THIS SINGLE MIGRATION SERVES BOTH ISSUE-060 (LOG/FMM/OPT sink) AND ISSUE-059 (INJ quarantine write path):
-- it stands up the Guardrails schema group — the enums, guardrail_log, injection_quarantine — and binds the
-- shared append-only trigger. ISSUE-059 writes INTO these tables; it does not re-create them.
--
-- Dependency order (schema.md / migrations.md): enums FIRST, then tables, then the trigger bind. The trigger
-- FUNCTION enforce_audit_append_only() is DEFINED by ISSUE-011 (migration 0005_retention_prune_whitelist, the
-- `create or replace` there). Its guardrail_log branch (schema.md §Global rules L60-64) already whitelists the
-- forward pending->{approved|rejected|modified} transition with description+task_id unchanged. This migration
-- only BINDS the trigger to the two new tables (schema.md L73-74 for guardrail_log; injection_quarantine is a
-- net-new shadow-retain sink bound the same way).
--
-- Phase-4 note (OD-096 / FR-10.ISO.001): NO `client_slug` column on either table — isolation is silo-per-client,
-- not a label column. The column exists only in the mgmt-plane client_registry.
--
-- Transactional: true (a normal BEGIN/COMMIT migration; no CONCURRENTLY here).

begin;

-- ── 1. Enums FIRST (schema.md §Types L120-122) ──────────────────────────────────────────────────────
-- The five-value guardrail_type is referenced by guardrail_log and by every writing slice (HRD/APR/ANM/INJ/RTL).
create type guardrail_type      as enum ('hard_limit','approval_gate','anomaly','rate_limit','prompt_injection');
create type guardrail_status    as enum ('pending','approved','rejected','modified');   -- 'modified' = FR-6.ESC.003
create type quarantine_decision as enum ('discard','approved_safe');                    -- null = pending

-- ── 2. guardrail_log (schema.md §7 L517-529) ────────────────────────────────────────────────────────
-- Append-only five-type security-event sink. The check constraint is the DB-level no-override guard
-- (AC-6.LOG.001.2): a hard_limit row can NEVER carry status='approved'. escalated_at is server-owned (⊕ net-new).
create table guardrail_log (                              -- append-only
  id             uuid primary key default gen_random_uuid(),
  task_id        uuid references task_queue(id),
  guardrail_type guardrail_type not null,
  description    text not null,
  action_blocked boolean not null,
  status         guardrail_status not null default 'pending',
  reviewed_by    uuid references profiles(id),
  reviewed_at    timestamptz,
  escalated_at   timestamptz,                             -- ⊕ net-new owed to C6 (server-owned)
  created_at     timestamptz not null default now(),
  check (not (guardrail_type = 'hard_limit' and status = 'approved'))  -- AC-6.LOG.001.2: no override
);

-- ── 3. injection_quarantine (schema.md §7 L531-542) ─────────────────────────────────────────────────
-- Net-new shadow-retain store (ADR-007 pt4): quarantined_content is NEVER machine-discarded. FK to
-- guardrail_log(id). Table only — ISSUE-059 owns the write PATH that fills it.
create table injection_quarantine (                       -- net-new; shadow-retain
  id                  uuid primary key default gen_random_uuid(),
  guardrail_log_id    uuid not null references guardrail_log(id),
  quarantined_content text not null,                      -- never machine-discarded
  source_tool         text not null,
  source_record_id    text,
  human_decision      quarantine_decision,                -- null = pending
  reviewed_by         uuid references profiles(id),
  reviewed_at         timestamptz,
  escalated_at        timestamptz,
  created_at          timestamptz not null default now()
);

-- ── 4a. Amend enforce_audit_append_only() to add an injection_quarantine branch ─────────────────────
-- ⚠️ SHARED-SPEC DELTA (see results/proposed-shared-spec.md): the ISSUE-011 function (schema.md §Global rules
-- L44-69) has ONLY a guardrail_log branch + a redaction-tombstone `elsif new.redacted_at ...`. injection_quarantine
-- has NEITHER a `status` NOR a `redacted_at` column, so binding the UN-amended trigger to it would (a) crash on the
-- `elsif new.redacted_at is not null` reference ("record new has no field redacted_at") and (b) reject the legitimate
-- forward `human_decision` transition (pending -> discard|approved_safe). So we `create or replace` the function
-- here, ADDITIVELY adding an injection_quarantine branch that whitelists that one forward decision transition
-- (with quarantined_content + guardrail_log_id unchanged — the shadow-retained content is never rewritten, and a
-- `discard` decision does NOT delete the row). Every existing branch is preserved byte-for-byte. This delta must be
-- mirrored back into schema.md §Global rules by the orchestrator (Rule 0).
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
  end if;                                             -- UPDATE: allow only whitelisted mutations
  if tg_table_name = 'guardrail_log' then
    if old.status = 'pending' and new.status in ('approved','rejected','modified')
       and new.description = old.description and new.task_id = old.task_id then
      return new;                                     -- forward status transition
    end if;
  elsif tg_table_name = 'injection_quarantine' then   -- ⊕ ISSUE-060 additive branch
    if old.human_decision is null and new.human_decision in ('discard','approved_safe')
       and new.quarantined_content = old.quarantined_content
       and new.guardrail_log_id = old.guardrail_log_id then
      return new;                                     -- forward human_decision transition (content shadow-retained)
    end if;
  elsif new.redacted_at is not null and old.redacted_at is null then
    return new;                                       -- one-way redaction-tombstone (FR-7.LOG.006 / OD-074)
  end if;
  raise exception 'audit sink %: in-place UPDATE forbidden (append-only / tamper-evident)', tg_table_name;
end $$;

-- ── 4b. Bind the shared append-only trigger (schema.md §Global rules L71-78) ─────────────────────────
create trigger t_append_only before update or delete on guardrail_log
  for each row execute function enforce_audit_append_only();
create trigger t_append_only before update or delete on injection_quarantine
  for each row execute function enforce_audit_append_only();

-- Belt-and-braces (schema.md L81-85): a normal-role DELETE can never even reach the trigger.
revoke delete on guardrail_log, injection_quarantine from anon, authenticated;

commit;
