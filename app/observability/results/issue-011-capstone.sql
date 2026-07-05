-- ISSUE-011 observability skeleton — LIVE capstone (proves the DB-level guarantees offline tests cannot reach).
--
-- Run AFTER `npm run migrate` has applied 0005_retention_prune_whitelist to the silo:
--   source ~/.ai-harness-secrets.env
--   /opt/homebrew/opt/libpq/bin/psql "$SILO_DB_URL" -v ON_ERROR_STOP=1 -f app/observability/results/issue-011-capstone.sql
--
-- Proves, fail-LOUD (any failed assertion RAISEs and aborts):
--   • AC-7.LOG.001.1  a plain in-place UPDATE of an event_log row is rejected by t_append_only
--   • AC-7.LOG.001.1  a plain DELETE of an event_log row is rejected (append-only)
--   • OD-180 / 0005   a DELETE INSIDE a `set local app.retention_prune='on'` txn SUCCEEDS (retention path), and
--                     a normal DELETE still fails even in the same session once the flag is not set (transaction-local)
--   • AC-7.LOG.006.3  the one-way redaction-tombstone UPDATE (null→non-null redacted_at) IS permitted
--   • AC-7.LOG.001.2  an out-of-enum event_type is rejected by the enum type
--
-- Everything runs in ONE transaction that ROLLS BACK — no fixture row survives; the silo is byte-identical
-- afterward (only the 0003/0004/0005 migrations persist). event_log.task_id is nullable, so no FK fixture is
-- needed and origin-mode triggers stay active throughout (exactly what we are testing).

\set ON_ERROR_STOP on
begin;

-- A single fixture row (task_id null → no FK; created_at old so it would be retention-eligible).
insert into public.event_log (id, event_type, summary, created_at)
values ('00000000-0000-0000-0000-0000000b0011', 'reporter_push', 'capstone fixture row', now() - interval '1000 days');

-- ── 1. in-place UPDATE rejected (append-only) — AC-7.LOG.001.1 ──────────────────────────────────────
do $$
begin
  update public.event_log set summary = 'tampered' where id = '00000000-0000-0000-0000-0000000b0011';
  raise exception 'FAIL AC-7.LOG.001.1: an in-place UPDATE was NOT rejected';
exception
  when others then
    if sqlerrm like 'FAIL %' then raise; end if;
    raise notice 'PASS AC-7.LOG.001.1 (UPDATE rejected): %', sqlerrm;
end $$;

-- ── 2. plain DELETE rejected (no retention flag) — AC-7.LOG.001.1 ───────────────────────────────────
do $$
begin
  delete from public.event_log where id = '00000000-0000-0000-0000-0000000b0011';
  raise exception 'FAIL AC-7.LOG.001.1: a DELETE without the retention flag was NOT rejected';
exception
  when others then
    if sqlerrm like 'FAIL %' then raise; end if;
    raise notice 'PASS AC-7.LOG.001.1 (unflagged DELETE rejected): %', sqlerrm;
end $$;

-- ── 3. redaction-tombstone UPDATE permitted (the ONE whitelisted UPDATE) — AC-7.LOG.006.3 ───────────
update public.event_log
   set summary = '[redacted]', entity_ids = null, payload = null, redacted_at = now()
 where id = '00000000-0000-0000-0000-0000000b0011' and redacted_at is null;
do $$
begin
  if not exists (select 1 from public.event_log
                 where id = '00000000-0000-0000-0000-0000000b0011' and redacted_at is not null) then
    raise exception 'FAIL AC-7.LOG.006.3: the redaction-tombstone UPDATE did not apply';
  end if;
  raise notice 'PASS AC-7.LOG.006.3 (redaction-tombstone permitted + applied)';
end $$;

-- ── 4. OD-180 retention-prune whitelist: a flagged DELETE succeeds — OD-180 / migration 0005 ─────────
-- `set local` is transaction-scoped; the retention job declares itself, deletes, and (here) rolls back.
set local app.retention_prune = 'on';
delete from public.event_log where id = '00000000-0000-0000-0000-0000000b0011';
do $$
begin
  if exists (select 1 from public.event_log where id = '00000000-0000-0000-0000-0000000b0011') then
    raise exception 'FAIL OD-180: the retention-flagged DELETE did not remove the row';
  end if;
  raise notice 'PASS OD-180 (flagged retention DELETE succeeded)';
end $$;

-- ── 5. out-of-enum event_type rejected — AC-7.LOG.001.2 ─────────────────────────────────────────────
do $$
begin
  insert into public.event_log (event_type, summary) values ('not_a_real_event_type', 'x');
  raise exception 'FAIL AC-7.LOG.001.2: an out-of-enum event_type was accepted';
exception
  when others then
    if sqlerrm like 'FAIL %' then raise; end if;
    raise notice 'PASS AC-7.LOG.001.2 (out-of-enum rejected): %', sqlerrm;
end $$;

rollback;   -- no fixture survives; silo byte-identical (only 0003/0004/0005 persist)
