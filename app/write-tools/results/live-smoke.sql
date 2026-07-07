-- ISSUE-035 (@harness/write-tools) — LIVE-SMOKE for the SupabaseApprovalQueue adapter.
-- Target DB: the CLIENT SILO ($SILO_DB_URL). Runs as the migration/service_role connection (RLS-exempt).
-- Rolled back (non-mutating) — safe to run against the live silo. Expect ALL ASSERTIONS PASS then ROLLBACK.
--   Run: psql "$SILO_DB_URL" -f app/write-tools/results/live-smoke.sql
--
-- WHY: the offline fake (store.ts InMemoryApprovalQueue) cannot catch column/enum/constraint/trigger drift
-- between the adapter's REAL statements and the live DDL. This script REPLAYS the exact write-path
-- statements the adapter (app/write-tools/src/supabase-store.ts) runs against guardrail_log:
--   * enqueue():  insert into guardrail_log (task_id, guardrail_type, description, action_blocked, status)
--                 values (null, 'approval_gate', <desc>, false, 'pending') returning id;
--   * get():      select id, description, action_blocked, status, created_at, reviewed_by, reviewed_at
--                 from guardrail_log where id = $1 and guardrail_type = 'approval_gate';
--   * decide():   update guardrail_log set status = <status>, reviewed_by = <uuid>, reviewed_at = now()
--                 where id = $1 and guardrail_type = 'approval_gate'
--                 returning id, status, created_at, reviewed_at, reviewed_by;
-- and asserts the guarded rejects the append-only trigger (enforce_audit_append_only, migration 0015) must
-- raise: an in-place content tamper, and a re-decide of an already-decided (non-pending) row.
--
-- FK note: decide() writes reviewed_by (uuid references profiles(id); profiles.id -> auth.users(id)). To
-- replay that statement faithfully with a REAL reviewer id we seed one auth.users + one profiles row inside
-- the txn (rolled back). enqueue()/get() need no fixture — task_id is null (nullable FK) and reviewed_by is
-- null until decide().

\set ON_ERROR_STOP on
begin;

