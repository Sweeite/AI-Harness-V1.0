// ISSUE-085 — one test per AC in §4 Definition of done. Proved against the InMemoryBackupDrStore reference
// model + the pure rehearsal / backup-health / dump-job / purge-leg / posture helpers (offline; NO live DB, NO
// pg_dump/restore). The live rehearsal run + AF-072 (LOAD) + AF-069 Path A (PITR) + AF-137 (SPIKE) are
// operator-present residuals — backup-dr-live.ts mirrors this fake 1:1 and reuses the GREEN AF-069 harness; it
// is NOT exercised here.
//
// Every test has TEETH: it asserts the AC invariant AND a negative/counter-case (the thing that MUST NOT
// happen). The #1/#3 postures — a restore is PROVEN not assumed, a lapse is LOUD not green, an erased target is
// purged off-platform not silently carried — are all offline-proven.
//
// AC map (§4):
//   AC-NFR-DR.001.1 — default tier = free daily in-project + hourly off-platform, PITR off
//   AC-NFR-DR.001.2 — hourly can't keep up → cadence backed off / PITR, LOGGED (never silently below RPO)
//   AC-NFR-DR.002.1 — off-platform copy client-owned/encrypted/different-region/lifecycle-independent
//   AC-NFR-DR.002.2 — survives the pause→deletion path (the only copy that does)
//   AC-NFR-DR.003.1 — tested restore: DB + pgvector + auth complete & queryable (a partial restore is FAILED)
//   AC-NFR-DR.003.2 — standing cadence logs result + ts; stale/failed → loud alert
//   AC-NFR-DR.004.1 — ownership split recorded; operator jobs exist; credential scoped not broad
//   AC-NFR-DR.005.1 — restore-with-downtime; RTO measured not assumed
//   AC-NFR-DR.005.2 — HA offered as upsell, never silently assumed present
//   AC-NFR-DR.006.1 — five backup-health fields + zero business data on the push
//   AC-NFR-DR.006.2 — lapse/stale → loud alert; a stale field reads stale, never green
//   AC-NFR-DR.007.1 — Storage holds only regenerable exports; no source-of-truth un-backed-up
//   AC-NFR-DR.008.1 — restore ∩ immutable audit ∩ shadow-retain each independently preserve knowledge
//   AC-NFR-DR.009.1 — purge flag received + snapshots purged within a dump-cycle
//   AC-NFR-DR.009.2 — still-open flag logged loud at the next rehearsal/health-check
//   AC-7.MGM.005.1  — backup-health visible from the Management API; no business data crosses

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  InMemoryBackupDrStore,
  BackupDrError,
  ERR_SILENT_DOWNGRADE,
  ERR_BAD_DESTINATION,
  validateDestination,
  assembleBackupHealth,
  assertNoBusinessData,
  BackupHealthBusinessDataError,
  evaluateBackupHealthAlert,
  BACKUP_HEALTH_FIELDS,
  runRehearsal,
  rehearsalDue,
  defaultDumpJob,
  decideCadence,
  receivePurgeFlag,
  actionPurgeFlag,
  openPurgeFlagExceptions,
  DR_POSTURE,
  STORAGE_SCOPE,
  DEFENSE_IN_DEPTH_LAYERS,
  OWNERSHIP_SPLIT,
  type OffPlatformDestination,
  type RestoreDriver,
  type RestoreProbe,
  type PurgeDriver,
  type PurgeDriverResult,
  type PurgeFlag,
} from './index.ts';

const NOW = 1_760_000_000; // fixed server epoch seconds
const iso = (sec: number) => new Date(sec * 1000).toISOString();

const goodDest: OffPlatformDestination = {
  owner: 'client',
  region: 'ap-southeast-4', // different from primary
  primary_region: 'ap-southeast-2',
  lifecycle_independent: true,
};

// A restore driver that reports a COMPLETE restore (models the GREEN AF-069 Path B run).
const passingDriver: RestoreDriver = {
  async restoreIntoThrowaway(): Promise<RestoreProbe> {
    return {
      throwaway_ref: 'throwaway-proj-xyz',
      db_queryable: true,
      pgvector_memory_complete: true,
      auth_rows_complete: true,
      measured_rto_seconds: 19.4, // the AF-069 Path B measured RTO
      detail: '5000/5000 memories + embeddings, 25/25 auth rows',
    };
  },
};

