-- Live-adapter smoke — webhook-auth (ISSUE-017) · R10 / live-adapter-hygiene-sweep Part A
-- Replays the adapter's REAL event_log write paths against the live silo, rolled back. Run:
--   psql "$SILO_DB_URL" -v ON_ERROR_STOP=1 -f app/webhook-auth/results/live-smoke.sql
--
-- History: session-73 hygiene audit found B1 — the four event_type values below were emitted by the
-- adapter (outcome.ts verified/replay_dropped/rate_throttled + supabase-store alertSuperAdmins
-- failure_alert) but existed in NO migration, so every live webhook write threw `invalid input value for
-- enum event_type` (silent 100% failure behind a green offline suite). Fixed by migration 0024
-- (OD-179 residual). This smoke proves the write paths now succeed.

begin;

-- outcome.ts + alertSuperAdmins write paths — all four event_type values must be admitted by the enum.
insert into event_log (task_id, event_type, entity_ids, summary, payload) values
  (null, 'webhook_verified',       '{}', 'live-smoke webhook-auth', '{"src":"smoke"}'),
  (null, 'webhook_replay_dropped', '{}', 'live-smoke webhook-auth', '{"src":"smoke"}'),
  (null, 'webhook_rate_throttled', '{}', 'live-smoke webhook-auth', '{"src":"smoke"}'),
  (null, 'webhook_failure_alert',  '{}', 'live-smoke webhook-auth', '{"src":"smoke"}');

-- writeAudit path (rotation) — access_audit audit_type/target_type/action are text (not enums); actor_type
-- 'system' is a valid enum member. Proves the secret-rotation audit write path.
insert into access_audit (audit_type, actor_identity, actor_type, action, target_type, after_value, reason)
  values ('webhook_secret', 'service_role:provisioning', 'system', 'webhook_secret_rotated', 'webhook_secrets',
          '{"connector":"smoke","secret_kind":"signing"}', 'live-smoke');

do $$
begin
  if (select count(*) from event_log where summary = 'live-smoke webhook-auth') <> 4 then
    raise exception 'webhook-auth smoke: expected 4 event_log rows';
  end if;
end $$;

rollback;
