-- ISSUE-085 backup-dr LIVE-SMOKE — replays the SupabaseBackupDrStore (backup-dr-live.ts) write-path
-- statements against the REAL management-plane DDL (app/management/migrations/0001_client_registry.sql
-- + 0003_backup_dr.sql), so drift between the fake-passes-offline adapter and the live schema (a wrong
-- column / an enum value not in the DDL / a NOT-NULL omission / a broken guarded WHERE) is caught LIVE.
--
--   db  = MGMT   → the orchestrator runs this against $MGMT_DB_URL (NOT $SILO_DB_URL).
--   Run: psql "$MGMT_DB_URL" -f app/backup-dr/results/live-smoke.sql
--   Expect: a stream of 'PASS ...' notices ending in 'ALL ASSERTIONS PASS', then ROLLBACK (non-mutating).
--
-- Every insert/update below mirrors the ACTUAL statement the adapter runs (same table, columns, enum
-- values, on-conflict clause, guarded WHERE). Prereq parent rows (client_registry → silo_backup_posture)
-- are inserted first WITHIN the txn so no FK-missing throw masquerades as drift. The whole script is
-- wrapped begin;…rollback; so it is safe to run against the live mgmt Supabase.
\set ON_ERROR_STOP on
begin;

do $$
declare
  v_slug   text := '__smoke_bdr__';
  v_slug2  text := '__smoke_bdr2__';
  v_rc     int;
  v_tier   recovery_tier;
  v_status text;
