-- ISSUE-052 (C5 JOB) — R10 live-adapter hygiene smoke (ROLLED BACK; run from a 💻 full/live env against the silo).
-- Proves the two pg adapters (SupabaseProjectionSink UPDATE of the task_queue OD-058 projection + SupabaseEventSink
-- INSERT of each emitted event_type) hit the REAL baseline DDL with no drift. Nothing is committed.
begin;

-- (1) a task_queue row to project onto (ISSUE-048 owns the lifecycle; we only mirror Inngest into its columns).
insert into task_queue (id, type, task_name, status)
values ('00000000-0000-0000-0000-0000000000f2', 'event', 'inngest-dlq R10 smoke', 'pending');

-- (2) SupabaseProjectionSink.sync — the OD-058 audit projection UPDATE (attempts/next_retry_at/status/error).
update task_queue
   set attempts      = 2,
       next_retry_at = now() + interval '20 seconds',
       status        = 'running'::task_status,
       error         = '[{"attempt":1,"message":"transient","at":"2026-07-08T00:00:00Z"},
                         {"attempt":2,"message":"transient","at":"2026-07-08T00:00:10Z"}]'::jsonb
 where id = '00000000-0000-0000-0000-0000000000f2';

-- read back (expect attempts=2, status=running, error length 2, next_retry_at not null).
select attempts, status, next_retry_at is not null as has_retry, jsonb_array_length(error) as errs
  from task_queue where id = '00000000-0000-0000-0000-0000000000f2';

-- terminal DLQ projection (status=failed, next_retry_at cleared — no scheduled retry).
update task_queue set status = 'failed'::task_status, next_retry_at = null
 where id = '00000000-0000-0000-0000-0000000000f2';

-- (3) SupabaseEventSink.append — every emitted event_type must INSERT without `invalid input value for enum`.
insert into event_log (task_id, event_type, entity_ids, summary, payload) values
  ('00000000-0000-0000-0000-0000000000f2', 'task_completed'::event_type, '{}'::uuid[], 'smoke: job completed record', '{}'::jsonb),
  ('00000000-0000-0000-0000-0000000000f2', 'task_failed'::event_type,    '{}'::uuid[], 'smoke: job dead-lettered record', '{}'::jsonb),
  ('00000000-0000-0000-0000-0000000000f2', 'queue_backup'::event_type,   '{}'::uuid[], 'smoke: DLQ liveness heartbeat', '{}'::jsonb);

select event_type, summary from event_log where task_id = '00000000-0000-0000-0000-0000000000f2' order by event_type;

rollback;
