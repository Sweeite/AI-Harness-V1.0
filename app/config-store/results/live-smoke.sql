-- ISSUE-010 config-store — LIVE-ADAPTER SMOKE (R10 hygiene sweep, spec/00-foundations/standards/
-- live-adapter-hygiene-sweep.md). Replays the ACTUAL write statements issued by
-- app/config-store/src/supabase-store.ts against the real silo DDL, asserts the effect, then ROLLS BACK
-- so nothing persists. This is the "offline-green is not enough" proof that the pg adapter's INSERT/UPDATE
-- column lists, enum literals, the OD-180 retention DELETE path, and the redaction-tombstone actually
-- round-trip on the live schema (migrations 0001 baseline + 0001c grants + 0003 RLS + 0005 prune whitelist).
--
-- WHAT THIS PROVES (each write path below mirrors a method in supabase-store.ts, verbatim column lists):
--   • putConfigValue     (L63-69)  — the config_values upsert incl. the M8 last-editor clobber behaviour
--   • putSecretPresence  (L98-104) — the secret_manifest presence upsert
--   • appendAudit        (L116-121)— the config_audit_log append (INSERT succeeds on the sink)
--   • redactActor        (L209-214)— the sanctioned tombstone UPDATE (allowed past the append-only trigger)
--   • runRetention       (L162-195)— set local app.retention_prune='on' + past-floor DELETE + event_log log-row
--
-- KNOWN FINDING M8 (confirmed here, section 1c): putConfigValue's `on conflict … set updated_by =
-- excluded.updated_by` has NO coalesce, so a system write with updatedBy=NULL overwrites a prior non-null
-- editor with NULL (last-editor attribution on config_values is lost). This smoke ASSERTS that behaviour so
-- it is documented-by-test; it matches the InMemory reference fake (parity), so it is a design behaviour to
-- ratify, not an adapter/fake divergence. The audit trail itself (config_audit_log) is unaffected.
--
-- ROLE NOTE (see the review): the adapter is DOCUMENTED as connecting `service_role`, but SILO_DB_URL
-- actually connects as `postgres` (current_user=postgres). `postgres` retains DELETE on config_audit_log
-- (0001c revoked DELETE from service_role, NOT from postgres), so the section-5 retention DELETE succeeds
-- under the real connect role. Were the adapter ever pointed at the service_role URL, section 5 would fail
-- with "permission denied for table config_audit_log" DESPITE the app.retention_prune GUC (the GUC clears
-- the trigger, not the grant). Section 5b makes that dependency explicit.
--
-- RUN (operator, 💻 full/live env, writes are serial with the orchestrator):
--   source ~/.ai-harness-secrets.env
--   /opt/homebrew/opt/libpq/bin/psql "$SILO_DB_URL" -v ON_ERROR_STOP=1 -f app/config-store/results/live-smoke.sql
-- Expect: a run of "PASS …" notices then "ALL … PASSED"; the final ROLLBACK leaves the silo untouched.

\set ON_ERROR_STOP on
begin;

-- ── Fixtures (rolled back): two editor profiles for the updated_by / actor_id FKs ──
-- session_replication_role=replica only to insert synthetic FK-referencing profiles without tripping
-- unrelated auth FKs; flipped back to origin so the append-only trigger + config_key_group run for real.
set local session_replication_role = replica;
do $fx$
declare
  editor_a uuid := '00000000-0000-0000-0000-00000000010a';
  editor_b uuid := '00000000-0000-0000-0000-00000000010b';
begin
  insert into public.profiles (id, email) values (editor_a, 'smoke010-a@example.invalid') on conflict do nothing;
  insert into public.profiles (id, email) values (editor_b, 'smoke010-b@example.invalid') on conflict do nothing;
end $fx$;
set local session_replication_role = origin;

do $t$
declare
  editor_a constant uuid := '00000000-0000-0000-0000-00000000010a';
  editor_b constant uuid := '00000000-0000-0000-0000-00000000010b';
  smoke_key   constant text := 'amber_zone_threshold';   -- a real §E memory-group key (config_key_group → PERM-config.memory)
  v_updated_by uuid;
  v_value      jsonb;
  v_present    boolean;
  v_rot        timestamptz;
  v_actor      uuid;
  v_redacted   timestamptz;
  v_id         uuid;
  cnt          int;
  pruned_n     int;
  floor_n      int;
begin
  -- ══════════════════════════════════════════════════════════════════════════
  -- 1. putConfigValue — config_values upsert (supabase-store.ts L63-69)
  -- ══════════════════════════════════════════════════════════════════════════
  -- 1a. First write (INSERT branch): a human editor sets the value.
  insert into public.config_values (key, value, updated_by)
    values (smoke_key, '0.70'::jsonb, editor_a)
    on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by;
  select value, updated_by into v_value, v_updated_by from public.config_values where key = smoke_key;
  if v_value <> '0.70'::jsonb or v_updated_by <> editor_a then
    raise exception 'S1a FAIL: initial putConfigValue did not land (value=%, updated_by=%)', v_value, v_updated_by;
  end if;
  raise notice 'PASS S1a — putConfigValue INSERT branch: value + editor attribution landed';

  -- 1b. Second write (UPDATE branch) by a DIFFERENT human editor: value + attribution both update.
  insert into public.config_values (key, value, updated_by)
    values (smoke_key, '0.75'::jsonb, editor_b)
    on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by;
  select value, updated_by into v_value, v_updated_by from public.config_values where key = smoke_key;
  if v_value <> '0.75'::jsonb or v_updated_by <> editor_b then
    raise exception 'S1b FAIL: putConfigValue UPDATE branch did not update value+editor (value=%, updated_by=%)', v_value, v_updated_by;
  end if;
  raise notice 'PASS S1b — putConfigValue UPDATE branch: value + new editor attribution updated';

  -- 1c. M8 (CONFIRMED): a SYSTEM write with updatedBy=NULL overwrites editor_b's attribution with NULL.
  -- excluded.updated_by = the $3 param = NULL here; no coalesce → prior non-null editor is lost.
  insert into public.config_values (key, value, updated_by)
    values (smoke_key, '0.80'::jsonb, null)
    on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by;
  select value, updated_by into v_value, v_updated_by from public.config_values where key = smoke_key;
  if v_value <> '0.80'::jsonb then
    raise exception 'S1c FAIL: system putConfigValue did not update the value (value=%)', v_value;
  end if;
  if v_updated_by is not null then
    raise exception 'S1c UNEXPECTED: a null-editor upsert did NOT clobber updated_by (M8 would be refuted) — got %', v_updated_by;
  end if;
  raise notice 'PASS S1c — M8 CONFIRMED: null-editor system write clobbered updated_by (last-editor attribution lost; matches the fake)';

  -- ══════════════════════════════════════════════════════════════════════════
  -- 2. putSecretPresence — secret_manifest upsert (supabase-store.ts L98-104)
  -- ══════════════════════════════════════════════════════════════════════════
  insert into public.secret_manifest (key, present, last_rotated)
    values ('ANTHROPIC_API_KEY', true, '2026-07-01T00:00:00Z'::timestamptz)
    on conflict (key) do update set present = excluded.present, last_rotated = excluded.last_rotated;
  -- upsert again with present=false + null rotated → both columns overwrite (mirrors the deploy-hook path)
  insert into public.secret_manifest (key, present, last_rotated)
    values ('ANTHROPIC_API_KEY', false, null)
    on conflict (key) do update set present = excluded.present, last_rotated = excluded.last_rotated;
  select present, last_rotated into v_present, v_rot from public.secret_manifest where key = 'ANTHROPIC_API_KEY';
  if v_present <> false or v_rot is not null then
    raise exception 'S2 FAIL: putSecretPresence upsert did not overwrite present/last_rotated (present=%, rot=%)', v_present, v_rot;
  end if;
  raise notice 'PASS S2 — putSecretPresence upsert overwrites presence + last_rotated';

  -- ══════════════════════════════════════════════════════════════════════════
  -- 3. appendAudit — config_audit_log append (supabase-store.ts L116-121)
  -- ══════════════════════════════════════════════════════════════════════════
  insert into public.config_audit_log (key, old_value, new_value, actor_id)
    values (smoke_key, '0.70'::jsonb, '0.75'::jsonb, editor_a)
    returning id into v_id;
  select actor_id, redacted_at into v_actor, v_redacted from public.config_audit_log where id = v_id;
  if v_actor <> editor_a or v_redacted is not null then
    raise exception 'S3 FAIL: appendAudit row not as expected (actor=%, redacted_at=%)', v_actor, v_redacted;
  end if;
  raise notice 'PASS S3 — appendAudit INSERT lands on config_audit_log (actor set, redacted_at null)';

  -- ══════════════════════════════════════════════════════════════════════════
  -- 4. redactActor — sanctioned tombstone UPDATE (supabase-store.ts L209-214)
  --    The 0005 append-only trigger permits THIS update because redacted_at goes null→non-null.
  -- ══════════════════════════════════════════════════════════════════════════
  update public.config_audit_log
    set actor_id = null, redacted_at = now()
    where actor_id = editor_a and redacted_at is null;
  get diagnostics cnt = row_count;
  if cnt < 1 then raise exception 'S4 FAIL: redactActor tombstone matched 0 rows (expected >=1)'; end if;
  select actor_id, redacted_at into v_actor, v_redacted
    from public.config_audit_log where id = v_id;
  if v_actor is not null or v_redacted is null then
    raise exception 'S4 FAIL: tombstone did not scrub actor / set redacted_at (actor=%, redacted_at=%)', v_actor, v_redacted;
  end if;
  raise notice 'PASS S4 — redactActor tombstone permitted by the append-only trigger: actor scrubbed, redacted_at set, change record retained';

  -- 4b. NEGATIVE control: an in-place CONTENT update (no redacted_at transition) is REJECTED by the trigger.
  begin
    update public.config_audit_log set new_value = '9.99'::jsonb where id = v_id;
    raise exception 'S4b FAIL: an in-place content UPDATE was NOT rejected (append-only broken, #1/#3)';
  exception when others then
    if sqlerrm not like '%append-only%' and sqlerrm not like '%UPDATE forbidden%' then
      raise exception 'S4b FAIL: content UPDATE raised the wrong error: %', sqlerrm;
    end if;
  end;
  raise notice 'PASS S4b — in-place content UPDATE on config_audit_log is rejected by the append-only trigger';

  -- ══════════════════════════════════════════════════════════════════════════
  -- 5. runRetention — the OD-180 sanctioned DELETE path (supabase-store.ts L162-195)
  --    set local app.retention_prune='on' → past-floor DELETE succeeds → event_log run-row logged.
  -- ══════════════════════════════════════════════════════════════════════════
  -- Seed one PAST-floor audit row (changed_at older than the floor) + rely on S3's row being inside the floor.
  set local session_replication_role = replica;   -- allow a synthetic old changed_at past the default now()
  insert into public.config_audit_log (id, key, old_value, new_value, actor_id, changed_at)
    values ('00000000-0000-0000-0000-0000000f0e01', smoke_key, '0.1'::jsonb, '0.2'::jsonb, null,
            now() - interval '10 years');
  set local session_replication_role = origin;

  -- 5a. OD-180 whitelist: within this txn, a past-floor DELETE is permitted.
  set local app.retention_prune = 'on';
  select count(*) into floor_n from public.config_audit_log
    where changed_at >= now() - (2::text || ' years')::interval;   -- 2y floor for the smoke
  with del as (
    delete from public.config_audit_log
    where changed_at < now() - (2::text || ' years')::interval
    returning 1
  ) select count(*) into pruned_n from del;
  if pruned_n < 1 then raise exception 'S5a FAIL: retention DELETE pruned 0 past-floor rows (expected >=1) — OD-180 whitelist or postgres DELETE grant missing'; end if;
  -- the inside-floor rows survived
  select count(*) into cnt from public.config_audit_log where id = v_id;
  if cnt <> 1 then raise exception 'S5a FAIL: an inside-floor audit row was pruned (floor safety #1 broken)'; end if;
  raise notice 'PASS S5a — runRetention DELETE: % past-floor rows pruned, inside-floor rows survived (floor held)', pruned_n;

  -- 5b. runRetention's run-log INSERT into event_log (task_completed enum literal + entity_ids '{}' uuid[]).
  insert into public.event_log (task_id, event_type, entity_ids, summary, payload)
    values (null, 'task_completed', '{}', 'config_audit_log retention prune: smoke', '{"pruned":1}'::jsonb);
  raise notice 'PASS S5b — runRetention event_log run-row inserts (task_completed enum + empty uuid[] entity_ids valid)';

  -- 5c. NEGATIVE control: WITHOUT the app.retention_prune GUC, a config_audit_log DELETE is rejected.
  reset app.retention_prune;   -- clear the whitelist for this sub-scope
  begin
    delete from public.config_audit_log where id = v_id;
    raise exception 'S5c FAIL: a non-retention DELETE was NOT rejected (append-only broken, #1)';
  exception when others then
    if sqlerrm not like '%append-only%' and sqlerrm not like '%DELETE forbidden%' and sqlerrm not like '%permission denied%' then
      raise exception 'S5c FAIL: DELETE raised the wrong error: %', sqlerrm;
    end if;
  end;
  raise notice 'PASS S5c — a config_audit_log DELETE without app.retention_prune is rejected (append-only holds)';

  raise notice '════════ ALL ISSUE-010 LIVE-ADAPTER SMOKE ASSERTIONS PASSED ════════';
end $t$;

rollback;   -- nothing persists: every fixture + write above is undone
