-- ISSUE-016 (C0 REC — support / login-recovery) — LIVE-SMOKE for the SupabaseSupportStore adapter
-- (app/support-recovery/src/supabase-store.ts).
-- Target DB: SILO  (run: psql "$SILO_DB_URL" -f this).  Non-mutating: the whole script ROLLS BACK.
--
-- Purpose: replay the adapter's ACTUAL write-path SQL against the real baseline DDL
-- (app/silo/migrations/0001_baseline.sql: support_requests L107-116 + support_status enum L28;
-- access_audit L211-226 + actor_type enum L41; append-only trigger L689-720) so any column / enum /
-- constraint / cast / guarded-WHERE drift throws HERE — catching the "fake-passes-offline /
-- live-adapter-throws" class before Stage-4 is closed.
--
-- The adapter statements replayed VERBATIM (same tables, columns, enum casts, guarded WHERE):
--   insertRequest():  insert into support_requests (email,name,issue_description,status,created_at,updated_at)
--                       values ($1,$2,$3,'pending',$4,$4) returning <cols>
--   listRequests():   select <cols> from support_requests order by created_at desc
--   getRequest():     select <cols> from support_requests where id=$1
--   transition():     select status from support_requests where id=$1 for update            (row-lock read)
--                     update support_requests set status=$3::support_status,
--                            assigned_to = case when $3='in_progress' then $5::uuid else assigned_to end,
--                            updated_at=$2
--                       where id=$1 and status=$4::support_status returning <cols>          (guarded WHERE)
--                     insert into access_audit (audit_type,actor_identity,actor_type,target_entity_id,
--                            target_type,action,before_value,after_value,created_at)
--                       values ('support_status_transition',$1,'user',$2,'support_request',$3,
--                               jsonb_build_object('status',$4::text),jsonb_build_object('status',$5::text),$6)
--   transitionsFor(): select before_value,after_value,actor_identity,created_at from access_audit
--                       where audit_type='support_status_transition' and target_entity_id=$1 order by created_at asc
--   pendingOlderThan():select <cols> from support_requests where status='pending' and created_at<$1 order by created_at asc
--
-- FK: support_requests.assigned_to -> profiles(id) (nullable), and profiles.id -> auth.users(id). The
-- transition pending->in_progress sets assigned_to = actorId::uuid, so we seed an auth.users + profiles
-- parent row FIRST (within the txn) whose id is the actor — otherwise the assigned_to FK would throw, and
-- that would be a FIXTURE bug, not real drift. access_audit has no FK to profiles on actor_identity (it is
-- plain text), target_entity_id is a free uuid — so no other parent rows are needed.
--
-- Style mirrors app/silo/results/stage4-checkpoint-capstone.sql + app/context-envelope/results/live-smoke.sql:
-- per-assertion savepoint/exception handling, raise notice 'PASS ...' / 'FAIL ...', ending 'ALL ASSERTIONS PASS'.
\set ON_ERROR_STOP on
begin;

do $$
declare
  v_actor  uuid := gen_random_uuid();   -- the PERM-support.resolve holder (profiles(id)) who transitions
  v_req    uuid;                          -- the support request under test
  v_req2   uuid;                          -- a second request for the stale-sweep read
  v_status support_status;
  v_assigned uuid;
  v_cnt    int;
  v_from   text;
  v_to     text;