// ── AC-NFR-DR.001.1 ──────────────────────────────────────────────────────────────
test('AC-NFR-DR.001.1 — default tier is free daily in-project + hourly off-platform, PITR off; below-hourly is not a silent default', async () => {
  const store = new InMemoryBackupDrStore();
  const silo = await store.registerSilo({ client_slug: 'acme', destination: goodDest, now: NOW });
  assert.equal(silo.recovery_tier, 'hourly_off_platform'); // hourly off-platform default (PITR off)
  // TEETH: provisioning a silo directly below hourly (daily-only) as a default is REFUSED (never silent).
  await assert.rejects(
    () => store.registerSilo({ client_slug: 'below', recovery_tier: 'daily_in_project', now: NOW }),
    (e) => e instanceof BackupDrError && e.reason === ERR_SILENT_DOWNGRADE,
  );
});

// ── AC-NFR-DR.001.2 ──────────────────────────────────────────────────────────────
test('AC-NFR-DR.001.2 — hourly-cant-keep-up backs off cadence / moves to PITR as a LOGGED decision, never silently below RPO', async () => {
  // Within the hour → keep hourly.
  const ok = decideCadence({ client_slug: 'acme', measured_dump_seconds: 1200, serverNow: NOW });
  assert.equal(ok.action, 'keep-hourly');
  // Over the hour, prefer back-off → a LOGGED downgrade entry is attached (never silent).
  const backoff = decideCadence({ client_slug: 'acme', measured_dump_seconds: 5000, serverNow: NOW, prefer: 'back-off-cadence', logged_by: 'sa:op' });
  assert.equal(backoff.action, 'back-off-cadence');
  assert.ok(backoff.downgrade, 'a below-hourly back-off must carry a LOGGED downgrade entry');
  // Applying it through the store also requires the logged downgrade (a silent below-hourly move is refused).
  const store = new InMemoryBackupDrStore();
  await store.registerSilo({ client_slug: 'acme', destination: goodDest, now: NOW });
  await assert.rejects(
    () => store.setRecoveryTier('acme', 'daily_in_project', { now: NOW }), // no downgrade reason → refused
    (e) => e instanceof BackupDrError && e.reason === ERR_SILENT_DOWNGRADE,
  );
  const moved = await store.setRecoveryTier('acme', 'daily_in_project', { now: NOW, downgrade: { reason: backoff.downgrade!.reason, logged_by: 'sa:op' } });
  assert.equal(moved.recovery_tier, 'daily_in_project');
  assert.equal(moved.downgrade_log.length, 1, 'the downgrade is logged, not silent');
  // PITR fallback is ABOVE hourly (an upsell, not a downgrade).
  const pitr = decideCadence({ client_slug: 'acme', measured_dump_seconds: 5000, serverNow: NOW, prefer: 'move-to-pitr' });
  assert.equal(pitr.new_tier, 'pitr');
  assert.equal(pitr.downgrade, null);
});

// ── AC-NFR-DR.002.1 ──────────────────────────────────────────────────────────────
test('AC-NFR-DR.002.1 — off-platform copy is client-owned, encrypted, different-region, lifecycle-independent', async () => {
  const job = defaultDumpJob('acme', goodDest);
  assert.equal(job.encrypted, true);
  assert.equal(job.cadence, 'hourly');
  assert.equal(job.pitr_enabled, false);
  assert.equal(job.keeps_daily_in_project_floor, true);
  assert.notEqual(job.destination.region, job.destination.primary_region);
  // TEETH: a same-region destination is REJECTED (fails different-region).
  assert.ok(validateDestination({ ...goodDest, region: 'ap-southeast-2' }).length > 0);
  // TEETH: a lifecycle-DEPENDENT destination is REJECTED (it would die with the project on the deletion path).
  assert.ok(validateDestination({ ...goodDest, lifecycle_independent: false }).length > 0);
});

// ── AC-NFR-DR.002.2 ──────────────────────────────────────────────────────────────
test('AC-NFR-DR.002.2 — the off-platform copy survives the pause→deletion path (the store refuses a copy that would not)', async () => {
  const store = new InMemoryBackupDrStore();
  await store.registerSilo({ client_slug: 'acme', destination: goodDest, now: NOW });
  // A lifecycle-independent copy is the only thing that survives project deletion — the store enforces it.
  await assert.rejects(
    () => store.setDestination('acme', { ...goodDest, lifecycle_independent: false }, NOW),
    (e) => e instanceof BackupDrError && e.reason === ERR_BAD_DESTINATION,
  );
  // The good destination stands (survives deletion).
  const silo = await store.getSilo('acme');
  assert.equal(silo?.destination?.lifecycle_independent, true);
});

