-- ISSUE-011 observability — LIVE-ADAPTER SMOKE (R10 hygiene sweep)
-- Target: app/observability/src/supabase-store.ts  (the ONLY module that talks to pg).
--
-- WHAT THIS PROVES (and does NOT): this replays the adapter's REAL write/read statements — the exact
-- INSERT/UPDATE column lists and enum-valued literals from supabase-store.ts — against the live silo DB
-- so we catch schema drift the offline InMemory reference cannot see (a missing/omitted column, an
-- enum literal not in the DDL enum, a column the adapter names that the table lacks). It also pins the
-- M10 finding: redactTombstone runs a bare `update … where id=$1 and redacted_at is null` with NO
-- rowCount inspection, so a compliance-erasure aimed at a MISSING id resolves as SILENT success where the
-- reference model (store.ts InMemoryEventLogStore.redactTombstone) THROWS "row … not found for redaction".
-- The SQL below demonstrates rowCount=0 on that path (proof for the review); the FIX is in app-code
-- (inspect rowCount and throw not-found) — not something a DDL change can carry.
--
-- ROLE: the live adapter connects via new pg.Pool({ connectionString: DATABASE_URL }); the silo DATABASE_URL
-- resolves to the `postgres` owner role (introspected: current_user=postgres), which BYPASSES RLS and holds
-- the table-owner DELETE grant 0001c revoked from service_role. So RLS "permission denied" (#2) is NOT a
-- risk for this adapter, and the prune() flagged-DELETE path has the grant it needs. Run this smoke AS THE
-- SAME ROLE the adapter uses (SILO_DB_URL) so grants/RLS are exercised identically.
--
-- HOW TO RUN (orchestrator only — live writes stay serial; do NOT run ad hoc):
--   source ~/.ai-harness-secrets.env
--   /opt/homebrew/opt/libpq/bin/psql "$SILO_DB_URL" -v ON_ERROR_STOP=1 -f app/observability/results/live-smoke.sql
--
-- Everything runs in ONE transaction that ROLLS BACK at the end — no row survives; the silo is byte-identical
-- afterward. Parent rows (a task_queue row for the FK) are created INSIDE the txn and rolled back too.

\set ON_ERROR_STOP on
begin;

-- Deterministic fixture ids (rolled back; chosen not to collide with 0001d_seed).
\set task_id     '''aa000000-0000-0000-0000-00000000e011'''
\set ev_id       '''bb000000-0000-0000-0000-00000000e011'''
\set notif_id    '''cc000000-0000-0000-0000-00000000e011'''
\set missing_id  '''dd000000-0000-0000-0000-0000deadbeef'''

-- A parent task_queue row so event_log.task_id / task_queue reads have a real referent (FK-safe).
insert into public.task_queue (id, type, task_name, status)
values (:task_id, 'event', 'live-smoke fixture task', 'completed');

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- 1. SupabaseEventLogStore.append() — the REAL 12-column INSERT, verbatim column list + enum literals.
--    Proves every named column exists, event_type/answer_mode literals are in their DDL enums, and the
--    param types (uuid[], jsonb, bigint, boolean) all bind. (supabase-store.ts L41-59)
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
insert into public.event_log
  (id, task_id, event_type, entity_ids, summary, payload, duration_ms, cost_tokens, cost_unknown,
   answer_mode, redacted_at, created_at)
values
  (:ev_id, :task_id, 'memory_written',
   array['11111111-1111-1111-1111-111111111111']::uuid[],
   'live-smoke append', '{"subject":"smoke"}'::jsonb, 42, 7, false, 'cited', null, now());

do $$
begin
  if not exists (select 1 from public.event_log
                 where id = 'bb000000-0000-0000-0000-00000000e011'
                   and event_type = 'memory_written' and cost_tokens = 7 and cost_unknown = false
                   and answer_mode = 'cited' and entity_ids is not null) then
    raise exception 'FAIL append: the 12-column event_log INSERT did not land as written';
  end if;
  raise notice 'PASS append (12-column INSERT + enum literals bound against live DDL)';
end $$;

-- append() duplicate-id path: a second INSERT of the same id must raise unique_violation (SQLSTATE 23505),
-- which the adapter maps to AppendOnlyViolation. Prove the substrate raises 23505 (not a silent upsert).
do $$
begin
  insert into public.event_log (id, event_type, summary, created_at)
  values ('bb000000-0000-0000-0000-00000000e011', 'task_started', 'dup', now());
  raise exception 'FAIL append: a duplicate id did NOT raise — append-only clobber went silent';
exception
  when unique_violation then
    raise notice 'PASS append (duplicate id → 23505 unique_violation → AppendOnlyViolation)';
  when others then
    if sqlerrm like 'FAIL %' then raise; end if;
    raise exception 'FAIL append: duplicate id raised % but not unique_violation', sqlerrm;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- 2. SupabaseEventLogStore.redactTombstone() — the ONE whitelisted UPDATE, verbatim. (supabase-store.ts L79-86)
--    2a: on a REAL, not-yet-redacted row it applies (null→non-null redacted_at, PII scrubbed) — 1 row.
--    2b: M10 PROOF — the SAME UPDATE against a MISSING id touches 0 rows and DOES NOT ERROR. The adapter
--        never inspects that rowCount, so it resolves as SILENT SUCCESS; the reference model throws
--        "not found". This block asserts rowCount=0 to make the divergence concrete for the review.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
do $$
declare n int;
begin
  update public.event_log
     set summary = '[redacted]', entity_ids = null, payload = null, redacted_at = now()
   where id = 'bb000000-0000-0000-0000-00000000e011' and redacted_at is null;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL redactTombstone: expected 1 row tombstoned, got %', n; end if;
  if exists (select 1 from public.event_log
             where id = 'bb000000-0000-0000-0000-00000000e011'
               and (summary <> '[redacted]' or entity_ids is not null or payload is not null
                    or redacted_at is null)) then
    raise exception 'FAIL redactTombstone: PII not scrubbed / redacted_at not set';
  end if;
  raise notice 'PASS redactTombstone (real row: null→non-null redacted_at, PII scrubbed, 1 row)';
end $$;

do $$
declare n int;
begin
  -- The adapter runs exactly this, then returns void regardless of row_count (M10).
  update public.event_log
     set summary = '[redacted]', entity_ids = null, payload = null, redacted_at = now()
   where id = 'dd000000-0000-0000-0000-0000deadbeef' and redacted_at is null;
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'UNEXPECTED: a missing-id redaction touched % row(s); fixture id leaked?', n;
  end if;
  -- rowCount=0, no error raised → the adapter would resolve() as success. Reference model THROWS here.
  raise notice 'M10 CONFIRMED — redactTombstone on a MISSING id: 0 rows, NO error → adapter returns SILENT success (reference throws not-found). #3 divergence on the compliance-erasure path.';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- 3. SupabaseEventLogStore.prune() — the retention DELETE inside a `set local app.retention_prune='on'`
--    txn, verbatim. Proves the whitelisted delete succeeds for the adapter's role (owner has DELETE grant).
--    (supabase-store.ts L96-108)  NOTE: prune() likewise never checks rowCount, but for a retention delete
--    an absent row is a legitimate no-op, so that is NOT flagged.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
do $$
declare n int;
begin
  set local app.retention_prune = 'on';
  delete from public.event_log where id = 'bb000000-0000-0000-0000-00000000e011';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL prune: flagged retention DELETE removed % rows, expected 1', n; end if;
  raise notice 'PASS prune (flagged retention DELETE succeeded for the adapter role)';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- 4. SupabaseNotificationStore.create() — the REAL 9-column INSERT with the 'unread' literal + the
--    watchdog's actual enum-valued type ('alert_engine_stalled'). Proves every named column exists and the
--    alert_type literal is in the DDL enum. (supabase-store.ts L154-159)
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
insert into public.notifications
  (id, type, severity, title, body, recipient, recipient_role, read_state, created_at)
values
  (:notif_id, 'alert_engine_stalled', 'critical', 'Alert engine stalled',
   'no heartbeat within stall window', null, 'super_admin', 'unread', now());

do $$
begin
  if not exists (select 1 from public.notifications
                 where id = 'cc000000-0000-0000-0000-00000000e011'
                   and type = 'alert_engine_stalled' and read_state = 'unread'
                   and recipient is null and recipient_role = 'super_admin') then
    raise exception 'FAIL notifications.create: the 9-column INSERT did not land as written';
  end if;
  raise notice 'PASS notifications.create (9-column INSERT + alert_type/read_state enum literals bound)';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- 5. The READ ports the adapter exposes, run verbatim so a projected/renamed column that no longer exists
--    would error here rather than at integration. (supabase-store.ts L67-72, L121-125, L138-142, L162)
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
do $$
begin
  perform id, task_id, event_type, entity_ids, summary, payload, duration_ms, cost_tokens, cost_unknown,
          answer_mode, redacted_at, created_at
    from public.event_log;                                    -- EventLogStore.all()
  perform id as task_id, status::text as status
    from public.task_queue where status in ('completed','failed');   -- TaskQueueStore.terminalTasks()
  perform id, task_id, created_at from public.guardrail_log;  -- GuardrailLogStore.all()
  perform * from public.notifications;                        -- NotificationStore.all()
  raise notice 'PASS read ports (all() / terminalTasks() / guardrail all() / notifications all() projections valid)';
end $$;

rollback;   -- nothing persists; the silo is byte-identical afterward.