do $$
declare
  v_reviewer  uuid := gen_random_uuid();
  v_prop_id   uuid;   -- the enqueued approval_gate proposal id (mirrors enqueue()'s RETURNING id)
  v_prop2_id  uuid;   -- a second proposal to exercise the re-decide reject
  r           record;
  v_touched   int;
begin
  -- ── Fixture: a real human approver (satisfies the decide() reviewed_by FK) ────────────────────────────
  -- profiles.id references auth.users(id); insert the auth row first, then the profile.
  -- auth.users is Supabase-managed; every column except `id` is nullable/defaulted, so insert id only to
  -- minimise the NOT-NULL surface (a missing-column throw here would be a fixture bug, not real drift).
  -- profiles.email IS NOT NULL, so supply it there.
  insert into auth.users (id) values (v_reviewer);
  insert into profiles (id, email, name) values (v_reviewer, 'smoke-approver@example.test', 'Smoke Approver');
  raise notice 'PASS fixture: seeded auth.users + profiles reviewer % ', v_reviewer;

  -- ── A. enqueue(): the exact adapter INSERT (task_id=null, approval_gate, action_blocked=false, pending) ─
  insert into guardrail_log (task_id, guardrail_type, description, action_blocked, status)
    values (null, 'approval_gate',
            'proposed write: tool=''ghl.contact.upsert'' connector=''ghl'' risk=''medium'' (awaiting approval — FR-3.ACT.001)',
            false, 'pending')
    returning id into v_prop_id;
  if v_prop_id is null then
    raise exception 'FAIL A: enqueue INSERT returned no id';
  end if;
  raise notice 'PASS A: enqueue INSERT succeeded (guardrail_log approval_gate/pending) id=%', v_prop_id;

  -- ── B. get(): the exact adapter SELECT (id + approval_gate guard) — must find the pending row ──────────
  select id, description, action_blocked, status, created_at, reviewed_by, reviewed_at
    into r
    from guardrail_log
    where id = v_prop_id and guardrail_type = 'approval_gate';
  if not found then
    raise exception 'FAIL B: get() SELECT did not find the enqueued approval_gate row';
  end if;
  if r.status <> 'pending' or r.action_blocked <> false or r.reviewed_by is not null or r.reviewed_at is not null then
    raise exception 'FAIL B: get() row not in the pending/no-effect state (status=% blocked=% reviewed_by=%)',
      r.status, r.action_blocked, r.reviewed_by;
  end if;
  raise notice 'PASS B: get() SELECT returns the pending, undecided proposal (no external effect recorded)';

  -- ── C. decide(): the exact adapter UPDATE — pending -> approved, set reviewed_by (real uuid) + now() ──
  -- Mirrors the forward-status-transition whitelist branch (a) of enforce_audit_append_only (0015):
  -- old.status='pending', new.status in (approved,rejected,modified), description unchanged, task_id unchanged.
  update guardrail_log
     set status = 'approved', reviewed_by = v_reviewer, reviewed_at = now()
   where id = v_prop_id and guardrail_type = 'approval_gate'
   returning id, status, created_at, reviewed_at, reviewed_by into r;
  if not found then
    raise exception 'FAIL C: decide() UPDATE matched no row';
  end if;
  if r.status <> 'approved' or r.reviewed_by <> v_reviewer or r.reviewed_at is null then
    raise exception 'FAIL C: decide() did not persist the approval (status=% reviewed_by=% reviewed_at=%)',
      r.status, r.reviewed_by, r.reviewed_at;
  end if;
  raise notice 'PASS C: decide() UPDATE persisted approved + reviewer + reviewed_at (forward transition accepted)';

  -- ── C2. decide() with a 'rejected' decision on a fresh pending row also traverses branch (a) ──────────
  insert into guardrail_log (task_id, guardrail_type, description, action_blocked, status)
    values (null, 'approval_gate', 'proposed write: to be rejected', false, 'pending')
    returning id into v_prop2_id;
  update guardrail_log
     set status = 'rejected', reviewed_by = v_reviewer, reviewed_at = now()
   where id = v_prop2_id and guardrail_type = 'approval_gate';
  if not found then
    raise exception 'FAIL C2: decide(rejected) UPDATE matched no row';
  end if;
  raise notice 'PASS C2: decide() rejected-decision forward transition accepted';

  -- ── D. GUARDED REJECT — re-decide of an already-decided (non-pending) row must RAISE. ─────────────────
  -- The adapter's decide() WHERE has no status='pending' guard; live, the append-only trigger rejects any
  -- transition whose old.status <> 'pending' (branch (a) requires old.status='pending'). This proves a
  -- second decision on a decided proposal fails LOUD (never a silent in-place overwrite — #1/#3).
  begin
    update guardrail_log
       set status = 'rejected', reviewed_by = v_reviewer, reviewed_at = now()
     where id = v_prop_id and guardrail_type = 'approval_gate';   -- v_prop_id is now 'approved'
    raise exception 'FAIL D: re-decide of an already-approved row was ALLOWED (silent tamper)';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS D: re-decide of a decided row rejected by append-only trigger -> %', sqlerrm;
  end;

  -- ── E. GUARDED REJECT — a covert in-place description rewrite (no redacted_at) must RAISE. ────────────
  -- Proves the only content mutation guardrail_log permits is the authorized redaction-tombstone (branch c);
  -- a bare description rewrite (the tamper class) is forbidden on a fresh pending row.
  begin
    update guardrail_log set description = 'tampered' where id = v_prop2_id;
    raise exception 'FAIL E: covert in-place description UPDATE was ALLOWED';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS E: covert description rewrite rejected by append-only trigger -> %', sqlerrm;
  end;

  -- ── F. get() approval_gate guard is real — a NON-approval_gate row is invisible to the adapter SELECT. ─
  -- Insert a hard_limit row and confirm the adapter's guarded SELECT does not return it (would be a #2 leak
  -- of a different guardrail class into the approval-queue read path).
  declare v_hl uuid;
  begin
    insert into guardrail_log (task_id, guardrail_type, description, action_blocked, status)
      values (null, 'hard_limit', 'blocked: financial transaction', true, 'pending')
      returning id into v_hl;
    perform 1 from guardrail_log where id = v_hl and guardrail_type = 'approval_gate';
    if found then
      raise exception 'FAIL F: adapter guarded SELECT returned a hard_limit row (class leak)';
    end if;
    raise notice 'PASS F: approval_gate guard excludes non-approval_gate rows from the adapter read path';
  end;

  raise notice 'ALL ASSERTIONS PASS';
end $$;

rollback;
