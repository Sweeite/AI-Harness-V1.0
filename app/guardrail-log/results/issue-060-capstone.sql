-- ISSUE-060 guardrail_log sink — LIVE capstone (proves the DB-level guarantees the offline reference model
-- re-implements but cannot itself reach: the real check constraint rejecting a hard_limit override, the real
-- t_append_only trigger rejecting a delete/content-rewrite while permitting the forward transition, the real FK,
-- and the shadow-retain of a discarded quarantine row). Run by the OPERATOR at the Stage-3 checkpoint (a 💻
-- full/live env), NOT by an offline builder.
--
-- Run AFTER `npm run migrate` has applied 0009_guardrails to the silo:
--   source ~/.ai-harness-secrets.env
--   /opt/homebrew/opt/libpq/bin/psql "$SILO_DB_URL" -v ON_ERROR_STOP=1 -f app/guardrail-log/results/issue-060-capstone.sql
--
-- Proves, fail-LOUD (any failed assertion RAISEs and aborts):
--   • AC-6.LOG.001.2  a hard_limit row inserted with status='approved' is rejected by the check constraint
--   • AC-6.LOG.001.2  a hard_limit row resolved (pending->approved) is rejected (constraint holds via the trigger path)
--   • AC-6.LOG.002.1  a plain in-place content UPDATE of a historical row is rejected by t_append_only
--   • AC-6.LOG.002.1  a plain DELETE of a historical row is rejected (append-only)
--   • AC-6.LOG.002.1  the whitelisted forward transition (pending->rejected, description/task_id unchanged) IS permitted
--   • FK / shadow    an injection_quarantine row with a dangling guardrail_log_id is rejected (FK); a `discard`
--                    decision retains the row + content (shadow-retain, not a delete)
--
-- Everything runs in ONE transaction that ROLLS BACK — no fixture survives; the silo is byte-identical afterward
-- (only 0009 persists). task_id/reviewed_by are nullable, so no FK fixture is needed for guardrail_log.

\set ON_ERROR_STOP on
begin;

-- A pending hard_limit fixture + a pending approval_gate fixture.
insert into public.guardrail_log (id, guardrail_type, description, action_blocked, status)
values ('00000000-0000-0000-0000-0000000c0060', 'hard_limit',    'capstone: spend cap hit', true,  'pending'),
       ('00000000-0000-0000-0000-0000000c0061', 'approval_gate', 'capstone: approval wait', false, 'pending');

-- ── 1. hard_limit + approved rejected at INSERT — AC-6.LOG.001.2 ────────────────────────────────────
do $$
begin
  insert into public.guardrail_log (guardrail_type, description, action_blocked, status)
  values ('hard_limit', 'capstone: illegal approve', true, 'approved');
  raise exception 'FAIL AC-6.LOG.001.2: a hard_limit row with status=approved was accepted at insert';
exception
  when others then
    if sqlerrm like 'FAIL %' then raise; end if;
    raise notice 'PASS AC-6.LOG.001.2 (insert hard_limit+approved rejected): %', sqlerrm;
end $$;

-- ── 2. hard_limit resolved to approved rejected — AC-6.LOG.001.2 ────────────────────────────────────
do $$
begin
  update public.guardrail_log set status = 'approved', reviewed_by = null, reviewed_at = now()
   where id = '00000000-0000-0000-0000-0000000c0060';
  raise exception 'FAIL AC-6.LOG.001.2: a hard_limit row was resolved to approved';
exception
  when others then
    if sqlerrm like 'FAIL %' then raise; end if;
    raise notice 'PASS AC-6.LOG.001.2 (resolve hard_limit->approved rejected): %', sqlerrm;
end $$;

-- ── 3. in-place content UPDATE rejected (append-only) — AC-6.LOG.002.1 ──────────────────────────────
do $$
begin
  update public.guardrail_log set description = 'tampered' where id = '00000000-0000-0000-0000-0000000c0061';
  raise exception 'FAIL AC-6.LOG.002.1: a content rewrite was NOT rejected';
exception
  when others then
    if sqlerrm like 'FAIL %' then raise; end if;
    raise notice 'PASS AC-6.LOG.002.1 (content rewrite rejected): %', sqlerrm;
end $$;

-- ── 4. plain DELETE rejected — AC-6.LOG.002.1 ───────────────────────────────────────────────────────
do $$
begin
  delete from public.guardrail_log where id = '00000000-0000-0000-0000-0000000c0061';
  raise exception 'FAIL AC-6.LOG.002.1: a DELETE was NOT rejected';
exception
  when others then
    if sqlerrm like 'FAIL %' then raise; end if;
    raise notice 'PASS AC-6.LOG.002.1 (DELETE rejected): %', sqlerrm;
end $$;

-- ── 5. the whitelisted forward transition IS permitted — AC-6.LOG.002.1 ─────────────────────────────
update public.guardrail_log set status = 'rejected', reviewed_by = null, reviewed_at = now()
 where id = '00000000-0000-0000-0000-0000000c0061' and status = 'pending';
do $$
begin
  if not exists (select 1 from public.guardrail_log
                 where id = '00000000-0000-0000-0000-0000000c0061' and status = 'rejected') then
    raise exception 'FAIL AC-6.LOG.002.1: the whitelisted forward transition did not apply';
  end if;
  raise notice 'PASS AC-6.LOG.002.1 (forward pending->rejected permitted + applied)';
end $$;

-- ── 6. injection_quarantine FK + shadow-retain — schema §7 / ADR-007 pt4 ────────────────────────────
do $$
begin
  insert into public.injection_quarantine (guardrail_log_id, quarantined_content, source_tool)
  values ('00000000-0000-0000-0000-0000000000ff', 'dangling', 'x');   -- no such guardrail_log row
  raise exception 'FAIL FK: a dangling guardrail_log_id was accepted';
exception
  when others then
    if sqlerrm like 'FAIL %' then raise; end if;
    raise notice 'PASS FK (dangling quarantine reference rejected): %', sqlerrm;
end $$;

insert into public.injection_quarantine (id, guardrail_log_id, quarantined_content, source_tool)
values ('00000000-0000-0000-0000-0000000c00ff', '00000000-0000-0000-0000-0000000c0060', 'malicious payload', 'gmail');
-- a `discard` decision must RETAIN the row + content (shadow-retain, not a delete).
update public.injection_quarantine set human_decision = 'discard', reviewed_at = now()
 where id = '00000000-0000-0000-0000-0000000c00ff' and human_decision is null;
do $$
begin
  if not exists (select 1 from public.injection_quarantine
                 where id = '00000000-0000-0000-0000-0000000c00ff'
                   and human_decision = 'discard' and quarantined_content = 'malicious payload') then
    raise exception 'FAIL shadow-retain: a discarded quarantine row lost its content or was deleted';
  end if;
  raise notice 'PASS shadow-retain (discard retains row + content)';
end $$;

rollback;   -- no fixture survives; silo byte-identical (only 0009 persists)
