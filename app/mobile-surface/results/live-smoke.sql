-- ============================================================================
-- app/mobile-surface — LIVE-ADAPTER SMOKE (ISSUE-079, surface-12 mobile surface)
-- R10 live-adapter hygiene sweep for src/supabase-store.ts (SupabaseMobileSurfaceStore).
--
-- WHAT THIS PROVES (replays the adapter's REAL read/write paths against the live silo DDL — 0001 baseline):
--   • push_subscriptions upsert (the one net-new binding this issue OWNS, FR-7.VIEW.003) — INSERT ... ON
--     CONFLICT (user_id, endpoint) DO UPDATE ... RETURNING; a re-register from the SAME device upserts to ONE
--     row (the unique(user_id,endpoint) constraint, index push_sub_user_endpoint) and refreshes keys/platform/
--     last_seen — matches InMemoryMobileSurfaceStore.registerPushSubscription 1:1.
--   • listPushSubscriptions               — reads back the row for the owner (order by last_seen desc).
--   • appendEventLog                       — INSERT public.event_log (event_type,entity_ids,summary,payload) —
--                                            the mobile `/` command audit sink (fail-closed on failure).
--   • markNotificationActioned            — UPDATE notifications SET read_state='actioned', actioned_at=now();
--                                            a 0-row UPDATE (missing/RLS-hidden id) is caught as "not found" (#3).
--   • listNotifications / listActivity     — read shapes (type::text, answer_mode::text) round-trip.
--
-- CONNECTS AS: postgres (rolbypassrls=t) via SILO_DB_URL — the silo plane. RLS is BYPASSED on this path; this
--   proves the WRITE/READ SHAPE, not RLS enforcement. NOTE: push_subscriptions currently has RLS ENABLED +
--   REVOKE ALL from authenticated but NO owner-scoped POLICY yet (default-deny) — the owner-scoped policy is
--   owed to C7 (see the migrationDDL in the build report). Under the authenticated mobile session the adapter's
--   insert needs that policy; this smoke (postgres) does not, so it validates the DDL shape today and the
--   policy delta is tracked separately.
--
-- SAFETY: everything runs inside ONE txn and ROLLBACKs — nothing persists (incl. the throwaway auth user).
-- RUN:  source ~/.ai-harness-secrets.env
--       /opt/homebrew/opt/libpq/bin/psql "$SILO_DB_URL" -v ON_ERROR_STOP=1 -f app/mobile-surface/results/live-smoke.sql
-- Expected tail: "MOBILE-SURFACE LIVE SMOKE: ALL ASSERTIONS PASSED" then ROLLBACK.
-- ============================================================================

\set ON_ERROR_STOP on
begin;

do $$
declare
  v_uid      uuid := gen_random_uuid();
  v_endpoint text := 'https://push.example/smoke-0079';
  v_sub1     uuid;
  v_sub2     uuid;
  v_count    int;
  v_platform text;
  v_notif    uuid;
  v_rows     int;
  v_caught   boolean;
begin
  -- ── throwaway auth user + profile (FK target for push_subscriptions.user_id) ─────────────────
  insert into auth.users (id, aud, role, email, created_at, updated_at)
    values (v_uid, 'authenticated', 'authenticated', 'smoke-0079@example.test', now(), now());
  insert into profiles (id, email, name, active) values (v_uid, 'smoke-0079@example.test', 'Smoke 0079', true);

  -- ── push_subscriptions upsert: two registers from the SAME device → ONE row ──────────────────
  insert into push_subscriptions (user_id, endpoint, keys, platform, last_seen)
    values (v_uid, v_endpoint, '{"p256dh":"k","auth":"a"}'::jsonb, 'web', now())
    on conflict (user_id, endpoint)
    do update set keys = excluded.keys, platform = excluded.platform, last_seen = now()
    returning id into v_sub1;

  insert into push_subscriptions (user_id, endpoint, keys, platform, last_seen)
    values (v_uid, v_endpoint, '{"p256dh":"k2","auth":"a2"}'::jsonb, 'web-updated', now())
    on conflict (user_id, endpoint)
    do update set keys = excluded.keys, platform = excluded.platform, last_seen = now()
    returning id into v_sub2;

  if v_sub1 <> v_sub2 then raise exception 'FAIL: re-register created a 2nd row (unique(user_id,endpoint) not upserting)'; end if;

  select count(*), max(platform) into v_count, v_platform from push_subscriptions where user_id = v_uid;
  if v_count <> 1 then raise exception 'FAIL: expected exactly 1 push_subscription, found %', v_count; end if;
  if v_platform <> 'web-updated' then raise exception 'FAIL: upsert did not refresh platform (got %)', v_platform; end if;

  -- ── event_log append (the mobile command audit sink) ─────────────────────────────────────────
  insert into event_log (event_type, entity_ids, summary, payload)
    values ('tool_called', '{}'::uuid[], 'mobile command /smoke dispatched (typed_slash)',
            '{"slug":"smoke","invocation":"typed_slash"}'::jsonb);

  -- ── notifications: create one, mark it actioned, and prove a missing-id UPDATE affects 0 rows ─
  insert into notifications (type, severity, title, body, recipient, read_state)
    values ('hard_limit_hit', 'critical', 'Hard limit hit', 'smoke', v_uid, 'unread')
    returning id into v_notif;

  update notifications set read_state = 'actioned', actioned_at = now() where id = v_notif;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'FAIL: mark-actioned affected % rows (expected 1)', v_rows; end if;

  update notifications set read_state = 'actioned', actioned_at = now() where id = gen_random_uuid();
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'FAIL: mark-actioned on a missing id affected % rows (expected 0 → adapter raises not-found #3)', v_rows; end if;

  -- ── read shapes round-trip ───────────────────────────────────────────────────────────────────
  perform id, type::text, severity, title, read_state, actioned_at from notifications where recipient = v_uid;
  perform id, summary, event_type::text, answer_mode::text, created_at from event_log where event_type = 'tool_called' limit 1;

  raise notice 'MOBILE-SURFACE LIVE SMOKE: ALL ASSERTIONS PASSED';
end $$;

rollback;
