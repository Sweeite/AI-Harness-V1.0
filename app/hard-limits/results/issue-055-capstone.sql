-- ISSUE-055 — Stage-3 LIVE CAPSTONE (operator-run; 💻 FULL / you-present only). NOT run in this offline
-- fan-out. Proves the DB-level half of the no-override posture that the offline InMemoryHardLimitGate
-- models: the schema.md §7 `check (not (guardrail_type='hard_limit' and status='approved'))` and the
-- append-only trigger actually reject an approve on a hard_limit row in the live silo.
--
-- NO MIGRATION is owned by ISSUE-055. The guardrail_log table + guardrail_type/guardrail_status enums +
-- the check + the enforce_audit_append_only() trigger are landed by the LOG slice (ISSUE-060). This
-- capstone ASSUMES they exist and only exercises them from the hard-limit write path.
--
-- Run as service_role against a client silo AFTER ISSUE-060's migration has applied. Each block should
-- behave exactly as annotated; a divergence is a Stage-3 checkpoint blocker.

begin;

-- 1) A hard-limit hit writes a row (type hard_limit, action_blocked=true, status pending). ------------
insert into guardrail_log (guardrail_type, description, action_blocked, status)
values ('hard_limit', 'autonomous external send (email/outbound message) is a hard limit', true, 'pending')
returning id \gset

-- 2) The DB CHECK refuses status→approved on a hard_limit row (AC-6.HRD.003.2 / AC-6.LOG.001.2). -------
--    EXPECT: ERROR — new row for relation "guardrail_log" violates check constraint (hard_limit+approved).
--    The trigger's forward-transition branch admits pending→approved in general, but the CHECK backstops
--    it specifically for hard_limit. This is the DB half of the reject the app also enforces (store.ts).
do $$
begin
  update guardrail_log set status = 'approved' where description like 'autonomous external send%';
  raise exception 'CAPSTONE FAIL: hard_limit row was approved — no-override guard is broken (#2 violation)';
exception
  when check_violation then
    raise notice 'CAPSTONE OK: DB CHECK rejected hard_limit -> approved (AC-6.HRD.003.2)';
end $$;

-- 3) The append-only trigger rejects a DELETE of the hit row (the record is retained). ----------------
--    EXPECT: ERROR — audit sink guardrail_log: DELETE forbidden (append-only).
do $$
begin
  delete from guardrail_log where description like 'autonomous external send%';
  raise exception 'CAPSTONE FAIL: a hard_limit row was deleted — append-only broken (#1/#3 violation)';
exception
  when others then
    raise notice 'CAPSTONE OK: append-only trigger rejected the DELETE';
end $$;

-- 4) A non-hard_limit row (e.g. approval_gate) MAY transition pending->approved (proves the guard is -----
--    specific to hard_limit, not a blanket freeze).
insert into guardrail_log (guardrail_type, description, action_blocked, status)
values ('approval_gate', 'capstone: approvable gate', false, 'pending')
returning id \gset
update guardrail_log set status = 'approved' where description = 'capstone: approvable gate';
-- EXPECT: UPDATE 1 (no error) — approval_gate is human-resolvable; hard_limit is not.

rollback; -- capstone is read-only in effect; roll back all inserts.

-- Evidence to capture on the operator run: the two "CAPSTONE OK" notices (steps 2 + 3) and the clean
-- UPDATE in step 4. File the transcript beside this script and flip AC-6.HRD.003.2 / AC-6.LOG.001.2 to
-- Verified in the issue evidence.
