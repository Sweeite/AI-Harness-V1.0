-- ISSUE-036 (tool-optimisation) LIVE-SMOKE — replays the SupabaseOptEventSink.append() write-path against
-- the real silo DDL, rolled back (non-mutating), so running it live catches any column/enum/constraint
-- drift (the fake-passes-offline / live-adapter-throws class of BLOCKER).
--
-- Target DB: SILO ($SILO_DB_URL).  Run: psql "$SILO_DB_URL" -f this.  Expect ALL ASSERTIONS PASS, ROLLBACK.
--
-- What the live adapter actually runs (src/supabase-store.ts L41-45), the ONLY statement it issues:
--     insert into event_log (task_id, event_type, summary, payload)
--       values ($1, $2::event_type, $3, $4)                 -- $2 cast to enum, $4 = JSON.stringify(payload)
-- plus two application-level fail-closed guards BEFORE the DB (L31-38): event_type must be in the
-- OPT-admitted set {tool_selection_ask, tool_unavailable}, and summary must be non-empty.
--
-- Drift this catches:
--   • the two OPT event_type enum values (migration 0011) must be present, or the ::event_type cast raises
--     'invalid input value for enum event_type' (the exact fail-closed throw the adapter documents).
--   • event_log columns task_id / event_type / summary / payload must exist with the expected types.
--   • summary NOT NULL must be enforced (AC-7.LOG.002.2) — the adapter's non-empty guard pairs with it.
--   • event_log is append-only (t_append_only) — the adapter ONLY ever INSERTs; an in-place UPDATE must
--     be REJECTED live (its append-only contract, #1 tamper-evidence).
--
-- FK note: event_log.task_id references task_queue(id). We insert a task_queue parent row WITHIN the txn
-- first so the attributed-event insert satisfies the FK (a FK-missing throw would be a fixture bug, not
-- real drift). We also replay the task_id = NULL path (the adapter allows a null task attribution).
\set ON_ERROR_STOP on
begin;

do $$
declare
  v_task  uuid;
  v_ask   uuid;
  v_gap   uuid;
  v_null  uuid;
begin
  -- ── Fixture: a task_queue parent so event_log.task_id FK is satisfied. task_type enum (0001 L51) =
  --    {scheduled,event,human,chained}; task_name is NOT NULL. Only NOT-NULL-without-default cols supplied. ─
  insert into task_queue (type, task_name)
    values ('scheduled', '__opt036_smoke__') returning id into v_task;

  -- ── WRITE 1 — FR-3.OPT.001 tool_selection_ask (below-threshold ask). Mirrors emitAsk() -> append():
  --    event_type cast to enum, summary non-empty, payload = redacted structured detail (jsonb). ─────────
  begin
    insert into event_log (task_id, event_type, summary, payload)
      values (
        v_task,
        'tool_selection_ask'::event_type,
        'Tool selection asked instead of calling: confidence 0.42 below threshold 0.7',
        '{"reason":"confidence 0.42 below threshold 0.7","confidence":0.42,"candidate":"gmail.send"}'::jsonb
      ) returning id into v_ask;
    raise notice 'PASS write1: tool_selection_ask INSERT accepted (enum value present, columns match) -> %', v_ask;
  exception when others then
    raise exception 'FAIL write1: tool_selection_ask INSERT threw (enum/column drift) -> %', sqlerrm;
  end;

  -- ── WRITE 2 — FR-3.OPT.004 tool_unavailable (missing-tool gap). Mirrors degrade() -> append(). ─────────
  begin
    insert into event_log (task_id, event_type, summary, payload)
      values (
        v_task,
        'tool_unavailable'::event_type,
        'Tool ''gmail.send'' unavailable (disconnected); gap flagged, doable part completed',
        '{"missing_tool":"gmail.send","reason":"disconnected","skipped":["send confirmation"],"blocking":false}'::jsonb
      ) returning id into v_gap;
    raise notice 'PASS write2: tool_unavailable INSERT accepted (enum value present, columns match) -> %', v_gap;
  exception when others then
    raise exception 'FAIL write2: tool_unavailable INSERT threw (enum/column drift) -> %', sqlerrm;
  end;

  -- ── WRITE 3 — NULL task attribution path (adapter passes ev.task_id which may be null; task_id nullable).
  begin
    insert into event_log (task_id, event_type, summary, payload)
      values (
        null,
        'tool_selection_ask'::event_type,
        'Tool selection asked instead of calling: no candidate tool met the selection bar',
        '{"reason":"no candidate tool met the selection bar","confidence":0.0,"candidate":null}'::jsonb
      ) returning id into v_null;
    raise notice 'PASS write3: null-task_id INSERT accepted (null attribution path) -> %', v_null;
  exception when others then
    raise exception 'FAIL write3: null-task_id INSERT threw -> %', sqlerrm;
  end;

  -- ── GUARD A — event_log is APPEND-ONLY (t_append_only). The adapter ONLY ever INSERTs; an in-place
  --    UPDATE on a fresh (non-redaction) row MUST be rejected. (#1 tamper-evidence.) ──────────────────────
  begin
    update event_log set summary = 'tampered' where id = v_ask;
    raise exception 'FAIL guardA: event_log in-place UPDATE was ALLOWED (append-only broken)';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS guardA: event_log in-place UPDATE rejected (append-only) -> %', sqlerrm;
  end;

  -- ── GUARD B — DELETE on event_log MUST be rejected (append-only; the adapter never deletes). ───────────
  begin
    delete from event_log where id = v_gap;
    raise exception 'FAIL guardB: event_log DELETE was ALLOWED (append-only broken)';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS guardB: event_log DELETE rejected (append-only) -> %', sqlerrm;
  end;

  -- ── GUARD C — summary NOT NULL (AC-7.LOG.002.2). The adapter's non-empty guard pairs with this DB
  --    constraint; a null summary MUST be rejected by the DB. ────────────────────────────────────────────
  begin
    insert into event_log (task_id, event_type, summary, payload)
      values (v_task, 'tool_selection_ask'::event_type, null, '{}'::jsonb);
    raise exception 'FAIL guardC: event_log INSERT with null summary was ALLOWED (NOT NULL broken)';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS guardC: null-summary INSERT rejected (summary NOT NULL) -> %', sqlerrm;
  end;

  -- ── GUARD D — the enum fail-closed floor. A value OUTSIDE the event_type enum MUST raise on the
  --    ::event_type cast (the exact 'invalid input value for enum event_type' the adapter documents as
  --    correct fail-closed #3 behaviour). This is the drift sentinel: if this ever SUCCEEDS the enum has
  --    been widened wrongly. ─────────────────────────────────────────────────────────────────────────────
  begin
    insert into event_log (task_id, event_type, summary, payload)
      values (v_task, 'not_a_real_event'::event_type, 'should never insert', '{}'::jsonb);
    raise exception 'FAIL guardD: bogus event_type cast was ACCEPTED (enum fail-closed floor broken)';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS guardD: bogus event_type rejected (enum fail-closed) -> %', sqlerrm;
  end;

  raise notice 'ALL ASSERTIONS PASS';
end $$;

rollback;