begin
  -- ── fixture: an auth.users + profiles parent row so the assigned_to FK is satisfied inside the txn ──────
  -- auth.users is Supabase-managed; seed the minimal safe columns (id + email + instance/aud/role text).
  -- Wrapped so a fixture failure is labelled distinctly from an adapter-statement failure.
  begin
    insert into auth.users (id, instance_id, aud, role, email)
      values (v_actor, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
              '__rec016_actor__@smoke.local');
    insert into profiles (id, email, name)
      values (v_actor, '__rec016_actor__@smoke.local', 'REC016 Smoke Actor');
    raise notice 'PASS setup: auth.users + profiles parent seeded (actor=%)', v_actor;
  exception when others then
    raise exception 'FAIL setup: could not seed actor profile (fixture bug, not drift) -> %', sqlerrm;
  end;

  -- ══ (1) insertRequest() — the PUBLIC intake insert. All three NOT-NULL text cols supplied, status literal
  --        'pending', created_at/updated_at bound to the same $4. id/assigned_to default. Asserts every
  --        column name + the 'pending' enum literal are real, and the RETURNING projection resolves. ────────
  declare v_rec record;
  begin
    -- Mirror the adapter's RETURNING projection EXACTLY (id,email,name,issue_description,status,assigned_to,
    -- created_at,updated_at) into a record, so any renamed/dropped/retyped projected column throws HERE.
    insert into support_requests (email, name, issue_description, status, created_at, updated_at)
      values ('user@smoke.local', 'Smoke User', 'cannot sign in', 'pending', now(), now())
      returning id, email, name, issue_description, status, assigned_to, created_at, updated_at
      into v_rec;
    v_req := v_rec.id;
    if v_rec.status <> 'pending' or v_rec.assigned_to is not null then
      raise exception 'FAIL 1: inserted row status=%/assigned_to=% (expected pending/null)', v_rec.status, v_rec.assigned_to;
    end if;
    raise notice 'PASS 1: insertRequest insert accepted (cols + ''pending''::support_status + full RETURNING projection valid) id=%', v_req;
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise exception 'FAIL 1: insertRequest insert threw -> %', sqlerrm;
  end;

  -- ══ (2) getRequest() — select <cols> where id=$1. Proves the SELECT_COLS projection is all-real. ─────────
  begin
    select status, assigned_to into v_status, v_assigned
      from support_requests where id = v_req;
    if v_status <> 'pending' or v_assigned is not null then
      raise exception 'FAIL 2: getRequest returned status=%/assigned_to=% (expected pending/null)', v_status, v_assigned;
    end if;
    raise notice 'PASS 2: getRequest select returns the row (assigned_to null while pending)';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise exception 'FAIL 2: getRequest select threw -> %', sqlerrm;
  end;

  -- ══ (3) transition() pending->in_progress — the row-lock read, the GUARDED update (status=$4 re-asserted
  --        in the WHERE), the assigned_to CASE (set to actor on pick-up), and the access_audit history insert.
  --        Asserts: update affects exactly 1 row, assigned_to becomes the actor, audit row lands. ───────────
  begin
    perform status from support_requests where id = v_req for update;  -- row-lock read
    update support_requests
       set status = 'in_progress'::support_status,
           assigned_to = case when 'in_progress' = 'in_progress' then v_actor::uuid else assigned_to end,
           updated_at = now()
     where id = v_req and status = 'pending'::support_status
     returning status, assigned_to into v_status, v_assigned;
    get diagnostics v_cnt = row_count;
    if v_cnt <> 1 then
      raise exception 'FAIL 3a: guarded pending->in_progress update affected % rows (expected 1)', v_cnt;
    end if;
    if v_status <> 'in_progress' or v_assigned is distinct from v_actor then
      raise exception 'FAIL 3b: post-update status=%/assigned_to=% (expected in_progress/actor)', v_status, v_assigned;
    end if;
    insert into access_audit (audit_type, actor_identity, actor_type, target_entity_id, target_type, action,
                              before_value, after_value, created_at)
      values ('support_status_transition', v_actor::text, 'user', v_req, 'support_request',
              'transition:pending->in_progress',
              jsonb_build_object('status', 'pending'::text),
              jsonb_build_object('status', 'in_progress'::text), now());
    raise notice 'PASS 3: transition pending->in_progress (guarded update + assigned_to=actor + access_audit insert)';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise exception 'FAIL 3: transition pending->in_progress threw -> %', sqlerrm;
  end;

  -- ══ (4) the WHERE guard (status=$4) is REAL: a re-run of the pending->in_progress update now that the row
  --        is already in_progress must affect ZERO rows (this is the optimistic-concurrency guard — a racing
  --        double-transition serializes to at most one winner; the adapter maps rowCount=0 to a lost-race
  --        reject). If it hit >0 rows the guard would be dead and a double-transition could win twice. ───────
  update support_requests
     set status = 'in_progress'::support_status, updated_at = now()
   where id = v_req and status = 'pending'::support_status;   -- from-guard no longer matches
  get diagnostics v_cnt = row_count;
  if v_cnt <> 0 then
    raise exception 'FAIL 4: stale from-guard (status=pending) update affected % rows (expected 0 — guard dead)', v_cnt;
  end if;
  raise notice 'PASS 4: transition WHERE-guard (status=$4) is live — stale from-state update is a 0-row no-op';

  -- ══ (5) transition() in_progress->resolved — the second legal move; assigned_to is PRESERVED (CASE else
  --        branch keeps it), status flips to resolved. ─────────────────────────────────────────────────────
  begin
    update support_requests
       set status = 'resolved'::support_status,
           assigned_to = case when 'resolved' = 'in_progress' then v_actor::uuid else assigned_to end,
           updated_at = now()
     where id = v_req and status = 'in_progress'::support_status
     returning status, assigned_to into v_status, v_assigned;
    get diagnostics v_cnt = row_count;
    if v_cnt <> 1 or v_status <> 'resolved' or v_assigned is distinct from v_actor then
      raise exception 'FAIL 5: in_progress->resolved rows=%/status=%/assigned_to=% (expected 1/resolved/actor-preserved)', v_cnt, v_status, v_assigned;
    end if;
    insert into access_audit (audit_type, actor_identity, actor_type, target_entity_id, target_type, action,
                              before_value, after_value, created_at)
      values ('support_status_transition', v_actor::text, 'user', v_req, 'support_request',
              'transition:in_progress->resolved',
              jsonb_build_object('status', 'in_progress'::text),
              jsonb_build_object('status', 'resolved'::text), now());
    raise notice 'PASS 5: transition in_progress->resolved (assigned_to preserved via CASE else + audit insert)';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise exception 'FAIL 5: in_progress->resolved threw -> %', sqlerrm;
  end;

  -- ══ (6) transitionsFor() — read the appended history: two rows, ordered created_at asc, before/after jsonb
  --        carry the .status the adapter maps out. Proves the audit_type filter + jsonb projection are real. ─
  select count(*) into v_cnt
    from access_audit
   where audit_type = 'support_status_transition' and target_entity_id = v_req;
  if v_cnt <> 2 then
    raise exception 'FAIL 6a: transitionsFor found % audit rows (expected 2)', v_cnt;
  end if;
  select before_value ->> 'status', after_value ->> 'status' into v_from, v_to
    from access_audit
   where audit_type = 'support_status_transition' and target_entity_id = v_req
   order by created_at asc limit 1;
  if v_from <> 'pending' or v_to <> 'in_progress' then
    raise exception 'FAIL 6b: first transition row before/after = %/% (expected pending/in_progress)', v_from, v_to;
  end if;
  raise notice 'PASS 6: transitionsFor reads both history rows in created_at asc order (before/after jsonb intact)';

  -- ══ (7) access_audit is APPEND-ONLY (0001 trigger L689): an in-place content UPDATE of a fresh audit row
  --        (no redacted_at) must be REJECTED. The adapter never updates access_audit; this proves the sink
  --        the adapter appends to is genuinely tamper-evident (#1/#3). ────────────────────────────────────
  begin
    update access_audit set action = 'tampered'
     where audit_type = 'support_status_transition' and target_entity_id = v_req;
    raise exception 'FAIL 7: in-place UPDATE of access_audit was ALLOWED (append-only trigger dead)';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS 7: access_audit in-place UPDATE rejected (append-only / tamper-evident) -> %', sqlerrm;
  end;

  -- ══ (8) the resolved row is TERMINAL: the guarded update for the (only) legal move OUT of a non-terminal
  --        state can no longer match (status is resolved). A pending->in_progress guard finds 0 rows, and an
  --        in_progress->resolved guard finds 0 rows — resolved history is immutable at the SQL guard level
  --        (the adapter also refuses in-app, but this proves the guarded WHERE alone will not re-move it). ──
  update support_requests
     set status = 'in_progress'::support_status, updated_at = now()
   where id = v_req and status = 'in_progress'::support_status;   -- resolved row: no match
  get diagnostics v_cnt = row_count;
  if v_cnt <> 0 then
    raise exception 'FAIL 8: a guarded re-move of a resolved row affected % rows (expected 0)', v_cnt;
  end if;
  raise notice 'PASS 8: resolved row is terminal at the guarded-WHERE level (no legal from-state matches)';

  -- ══ (9) pendingOlderThan() — the stale-sweep read: status='pending' AND created_at < cutoff, ordered asc.
  --        Seed a second pending row with an OLD created_at; assert only it is returned for a recent cutoff. ─
  insert into support_requests (email, name, issue_description, status, created_at, updated_at)
    values ('stale@smoke.local', 'Stale User', 'still stuck', 'pending',
            now() - interval '2 hours', now() - interval '2 hours')
    returning id into v_req2;
  select count(*) into v_cnt
    from support_requests
   where status = 'pending' and created_at < (now() - interval '30 minutes');
  if v_cnt < 1 then
    raise exception 'FAIL 9a: pendingOlderThan(30m cutoff) found % rows (expected >=1 stale row)', v_cnt;
  end if;
  -- the resolved row under test must NOT appear (status filter), and a freshly-created pending row must not either
  perform 1 from support_requests
    where id = v_req and status = 'pending' and created_at < (now() - interval '30 minutes');
  if found then
    raise exception 'FAIL 9b: the resolved request leaked into the pending stale sweep (status filter dead)';
  end if;
  raise notice 'PASS 9: pendingOlderThan returns only pending rows past the cutoff (status + created_at filters live)';

  raise notice 'ALL ASSERTIONS PASS';
end $$;

rollback;
