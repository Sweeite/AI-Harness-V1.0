-- ISSUE-077 (app/log-retention) LIVE-SMOKE — replays the ACTUAL write-path statements of the live pg adapter
-- (app/log-retention/src/supabase-store.ts) against the real SILO DDL (app/silo/migrations 0001 baseline +
-- 0005 retention-prune whitelist + 0015 guardrail_log redacted_at + append-only trigger). Its job is to catch
-- column / enum / constraint / trigger-branch drift between the adapter's SQL and the migrated schema — the
-- "fake passes offline / live adapter throws" class.
--
-- DB target: SILO  →  run with:  psql "$SILO_DB_URL" -f app/log-retention/results/live-smoke.sql
-- Non-mutating: the whole script is wrapped in begin; ... rollback; so it is safe against the live silo.
-- Expect: a stream of  PASS ...  notices and a final  ALL ASSERTIONS PASS,  then ROLLBACK.
--
-- What each assertion mirrors (adapter method -> exact statement replayed):
--   SupabaseEventLogStore.all()             -> select ... from event_log order by created_at asc
--   SupabaseEventLogStore.redactTombstone() -> update event_log set summary='[redacted]', entity_ids=null,
--                                              payload=null, redacted_at=$2 where id=$1 and redacted_at is null
--   SupabaseEventLogStore.prune()           -> set local app.retention_prune='on'; delete from event_log where id=$1
--   SupabaseGuardrailLogStore.all()         -> select ... from guardrail_log order by created_at asc
--   SupabaseGuardrailLogStore.inRange()     -> select ... where created_at >= $1 and created_at <= $2 order by ...
--   SupabaseGuardrailLogStore.countInRange()-> select count(*)::text from guardrail_log where created_at between ...
--   SupabaseGuardrailLogStore.redactTombstone() -> update guardrail_log set description='[redacted]',
--                                              redacted_at=$2 where id=$1 and redacted_at is null
--   SupabaseGuardrailLogStore.prune()       -> set local app.retention_prune='on'; delete from guardrail_log where id=$1
--   SupabaseGuardrailLogStore.rewriteContent() -> update guardrail_log set description=$2 where id=$1  (MUST raise)
--
-- FK note: event_log.task_id and guardrail_log.task_id/reviewed_by are all NULLABLE FKs, so fixtures leave them
-- null — no parent task_queue/profiles row is required and no FK-missing throw can masquerade as drift.

\set ON_ERROR_STOP on
begin;

do $$
declare
  e_id   uuid;
  e_id2  uuid;
  g_id   uuid;
  g_id2  uuid;
  g_id3  uuid;
  g_id4  uuid;
  n_all  int;
  n_rng  int;
  n_cnt  bigint;
  v_txt  text;
  v_redacted timestamptz;