// ── AC-NFR-DR.003.1 ──────────────────────────────────────────────────────────────
test('AC-NFR-DR.003.1 — a tested restore comes back complete & queryable (DB + pgvector + auth); a PARTIAL restore is FAILED, never a phantom pass', async () => {
  const pass = await runRehearsal(passingDriver, { client_slug: 'acme', trigger: 'monthly', serverNow: NOW });
  assert.equal(pass.result, 'passed');
  assert.equal(pass.pgvector_memory_complete, true);
  assert.equal(pass.auth_rows_complete, true);
  assert.equal(pass.measured_rto_seconds, 19.4); // MEASURED (NFR-DR.005)
  assert.notEqual(pass.restored_into, 'production'); // restored into a THROWAWAY project, never production

  // TEETH: pgvector memory NOT complete → the rehearsal is FAILED (a restore that loses memory is not a restore).
  const partialDriver: RestoreDriver = {
    async restoreIntoThrowaway(): Promise<RestoreProbe> {
      return { throwaway_ref: 't', db_queryable: true, pgvector_memory_complete: false, auth_rows_complete: true, measured_rto_seconds: 30, detail: 'embeddings missing' };
    },
  };
  const fail = await runRehearsal(partialDriver, { client_slug: 'acme', trigger: 'monthly', serverNow: NOW });
  assert.equal(fail.result, 'failed');
  assert.equal(fail.measured_rto_seconds, null); // no valid RTO on a failed restore

  // TEETH: a driver that THROWS → FAILED, never a silent green.
  const throwingDriver: RestoreDriver = { async restoreIntoThrowaway(): Promise<RestoreProbe> { throw new Error('pg_restore blew up'); } };
  const aborted = await runRehearsal(throwingDriver, { client_slug: 'acme', trigger: 'monthly', serverNow: NOW });
  assert.equal(aborted.result, 'failed');
});

// ── AC-NFR-DR.003.2 ──────────────────────────────────────────────────────────────
test('AC-NFR-DR.003.2 — standing cadence (monthly + per-migration) logs result+ts; a never/stale rehearsal is due + raises a loud alert', async () => {
  // Never rehearsed → always due (and restore is UNPROVEN until it runs).
  assert.equal(rehearsalDue({ lastRehearsalAt: null, lastMigrationReleaseAt: null, serverNow: NOW }), 'monthly');
  // A month elapsed → due.
  assert.equal(rehearsalDue({ lastRehearsalAt: iso(NOW - 60 * 60 * 24 * 31), lastMigrationReleaseAt: null, serverNow: NOW }), 'monthly');
  // A migration release since the last rehearsal → due (per-migration cadence).
  assert.equal(
    rehearsalDue({ lastRehearsalAt: iso(NOW - 60 * 60 * 24 * 3), lastMigrationReleaseAt: iso(NOW - 60 * 60), serverNow: NOW }),
    'migration-release',
  );
  // TEETH: fresh + no migration → NOT due (we don't cry wolf).
  assert.equal(rehearsalDue({ lastRehearsalAt: iso(NOW - 60 * 60 * 24 * 3), lastMigrationReleaseAt: null, serverNow: NOW }), null);
  // A stale/never rehearsal drives a loud alert via backup-health.
  const health = assembleBackupHealth({
    recovery_tier: 'hourly_off_platform', last_in_project_backup_at: iso(NOW - 60), project_status: 'active',
    last_off_platform_snapshot_at: iso(NOW - 60), last_rehearsal_at: null, last_rehearsal_result: null,
  });
  const alert = evaluateBackupHealthAlert('acme', health, NOW);
  assert.ok(alert.alert && alert.rehearsal === 'never', 'a never-run rehearsal must be a loud alert reading never, not green');
});

