// @harness/backup-dr — ISSUE-085 (Backup & DR, ADR-008 / NFR-DR.001-009). Public surface: the domain types +
// recovery_tier enum, the BackupDrStore port + in-memory fake reference model + the live pg/CLI adapter, the
// five-field backup-health payload + loud lapse/stale alert, the restore-rehearsal orchestration (built on the
// GREEN AF-069) + cadence-due math, the hourly off-platform dump-job definition + AF-072 cadence fallback, the
// off-platform purge-leg (NFR-DR.009 receive-leg), and the stated DR/ownership/Storage/defense-in-depth postures.
//
// The `check` CLI runs the offline build-time gates (no DB, no network, no pg_dump):
//   (1) recovery_tier enum parity — the module enum ≡ config-registry.md §M `recovery_tier` enum
//       (daily_in_project · hourly_off_platform · pitr); a below-hourly default is refused.
//   (2) backup-health boundary — the five-field payload carries ONLY operational metadata; a business-data key
//       is rejected, never dropped (#2), and a stale/never/failed field reads loud, never green (#3).
//   (3) posture stated — the DR/ownership/Storage/defense-in-depth postures are recorded (no silent assumption).

import { fileURLToPath } from 'node:url';

import {
  type RecoveryTier,
  type ProjectStatus,
  type RehearsalResult,
  type RehearsalRecord,
  type RehearsalTrigger,
  type OffPlatformSnapshot,
  type OffPlatformDestination,
  type PurgeFlag,
  RECOVERY_TIERS,
  AT_OR_ABOVE_HOURLY,
  DEFAULT_RECOVERY_TIER,
  PROJECT_STATUSES,
} from './types.ts';
import {
  type BackupDrStore,
  type SiloBackupPosture,
  type DowngradeEntry,
  type PurgeFlagState,
  InMemoryBackupDrStore,
  BackupDrError,
  ERR_NO_SUCH_SILO,
  ERR_SILENT_DOWNGRADE,
  ERR_BAD_TIER,
  ERR_BAD_DESTINATION,
  ERR_DUPLICATE_SILO,
  validateDestination,
} from './store.ts';
import {
  type BackupHealthPayload,
  type BackupHealthInputs,
  type BackupHealthAlert,
  type FieldFreshness,
  type FreshnessWindows,
  BACKUP_HEALTH_FIELDS,
  BackupHealthBusinessDataError,
  assertNoBusinessData,
  assembleBackupHealth,
  evaluateBackupHealthAlert,
  DEFAULT_FRESHNESS_WINDOWS,
} from './backup-health.ts';
import {
  type RestoreDriver,
  type RestoreProbe,
  RestoreDriverError,
  runRehearsal,
  rehearsalDue,
  MONTHLY_SECONDS,
} from './rehearsal.ts';
import {
  type DumpJobDefinition,
  type CadenceDecision,
  type CadenceFallback,
  defaultDumpJob,
  decideCadence,
} from './dump-job.ts';
import {
  type PurgeDriver,
  type PurgeDriverResult,
  type PurgeOutcome,
  receivePurgeFlag,
  actionPurgeFlag,
  openPurgeFlagExceptions,
  DUMP_CYCLE_SECONDS,
} from './purge-leg.ts';
import {
  OWNERSHIP_SPLIT,
  DR_POSTURE,
  STORAGE_SCOPE,
  DEFENSE_IN_DEPTH_LAYERS,
  DEFAULT_TIER_POSTURE,
} from './posture.ts';
import { SupabaseBackupDrStore, Af069RestoreDriver, Af137PurgeDriver } from './backup-dr-live.ts';