begin
  -- ══════════════════════════════════════════════════════════════════════════════════════════════════════
  -- event_log — the C7 retention + redaction-tombstone write path (SupabaseEventLogStore)
  -- ══════════════════════════════════════════════════════════════════════════════════════════════════════

  -- Fixture: two append-only rows. entity_ids is uuid[] (adapter reads it back); event_type is the enum; the
  -- adapter's redactTombstone blanks summary/entity_ids/payload — insert non-null values so the scrub is real.
  insert into event_log (event_type, entity_ids, summary, payload, duration_ms, cost_tokens, cost_unknown, answer_mode)
    values ('reporter_push', array[gen_random_uuid()], 'subject PII narrative', '{"k":"v"}'::jsonb, 12, 3, false, 'cited')
    returning id into e_id;
  insert into event_log (event_type, summary, cost_unknown)
    values ('task_completed', 'another event', false)
    returning id into e_id2;
  raise notice 'PASS event_log.insert: fixture rows created (columns/enums accepted)';

  -- (1) all() — the exact select-list the adapter reads back. A missing/renamed column throws here.
  select count(*) into n_all from (
    select id, task_id, event_type, entity_ids, summary, payload, duration_ms, cost_tokens,
           cost_unknown, answer_mode, redacted_at, created_at
      from event_log order by created_at asc
  ) q;
  if n_all < 2 then raise exception 'FAIL event_log.all: expected >=2 rows, got %', n_all; end if;
  raise notice 'PASS event_log.all: select-list matches DDL (% rows)', n_all;

  -- (2) redactTombstone() — the ONE whitelisted event_log UPDATE (null->non-null redacted_at + in-place scrub).
  update event_log
     set summary = '[redacted]', entity_ids = null, payload = null, redacted_at = now()
   where id = e_id and redacted_at is null;
  select summary, redacted_at into v_txt, v_redacted from event_log where id = e_id;
  if v_txt <> '[redacted]' or v_redacted is null then
    raise exception 'FAIL event_log.redactTombstone: scrub did not apply (summary=%, redacted_at=%)', v_txt, v_redacted;
  end if;
  raise notice 'PASS event_log.redactTombstone: authorized scrub accepted by append-only trigger';

  -- (2b) redactTombstone() is idempotent: WHERE redacted_at is null makes a re-run a 0-row no-op (never a re-scrub).
  update event_log
     set summary = '[redacted]', entity_ids = null, payload = null, redacted_at = now()
   where id = e_id and redacted_at is null;
  raise notice 'PASS event_log.redactTombstone: idempotent (already-redacted row untouched, 0-row no-op)';

  -- (3) GUARDED REJECT — a covert in-place UPDATE that is NOT the whitelisted tombstone must raise (append-only).
  begin
    update event_log set summary = 'tampered' where id = e_id2;   -- redacted_at stays null -> not whitelisted
    raise exception 'FAIL event_log.appendOnly: covert in-place UPDATE was ALLOWED';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS event_log.appendOnly: covert UPDATE rejected -> %', sqlerrm;
  end;

  -- (4) GUARDED REJECT — a naked DELETE (no retention-prune flag) must raise (#1: no silent knowledge loss).
  begin
    delete from event_log where id = e_id2;
    raise exception 'FAIL event_log.delete: naked DELETE was ALLOWED';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS event_log.delete: naked DELETE rejected (retention-prune flag required) -> %', sqlerrm;
  end;

  -- (5) prune() — the SANCTIONED delete: set local app.retention_prune='on' then delete. Adapter opens its own
  --     txn; here we mirror the flag+delete inside this outer txn (set local is txn-scoped and rolled back).
  set local app.retention_prune = 'on';
  delete from event_log where id = e_id2;
  if exists (select 1 from event_log where id = e_id2) then
    raise exception 'FAIL event_log.prune: row survived a whitelisted retention delete';
  end if;
  set local app.retention_prune = 'off';   -- restore the guard for the rest of the script
  raise notice 'PASS event_log.prune: whitelisted retention DELETE removed the row';

  -- ══════════════════════════════════════════════════════════════════════════════════════════════════════
  -- guardrail_log — view/export/retention/redaction (SupabaseGuardrailLogStore). redacted_at added by 0015.
  -- ══════════════════════════════════════════════════════════════════════════════════════════════════════

  -- Fixture: rows spanning a time window. status defaults 'pending'; guardrail_type enum; action_blocked NOT NULL.
  -- NB: the CHECK (not (guardrail_type='hard_limit' and status='approved')) — fixtures stay 'pending', safe.
  insert into guardrail_log (guardrail_type, description, action_blocked, status, created_at)
    values ('approval_gate', 'subject PII narrative', false, 'pending', now() - interval '2 days')
    returning id into g_id;
  insert into guardrail_log (guardrail_type, description, action_blocked, status, created_at)
    values ('anomaly', 'in-window event', true, 'pending', now() - interval '1 day')
    returning id into g_id2;
  insert into guardrail_log (guardrail_type, description, action_blocked, status)
    values ('prompt_injection', 'fresh covert-rewrite target', false, 'pending')
    returning id into g_id3;
  insert into guardrail_log (guardrail_type, description, action_blocked, status)
    values ('rate_limit', 'fresh redaction target', false, 'pending')
    returning id into g_id4;
  raise notice 'PASS guardrail_log.insert: fixture rows created (enums/CHECK/columns accepted)';

  -- (6) all() — the exact select-list the adapter reads (redacted_at is 0015-added; a drift throws here).
  select count(*) into n_all from (
    select id, task_id, guardrail_type, description, action_blocked, status, reviewed_by,
           reviewed_at, escalated_at, redacted_at, created_at
      from guardrail_log order by created_at asc
  ) q;
  if n_all < 4 then raise exception 'FAIL guardrail_log.all: expected >=4 rows, got %', n_all; end if;
  raise notice 'PASS guardrail_log.all: select-list matches DDL incl. redacted_at (% rows)', n_all;

  -- (7) inRange() — the export window predicate (created_at >= $1 and created_at <= $2). Same select-list.
  select count(*) into n_rng from (
    select id, task_id, guardrail_type, description, action_blocked, status, reviewed_by,
           reviewed_at, escalated_at, redacted_at, created_at
      from guardrail_log
     where created_at >= (now() - interval '3 days') and created_at <= now()
     order by created_at asc
  ) q;
  raise notice 'PASS guardrail_log.inRange: windowed select-list matches DDL (% rows)', n_rng;

  -- (8) countInRange() — the INDEPENDENT reconciliation count (all-or-nothing export, AF-133). count(*)::text cast.
  select count(*) into n_cnt from guardrail_log
   where created_at >= (now() - interval '3 days') and created_at <= now();
  if n_cnt <> n_rng then
    raise exception 'FAIL guardrail_log.countInRange: count (%) disagrees with inRange (%) in one snapshot', n_cnt, n_rng;
  end if;
  raise notice 'PASS guardrail_log.countInRange: independent count reconciles with inRange (%)', n_cnt;

  -- (9) redactTombstone() — the ONE whitelisted guardrail_log content mutation (0015 branch c): description ->
  --     '[redacted]' + redacted_at null->ts, every other field pinned. MUST be accepted by the trigger.
  update guardrail_log set description = '[redacted]', redacted_at = now()
   where id = g_id4 and redacted_at is null;
  select description, redacted_at into v_txt, v_redacted from guardrail_log where id = g_id4;
  if v_txt <> '[redacted]' or v_redacted is null then
    raise exception 'FAIL guardrail_log.redactTombstone: scrub did not apply (description=%, redacted_at=%)', v_txt, v_redacted;
  end if;
  raise notice 'PASS guardrail_log.redactTombstone: authorized scrub accepted (0015 branch c)';

  -- (9b) idempotent: WHERE redacted_at is null makes a re-run a 0-row no-op.
  update guardrail_log set description = '[redacted]', redacted_at = now()
   where id = g_id4 and redacted_at is null;
  raise notice 'PASS guardrail_log.redactTombstone: idempotent (0-row no-op on already-redacted row)';

  -- (10) rewriteContent() — GUARDED REJECT: a bare description rewrite with redacted_at still null is a covert
  --      tamper and MUST raise (no legal in-place content rewrite). This is the seam-proving statement.
  begin
    update guardrail_log set description = 'covertly rewritten' where id = g_id3;
    raise exception 'FAIL guardrail_log.rewriteContent: covert content REWRITE was ALLOWED';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS guardrail_log.rewriteContent: covert content REWRITE rejected -> %', sqlerrm;
  end;

  -- (11) GUARDED REJECT — a naked DELETE (no retention-prune flag) must raise.
  begin
    delete from guardrail_log where id = g_id;
    raise exception 'FAIL guardrail_log.delete: naked DELETE was ALLOWED';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS guardrail_log.delete: naked DELETE rejected (retention-prune flag required) -> %', sqlerrm;
  end;

  -- (12) prune() — the SANCTIONED guardrail_log retention delete under the flag.
  set local app.retention_prune = 'on';
  delete from guardrail_log where id = g_id;
  if exists (select 1 from guardrail_log where id = g_id) then
    raise exception 'FAIL guardrail_log.prune: row survived a whitelisted retention delete';
  end if;
  set local app.retention_prune = 'off';
  raise notice 'PASS guardrail_log.prune: whitelisted retention DELETE removed the row';

  -- (13) NEGATIVE CONTROL for the tombstone branch — a redaction that does NOT scrub description to the sentinel
  --      must be REJECTED (proves branch (c) is not a blanket "any change if redacted_at set" hole).
  begin
    update guardrail_log set redacted_at = now(), description = 'not the sentinel' where id = g_id2;
    raise exception 'FAIL guardrail_log.tombstone-guard: non-sentinel redaction was ALLOWED';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS guardrail_log.tombstone-guard: redaction without the sentinel scrub rejected -> %', sqlerrm;
  end;

  raise notice 'ALL ASSERTIONS PASS';
end $$;

rollback;
