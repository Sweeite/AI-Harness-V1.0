-- ISSUE-050 (C5 ENV) — LIVE-SMOKE for the SupabaseTaskHistoryStore adapter (app/context-envelope/src/supabase-store.ts).
-- Target DB: SILO  (run: psql "$SILO_DB_URL" -f this).  Non-mutating: the whole script ROLLS BACK.
--
-- Purpose: replay the adapter's ACTUAL write-path SQL against the real baseline DDL
-- (app/silo/migrations/0001_baseline.sql: task_queue + task_history) so any column / enum / constraint / cast
-- drift throws HERE — catching the "fake-passes-offline / live-adapter-throws" class before the stage is closed.
--
-- The three statements the adapter runs, replayed verbatim (same tables, columns, $3::jsonb cast, on-conflict target):
--   retain():       insert into task_history (task_id, step_index, full_output) values ($1,$2,$3::jsonb)
--                                                                on conflict (task_id, step_index) do nothing
--   getOriginal():  select full_output              from task_history where task_id=$1 and step_index=$2
--   listOriginals():select step_index, full_output  from task_history where task_id=$1 order by step_index asc
--
-- FK: task_history.task_id -> task_queue(id) not null. We insert a task_queue parent row FIRST (within the txn),
-- so no FK-missing throw (that would be a fixture bug, not real drift). task_queue requires type (task_type enum)
-- + task_name (not null); everything else defaults.
--
-- Style mirrors app/silo/results/stage4-checkpoint-capstone.sql: per-assertion savepoint/exception handling,
-- raise notice 'PASS ...' / 'FAIL ...', ending 'ALL ASSERTIONS PASS'.
\set ON_ERROR_STOP on
begin;

do $$
declare
  v_task uuid;
  v_full jsonb;
  v_rowcount int;
  v_steps int[];
begin
  -- ── fixture: a task_queue parent row so the task_history FK is satisfied inside the txn ──────────────────
  insert into task_queue (type, task_name)
    values ('chained'::task_type, '__env050_smoke__')
    returning id into v_task;
  raise notice 'PASS setup: task_queue parent inserted (id=%)', v_task;

  -- ── (1) retain() step 0 — the adapter's insert with $3::jsonb cast. NOT-NULL full_output supplied; id +
  --        created_at default. Asserts every column name / the jsonb cast / the on-conflict target are real. ─
  begin
    insert into task_history (task_id, step_index, full_output)
      values (v_task, 0, ('{"step":0,"kind":"original"}')::jsonb)
      on conflict (task_id, step_index) do nothing;
    raise notice 'PASS 1: retain(step 0) insert accepted (columns + $3::jsonb cast + on-conflict target valid)';
  exception when others then
    raise exception 'FAIL 1: retain(step 0) insert threw -> %', sqlerrm;
  end;

  -- ── (2) retain() step 1 — second row, distinct step_index, same task ──────────────────────────────────
  begin
    insert into task_history (task_id, step_index, full_output)
      values (v_task, 1, ('{"step":1,"kind":"original"}')::jsonb)
      on conflict (task_id, step_index) do nothing;
    raise notice 'PASS 2: retain(step 1) insert accepted';
  exception when others then
    raise exception 'FAIL 2: retain(step 1) insert threw -> %', sqlerrm;
  end;

  -- ── (3) #1 FIRST-WRITE-WINS: a re-retain of (task,step 0) with DIFFERENT data must NOT overwrite the
  --        original (on conflict do nothing). This is the load-bearing no-knowledge-loss guarantee. ────────
  insert into task_history (task_id, step_index, full_output)
    values (v_task, 0, ('{"step":0,"kind":"TAMPERED"}')::jsonb)
    on conflict (task_id, step_index) do nothing;
  get diagnostics v_rowcount = row_count;
  if v_rowcount <> 0 then
    raise exception 'FAIL 3a: conflicting re-retain reported % affected rows (expected 0 — do nothing)', v_rowcount;
  end if;
  -- prove the stored value is still the ORIGINAL, not the tampered payload (getOriginal() read-path)
  select full_output into v_full from task_history where task_id = v_task and step_index = 0;
  if v_full is null then
    raise exception 'FAIL 3b: getOriginal(step 0) returned no row after retain';
  end if;
  if v_full ->> 'kind' <> 'original' then
    raise exception 'FAIL 3c: on-conflict OVERWROTE the original — full_output.kind=% (expected ''original'') — #1 VIOLATION', v_full ->> 'kind';
  end if;
  raise notice 'PASS 3: first-write-wins upheld (re-retain no-op; stored original intact) — #1';

  -- ── (4) getOriginal() exact statement — select full_output where task_id=$1 and step_index=$2 ───────────
  begin
    select full_output into v_full from task_history where task_id = v_task and step_index = 1;
    if v_full is null or v_full ->> 'step' <> '1' then
      raise exception 'FAIL 4: getOriginal(step 1) returned unexpected/absent value -> %', v_full;
    end if;
    raise notice 'PASS 4: getOriginal(step 1) select returns the retained original';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise exception 'FAIL 4: getOriginal select threw -> %', sqlerrm;
  end;

  -- ── (5) getOriginal() miss — a never-retained (task,step) yields NULL (adapter returns null), not an error ─
  select full_output into v_full from task_history where task_id = v_task and step_index = 99;
  if v_full is not null then
    raise exception 'FAIL 5: getOriginal(step 99) returned a row for a never-retained step -> %', v_full;
  end if;
  raise notice 'PASS 5: getOriginal(miss) returns NULL (adapter maps to null), no error';

  -- ── (6) listOriginals() exact statement — select step_index, full_output where task_id=$1 order by
  --        step_index asc. Assert ORDERING + full set (resume/audit reconstruct depends on this). ──────────
  select array_agg(step_index order by rn) into v_steps
  from (
    select step_index, row_number() over () as rn
    from task_history where task_id = v_task order by step_index asc
  ) q;
  if v_steps is distinct from array[0,1] then
    raise exception 'FAIL 6: listOriginals returned steps % (expected [0,1] in ascending order)', v_steps;
  end if;
  raise notice 'PASS 6: listOriginals returns all retained originals ordered by step_index asc';

  -- ── (7) FK integrity — task_history.task_id must reference an existing task_queue row (not null FK). A
  --        bogus task_id must be REJECTED (proves the FK is live; the envelope is genuinely per-task). ──────
  begin
    insert into task_history (task_id, step_index, full_output)
      values (gen_random_uuid(), 0, '{}'::jsonb);
    raise exception 'FAIL 7: task_history insert with a non-existent task_id was ALLOWED (FK not enforced)';
  exception when foreign_key_violation then
    raise notice 'PASS 7: task_history FK to task_queue enforced (orphan insert rejected)';
  when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise exception 'FAIL 7: unexpected error on FK test -> %', sqlerrm;
  end;

  -- ── (8) UNIQUE(task_id, step_index) is real — a plain (no on-conflict) duplicate must raise unique_violation.
  --        This is the constraint the adapter's `on conflict (task_id, step_index)` target depends on. ──────
  begin
    insert into task_history (task_id, step_index, full_output)
      values (v_task, 0, '{}'::jsonb);
    raise exception 'FAIL 8: duplicate (task_id, step_index) insert was ALLOWED (UNIQUE constraint missing)';
  exception when unique_violation then
    raise notice 'PASS 8: UNIQUE(task_id, step_index) enforced (the on-conflict target the adapter relies on is real)';
  when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise exception 'FAIL 8: unexpected error on UNIQUE test -> %', sqlerrm;
  end;

  raise notice 'ALL ASSERTIONS PASS';
end $$;

rollback;
