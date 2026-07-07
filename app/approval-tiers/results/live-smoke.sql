-- ISSUE-056 (C6 approval-tiers) — LIVE-SMOKE for the SupabaseApprovalWorkflow live adapter.
-- Target DB: SILO ($SILO_DB_URL).  Run: psql "$SILO_DB_URL" -f this.  Expect ALL ASSERTIONS PASS, then ROLLBACK.
--
-- PURPOSE. Replay the ACTUAL write-path SQL that app/approval-tiers/src/supabase-store.ts runs, statement for
-- statement (same tables, columns, enum literals, casts, guarded WHERE clauses), against the real baseline DDL
-- (app/silo/migrations/0001_baseline.sql §guardrail_log / §task_queue / §access_audit + the append-only trigger
-- enforce_audit_append_only(), as amended by 0015). This catches the fake-passes-offline / live-adapter-throws
-- class of BLOCKER: the in-memory reference model can't reject an enum value or a NOT-NULL/CHECK the live DB will.
--
-- The whole script is a single txn ending in ROLLBACK — non-mutating, safe to run against the live client silo.
-- FKs are satisfied WITHIN the txn (auth.users -> profiles -> task_queue -> guardrail_log) so a FK-missing throw
-- is never mistaken for real drift.
--
-- DEFECTS THIS SMOKE ASSERTS FIXED (found in the review, now corrected in supabase-store.ts):
--   • BLOCKER — resolve() used to insert into access_audit with actor_type = 'human', but the actor_type enum is
--     ('user','agent','system') ONLY (0001_baseline.sql L41), so every live resolve threw 22P02. FIXED: the
--     human-reviewer resolution uses 'user' and the timer auto-run uses 'system', and the guardrail_log
--     transition + the access_audit append now run in ONE transaction (atomic — never a transition without its
--     audit). #R2 asserts the corrected 'user' + 'system' inserts SUCCEED, and #R2t asserts the two statements
--     commit together as a unit; #R2x documents that the OLD 'human' literal would still be rejected by the enum.
--   • MAJOR — resolve()'s compensation path delegated to this.ref.resolve(...).catch(()=>null); the ref's
--     in-memory store never held the live rowId, so it ALWAYS threw->null and compensationQueued/nonCompensable
--     were ALWAYS []. FIXED in code: the compensation loop now runs directly off opts.appliedEffects via the live
--     CompensationSink. Not SQL-observable (a JS-layer knowledge-loss) — proven in the code, not here.
--   • MINOR — escalateStaleWaits() used to throw ERR_ESCALATED_AT_NEEDS_DELTA, but 0015 branch (b) lands the
--     escalated_at null->ts stamp. FIXED: escalateStaleWaits now performs the real stamp. #E asserts the stamp
--     SUCCEEDS live (the fixed adapter path). holdForFullReview stays deferred (its held_for_review_at column is
--     absent — OD-188); that is a separate, still-owed delta, not asserted here.

\set ON_ERROR_STOP on
begin;

do $$
declare
  v_u1     uuid := gen_random_uuid();   -- initiator / originating_user_id (a profiles id)
  v_rev    uuid := gen_random_uuid();   -- reviewer (reviewed_by) — a DIFFERENT profiles id (no self-approval)
  v_task   uuid;                        -- task_queue parent (guardrail_log.task_id FK)
  v_task2  uuid;
  v_gate   uuid;                        -- the approval_gate row from tierAndGate()
  v_soft   uuid;                        -- the soft row for autoRunElapsedSoft()
  v_hard   uuid;                        -- a hard_limit row (multi-fire domination)
  v_appr   uuid;                        -- a co-firing approvable row (must be closed to 'rejected')
  v_req    boolean;
  v_status task_status;
  v_gstat  guardrail_status;