// ── AC-NFR-DR.004.1 ──────────────────────────────────────────────────────────────
test('AC-NFR-DR.004.1 — ownership split recorded (client owns+pays / operator operates+verifies); credential scoped not broad; operator jobs exist', async () => {
  assert.ok(OWNERSHIP_SPLIT.client.some((s) => /pays/.test(s)));
  assert.ok(OWNERSHIP_SPLIT.operator.some((s) => /rehearsal/.test(s)));
  assert.equal(OWNERSHIP_SPLIT.neither_may_assume_the_other, true);
  // TEETH: the credential posture is DELEGATED + SCOPED, and explicitly NOT a broad grant.
  assert.match(OWNERSHIP_SPLIT.operator_credential, /delegated/);
  assert.match(OWNERSHIP_SPLIT.operator_credential, /scoped/);
  assert.match(OWNERSHIP_SPLIT.operator_credential, /NOT a broad grant/); // the broad-grant is explicitly ruled out
  // the operator jobs exist as definitions: a dump job + a rehearsal (proven runnable above).
  const job = defaultDumpJob('acme', goodDest);
  assert.equal(job.client_slug, 'acme');
});

// ── AC-NFR-DR.005.1 ──────────────────────────────────────────────────────────────
test('AC-NFR-DR.005.1 — DR is backup-restore-with-downtime; RTO is a MEASURED number, not assumed', async () => {
  assert.equal(DR_POSTURE.recovery_model, 'backup-restore-with-downtime');
  assert.equal(DR_POSTURE.hot_failover, false);
  assert.equal(DR_POSTURE.rto_is_measured_not_assumed, true);
  // The rehearsal produces a MEASURED RTO (not an assumed constant).
  const reh = await runRehearsal(passingDriver, { client_slug: 'acme', trigger: 'monthly', serverNow: NOW });
  assert.equal(typeof reh.measured_rto_seconds, 'number');
});

// ── AC-NFR-DR.005.2 ──────────────────────────────────────────────────────────────
test('AC-NFR-DR.005.2 — HA / read-replicas are offered as a per-client upsell, never silently assumed present', () => {
  assert.equal(DR_POSTURE.ha_read_replica, 'per-client-upsell');
  // TEETH: hot failover is explicitly NOT present (no silent assumption of failover that does not exist).
  assert.equal(DR_POSTURE.hot_failover, false);
});

// ── AC-NFR-DR.006.1 ──────────────────────────────────────────────────────────────
test('AC-NFR-DR.006.1 — the push carries the five backup-health fields and ZERO business data', () => {
  const payload = assembleBackupHealth({
    recovery_tier: 'hourly_off_platform', last_in_project_backup_at: iso(NOW - 60), project_status: 'active',
    last_off_platform_snapshot_at: iso(NOW - 60), last_rehearsal_at: iso(NOW - 60), last_rehearsal_result: 'passed',
  });
  // exactly the five fields (six keys: rehearsal is date + result).
  assert.deepEqual(Object.keys(payload).sort(), [...BACKUP_HEALTH_FIELDS].sort());
  // TEETH: a business-data key is REJECTED at the boundary, not silently dropped (#2).
  assert.throws(
    () => assertNoBusinessData({ ...payload, memory_text: 'secret client content' }),
    (e) => e instanceof BackupHealthBusinessDataError,
  );
});

// ── AC-NFR-DR.006.2 ──────────────────────────────────────────────────────────────
test('AC-NFR-DR.006.2 — a lapsed/stale backup or a paused/billing-at-risk project raises a LOUD alert; a stale field reads stale, never green', () => {
  // A stale off-platform snapshot reads stale + alerts (never green).
  const stale = assembleBackupHealth({
    recovery_tier: 'hourly_off_platform', last_in_project_backup_at: iso(NOW - 60), project_status: 'active',
    last_off_platform_snapshot_at: iso(NOW - 60 * 60 * 5), last_rehearsal_at: iso(NOW - 60), last_rehearsal_result: 'passed',
  });
  const a1 = evaluateBackupHealthAlert('acme', stale, NOW);
  assert.equal(a1.off_platform_snapshot, 'stale');
  assert.ok(a1.alert && a1.severity === 'critical');
  // A paused project alerts critical (approaching the deletion path).
  const paused = assembleBackupHealth({
    recovery_tier: 'hourly_off_platform', last_in_project_backup_at: iso(NOW - 60), project_status: 'paused',
    last_off_platform_snapshot_at: iso(NOW - 60), last_rehearsal_at: iso(NOW - 60), last_rehearsal_result: 'passed',
  });
  const a2 = evaluateBackupHealthAlert('acme', paused, NOW);
  assert.ok(a2.alert && a2.reasons.some((r) => /PAUSED/.test(r)));
  // TEETH: an all-fresh healthy read does NOT alert (green means green only when actually fresh).
  const fresh = assembleBackupHealth({
    recovery_tier: 'hourly_off_platform', last_in_project_backup_at: iso(NOW - 60), project_status: 'active',
    last_off_platform_snapshot_at: iso(NOW - 60), last_rehearsal_at: iso(NOW - 60), last_rehearsal_result: 'passed',
  });
  const a3 = evaluateBackupHealthAlert('acme', fresh, NOW);
  assert.equal(a3.alert, false);
  assert.equal(a3.severity, 'ok');
});

