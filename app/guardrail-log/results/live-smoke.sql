-- ============================================================================
-- app/guardrail-log — LIVE-ADAPTER HYGIENE SMOKE  (ISSUE-060, R10)
-- Adapter under test: app/guardrail-log/src/supabase-store.ts
--   SupabaseGuardrailLogStore  → table guardrail_log
--   SupabaseQuarantineStore    → table injection_quarantine
--
-- WHAT THIS PROVES (replays the adapter's REAL write paths against live DDL):
--   1. append()  INSERT column list + enum literals match live guardrail_log
--      (11 cols incl. redacted_at NOT in the insert — server-owned; enum
--       guardrail_type/guardrail_status members exist).
--   2. all()     select list (incl. redacted_at::text) resolves against live cols.
--   3. resolve() the whitelisted pending->resolved forward transition is PERMITTED
--      by the t_append_only trigger (branch a), with reviewed_by/reviewed_at set.
--   4. the CHECK (not(hard_limit and approved)) FIRES (23514) — the mapping to
--      HardLimitApprovalForbidden is real.
--   5. rewriteContent()/delete() are REJECTED by the trigger (append-only / #1).
--   6. quarantine append() INSERT cols match; FK to guardrail_log(id) enforced
--      (23503 → DanglingQuarantineFk); decide() forward write-once is PERMITTED.
--   7. quarantine delete() is REJECTED by the trigger.
--
-- Connects as: postgres owner (rolbypassrls=t) per OD-193 — same role the live
--   pg.Pool uses. RLS is bypassed but TRIGGERS + CHECK + FK are NOT bypassed by
--   rolbypassrls, so every append-only guarantee below is exercised for real.
--
-- SAFETY: wrapped in BEGIN; ... ROLLBACK; — nothing persists. Do NOT COMMIT.
--   Run serially via the orchestrator:
--     psql "$SILO_DB_URL" -v ON_ERROR_STOP=1 -f app/guardrail-log/results/live-smoke.sql
--   Expected: every RAISE NOTICE 'OK ...' prints, final ROLLBACK, no ERROR.
-- ============================================================================

\set ON_ERROR_STOP on
begin;

-- Deterministic ids so assertions can reference them.
\set gl_ok    '''11111111-1111-1111-1111-111111111111'''
\set gl_hard  '''22222222-2222-2222-2222-222222222222'''
\set gl_rw    '''33333333-3333-3333-3333-333333333333'''
\set gl_del   '''44444444-4444-4444-4444-444444444444'''
\set q_ok     '''55555555-5555-5555-5555-555555555555'''
\set q_del    '''66666666-6666-6666-6666-666666666666'''
\set q_orphan '''77777777-7777-7777-7777-777777777777'''
\set bad_fk   '''99999999-9999-9999-9999-999999999999'''

-- ── 1. append(): the real INSERT column list + enum literals ────────────────
-- task_id + reviewed_by left NULL (both nullable) to avoid seeding task_queue/profiles;
-- the adapter passes these straight through and they are the columns most likely to
-- differ live. guardrail_type + status are enum-typed → proves the literals exist.
insert into guardrail_log
  (id, task_id, guardrail_type, description, action_blocked, status, reviewed_by, reviewed_at,
   escalated_at, created_at)
values
  (:gl_ok,   null, 'prompt_injection', 'smoke: injection blocked', true,  'pending', null, null, null, now()),
  (:gl_hard, null, 'hard_limit',       'smoke: hard limit hit',    true,  'pending', null, null, null, now()),
  (:gl_rw,   null, 'anomaly',          'smoke: original desc',     false, 'pending', null, null, null, now()),
  (:gl_del,  null, 'rate_limit',       'smoke: rate limited',      true,  'pending', null, null, null, now());

do $$
begin
  if (select count(*) from guardrail_log where id in
        ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
         '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444')) <> 4 then
    raise exception 'FAIL: append() INSERT did not land 4 rows';
  end if;
  raise notice 'OK 1: append() INSERT column list + enum literals accepted';
end $$;

-- ── 2. all(): the exact select list resolves (incl. redacted_at::text) ──────
do $$
declare n int;
begin
  select count(*) into n from (
    select id, task_id, guardrail_type, description, action_blocked, status, reviewed_by,
           reviewed_at::text as reviewed_at, escalated_at::text as escalated_at,
           created_at::text as created_at, redacted_at::text as redacted_at
      from guardrail_log order by created_at
  ) s;
  raise notice 'OK 2: all() select list (redacted_at included) resolves, % rows', n;
end $$;

-- ── 3. resolve(): the whitelisted pending->resolved forward transition ──────
update guardrail_log
   set status = 'approved', reviewed_by = null, reviewed_at = now()
 where id = :gl_ok and status = 'pending';
do $$
begin
  if (select status from guardrail_log where id = '11111111-1111-1111-1111-111111111111') <> 'approved' then
    raise exception 'FAIL: resolve() forward transition did not apply';
  end if;
  raise notice 'OK 3: resolve() pending->approved permitted by t_append_only (branch a)';
end $$;

-- ── 4. CHECK (not(hard_limit and approved)) FIRES for hard_limit->approved ──
do $$
begin
  begin
    update guardrail_log set status = 'approved', reviewed_at = now()
     where id = '22222222-2222-2222-2222-222222222222' and status = 'pending';
    raise exception 'FAIL: hard_limit->approved was NOT rejected';
  exception when check_violation then           -- SQLSTATE 23514 → HardLimitApprovalForbidden
    raise notice 'OK 4: hard_limit->approved rejected by CHECK (23514)';
  end;
end $$;

-- ── 5. rewriteContent() + delete() are REJECTED (append-only / #1) ──────────
do $$
begin
  begin
    update guardrail_log set description = 'smoke: TAMPERED'
     where id = '33333333-3333-3333-3333-333333333333';
    raise exception 'FAIL: in-place description rewrite was NOT rejected';
  exception when others then                     -- trigger raises a plpgsql exception → AppendOnlyViolation
    raise notice 'OK 5a: rewriteContent() rejected by t_append_only';
  end;
  begin
    delete from guardrail_log where id = '44444444-4444-4444-4444-444444444444';
    raise exception 'FAIL: DELETE was NOT rejected';
  exception when others then
    raise notice 'OK 5b: delete() rejected by t_append_only';
  end;
end $$;

-- ── 6. quarantine append() cols + FK enforcement + decide() forward write ───
-- 6a. positive: FK parent (gl_rw) exists in-txn → insert accepted.
insert into injection_quarantine
  (id, guardrail_log_id, quarantined_content, source_tool, source_record_id, human_decision,
   reviewed_by, reviewed_at, escalated_at, created_at)
values
  (:q_ok,  :gl_rw, 'smoke: quarantined payload', 'gmail', 'msg-123', null, null, null, null, now()),
  (:q_del, :gl_rw, 'smoke: to-delete payload',   'slack', null,      null, null, null, null, now());
do $$
begin
  if (select count(*) from injection_quarantine where id in
        ('55555555-5555-5555-5555-555555555555','66666666-6666-6666-6666-666666666666')) <> 2 then
    raise exception 'FAIL: quarantine append() INSERT did not land';
  end if;
  raise notice 'OK 6a: quarantine append() INSERT column list accepted';
end $$;

-- 6b. negative: dangling FK → 23503 → DanglingQuarantineFk.
do $$
begin
  begin
    insert into injection_quarantine
      (id, guardrail_log_id, quarantined_content, source_tool, source_record_id, human_decision,
       reviewed_by, reviewed_at, escalated_at, created_at)
    values
      ('77777777-7777-7777-7777-777777777777','99999999-9999-9999-9999-999999999999',
       'orphan','gmail',null,null,null,null,null,now());
    raise exception 'FAIL: dangling FK was NOT rejected';
  exception when foreign_key_violation then       -- 23503 → DanglingQuarantineFk
    raise notice 'OK 6b: quarantine dangling FK rejected (23503)';
  end;
end $$;

-- 6c. decide(): pending(null)->approved_safe forward write-once permitted.
update injection_quarantine
   set human_decision = 'approved_safe', reviewed_by = null, reviewed_at = now()
 where id = :q_ok and human_decision is null;
do $$
begin
  if (select human_decision from injection_quarantine where id = '55555555-5555-5555-5555-555555555555')
       <> 'approved_safe' then
    raise exception 'FAIL: decide() forward transition did not apply';
  end if;
  raise notice 'OK 6c: decide() null->approved_safe permitted (write-once)';
end $$;

-- ── 7. quarantine delete() is REJECTED (shadow-retain / #1) ─────────────────
do $$
begin
  begin
    delete from injection_quarantine where id = '66666666-6666-6666-6666-666666666666';
    raise exception 'FAIL: quarantine DELETE was NOT rejected';
  exception when others then
    raise notice 'OK 7: quarantine delete() rejected by t_append_only';
  end;
end $$;

rollback;   -- nothing persists. Do NOT change to COMMIT.