// ── re-exports (public surface) ─────────────────────────────────────────────────
export {
  type RecoveryTier,
  type ProjectStatus,
  type RehearsalResult,
  type RehearsalRecord,
  type RehearsalTrigger,
  type OffPlatformSnapshot,
  type OffPlatformDestination,
  type PurgeFlag,
  RECOVERY_TIERS,
  AT_OR_ABOVE_HOURLY,
  DEFAULT_RECOVERY_TIER,
  PROJECT_STATUSES,
};
export {
  type BackupDrStore,
  type SiloBackupPosture,
  type DowngradeEntry,
  type PurgeFlagState,
  InMemoryBackupDrStore,
  BackupDrError,
  ERR_NO_SUCH_SILO,
  ERR_SILENT_DOWNGRADE,
  ERR_BAD_TIER,
  ERR_BAD_DESTINATION,
  ERR_DUPLICATE_SILO,
  validateDestination,
};
export {
  type BackupHealthPayload,
  type BackupHealthInputs,
  type BackupHealthAlert,
  type FieldFreshness,
  type FreshnessWindows,
  BACKUP_HEALTH_FIELDS,
  BackupHealthBusinessDataError,
  assertNoBusinessData,
  assembleBackupHealth,
  evaluateBackupHealthAlert,
  DEFAULT_FRESHNESS_WINDOWS,
};
export {
  type RestoreDriver,
  type RestoreProbe,
  RestoreDriverError,
  runRehearsal,
  rehearsalDue,
  MONTHLY_SECONDS,
};
export { type DumpJobDefinition, type CadenceDecision, type CadenceFallback, defaultDumpJob, decideCadence };
export {
  type PurgeDriver,
  type PurgeDriverResult,
  type PurgeOutcome,
  receivePurgeFlag,
  actionPurgeFlag,
  openPurgeFlagExceptions,
  DUMP_CYCLE_SECONDS,
};
export { OWNERSHIP_SPLIT, DR_POSTURE, STORAGE_SCOPE, DEFENSE_IN_DEPTH_LAYERS, DEFAULT_TIER_POSTURE };
export { SupabaseBackupDrStore, Af069RestoreDriver, Af137PurgeDriver };

// ── offline build-time check ──────────────────────────────────────────────────────
interface Finding {
  gate: string;
  message: string;
}

// config-registry.md §M `recovery_tier` enum — the module enum must be EXACTLY this (no drift).
const CONFIG_RECOVERY_TIER_ENUM: readonly string[] = ['daily_in_project', 'hourly_off_platform', 'pitr'];

/** Gate 1 — recovery_tier enum ≡ config-registry §M; the default is hourly_off_platform; below-hourly is not a
 *  silent default. */
function checkRecoveryTierParity(): Finding[] {
  const findings: Finding[] = [];
  const mine = new Set<string>(RECOVERY_TIERS);
  for (const t of CONFIG_RECOVERY_TIER_ENUM) {
    if (!mine.has(t)) findings.push({ gate: 'recovery-tier-enum', message: `config §M recovery_tier value '${t}' missing from the module enum (a valid tier would be rejected)` });
  }
  for (const t of RECOVERY_TIERS) {
    if (!CONFIG_RECOVERY_TIER_ENUM.includes(t)) findings.push({ gate: 'recovery-tier-enum', message: `module carries recovery_tier '${t}' not in config §M (over-broad enum)` });
  }
  if (DEFAULT_RECOVERY_TIER !== 'hourly_off_platform') {
    findings.push({ gate: 'recovery-tier-default', message: `default recovery_tier is '${DEFAULT_RECOVERY_TIER}', not hourly_off_platform (NFR-DR.001)` });
  }
  if (AT_OR_ABOVE_HOURLY.includes('daily_in_project')) {
    findings.push({ gate: 'recovery-tier-default', message: `daily_in_project is marked at-or-above-hourly — a below-hourly tier could become a silent default (NFR-DR.001)` });
  }
  return findings;
}

/** Gate 2 — the backup-health boundary is operational-metadata-only + fail-loud. A business-data key is rejected;
 *  a never/stale/failed field reads loud, never green. */
