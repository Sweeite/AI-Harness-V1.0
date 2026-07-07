-- ISSUE-049 (app/task-graphs) — LIVE-SMOKE for the pg adapters in src/supabase-store.ts.
-- Replays the ADAPTER'S ACTUAL write-path statements (same tables, columns, casts, guarded WHEREs,
-- enum values) against the REAL silo DDL so a live run catches any column/enum/constraint drift —
-- the fake-passes-offline / live-adapter-throws class that has produced every BLOCKER in this build.
--
-- Target DB: SILO ($SILO_DB_URL). Rolled back (non-mutating) — safe to run against the live silo.
-- Run: psql "$SILO_DB_URL" -f app/task-graphs/results/live-smoke.sql   → expect ALL ASSERTIONS PASS, then ROLLBACK.
--
-- Mirrors app/silo/results/stage4-checkpoint-capstone.sql style: one plpgsql DO block, per-assertion
-- savepoint/exception handling, raise notice 'PASS ...' / 'FAIL ...'. Every write asserted to SUCCEED,
-- every GUARDED REJECT asserted to actually raise.
--
-- DDL replayed (all cited):
--   task_graph_versions   0001_baseline.sql L419-429  (+ 0013 append-only trigger + REVOKE)
--   idempotency_ledger    0001_baseline.sql L350-355  (+ 0008 write-once trigger)
--   task_history          0001_baseline.sql L432-439  (FK task_queue(id))
--   task_queue            0001_baseline.sql L398-415  (FK parent for task_history)
--   event_log             0001_baseline.sql L483-496  (event_type enum values from 0011)
--   event_type enum       0001_baseline.sql L60 + 0011 (task_graph_missing / task_graph_chain_depth_over_limit)
\set ON_ERROR_STOP on
begin;

do $$
declare
  v_id        uuid;
  v_prior_ver int;
  v_next_ver  int;
  v_key       text := 'tsk_livesmoke0049';       -- stands in for stepIdempotencyKey(...)
  v_connector text := 'harness:task-graph';       -- LEDGER_CONNECTOR (src/store.ts L465)
  v_completed boolean;
  v_result    jsonb;
  v_task_id   uuid;
  v_hist_out  jsonb;
  v_rowcount  int;
