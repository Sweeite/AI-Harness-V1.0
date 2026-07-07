-- Migration 0023 — add task_queue/notifications to the supabase_realtime publication. Checkpoint-3
-- adversarial review (session 72) found `select * from pg_publication_tables where pubname =
-- 'supabase_realtime'` returned 0 rows: neither table this package (ISSUE-076) depends on for Postgres
-- Changes had ever been added to the publication, so a `channel().on('postgres_changes', ...)` subscription
-- connects fine but never receives a single change event — a silent freeze reported as `mode: 'live'`
-- (#3). This is independent of, and compounds, the separate RLS gap on these two tables (only default_deny
-- for `authenticated` — owned by the still-blocked ISSUE-020; NOT fixed by this migration).
--
-- transactional:true -- do NOT add BEGIN/COMMIT. Re-runnable (guarded on pg_publication_tables).

do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'task_queue'
  ) then
    alter publication supabase_realtime add table public.task_queue;
  end if;
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