function checkBackupHealthBoundary(): Finding[] {
  const findings: Finding[] = [];
  // A rogue payload with a business-data key must be REJECTED, not silently dropped (#2).
  const rogue = { recovery_tier: 'hourly_off_platform', project_status: 'active', customer_email: 'a@b.com' };
  let rejected = false;
  try {
    assertNoBusinessData(rogue);
  } catch (e) {
    rejected = e instanceof BackupHealthBusinessDataError;
  }
  if (!rejected) findings.push({ gate: 'backup-health-boundary', message: 'backup-health payload with a business-data field was not rejected — the boundary leaks (#2)' });

  // A never/stale field must read LOUD, never green (#3).
  const lapsed = assembleBackupHealth({
    recovery_tier: 'hourly_off_platform',
    last_in_project_backup_at: null,
    project_status: 'active',
    last_off_platform_snapshot_at: null, // never → the deletion-path defense is not current
    last_rehearsal_at: null, // never → restore UNPROVEN
    last_rehearsal_result: null,
  });
  const alert = evaluateBackupHealthAlert('acme', lapsed, Math.floor(Date.now() / 1000));
  if (!alert.alert || alert.off_platform_snapshot === 'fresh' || alert.rehearsal === 'fresh') {
    findings.push({ gate: 'backup-health-boundary', message: 'a lapsed (never-run) backup-health read did not raise a loud alert / read stale-not-green (#3)' });
  }
  return findings;
}

/** Gate 3 — the DR/ownership/Storage/defense-in-depth postures are stated (no silent assumption). */
function checkPostureStated(): Finding[] {
  const findings: Finding[] = [];
  if (DR_POSTURE.hot_failover !== false || DR_POSTURE.recovery_model !== 'backup-restore-with-downtime') {
    findings.push({ gate: 'posture', message: 'DR posture does not state backup-restore-with-downtime / no hot failover (NFR-DR.005)' });
  }
  if (!DR_POSTURE.rto_is_measured_not_assumed) findings.push({ gate: 'posture', message: 'RTO is not stated as measured-not-assumed (NFR-DR.005 / AF-069)' });
  if (STORAGE_SCOPE.buckets_backed_up_in_v1 !== false || STORAGE_SCOPE.source_files_copied_into_supabase !== false) {
    findings.push({ gate: 'posture', message: 'Storage-out-of-scope / golden-rule posture not stated (NFR-DR.007 / OOS-013)' });
  }
  if (DEFENSE_IN_DEPTH_LAYERS.length < 3 || !DEFENSE_IN_DEPTH_LAYERS.every((l) => l.independent)) {
    findings.push({ gate: 'posture', message: 'defense-in-depth composition (restore ∩ audit-immutability ∩ shadow-retain) not stated as independent (NFR-DR.008)' });
  }
  if (!OWNERSHIP_SPLIT.neither_may_assume_the_other) findings.push({ gate: 'posture', message: 'ownership split not stated (NFR-DR.004)' });
  return findings;
}

function runCheck(): Finding[] {
  const findings = [...checkRecoveryTierParity(), ...checkBackupHealthBoundary(), ...checkPostureStated()];
  if (findings.length === 0) {
    console.log(
      `✓ backup-dr check: recovery_tier enum ≡ config §M (${RECOVERY_TIERS.length} tiers, default hourly_off_platform, below-hourly never a silent default) · backup-health boundary is operational-metadata-only + fail-loud (lapse reads stale-not-green) · DR/ownership/Storage/defense-in-depth postures stated (no silent assumption).`,
    );
  } else {
    console.error(`✗ backup-dr check: ${findings.length} finding(s):`);
    for (const f of findings) console.error(`  [${f.gate}] ${f.message}`);
  }
  return findings;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cmd = process.argv[2] ?? 'check';
  if (cmd === 'check') {
    process.exit(runCheck().length === 0 ? 0 : 1);
  }
  console.error(`unknown command '${cmd}' — use: check`);
  process.exit(2);
}