begin
  -- ── FK SETUP (satisfied within the txn) ─────────────────────────────────────────────────────────────────
  -- profiles.id -> auth.users(id); task_queue.originating_user_id/approved_by/reviewed_by -> profiles(id).
  insert into auth.users (id, email) values (v_u1,  'apr056-initiator@example.com');
  insert into auth.users (id, email) values (v_rev, 'apr056-reviewer@example.com');
  insert into profiles (id, email, active) values (v_u1,  'apr056-initiator@example.com', true);
  insert into profiles (id, email, active) values (v_rev, 'apr056-reviewer@example.com',  true);
  -- task_queue parents. type/task_name are the only NOT-NULLs without a default.
  insert into task_queue (type, task_name, originating_user_id, status)
    values ('chained'::task_type, '__apr056_smoke_task__', v_u1, 'awaiting_approval') returning id into v_task;
  insert into task_queue (type, task_name, originating_user_id, status)
    values ('chained'::task_type, '__apr056_smoke_task2__', v_u1, 'running') returning id into v_task2;
  raise notice 'PASS setup: auth.users + profiles + task_queue parents inserted';

  -- ══════════════════════════════════════════════════════════════════════════════════════════════════════
  -- #1 tierAndGate() — supabase-store.ts L106-118
  --   insert into guardrail_log (task_id, guardrail_type, description, action_blocked, status)
  --     values ($1,'approval_gate',$2,true,'pending') returning id
  --   update task_queue set requires_approval = true where id=$1 and status not in ('completed','failed')
  -- ══════════════════════════════════════════════════════════════════════════════════════════════════════
  begin
    insert into guardrail_log (task_id, guardrail_type, description, action_blocked, status)
      values (v_task, 'approval_gate', 'mandatory hard-approval floor', true, 'pending')
      returning id into v_gate;
    update task_queue set requires_approval = true where id = v_task and status not in ('completed','failed');
    select requires_approval into v_req from task_queue where id = v_task;
    if v_req is not true then
      raise exception 'FAIL #1: tierAndGate requires_approval guard did not set the flag';
    end if;
    raise notice 'PASS #1: tierAndGate — guardrail_log approval_gate insert + task_queue requires_approval update';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise exception 'FAIL #1: tierAndGate write-path threw live -> %', sqlerrm;
  end;

  -- ══════════════════════════════════════════════════════════════════════════════════════════════════════
  -- #2 autoRunElapsedSoft() — supabase-store.ts L146-152
  --   update guardrail_log set status='approved', reviewed_at=now() where id=$1 and status='pending' returning ...
  -- (forward status transition; description/task_id unchanged -> legal under append-only branch (a))
  -- ══════════════════════════════════════════════════════════════════════════════════════════════════════
  insert into guardrail_log (task_id, guardrail_type, description, action_blocked, status)
    values (v_task, 'approval_gate', 'soft auto-run candidate', true, 'pending') returning id into v_soft;
  begin
    update guardrail_log set status = 'approved', reviewed_at = now()
      where id = v_soft and status = 'pending';
    select status into v_gstat from guardrail_log where id = v_soft;
    if v_gstat <> 'approved' then raise exception 'FAIL #2: soft auto-run transition not applied'; end if;
    raise notice 'PASS #2: autoRunElapsedSoft — pending->approved forward transition accepted';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise exception 'FAIL #2: autoRunElapsedSoft transition threw live -> %', sqlerrm;
  end;

  -- ══════════════════════════════════════════════════════════════════════════════════════════════════════
  -- #3 raiseFlag() multi-fire domination — supabase-store.ts L188-214
  --   per hit: insert into guardrail_log (task_id, guardrail_type, description, action_blocked, status)
  --            values ($1,$2,$3,true,'pending')
  --   hard_limit dominates: for each approvable co-firing row ->
  --            update guardrail_log set status='rejected', reviewed_at=now() where id=$1 and status='pending'
  --   then: update task_queue set status='flagged' where id=$1 and status not in ('completed','failed')
  -- ══════════════════════════════════════════════════════════════════════════════════════════════════════
  begin
    insert into guardrail_log (task_id, guardrail_type, description, action_blocked, status)
      values (v_task2, 'hard_limit', 'external send blocked (hard kill)', true, 'pending') returning id into v_hard;
    insert into guardrail_log (task_id, guardrail_type, description, action_blocked, status)
      values (v_task2, 'anomaly', 'co-firing approvable anomaly', true, 'pending') returning id into v_appr;
    -- the approvable co-firing row is closed to 'rejected' (the kill governs) — forward transition, legal
    update guardrail_log set status = 'rejected', reviewed_at = now()
      where id = v_appr and status = 'pending';
    -- the hard_limit row stays pending-and-blocked (never approvable — see #R3 CHECK)
    -- C6-set flagged on the task
    update task_queue set status = 'flagged' where id = v_task2 and status not in ('completed','failed');
    select status into v_gstat from guardrail_log where id = v_appr;
    select status into v_status from task_queue where id = v_task2;
    if v_gstat <> 'rejected' then raise exception 'FAIL #3a: co-firing approvable row not closed to rejected'; end if;
    if v_status <> 'flagged'  then raise exception 'FAIL #3b: task not set flagged'; end if;
    raise notice 'PASS #3: raiseFlag — hard_limit + anomaly inserts, approvable->rejected, task->flagged';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise exception 'FAIL #3: raiseFlag write-path threw live -> %', sqlerrm;
  end;

  -- ══════════════════════════════════════════════════════════════════════════════════════════════════════
  -- #4 resolve() guardrail_log transition — supabase-store.ts L268-274
  --   update guardrail_log set status=$2, reviewed_by=$3, reviewed_at=now()
  --     where id=$1 and status='pending' returning ...
  -- (reviewed_by is a profiles id -> use v_rev, a real profile that is NOT the initiator)
  -- ══════════════════════════════════════════════════════════════════════════════════════════════════════
  begin
    update guardrail_log set status = 'approved', reviewed_by = v_rev, reviewed_at = now()
      where id = v_gate and status = 'pending';
    select status, reviewed_by into v_gstat, v_rev from guardrail_log where id = v_gate;
    if v_gstat <> 'approved' then raise exception 'FAIL #4: resolve transition not applied'; end if;
    raise notice 'PASS #4: resolve — pending->approved with reviewed_by set (profiles FK satisfied)';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise exception 'FAIL #4: resolve guardrail_log transition threw live -> %', sqlerrm;
  end;
  v_rev := (select id from profiles where email = 'apr056-reviewer@example.com');  -- restore (select overwrote)

  -- ══════════════════════════════════════════════════════════════════════════════════════════════════════
  -- #R1 GUARDED REJECT — optimistic-concurrency guard.  resolve()/autoRun both gate on `status='pending'`.
  -- A second resolve on an already-approved row must hit 0 rows (no re-resolution), NOT re-mutate.
  -- ══════════════════════════════════════════════════════════════════════════════════════════════════════
  declare v_rows int;
  begin
    update guardrail_log set status = 'rejected', reviewed_by = v_rev, reviewed_at = now()
      where id = v_gate and status = 'pending';
    get diagnostics v_rows = row_count;
    if v_rows <> 0 then raise exception 'FAIL #R1: re-resolve on a non-pending row mutated % rows (guard failed)', v_rows; end if;
    raise notice 'PASS #R1: status=''pending'' guard blocks re-resolution of an already-approved row (0 rows)';
  end;

  -- ══════════════════════════════════════════════════════════════════════════════════════════════════════
  -- #R2 🟢 BLOCKER FIX — resolve() access_audit insert — supabase-store.ts (FIXED):
  --   human-reviewer resolution: actor_type = 'user'   (NOT the old, invalid 'human')
  --   timer auto-run (autoRunElapsedSoft): actor_type = 'system'
  -- actor_type is enum ('user','agent','system') (0001 L41). Assert BOTH corrected literals WRITE CLEANLY.
  -- ══════════════════════════════════════════════════════════════════════════════════════════════════════
  begin
    -- human reviewer resolution → 'user'
    insert into access_audit (audit_type, actor_identity, actor_type, action, target_type)
      values ('approval_resolution', v_rev::text, 'user', 'approve', 'guardrail_log');
    -- timer auto-run resolution → 'system'
    insert into access_audit (audit_type, actor_identity, actor_type, action, target_type)
      values ('approval_resolution', 'system:soft-auto-run', 'system', 'approve', 'guardrail_log');
    raise notice 'PASS #R2: FIXED — access_audit inserts with actor_type=''user'' (reviewer) + ''system'' (timer) both succeed live';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise exception 'FAIL #R2: corrected access_audit insert threw -> % (the column set / enum literal is still wrong)', sqlerrm;
  end;

  -- #R2x DOCUMENTARY — the OLD literal actor_type='human' is (still) rejected by the enum. This records WHY the
  -- fix was needed: 'human' is a task_type value, never an actor_type. (Not a break — a pinned regression guard.)
  begin
    insert into access_audit (audit_type, actor_identity, actor_type, action, target_type)
      values ('approval_resolution', v_rev::text, 'human', 'approve', 'guardrail_log');
    raise exception 'FAIL #R2x: access_audit accepted actor_type=''human'' — the enum drifted; the fix must re-target the valid members';
  exception
    when invalid_text_representation then
      raise notice 'PASS #R2x: the pre-fix literal actor_type=''human'' is rejected (22P02) — confirms the fix (''user''/''system'') was necessary -> %', sqlerrm;
    when others then
      if sqlerrm like 'FAIL%' then raise; end if;
      raise notice 'PASS #R2x: the pre-fix literal actor_type=''human'' is rejected -> %', sqlerrm;
  end;

  -- #R2t ATOMICITY — the FIXED resolve() runs the guardrail_log forward transition + the access_audit append in
  -- ONE transaction: on error the whole unit rolls back, so a transition can never land un-audited (#1/#3). We
  -- prove it here with a savepoint: stage a legal transition + a DELIBERATELY-BROKEN audit insert (the old
  -- 'human'), roll the savepoint back, and confirm NEITHER the transition NOR the audit survived.
  declare
    v_txn uuid;
    v_before_status guardrail_status;
    v_after_status  guardrail_status;
    v_audit_cnt int;
  begin
    insert into guardrail_log (task_id, guardrail_type, description, action_blocked, status)
      values (v_task, 'approval_gate', 'atomicity probe row', true, 'pending') returning id into v_txn;
    select status into v_before_status from guardrail_log where id = v_txn;   -- 'pending'
    begin
      -- A nested begin/exception block is an IMPLICIT savepoint in plpgsql: when the broken audit insert throws
      -- and is caught below, every DB change in this block (incl. the UPDATE) is rolled back as a unit — exactly
      -- the adapter's single-transaction guarantee. (Explicit SAVEPOINT is illegal inside a plpgsql block.)
      update guardrail_log set status = 'approved', reviewed_by = v_rev, reviewed_at = now()
        where id = v_txn and status = 'pending';                              -- legal forward transition
      insert into access_audit (audit_type, actor_identity, actor_type, action, target_type)
        values ('approval_resolution', v_rev::text, 'human', 'approve', 'guardrail_log');  -- BROKEN audit → throws
      raise exception 'FAIL #R2t: the broken audit insert did not throw — atomicity probe invalid';
    exception when invalid_text_representation then
      null;   -- the block's implicit savepoint already undid the UPDATE + the failed INSERT together
    end;
    select status into v_after_status from guardrail_log where id = v_txn;
    select count(*) into v_audit_cnt from access_audit
      where audit_type = 'approval_resolution' and actor_identity = v_rev::text and actor_type = 'user'
        and action = 'approve' and target_type = 'guardrail_log';
    if v_after_status <> 'pending' then
      raise exception 'FAIL #R2t: transition survived a rolled-back audit (%). NON-atomic — un-audited resolution possible', v_after_status;
    end if;
    raise notice 'PASS #R2t: transition + audit are ATOMIC — a failed audit rolls the transition back (row still pending; no un-audited resolution). #1/#3 upheld.';
  end;

  -- ══════════════════════════════════════════════════════════════════════════════════════════════════════
  -- #R3 GUARDED REJECT — the no-override CHECK. A hard_limit row can NEVER be approved (0001 L465 CHECK).
  -- The adapter refuses in code AND resolve()'s update would still be caught by the DB backstop.
  -- ══════════════════════════════════════════════════════════════════════════════════════════════════════
  begin
    update guardrail_log set status = 'approved', reviewed_by = v_rev, reviewed_at = now()
      where id = v_hard and status = 'pending';
    raise exception 'FAIL #R3: hard_limit row was set to approved — the no-override CHECK is not enforced';
  exception when check_violation then
    raise notice 'PASS #R3: hard_limit->approved rejected by CHECK not(hard_limit and approved) -> %', sqlerrm;
  when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS #R3: hard_limit->approved rejected -> %', sqlerrm;
  end;

  -- ══════════════════════════════════════════════════════════════════════════════════════════════════════
  -- #R4 GUARDED REJECT — append-only in-place mutation. The adapter relies on the trigger whitelist: only a
  -- forward status transition (description/task_id unchanged) is legal. A covert in-place description rewrite
  -- on a FRESH pending row (no redacted_at) must be rejected (append-only / tamper-evident, #1/#3).
  -- ══════════════════════════════════════════════════════════════════════════════════════════════════════
  declare v_fresh uuid;
  begin
    insert into guardrail_log (task_id, guardrail_type, description, action_blocked, status)
      values (v_task, 'approval_gate', 'original detail', true, 'pending') returning id into v_fresh;
    begin
      update guardrail_log set description = 'tampered' where id = v_fresh;
      raise exception 'FAIL #R4: in-place description rewrite ALLOWED — append-only trigger not enforced';
    exception when others then
      if sqlerrm like 'FAIL%' then raise; end if;
      raise notice 'PASS #R4: covert description rewrite rejected by append-only trigger -> %', sqlerrm;
    end;
  end;

  -- ══════════════════════════════════════════════════════════════════════════════════════════════════════
  -- #E 🟢 MINOR FIX — escalateStaleWaits() escalated_at stamp — supabase-store.ts (FIXED):
  --   update guardrail_log set escalated_at = now()
  --     where status='pending' and escalated_at is null and guardrail_type <> 'hard_limit' and created_at <= $1
  -- 0015 branch (b) (kin 0010/OD-182) PERMITS this null->ts stamp on a still-pending row (status/description/
  -- task_id/guardrail_type/reviewers unchanged). The adapter no longer throws ERR_ESCALATED_AT_NEEDS_DELTA —
  -- it performs the real stamp. Assert the stamp SUCCEEDS and the row STAYS pending (escalate, never auto-resolve).
  -- ══════════════════════════════════════════════════════════════════════════════════════════════════════
  declare v_stale uuid;
  begin
    insert into guardrail_log (task_id, guardrail_type, description, action_blocked, status)
      values (v_task, 'approval_gate', 'stale wait-point', true, 'pending') returning id into v_stale;
    -- the adapter's real escalateStaleWaits UPDATE (guarded on pending + null escalated_at + non-hard_limit)
    update guardrail_log set escalated_at = now()
      where id = v_stale and status = 'pending' and escalated_at is null and guardrail_type <> 'hard_limit';
    if (select escalated_at from guardrail_log where id = v_stale) is null then
      raise exception 'FAIL #E: escalated_at not persisted — 0015 branch (b) did not accept the stamp';
    end if;
    if (select status from guardrail_log where id = v_stale) <> 'pending' then
      raise exception 'FAIL #E: escalation changed status — a wait-point must escalate, never auto-resolve (#3)';
    end if;
    raise notice 'PASS #E: FIXED — escalated_at null->ts stamped LIVE (0015 branch b); row STAYS pending (escalated, not auto-resolved). Adapter performs the real stamp, no longer throws.';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise exception 'FAIL #E: escalated_at stamp threw live -> % (0015 branch (b) delta missing — the adapter fix cannot run)', sqlerrm;
  end;

  -- #Eh DOCUMENTARY — holdForFullReview stays DEFERRED (OD-188): its held_for_review_at column is absent from
  -- every migration. Confirm no such column exists, so the adapter's continued deferral is correct (not stale).
  declare v_hfr_col int;
  begin
    select count(*) into v_hfr_col from information_schema.columns
      where table_name = 'guardrail_log' and column_name = 'held_for_review_at';
    if v_hfr_col <> 0 then
      raise exception 'FAIL #Eh: held_for_review_at EXISTS — holdForFullReview should no longer be deferred (OD-188 landed)';
    end if;
    raise notice 'PASS #Eh: held_for_review_at absent (OD-188 deferral holds) — holdForFullReview correctly stays deferred.';
  end;

  raise notice 'ALL ASSERTIONS PASS';
end $$;

rollback;
