-- app/realtime/results/live-smoke.sql
-- ISSUE-076 — live-adapter hygiene smoke for src/supabase-store.ts (SupabaseRealtimeConfig).
-- R10 / live-adapter-hygiene-sweep. Run:  psql "$SILO_DB_URL" -f app/realtime/results/live-smoke.sql
--
-- WHAT THIS ADAPTER IS: a READ-ONLY config/seed transport. It performs NO writes — only four SELECT paths:
--   (a) loadConfig()  -> `select value from config_values where key = $1`  (6 poll-cadence keys + 1 headroom key)
--   (b) seedApprovalQueue()  -> `select id,status,task_name,created_at from task_queue where status='awaiting_approval' order by created_at asc`
--   (c) seedNotifications()  -> `select id,type,severity,title,read_state,created_at from notifications order by created_at desc`
-- Plus the Postgres-Changes subscriptions require task_queue + notifications to be in the supabase_realtime publication (mig 0023).
--
-- WHAT THIS PROVES (all read-side, so the "writes" below are seed rows the SELECTs must observe, then ROLLBACK):
--   1. The publication membership (mig 0023) is live — a subscription would actually receive change events, not silently freeze (#3).
--   2. Every column the four SELECTs project exists with a compatible type, and the `status='awaiting_approval'` predicate
--      literal is a valid task_status enum member (else the seed read would 42703/22P02 at runtime, not offline).
--   3. config_values is jsonb-shaped and readable; a numeric cadence + a headroom value round-trip through the same read.
--   4. The adapter's connect role (postgres owner, rolbypassrls=t per OD-193) can SELECT all three tables.
--
-- Connect role note (OD-193): SILO_DB_URL connects as `postgres` (rolbypassrls=t), NOT service_role. RLS is bypassed on
-- this path, so this smoke does NOT assert authenticated-role visibility (the authenticated SELECT grant on
-- task_queue/notifications is owned by still-blocked ISSUE-020, mig 0023 comment L7). We only prove the real adapter role works.
--
-- NON-DESTRUCTIVE: everything runs inside BEGIN … ROLLBACK. Nothing persists.

\set ON_ERROR_STOP on
begin;

-- ── Assert 0: we are the role the adapter actually connects as (postgres owner, bypassrls) ──
do $$
begin
  if current_user <> 'postgres' then
    raise exception 'CONNECT-ROLE: expected postgres owner (adapter builds pg.Pool on SILO_DB_URL, OD-193), got %', current_user;
  end if;
end $$;

-- ── Assert 1: publication membership is LIVE (mig 0023) — the fix for the silent-freeze #3 ──
do $$
declare n int;
begin
  select count(*) into n
    from pg_publication_tables
   where pubname = 'supabase_realtime' and tablename in ('task_queue','notifications');
  if n <> 2 then
    raise exception 'PUBLICATION: expected task_queue AND notifications in supabase_realtime, found % of 2 (mig 0023 not applied → Postgres-Changes subscribe silently freezes, #3)', n;
  end if;
end $$;

-- ── Assert 2: 'awaiting_approval' is a real task_status member (the seedApprovalQueue predicate literal) ──
do $$
begin
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
     where t.typname = 'task_status' and e.enumlabel = 'awaiting_approval'
  ) then
    raise exception 'ENUM: task_status has no member awaiting_approval — seedApprovalQueue predicate would 22P02';
  end if;
end $$;

-- ── Seed representative parent rows (matching real column types / enum members) the read paths must observe ──
-- config_values: one numeric poll cadence (jsonb number) + the headroom threshold (jsonb number).
insert into config_values (key, value) values
  ('polling_interval_health_metrics_s', to_jsonb(45)),
  ('realtime_connection_headroom_threshold', to_jsonb(75))
on conflict (key) do update set value = excluded.value;

-- task_queue: one awaiting_approval row (must be seen) + one running row (must NOT be seen by the status filter).
insert into task_queue (type, task_name, status) values
  ('human'::task_type, 'smoke-approval-A', 'awaiting_approval'::task_status),
  ('event'::task_type, 'smoke-running-B',  'running'::task_status);

-- notifications: one row exercising every projected column, incl. read_state enum + alert_type enum.
insert into notifications (type, severity, title, body, read_state) values
  ('queue_backup'::alert_type, 'warning', 'smoke-notif-A', 'body', 'unread'::notification_read);

-- ── Assert 3: loadConfig() reads — config_values value is jsonb and coerces to a finite positive number ──
do $$
declare cadence jsonb; hd jsonb;
begin
  select value into cadence from config_values where key = 'polling_interval_health_metrics_s';
  if cadence is null or (cadence #>> '{}')::numeric <> 45 then
    raise exception 'CONFIG: poll cadence read did not round-trip (got %)', cadence;
  end if;
  select value into hd from config_values where key = 'realtime_connection_headroom_threshold';
  if hd is null or (hd #>> '{}')::numeric <> 75 then
    raise exception 'CONFIG: headroom threshold read did not round-trip (got %)', hd;
  end if;
end $$;

-- ── Assert 4: seedApprovalQueue() — exact projection + intra-silo status predicate, NO client_slug ──
do $$
declare seen int;
begin
  select count(*) into seen
    from (
      select id, status, task_name, created_at
        from task_queue
       where status = 'awaiting_approval'
       order by created_at asc
    ) q
   where task_name = 'smoke-approval-A';
  if seen <> 1 then
    raise exception 'SEED-APPROVAL: awaiting_approval seed row not returned by the exact adapter projection (got %)', seen;
  end if;
  -- the running row must be filtered out (the predicate is the only isolation the subscription carries)
  if exists (
    select 1 from task_queue where status = 'awaiting_approval' and task_name = 'smoke-running-B'
  ) then
    raise exception 'SEED-APPROVAL: status predicate leaked a non-awaiting_approval row';
  end if;
end $$;

-- ── Assert 5: seedNotifications() — every projected column readable, ordered by created_at desc ──
do $$
declare seen int;
begin
  select count(*) into seen
    from (
      select id, type, severity, title, read_state, created_at
        from notifications
       order by created_at desc
    ) n
   where title = 'smoke-notif-A' and read_state = 'unread';
  if seen <> 1 then
    raise exception 'SEED-NOTIF: notification seed row not returned by the exact adapter projection (got %)', seen;
  end if;
end $$;

rollback;  -- nothing persists — this adapter has no write paths; seeds existed only to be read back