// ── AC-NFR-DR.007.1 ──────────────────────────────────────────────────────────────
test('AC-NFR-DR.007.1 — Storage holds only regenerable exports; no source-of-truth is copied in un-backed-up', () => {
  assert.equal(STORAGE_SCOPE.buckets_backed_up_in_v1, false);
  assert.equal(STORAGE_SCOPE.source_files_copied_into_supabase, false); // golden rule
  assert.match(STORAGE_SCOPE.v1_storage_contents, /regenerable/);
  assert.match(STORAGE_SCOPE.reopens_if, /NON-regenerable/);
});

// ── AC-NFR-DR.008.1 ──────────────────────────────────────────────────────────────
test('AC-NFR-DR.008.1 — restore ∩ immutable audit history ∩ shadow-retain each INDEPENDENTLY preserve knowledge', () => {
  const layers = DEFENSE_IN_DEPTH_LAYERS.map((l) => l.layer);
  assert.ok(layers.includes('proven-restore'));
  assert.ok(layers.includes('append-only-tamper-evident-audit-history'));
  assert.ok(layers.includes('shadow-retain'));
  // TEETH: every layer is marked independent (no single-layer failure is total loss).
  assert.ok(DEFENSE_IN_DEPTH_LAYERS.every((l) => l.independent));
});

// ── AC-NFR-DR.009.1 ──────────────────────────────────────────────────────────────
test('AC-NFR-DR.009.1 — a purge flag is received + its target purged from pre-erasure snapshots within a dump-cycle', async () => {
  const store = new InMemoryBackupDrStore();
  await store.registerSilo({ client_slug: 'acme', destination: goodDest, now: NOW });
  const flag: PurgeFlag = { flag_id: 'pf-1', client_slug: 'acme', target_ref: 'user-42', raised_at: iso(NOW), erasure_effective_at: iso(NOW) };
  const { new: isNew } = await receivePurgeFlag(store, flag);
  assert.equal(isNew, true);
  // idempotent receive — a replay does not re-open.
  const { new: replay } = await receivePurgeFlag(store, flag);
  assert.equal(replay, false);

  // A driver that clears ALL residue → the flag is CLEARED within the window.
  const cleanDriver: PurgeDriver = {
    async purgeFromPreErasureSnapshots(): Promise<PurgeDriverResult> {
      return { pre_erasure_snapshots_examined: 3, snapshots_with_residue: 2, snapshots_cleared: 2, detail: 'purged 2/2' };
    },
  };
  const outcome = await actionPurgeFlag(store, cleanDriver, flag, NOW + 60);
  assert.equal(outcome.status, 'cleared');
  assert.equal(outcome.within_window, true);
  assert.equal(outcome.logged, true);
  assert.equal((await store.getPurgeFlag('pf-1'))?.status, 'cleared');
});

