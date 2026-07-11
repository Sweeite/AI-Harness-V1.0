-- Client-silo migration 0048 (CONTRACT) — fix the deletion_requests two-person distinctness CHECKs to be NULL-tolerant
-- (ISSUE-082, C10 individual right-to-erasure workflow; latent bug in 0001_baseline discovered by the ISSUE-082 R10
-- live smoke -- 082 is the first consumer to ever insert a deletion_requests row).
--
-- CONTRACT migration (the DROP CONSTRAINT is a destructive change, permitted ONLY in a dedicated *_contract migration,
-- AC-NFR-INF.002.1). Justified: NO deployment has EVER inserted a deletion_requests row (ISSUE-082 is the first
-- consumer + it ships WITH this fix), so no deployment reads the old (buggy) constraint shape -- the expand-contract
-- precondition ("no deployment reads the old shape") holds immediately.
--
-- BUG: the baseline CHECKs are `second_authoriser_id IS DISTINCT FROM authorized_by` and
-- `executor_id IS DISTINCT FROM authorized_by AND executor_id IS DISTINCT FROM second_authoriser_id`. `IS DISTINCT
-- FROM` returns FALSE (not NULL) when BOTH operands are NULL -- so an intake row (status='received', all three
-- authoriser roles NULL, per AC-10.DEL.001.1) evaluates the CHECK to FALSE and is REJECTED. The baseline comment
-- claimed `is distinct from` "allows pre-fill nulls" -- it does not -- so the table was uninsertable at intake since
-- 0001 (never caught because no code inserted a deletion_requests row until ISSUE-082). This blocks the entire
-- right-to-erasure queue (#2 legal obligation cannot even be recorded / #3 the schema silently forbade its own
-- documented intake path).
--
-- FIX: replace the two distinctness CHECKs with NULL-tolerant forms that STILL reject a same-person collision (the
-- AC-10.DEL.006.2 / OD-093 no-self-authorisation guarantee) but ALLOW the pre-fill nulls of intake + partial
-- authorisation. Semantics per pair: pass when either side is NULL, fail only when both are non-NULL and equal. The
-- status='executed' all-three-non-null CHECK (deletion_requests_check2) is correct + is kept unchanged -- it is what
-- guarantees three real distinct authorisers AT execution. This matches the InMemory fake's assertDistinctness (which
-- already implemented the intended null-tolerant semantics) -- so after this migration the fake and live agree (R10).
--
-- transactional:true -- plain ALTER TABLE DROP/ADD CONSTRAINT, no CONCURRENTLY / no ALTER TYPE ADD VALUE.

alter table deletion_requests drop constraint deletion_requests_check;
alter table deletion_requests drop constraint deletion_requests_check1;

alter table deletion_requests add constraint deletion_requests_second_distinct
  check (second_authoriser_id is null or authorized_by is null or second_authoriser_id <> authorized_by);

alter table deletion_requests add constraint deletion_requests_executor_distinct
  check ((executor_id is null or authorized_by is null or executor_id <> authorized_by)
         and (executor_id is null or second_authoriser_id is null or executor_id <> second_authoriser_id));