begin
  -- ── FIXTURE: the FK parents. silo_backup_posture.client_slug -> client_registry(client_slug);
  --    all the log tables -> silo_backup_posture(client_slug). Insert the client_registry row first
  --    (NOT-NULL no-default: client_slug, client_name, internal_token). ────────────────────────────────
  insert into client_registry (client_slug, client_name, internal_token)
    values (v_slug, 'BDR Smoke Client', 'enc:smoke-token');
  insert into client_registry (client_slug, client_name, internal_token)
    values (v_slug2, 'BDR Smoke Client 2', 'enc:smoke-token-2');

  -- ══ registerSilo() — insert into silo_backup_posture (recovery_tier enum CHECK; DB-clock now()) ══════
  --    Adapter: values ($1,$2,$3,$4, now(), now()) with tier default 'hourly_off_platform', destination
  --    as JSON text (jsonb col), project_status default 'active'. Replays the exact column list.
  insert into silo_backup_posture (client_slug, recovery_tier, destination, project_status, created_at, updated_at)
    values (v_slug, 'hourly_off_platform',
            '{"owner":"client","region":"ap-southeast-1","primary_region":"ap-southeast-2","lifecycle_independent":true}'::jsonb,
            'active', now(), now());
  raise notice 'PASS registerSilo: silo_backup_posture insert (hourly_off_platform, jsonb destination) ACCEPTED';

  insert into silo_backup_posture (client_slug, recovery_tier, project_status, created_at, updated_at)
    values (v_slug2, 'hourly_off_platform', 'active', now(), now());
  raise notice 'PASS registerSilo: second posture (null destination) ACCEPTED';

  -- GUARDED REJECT: recovery_tier is a closed enum — a value not in the DDL enum must RAISE (the app
  -- refuses 'bad_recovery_tier' offline; live it must be a hard type error, not a silent accept).
  begin
    insert into silo_backup_posture (client_slug, recovery_tier, created_at, updated_at)
      values (v_slug2, 'weekly_offsite', now(), now());
    raise exception 'FAIL registerSilo-enum: an out-of-enum recovery_tier was ACCEPTED';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS registerSilo-enum: out-of-enum recovery_tier REJECTED -> %', sqlerrm;
  end;

  -- GUARDED REJECT: silo_backup_posture PK is client_slug — a duplicate register must RAISE (the fake
  -- throws ERR_DUPLICATE_SILO; live the PK enforces it). This is the register-idempotency boundary.
  begin
    insert into silo_backup_posture (client_slug, recovery_tier, created_at, updated_at)
      values (v_slug, 'hourly_off_platform', now(), now());
    raise exception 'FAIL registerSilo-dup: a duplicate silo_backup_posture PK was ACCEPTED';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS registerSilo-dup: duplicate client_slug PK REJECTED -> %', sqlerrm;
  end;

  -- ══ setRecoveryTier() below-hourly — insert backup_downgrade_log THEN update posture ════════════════
  --    Adapter runs these as two statements; replay both. from_tier/to_tier are the recovery_tier enum.
  insert into backup_downgrade_log (client_slug, from_tier, to_tier, reason, logged_by, at)
    values (v_slug, 'hourly_off_platform', 'daily_in_project', 'cost cap — logged exception', 'super-admin@op', now());
  raise notice 'PASS setRecoveryTier: backup_downgrade_log insert (hourly->daily, logged reason+actor) ACCEPTED';

  update silo_backup_posture set recovery_tier = 'daily_in_project', updated_at = now() where client_slug = v_slug;
  get diagnostics v_rc = row_count;
  if v_rc <> 1 then raise exception 'FAIL setRecoveryTier: posture UPDATE hit % rows, expected exactly 1', v_rc; end if;
  select recovery_tier into v_tier from silo_backup_posture where client_slug = v_slug;
  if v_tier <> 'daily_in_project' then raise exception 'FAIL setRecoveryTier: tier is % after downgrade, expected daily_in_project', v_tier; end if;
  raise notice 'PASS setRecoveryTier: posture UPDATE hit exactly 1 row, tier now daily_in_project';

  -- GUARDED REJECT: from_tier/to_tier are also the closed enum — a bad tier in the audit row must RAISE.
  begin
    insert into backup_downgrade_log (client_slug, from_tier, to_tier, reason, logged_by, at)
      values (v_slug, 'hourly_off_platform', 'nope', 'x', 'y', now());
    raise exception 'FAIL downgrade-enum: an out-of-enum to_tier was ACCEPTED in backup_downgrade_log';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS downgrade-enum: out-of-enum downgrade to_tier REJECTED -> %', sqlerrm;
  end;

  -- ══ setDestination() / setProjectStatus() — guarded UPDATE ... where client_slug=$1 ═════════════════
  update silo_backup_posture
    set destination = '{"owner":"client","region":"us-east-1","primary_region":"ap-southeast-2","lifecycle_independent":true}'::jsonb,
        updated_at = now()
    where client_slug = v_slug;
  get diagnostics v_rc = row_count;
  if v_rc <> 1 then raise exception 'FAIL setDestination: UPDATE hit % rows, expected 1', v_rc; end if;
  raise notice 'PASS setDestination: destination UPDATE hit exactly 1 row';

  update silo_backup_posture set project_status = 'billing_at_risk', updated_at = now() where client_slug = v_slug;
  get diagnostics v_rc = row_count;
  if v_rc <> 1 then raise exception 'FAIL setProjectStatus: UPDATE hit % rows, expected 1', v_rc; end if;
  raise notice 'PASS setProjectStatus: project_status UPDATE (billing_at_risk enum) hit exactly 1 row';

  -- GUARDED REJECT: project_status is the dr_project_status enum — a bad value must RAISE.
  begin
    update silo_backup_posture set project_status = 'deleted', updated_at = now() where client_slug = v_slug;
    raise exception 'FAIL status-enum: an out-of-enum project_status was ACCEPTED';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS status-enum: out-of-enum project_status REJECTED -> %', sqlerrm;
  end;

  -- setProjectStatus on a missing silo: adapter checks rows[0] and throws ERR_NO_SUCH_SILO. Live the
  -- UPDATE simply hits 0 rows (no throw) — assert that (the app-side no-such-silo guard, not a DB error).
  update silo_backup_posture set project_status = 'active', updated_at = now() where client_slug = '__nonexistent__';
  get diagnostics v_rc = row_count;
  if v_rc <> 0 then raise exception 'FAIL no-such-silo: UPDATE on a missing slug hit % rows, expected 0', v_rc; end if;
  raise notice 'PASS no-such-silo: UPDATE on a missing slug hit 0 rows (app throws ERR_NO_SUCH_SILO on empty return)';

  -- ══ recordSnapshot() — insert off_platform_snapshot_log (destination jsonb NOT NULL; size_bytes bigint null) ══
  insert into off_platform_snapshot_log (snapshot_id, client_slug, taken_at, destination, encrypted, size_bytes)
    values ('snap-0001', v_slug, now(),
            '{"owner":"client","region":"us-east-1","primary_region":"ap-southeast-2","lifecycle_independent":true}'::jsonb,
            true, 1048576);
  raise notice 'PASS recordSnapshot: off_platform_snapshot_log insert (encrypted, jsonb dest) ACCEPTED';
  -- null size_bytes path (adapter passes snapshot.size_bytes ?? null)
  insert into off_platform_snapshot_log (snapshot_id, client_slug, taken_at, destination, encrypted, size_bytes)
    values ('snap-0002', v_slug, now(),
            '{"owner":"client","region":"us-east-1","primary_region":"ap-southeast-2","lifecycle_independent":true}'::jsonb,
            true, null);
  raise notice 'PASS recordSnapshot: null size_bytes ACCEPTED (nullable bigint)';

  -- lastSnapshot() select — order by taken_at desc limit 1 (mirror the read the adapter runs)
  perform 1 from off_platform_snapshot_log where client_slug = v_slug order by taken_at desc limit 1;
  raise notice 'PASS lastSnapshot: order-by-taken_at-desc-limit-1 select runs against real columns';

  -- GUARDED REJECT: FK to silo_backup_posture — a snapshot for an unregistered slug must RAISE (an orphan
  -- backup log is a #1 knowledge-provenance hole; the fake's require() throws, the DDL FK enforces it).
  begin
    insert into off_platform_snapshot_log (snapshot_id, client_slug, taken_at, destination, encrypted, size_bytes)
      values ('snap-orphan', '__no_posture__', now(), '{}'::jsonb, true, null);
    raise exception 'FAIL snapshot-fk: a snapshot for a slug with NO posture was ACCEPTED (orphan backup log)';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS snapshot-fk: snapshot for an unregistered slug REJECTED -> %', sqlerrm;
  end;

  -- ══ recordRehearsal() — insert restore_rehearsal_log (11 cols; measured_rto_seconds nullable numeric) ══
  insert into restore_rehearsal_log
    (rehearsal_id, client_slug, ran_at, result, restored_into, db_queryable,
     pgvector_memory_complete, auth_rows_complete, measured_rto_seconds, trigger, detail)
    values ('reh-0001', v_slug, now(), 'passed', 'throwaway-proj-xyz', true,
            true, true, 19.4, 'monthly', 'green rehearsal — 5000/5000 memories, 25/25 auth rows');
  raise notice 'PASS recordRehearsal: restore_rehearsal_log insert (passed/monthly, measured RTO) ACCEPTED';
  -- failed path: measured_rto_seconds null (adapter passes record.measured_rto_seconds which is null on fail)
  insert into restore_rehearsal_log
    (rehearsal_id, client_slug, ran_at, result, restored_into, db_queryable,
     pgvector_memory_complete, auth_rows_complete, measured_rto_seconds, trigger, detail)
    values ('reh-0002', v_slug, now(), 'failed', 'throwaway-proj-abc', false,
            false, false, null, 'migration-release', 'restore aborted — pgvector dim mismatch');
  raise notice 'PASS recordRehearsal: failed rehearsal with null measured_rto_seconds ACCEPTED';

  -- GUARDED REJECT: result enum (rehearsal_result) — a bad result value must RAISE.
  begin
    insert into restore_rehearsal_log
      (rehearsal_id, client_slug, ran_at, result, restored_into, db_queryable,
       pgvector_memory_complete, auth_rows_complete, measured_rto_seconds, trigger, detail)
      values ('reh-bad', v_slug, now(), 'maybe', 'x', true, true, true, null, 'monthly', 'x');
    raise exception 'FAIL rehearsal-enum: an out-of-enum rehearsal result was ACCEPTED';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS rehearsal-enum: out-of-enum rehearsal result REJECTED -> %', sqlerrm;
  end;

  -- GUARDED REJECT: trigger enum (rehearsal_trigger) — a bad trigger value must RAISE.
  begin
    insert into restore_rehearsal_log
      (rehearsal_id, client_slug, ran_at, result, restored_into, db_queryable,
       pgvector_memory_complete, auth_rows_complete, measured_rto_seconds, trigger, detail)
      values ('reh-bad2', v_slug, now(), 'passed', 'x', true, true, true, null, 'weekly', 'x');
    raise exception 'FAIL rehearsal-trigger-enum: an out-of-enum rehearsal trigger was ACCEPTED';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS rehearsal-trigger-enum: out-of-enum rehearsal trigger REJECTED -> %', sqlerrm;
  end;

  -- ══ receivePurgeFlag() — insert off_platform_purge_flag ... on conflict (flag_id) do nothing ═════════
  --    Adapter: values ($1,$2,$3,$4,$5,'open',$4) — received_at is set to raised_at ($4). Replay verbatim,
  --    then re-run to prove the ON CONFLICT DO NOTHING idempotent receive (rowCount 0 => new=false).
  insert into off_platform_purge_flag
    (flag_id, client_slug, target_ref, raised_at, erasure_effective_at, status, received_at)
    values ('purge-0001', v_slug, 'user:42', now(), now(), 'open', now())
    on conflict (flag_id) do nothing;
  get diagnostics v_rc = row_count;
  if v_rc <> 1 then raise exception 'FAIL receivePurgeFlag: first receive inserted % rows, expected 1 (new=true)', v_rc; end if;
  raise notice 'PASS receivePurgeFlag: first receive ACCEPTED (rowCount=1 => new=true)';

  insert into off_platform_purge_flag
    (flag_id, client_slug, target_ref, raised_at, erasure_effective_at, status, received_at)
    values ('purge-0001', v_slug, 'user:42', now(), now(), 'open', now())
    on conflict (flag_id) do nothing;
  get diagnostics v_rc = row_count;
  if v_rc <> 0 then raise exception 'FAIL receivePurgeFlag: idempotent re-receive inserted % rows, expected 0 (new=false)', v_rc; end if;
  raise notice 'PASS receivePurgeFlag: idempotent re-receive DID NOT double-insert (rowCount=0 => new=false)';

  -- GUARDED REJECT: status CHECK (status in ('open','cleared')) — a bad status must RAISE.
  begin
    insert into off_platform_purge_flag
      (flag_id, client_slug, target_ref, raised_at, erasure_effective_at, status, received_at)
      values ('purge-badstatus', v_slug, 'user:99', now(), now(), 'pending', now());
    raise exception 'FAIL purge-status-check: an out-of-check purge status was ACCEPTED';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS purge-status-check: out-of-check purge status REJECTED -> %', sqlerrm;
  end;

  -- ══ markPurgeCleared() — update off_platform_purge_flag set status='cleared', cleared_at, confirmed_by ══
  update off_platform_purge_flag
    set status = 'cleared', cleared_at = now(), confirmed_by = 'off-platform-purge-leg'
    where flag_id = 'purge-0001';
  get diagnostics v_rc = row_count;
  if v_rc <> 1 then raise exception 'FAIL markPurgeCleared: UPDATE hit % rows, expected exactly 1', v_rc; end if;
  select status into v_status from off_platform_purge_flag where flag_id = 'purge-0001';
  if v_status <> 'cleared' then raise exception 'FAIL markPurgeCleared: status is % after clear, expected cleared', v_status; end if;
  raise notice 'PASS markPurgeCleared: guarded UPDATE hit exactly 1 row, status now cleared';

  -- markPurgeCleared on a missing flag: adapter checks rows[0] and throws ERR_NO_SUCH_SILO; live it hits 0.
  update off_platform_purge_flag
    set status = 'cleared', cleared_at = now(), confirmed_by = 'x'
    where flag_id = '__no_such_flag__';
  get diagnostics v_rc = row_count;
  if v_rc <> 0 then raise exception 'FAIL markPurgeCleared-missing: UPDATE on a missing flag_id hit % rows, expected 0', v_rc; end if;
  raise notice 'PASS markPurgeCleared-missing: UPDATE on a missing flag_id hit 0 rows (app throws on empty return)';

  -- listOpenPurgeFlags() select — where client_slug=$1 and status='open' (mirror the read)
  perform 1 from off_platform_purge_flag where client_slug = v_slug and status = 'open';
  raise notice 'PASS listOpenPurgeFlags: where client_slug/status=open select runs against real columns';

  raise notice 'ALL ASSERTIONS PASS';
end $$;

rollback;
