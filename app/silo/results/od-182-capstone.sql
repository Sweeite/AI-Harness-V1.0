-- OD-182 live proof — the widened append-only trigger (migration 0009) on guardrail_log + injection_quarantine.
-- One rolled-back transaction; each expected-RAISE is caught in a subblock so the txn survives to the next check.
-- Run against the silo as the migration role (fires regardless of role — the trigger is not RLS).
begin;

do $$
declare
  gid uuid;
  qid uuid;
  ok  boolean;
begin
  -- Seed a pending guardrail_log row (INSERT is not gated by the append-only trigger).
  insert into guardrail_log (guardrail_type, description, action_blocked, status)
    values ('prompt_injection', 'od-182 live proof row', false, 'pending')
    returning id into gid;

  -- A. a normal in-place mutation is STILL rejected (tamper-evidence preserved).
  ok := false;
  begin
    update guardrail_log set description = 'tampered' where id = gid;
  exception when others then ok := true;
  end;
  if not ok then raise exception 'OD-182 FAIL A: in-place description rewrite was NOT rejected'; end if;
  raise notice 'OD-182 PASS A: in-place mutation rejected';

  -- B. a monotonic escalated_at stamp on a still-pending row SUCCEEDS (the 057/059 fix).
  update guardrail_log set escalated_at = now(), action_blocked = true where id = gid;  -- status stays 'pending'
  perform 1 from guardrail_log where id = gid and escalated_at is not null and status = 'pending';
  if not found then raise exception 'OD-182 FAIL B: escalated_at stamp did not persist with status pending'; end if;
  raise notice 'OD-182 PASS B: monotonic escalated_at stamp accepted (status unchanged)';

  -- B2. a re-stamp (non-monotonic) is rejected — escalated_at is write-once.
  ok := false;
  begin
    update guardrail_log set escalated_at = now() + interval '1 hour' where id = gid;
  exception when others then ok := true;
  end;
  if not ok then raise exception 'OD-182 FAIL B2: escalated_at re-stamp was NOT rejected'; end if;
  raise notice 'OD-182 PASS B2: escalated_at re-stamp rejected (write-once)';

  -- C. injection_quarantine (now bound to the trigger): content immutable, decision write-once, no delete.
  insert into injection_quarantine (guardrail_log_id, quarantined_content, source_tool)
    values (gid, 'retained malicious payload', 'test_tool')
    returning id into qid;

  ok := false;
  begin
    update injection_quarantine set quarantined_content = 'erased' where id = qid;
  exception when others then ok := true;
  end;
  if not ok then raise exception 'OD-182 FAIL C1: quarantined_content rewrite was NOT rejected (#1 retain)'; end if;
  raise notice 'OD-182 PASS C1: quarantined_content rewrite rejected (shadow-retain holds)';

  -- a forward human_decision is accepted; the row is retained (discard != delete).
  update injection_quarantine set human_decision = 'discard' where id = qid;
  perform 1 from injection_quarantine where id = qid;
  if not found then raise exception 'OD-182 FAIL C2: the row vanished on a discard decision (#1)'; end if;
  raise notice 'OD-182 PASS C2: human_decision recorded, row retained';

  ok := false;
  begin
    delete from injection_quarantine where id = qid;
  exception when others then ok := true;
  end;
  if not ok then raise exception 'OD-182 FAIL C3: a DELETE on injection_quarantine was NOT rejected'; end if;
  raise notice 'OD-182 PASS C3: injection_quarantine DELETE rejected';

  raise notice 'OD-182 ALL ASSERTIONS PASS';
end $$;

rollback;