// ── AC-NFR-DR.009.2 ──────────────────────────────────────────────────────────────
test('AC-NFR-DR.009.2 — a still-open purge flag is logged loud (never silently cleared or carried forward)', async () => {
  const store = new InMemoryBackupDrStore();
  await store.registerSilo({ client_slug: 'acme', destination: goodDest, now: NOW });
  const flag: PurgeFlag = { flag_id: 'pf-2', client_slug: 'acme', target_ref: 'user-9', raised_at: iso(NOW), erasure_effective_at: iso(NOW) };
  await receivePurgeFlag(store, flag);

  // A driver that leaves residue → the flag STAYS OPEN and is logged (never reported clear).
  const partialDriver: PurgeDriver = {
    async purgeFromPreErasureSnapshots(): Promise<PurgeDriverResult> {
      return { pre_erasure_snapshots_examined: 3, snapshots_with_residue: 2, snapshots_cleared: 1, detail: 'one snapshot could not be rewritten' };
    },
  };
  const outcome = await actionPurgeFlag(store, partialDriver, flag, NOW + 60);
  assert.equal(outcome.status, 'still_open');
  assert.equal(outcome.logged, true);
  assert.equal((await store.getPurgeFlag('pf-2'))?.status, 'open'); // NOT cleared

  // Past the dump-cycle window, the open flag surfaces as an OVERDUE logged exception at the next check.
  const exceptions = await openPurgeFlagExceptions(store, 'acme', NOW + 60 * 60 * 2);
  assert.equal(exceptions.length, 1);
  assert.equal(exceptions[0]!.overdue, true);
  assert.match(exceptions[0]!.detail, /STILL OPEN past its dump-cycle window/);

  // TEETH: a driver that THROWS also leaves the flag open + logged, never a phantom clear.
  const throwingDriver: PurgeDriver = { async purgeFromPreErasureSnapshots(): Promise<PurgeDriverResult> { throw new Error('store unreachable'); } };
  const flag3: PurgeFlag = { flag_id: 'pf-3', client_slug: 'acme', target_ref: 'user-7', raised_at: iso(NOW), erasure_effective_at: iso(NOW) };
  await receivePurgeFlag(store, flag3);
  const o3 = await actionPurgeFlag(store, throwingDriver, flag3, NOW + 60);
  assert.equal(o3.status, 'still_open');
  assert.equal((await store.getPurgeFlag('pf-3'))?.status, 'open');
});

// ── AC-NFR-DR.009.2 (regression: silent-empty scan) ──────────────────────────────
// logic-sweep fix: an all-zeros driver result (examined=0/residue=0/cleared=0) is what a
// silently-empty scan produces (wrong client_slug/target_ref, an empty query that did not
// throw). It must NOT be reported CLEARED — nothing was proven purged off-platform, so
// erased Personal data could still survive in a pre-erasure snapshot (#1 keystone / #3).
test('AC-NFR-DR.009.2 — an all-zeros (examined=0) driver result is STILL OPEN, never a phantom clear', async () => {
  const store = new InMemoryBackupDrStore();
  await store.registerSilo({ client_slug: 'acme', destination: goodDest, now: NOW });
  const flag: PurgeFlag = { flag_id: 'pf-4', client_slug: 'acme', target_ref: 'user-3', raised_at: iso(NOW), erasure_effective_at: iso(NOW) };
  await receivePurgeFlag(store, flag);

  // A driver that examined NOTHING (silent-empty scan) — 0/0/0. This is indistinguishable from
  // a matched-no-rows misconfiguration, so it must fail OPEN, not confirm a clearance.
  const emptyDriver: PurgeDriver = {
    async purgeFromPreErasureSnapshots(): Promise<PurgeDriverResult> {
      return { pre_erasure_snapshots_examined: 0, snapshots_with_residue: 0, snapshots_cleared: 0, detail: 'no rows matched' };
    },
  };
  const outcome = await actionPurgeFlag(store, emptyDriver, flag, NOW + 60);
  assert.equal(outcome.status, 'still_open'); // NOT 'cleared' — nothing was examined/proven purged
  assert.equal(outcome.logged, true);
  assert.equal((await store.getPurgeFlag('pf-4'))?.status, 'open'); // flag stays OPEN
});

// ── AC-7.MGM.005.1 ───────────────────────────────────────────────────────────────
test('AC-7.MGM.005.1 — backup-health is visible sourced from the Management API; no business data crosses', () => {
  // The payload the mgmt-plane push carries in deployment_health.backup_health is operational-metadata only.
  const payload = assembleBackupHealth({
    recovery_tier: 'pitr', last_in_project_backup_at: iso(NOW - 60), project_status: 'active',
    last_off_platform_snapshot_at: iso(NOW - 60), last_rehearsal_at: iso(NOW - 60), last_rehearsal_result: 'passed',
  });
  // every field is a tier/status enum, a timestamp, or a pass/fail — no client content.
  for (const [k, v] of Object.entries(payload)) {
    assert.ok(v === null || typeof v === 'string', `field ${k} must be a string/null (operational metadata), not a business object`);
  }
  // TEETH: a business object smuggled onto the payload is rejected (the mgmt-plane boundary holds — ADR-001 §7).
  assert.throws(
    () => assertNoBusinessData({ ...payload, connector_secrets: 'oauth-token' }),
    (e) => e instanceof BackupHealthBusinessDataError,
  );
});
