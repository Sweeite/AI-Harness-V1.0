-- Stage-4 Checkpoint-4 LIVE capstone (R7 three-non-negotiables re-check for the new Stage-4 DB invariants).
-- Rolled back. Proves the migrations 0013/0015/0016 append-only + redaction invariants enforce LIVE.
-- Run: psql "$SILO_DB_URL" -f this. Expect ALL ASSERTIONS PASS, then ROLLBACK.
\set ON_ERROR_STOP on
begin;

do $$
declare v_id uuid; a_id uuid; g_id uuid; g2_id uuid;
begin
  -- ── #1 (never lose/corrupt knowledge): task_graph_versions is append-only-by-version (0013) ──────────
  insert into task_graph_versions (task_type_name, version, steps, change_reason)
    values ('__cp4__', 1, '[]'::jsonb, 'cp4 seed') returning id into v_id;
  begin
    update task_graph_versions set change_reason = 'tampered' where id = v_id;
    raise exception 'FAIL #1a: task_graph_versions in-place UPDATE was ALLOWED';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS #1a: task_graph_versions UPDATE rejected -> %', sqlerrm;
  end;
  begin
    delete from task_graph_versions where id = v_id;
    raise exception 'FAIL #1b: task_graph_versions DELETE was ALLOWED';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS #1b: task_graph_versions DELETE rejected -> %', sqlerrm;
  end;

  -- ── #1: agents version-lineage is immutable (0016) ────────────────────────────────────────────────────
  insert into agents (name, description, memory_scope, change_reason)
    values ('__cp4_agent__', 'cp4', '{}'::jsonb, 'cp4 seed') returning id into a_id;
  begin
    update agents set version = 2 where id = a_id;   -- rewriting the version lineage is forbidden
    raise exception 'FAIL #1c: agents version-lineage UPDATE was ALLOWED';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS #1c: agents version-lineage UPDATE rejected -> %', sqlerrm;
  end;
  -- an operational (non-lineage) toggle is still permitted (enabled left mutable by design)
  update agents set enabled = false where id = a_id;
  raise notice 'PASS #1d: agents enabled-toggle permitted (non-lineage in-place update allowed)';

  -- ── #1/#3 (tamper-evident): guardrail_log redaction-tombstone is the ONLY content mutation (0015) ──────
  insert into guardrail_log (guardrail_type, description, action_blocked, status)
    values ('approval_gate', 'sensitive detail', false, 'pending') returning id into g_id;
  -- (a) the authorized one-way redaction (redacted_at null->ts + description scrubbed) is ACCEPTED
  update guardrail_log set redacted_at = now(), description = '[redacted]' where id = g_id;
  raise notice 'PASS #3a: guardrail_log redaction-tombstone accepted (authorized scrub)';
  -- (b) a covert content rewrite (no redacted_at) on a fresh row is REJECTED
  insert into guardrail_log (guardrail_type, description, action_blocked, status)
    values ('approval_gate', 'sensitive detail', false, 'pending') returning id into g2_id;
  begin
    update guardrail_log set description = 'tampered' where id = g2_id;
    raise exception 'FAIL #3b: guardrail_log covert content UPDATE was ALLOWED';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS #3b: guardrail_log covert content UPDATE rejected -> %', sqlerrm;
  end;

  raise notice 'ALL ASSERTIONS PASS';
end $$;

rollback;