begin
  -- ════════════════════════════════════════════════════════════════════════════════════════════════
  -- A. SupabaseGraphStore.putVersion — insert a NEW version row, then prove append-only (0013).
  --    Replays the adapter's for-update-prior + insert(...) returning GRAPH_COLS. (supabase-store L59-100)
  -- ════════════════════════════════════════════════════════════════════════════════════════════════

  -- adapter: select ... from task_graph_versions where task_type_name=$1 order by version desc limit 1 for update
  select version into v_prior_ver
    from task_graph_versions
    where task_type_name = '__ls049__'
    order by version desc limit 1
    for update;
  v_next_ver := coalesce(v_prior_ver, 0) + 1;     -- adapter: priorRow ? priorRow.version + 1 : 1

  -- adapter: insert into task_graph_versions (task_type_name, version, steps, change_reason,
  --          previous_version_id, created_by) values ($1,$2,$3::jsonb,$4,$5,$6) returning GRAPH_COLS
  --  steps is the exact jsonb the adapter serialises via JSON.stringify(v.steps); created_by is nullable (→ profiles).
  insert into task_graph_versions
      (task_type_name, version, steps, change_reason, previous_version_id, created_by)
    values (
      '__ls049__',
      v_next_ver,
      '[{"step_id":"s0","kind":"tool_call","depends_on":[],"failure_mode":"halt","payload":{"a":1}}]'::jsonb,
      'live-smoke seed',                          -- change_reason NOT NULL + non-empty (adapter pre-checks it)
      null,                                       -- previous_version_id (first version → null)
      null                                        -- created_by nullable
    )
    returning id into v_id;
  raise notice 'PASS A1: task_graph_versions INSERT succeeded (id=%, version=%)', v_id, v_next_ver;

  -- adapter's getCurrent/listVersions selects (prove the column list resolves).
  perform id, task_type_name, version, steps, change_reason, previous_version_id, created_at, created_by
    from task_graph_versions where task_type_name = '__ls049__' order by version desc limit 1;
  raise notice 'PASS A2: GRAPH_COLS select list resolves (getCurrent/listVersions shape)';

  -- append-only REJECT: an in-place UPDATE of a committed version must raise (0013 trigger). This is the DB
  -- backstop to the app-layer append-only gate — a #1 knowledge-integrity guarantee.
  begin
    update task_graph_versions set change_reason = 'tampered' where id = v_id;
    raise exception 'FAIL A3: task_graph_versions in-place UPDATE was ALLOWED';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS A3: task_graph_versions UPDATE rejected -> %', sqlerrm;
  end;
  begin
    delete from task_graph_versions where id = v_id;
    raise exception 'FAIL A4: task_graph_versions DELETE was ALLOWED';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS A4: task_graph_versions DELETE rejected -> %', sqlerrm;
  end;

  -- ════════════════════════════════════════════════════════════════════════════════════════════════
  -- B. SupabaseIdempotencyLedger — reserve / complete / get on the baseline idempotency_ledger under the
  --    sentinel connector, with the 0008 write-once trigger. (supabase-store L169-214)
  -- ════════════════════════════════════════════════════════════════════════════════════════════════

  -- reserve(key): insert (idempotency_key, connector, result=NULL) on conflict (idempotency_key) do nothing
  insert into idempotency_ledger (idempotency_key, connector, result)
    values (v_key, v_connector, null)
    on conflict (idempotency_key) do nothing;
  raise notice 'PASS B1: idempotency_ledger reserve INSERT (result NULL, sentinel connector) succeeded';

  -- a SECOND reserve of the same key is a no-op (ON CONFLICT DO NOTHING) — never a PK error, never a rewrite.
  insert into idempotency_ledger (idempotency_key, connector, result)
    values (v_key, v_connector, null)
    on conflict (idempotency_key) do nothing;
  raise notice 'PASS B2: duplicate reserve is a no-op (on conflict do nothing)';

  -- get(key): the exact adapter projection — (result is not null) as completed, result, created_at::text.
  select (result is not null), result into v_completed, v_result
    from idempotency_ledger where idempotency_key = v_key;
  if v_completed then raise exception 'FAIL B3: freshly-reserved key reads completed=true (expected false)'; end if;
  raise notice 'PASS B3: reserved-but-null reads completed=false (the crash window)';

  -- complete(key): guarded write-once update — set result=$::jsonb where idempotency_key=$ and result is null.
  update idempotency_ledger
    set result = '{"charged":true}'::jsonb          -- adapter: JSON.stringify(output ?? null)::jsonb
    where idempotency_key = v_key and result is null;
  get diagnostics v_rowcount = row_count;
  if v_rowcount <> 1 then raise exception 'FAIL B4: complete updated % rows (expected 1)', v_rowcount; end if;
  raise notice 'PASS B4: complete NULL->value updated exactly 1 row (write-once fill permitted by 0008)';

  -- re-complete of an already-completed key: the `result is null` guard makes it a 0-row no-op (idempotent),
  -- and even a same-value UPDATE reaching the row would be permitted; a DIFFERENT value must be blocked by 0008.
  update idempotency_ledger
    set result = '{"charged":true}'::jsonb
    where idempotency_key = v_key and result is null;
  get diagnostics v_rowcount = row_count;
  if v_rowcount <> 0 then raise exception 'FAIL B5: re-complete matched % rows (expected 0 — guarded by result is null)', v_rowcount; end if;
  raise notice 'PASS B5: re-complete of a completed key is a 0-row no-op (idempotent complete)';

  -- 0008 write-once REJECT: an in-place rewrite of an already-recorded result must raise.
  begin
    update idempotency_ledger set result = '{"charged":false}'::jsonb where idempotency_key = v_key;
    raise exception 'FAIL B6: idempotency_ledger result rewrite was ALLOWED';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS B6: idempotency_ledger result rewrite rejected (write-once) -> %', sqlerrm;
  end;

  -- completed-with-JSON-null-output stays distinguishable from merely-reserved: the adapter writes the JSON
  -- `null` token (jsonb 'null'), which is NOT SQL-NULL, so `result is not null` ⇒ completed=true.
  insert into idempotency_ledger (idempotency_key, connector, result)
    values (v_key || '_n', v_connector, null) on conflict (idempotency_key) do nothing;
  update idempotency_ledger
    set result = 'null'::jsonb                       -- JSON.stringify(null) -> 'null'::jsonb (the JSON null token, NOT SQL-NULL)
    where idempotency_key = v_key || '_n' and result is null;
  select (result is not null) into v_completed
    from idempotency_ledger where idempotency_key = v_key || '_n';
  if not v_completed then raise exception 'FAIL B7: a step returning null reads reserved, not completed'; end if;
  raise notice 'PASS B7: completed-with-null-output ⇒ completed=true (distinct from reserved, #1)';

  -- ════════════════════════════════════════════════════════════════════════════════════════════════
  -- C. SupabaseHistoryStore — the resume READ path on task_history. (supabase-store L128-151)
  --    Satisfy the FK to task_queue by inserting a parent task row first (FK-missing throw = fixture bug).
  -- ════════════════════════════════════════════════════════════════════════════════════════════════

  insert into task_queue (type, task_name)
    values ('event', '__ls049_task__') returning id into v_task_id;   -- FK parent for task_history

  insert into task_history (task_id, step_index, full_output)
    values (v_task_id, 0, '{"r":"zero"}'::jsonb);
  raise notice 'PASS C1: task_history INSERT (FK to task_queue satisfied) succeeded';

  -- adapter getOutput: select task_id, step_index, full_output from task_history where task_id=$1 and step_index=$2
  select full_output into v_hist_out
    from task_history where task_id = v_task_id and step_index = 0;
  if v_hist_out is null then raise exception 'FAIL C2: getOutput read returned no row'; end if;
  raise notice 'PASS C2: getOutput select (task_id + step_index) resolves the preserved original';

  -- adapter listOutputs: ... where task_id=$1 order by step_index asc
  perform task_id, step_index, full_output from task_history where task_id = v_task_id order by step_index asc;
  raise notice 'PASS C3: listOutputs select list + ordering resolves';

  -- ════════════════════════════════════════════════════════════════════════════════════════════════
  -- D. SupabaseConfigErrorSink — the loud config-error audit write onto event_log with the ISSUE-049
  --    enum values (0011). A drift here (missing enum value) is a #3 silent-failure of the audit write.
  --    Replays: insert into event_log (event_type, entity_ids, summary, payload) values ($1,$2,$3,$4::jsonb)
  --    with eventTypeForKind('no_graph')='task_graph_missing' / ('chain_depth_over_limit')=
  --    'task_graph_chain_depth_over_limit', and entity_ids = ev.task_id ? [ev.task_id] : []. (supabase-store L228-249)
  -- ════════════════════════════════════════════════════════════════════════════════════════════════

  -- no_graph: task_id present → entity_ids = ARRAY[task_id] (a real uuid). Enum value 'task_graph_missing' (0011).
  insert into event_log (event_type, entity_ids, summary, payload)
    values (
      'task_graph_missing',                          -- eventTypeForKind('no_graph') — MUST be an enum member (0011)
      array[v_task_id],                              -- entity_ids uuid[]: ev.task_id ? [ev.task_id] : []
      'Task type ''__ls049__'' has no registered task graph — refusing to run ad-hoc; task fails at dequeue.',
      '{"task_id":"seed","task_type_name":"__ls049__"}'::jsonb
    );
  raise notice 'PASS D1: event_log INSERT event_type=task_graph_missing (enum member, 0011) succeeded';

  -- chain_depth_over_limit: task_id null → entity_ids = '{}' (empty uuid[]) — the adapter's `[]` branch.
  --  This empty-array branch is exactly the drift the smoke exists to catch (adapter uses [] here where the
  --  alerting adapter uses null); an empty-array cast to uuid[] must not throw.
  insert into event_log (event_type, entity_ids, summary, payload)
    values (
      'task_graph_chain_depth_over_limit',           -- eventTypeForKind('chain_depth_over_limit') (0011)
      '{}'::uuid[],                                   -- ev.task_id ? [ev.task_id] : []  → empty array branch
      'graph rejected: 9 steps > chain_depth_limit 6',
      '{"resolved_depth":9,"limit":6,"outcome":"rejected"}'::jsonb
    );
  raise notice 'PASS D2: event_log INSERT event_type=task_graph_chain_depth_over_limit + empty entity_ids[] succeeded';

  raise notice 'ALL ASSERTIONS PASS';
end $$;

rollback;
