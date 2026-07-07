-- LAYER-3 CROSS-COMPONENT INTEGRATION SMOKE (session 74). Proves the Stage-0–4 SEAMS compose LIVE against the
-- real silo — not each adapter in isolation (that is the per-package live-smoke layer). One realistic flow
-- threads: provision (auth.users→profiles→user_roles) → task_queue → guardrail_log gate → escalation +
-- alerting notification → resolution + access_audit, and asserts every cross-table FK / shared enum / shared
-- append-only trigger holds TOGETHER. Rolled back → safe. Run: psql "$SILO_DB_URL" -f this. (db = silo)
\set ON_ERROR_STOP on
begin;

do $$
declare
  v_uid  uuid := gen_random_uuid();   -- the acting user (must parent profiles + FK targets)
  v_task uuid;
  v_gl   uuid;
  v_role uuid;
begin
  -- ── SEAM 0 — provisioning spine: auth.users → profiles → user_roles (Stage 0-1, RBAC). ─────────────────
  insert into auth.users (id, email) values (v_uid, 'l3@example.com');
  insert into profiles (id, email, active) values (v_uid, 'l3@example.com', true);
  insert into user_roles (user_id, role_id, active)
    select v_uid, id, true from roles where name = 'Super Admin' returning role_id into v_role;
  if v_role is null then raise exception 'SEAM0 FAIL: no Super Admin role in the seeded catalog'; end if;
  raise notice 'SEAM0 OK: auth.users→profiles→user_roles provisioning spine holds';

  -- ── SEAM 1 — task_queue: a task originated by that user (originating_user_id → profiles FK). ────────────
  insert into task_queue (type, task_name, status, originating_user_id)
    values ('chained', 'l3-task', 'running', v_uid) returning id into v_task;
  raise notice 'SEAM1 OK: task_queue row created (originating_user_id → profiles FK satisfied)';

  -- ── SEAM 2 — guardrail_log gate on that task (task_id → task_queue FK) + the requires_approval flip. ────
  insert into guardrail_log (task_id, guardrail_type, description, action_blocked, status)
    values (v_task, 'approval_gate', 'L3 approval gate', true, 'pending') returning id into v_gl;
  update task_queue set requires_approval = true where id = v_task;
  perform 1 from guardrail_log g join task_queue t on t.id = g.task_id
    where g.id = v_gl and t.requires_approval = true;
  if not found then raise exception 'SEAM2 FAIL: guardrail_log→task_queue seam broken (gate not linked to task)'; end if;
  raise notice 'SEAM2 OK: guardrail_log.task_id → task_queue link + requires_approval flip compose';

  -- ── SEAM 3 — escalation stamp (append-only OD-182 allows) → alerting notification (recipient → profiles). ─
  update guardrail_log set escalated_at = now() where id = v_gl;          -- monotonic escalation stamp (OD-182)
  insert into notifications (type, severity, title, body, recipient, read_state)
    values ('approval_queue_stale', 'warning', 'L3 escalation', 'gate stale', v_uid, 'unread');
  perform 1 from notifications n where n.recipient = v_uid;
  if not found then raise exception 'SEAM3 FAIL: alerting notification recipient → profiles seam broken'; end if;
  raise notice 'SEAM3 OK: guardrail escalation stamp + notification(recipient→profiles) compose';

  -- ── SEAM 4 — resolution: guardrail forward transition (reviewed_by → profiles) + access_audit append. ──
  update guardrail_log set status = 'approved', reviewed_by = v_uid, reviewed_at = now()
    where id = v_gl and status = 'pending';
  insert into access_audit (audit_type, actor_identity, actor_type, action, target_type, reason, originating_user_id)
    values ('approval_resolved', v_uid::text, 'user', 'resolve', 'guardrail', 'L3 resolve', v_uid);
  perform 1 from guardrail_log where id = v_gl and status = 'approved' and reviewed_by = v_uid;
  if not found then raise exception 'SEAM4 FAIL: guardrail resolution (reviewed_by→profiles) did not land'; end if;
  raise notice 'SEAM4 OK: guardrail resolution + access_audit append compose (reviewed_by→profiles FK)';
end $$;

-- ── SEAM 5 — the SHARED append-only trigger composes across sinks (a #1/#3 backstop that spans components). ──
-- (a) access_audit in-place UPDATE rejected.
do $$
declare v_a uuid;
begin
  insert into access_audit (audit_type, actor_identity, actor_type, action, target_type, reason)
    values ('l3_probe', 'sys', 'system', 'probe', 'guardrail', 'append-only probe') returning id into v_a;
  begin
    update access_audit set reason = 'tampered' where id = v_a;
    raise exception 'SEAM5a FAIL: access_audit in-place UPDATE was ALLOWED';
  exception when others then
    if sqlerrm like 'SEAM5a FAIL%' then raise; end if;
    raise notice 'SEAM5a OK: access_audit in-place UPDATE rejected (append-only composes) — %', sqlerrm;
  end;
end $$;
-- (b) guardrail_log content UPDATE + DELETE rejected (same shared trigger, different sink).
do $$
declare v_g uuid; v_t uuid;
begin
  insert into task_queue (type, task_name, status) values ('chained','l3-probe-task','running') returning id into v_t;
  insert into guardrail_log (task_id, guardrail_type, description, action_blocked, status)
    values (v_t, 'anomaly', 'l3 probe', true, 'pending') returning id into v_g;
  begin
    update guardrail_log set description = 'tampered' where id = v_g;     -- content mutation (not a whitelisted transition)
    raise exception 'SEAM5b FAIL: guardrail_log content UPDATE was ALLOWED';
  exception when others then
    if sqlerrm like 'SEAM5b FAIL%' then raise; end if;
    raise notice 'SEAM5b OK: guardrail_log content UPDATE rejected (append-only composes) — %', sqlerrm;
  end;
  begin
    delete from guardrail_log where id = v_g;
    raise exception 'SEAM5c FAIL: guardrail_log DELETE was ALLOWED';
  exception when others then
    if sqlerrm like 'SEAM5c FAIL%' then raise; end if;
    raise notice 'SEAM5c OK: guardrail_log DELETE rejected (append-only composes) — %', sqlerrm;
  end;
end $$;

do $$ begin raise notice 'ALL LAYER-3 SEAMS PASS'; end $$;
rollback;
