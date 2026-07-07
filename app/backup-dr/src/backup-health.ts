// ISSUE-085 — the FIVE backup-health fields + the loud lapse/stale alert (NFR-DR.006 / ADR-008 part 5 /
// FR-7.MGM.005 / AC-7.MGM.005.1).
//
// This module owns the INTERNAL SHAPE of the deployment_health.backup_health jsonb (opaque to
// @harness/management, which carries it as an operational rollup — see its contracts.ts backupHealthCard).
// The five fields (ADR-008 part 5):
//   1. recovery tier
//   2. last in-project backup + timestamp
//   3. project status (active / paused / billing_at_risk)
//   4. last off-platform snapshot + timestamp
//   5. last restore-rehearsal date + result
//
// #1 posture: catch the approaching pause → 90-day deletion window LONG before deletion.
// #3 posture: any lapsed/stale field, or a project entering paused/billing_at_risk, raises a LOUD alert; a
//   stale field reads STALE, never green — absence of a fresh signal is itself a signal (never assume-healthy).
//
// CRUCIAL BOUNDARY (#2 / ADR-001 §7): backup-health is OPERATIONAL METADATA ONLY. Every field here is a tier
// name, a timestamp, a status enum, or a pass/fail — ZERO client business data. This is asserted structurally
// (assertNoBusinessData) so the payload can never carry a memory row, an embedding, or any client content.

import {
  type RecoveryTier,
  type ProjectStatus,
  type RehearsalResult,
  RECOVERY_TIERS,
  PROJECT_STATUSES,
} from './types.ts';

/** The five-field backup-health payload — the internal shape of deployment_health.backup_health (NFR-DR.006).
 *  Timestamps are ISO strings; a `null` timestamp means "never happened" (which is itself a lapse, surfaced
 *  loud — never rendered as green). This is operational metadata ONLY; no business data (asserted below). */
export interface BackupHealthPayload {
  recovery_tier: RecoveryTier; // field 1
  last_in_project_backup_at: string | null; // field 2
  project_status: ProjectStatus; // field 3
  last_off_platform_snapshot_at: string | null; // field 4
  last_rehearsal_at: string | null; // field 5a
  last_rehearsal_result: RehearsalResult | null; // field 5b
}

/** The keys the payload is ALLOWED to carry — used to structurally reject any stray (business-data) key that a
 *  buggy assembler might add. Deny-by-default, mirroring the mgmt-plane allow-list posture (#2). */
export const BACKUP_HEALTH_FIELDS = [
  'recovery_tier',
  'last_in_project_backup_at',
  'project_status',
  'last_off_platform_snapshot_at',
  'last_rehearsal_at',
  'last_rehearsal_result',
] as const;

export class BackupHealthBusinessDataError extends Error {
  constructor(public offendingFields: string[]) {
    super(
      `backup-health payload carries non-operational field(s) [${offendingFields.join(', ')}] — backup-health is ` +
        `operational metadata ONLY; no client business data may cross the mgmt-plane boundary (ADR-001 §7 / NFR-DR.006 / #2)`,
    );
    this.name = 'BackupHealthBusinessDataError';
  }
}

/** Reject any key that is not one of the five backup-health fields. The assembler runs this before the payload
 *  is handed to the mgmt-plane push (defence-in-depth; the boundary can never leak business data — #2). */
export function assertNoBusinessData(payload: Record<string, unknown>): void {
  const allowed = new Set<string>(BACKUP_HEALTH_FIELDS);
  const bad = Object.keys(payload).filter((k) => !allowed.has(k));
  if (bad.length > 0) throw new BackupHealthBusinessDataError(bad);
  // The typed fields must also hold typed values (a tier/status enum can't be an arbitrary string carrying content).
  if (!RECOVERY_TIERS.includes(payload.recovery_tier as RecoveryTier)) {
    throw new BackupHealthBusinessDataError(['recovery_tier(not-an-enum-value)']);
  }
  if (!PROJECT_STATUSES.includes(payload.project_status as ProjectStatus)) {
    throw new BackupHealthBusinessDataError(['project_status(not-an-enum-value)']);
  }
}

/** The raw inputs the assembler draws the five fields from. `null` timestamps mean "never" (a lapse). */
export interface BackupHealthInputs {
  recovery_tier: RecoveryTier;
  last_in_project_backup_at: string | null;
  project_status: ProjectStatus;
  last_off_platform_snapshot_at: string | null;
  last_rehearsal_at: string | null;
  last_rehearsal_result: RehearsalResult | null;
}

/** Assemble the five-field payload, asserting it carries operational metadata only (AC-NFR-DR.006.1). */
export function assembleBackupHealth(inputs: BackupHealthInputs): BackupHealthPayload {
  const payload: BackupHealthPayload = {
    recovery_tier: inputs.recovery_tier,
    last_in_project_backup_at: inputs.last_in_project_backup_at,
    project_status: inputs.project_status,
    last_off_platform_snapshot_at: inputs.last_off_platform_snapshot_at,
    last_rehearsal_at: inputs.last_rehearsal_at,
    last_rehearsal_result: inputs.last_rehearsal_result,
  };
  assertNoBusinessData(payload as unknown as Record<string, unknown>);
  return payload;
}

// ── the loud lapse/stale alert (NFR-DR.006 / AC-NFR-DR.006.2) ────────────────────────────────────────────

/** A per-field freshness read. `stale` / `never` NEVER read as green — absence of a fresh signal is a signal. */
export type FieldFreshness = 'fresh' | 'stale' | 'never';

export interface BackupHealthAlert {
  client_slug: string;
  alert: boolean; // true ⇒ a LOUD Super Admin alert is raised (never silently assumed-healthy)
  severity: 'ok' | 'warn' | 'critical';
  reasons: string[]; // every lapsed/stale/at-risk reason, listed (never a single silent green)
  // per-field freshness so the Super Admin grid can render each field stale-not-green (AC-NFR-DR.006.2).
  in_project_backup: FieldFreshness;
  off_platform_snapshot: FieldFreshness;
  rehearsal: FieldFreshness;
}

/** The freshness windows the alert judges against (seconds). Off-platform inherits the ~1h RPO (NFR-DR.001);
 *  the in-project floor is daily; the rehearsal is monthly (NFR-DR.003). A field older than its window reads
 *  STALE; a null timestamp reads NEVER — both are loud, never green (staleness inherits the mgmt-plane freshness
 *  posture, OBS-f / FR-7.MGM.002). Defaults are the ADR-008 cadences; the caller may widen per config. */
export interface FreshnessWindows {
  off_platform_seconds: number; // default hourly (~1h RPO) + slack
  in_project_seconds: number; // default daily + slack
  rehearsal_seconds: number; // default monthly + slack
}

export const DEFAULT_FRESHNESS_WINDOWS: FreshnessWindows = {
  off_platform_seconds: 60 * 60 * 2, // 2h — an hourly dump missed twice is stale (NFR-DR.001)
  in_project_seconds: 60 * 60 * 26, // ~26h — a daily backup with slack
  rehearsal_seconds: 60 * 60 * 24 * 35, // ~35d — a monthly rehearsal with slack (NFR-DR.003)
};

function freshness(lastAtIso: string | null, serverNow: number, windowSeconds: number): FieldFreshness {
  if (lastAtIso === null) return 'never';
  const ageSeconds = Math.max(0, serverNow - Math.floor(Date.parse(lastAtIso) / 1000));
  return ageSeconds <= windowSeconds ? 'fresh' : 'stale';
}

/** Evaluate the loud lapse/stale alert for one deployment's backup-health (AC-NFR-DR.006.2). A stale/never
 *  field, a FAILED last rehearsal, or a project in paused/billing_at_risk raises the alert. A stale field is
 *  reported stale, never green. Fail-LOUD, never assume-healthy (#3). */
export function evaluateBackupHealthAlert(
  client_slug: string,
  payload: BackupHealthPayload,
  serverNow: number,
  windows: FreshnessWindows = DEFAULT_FRESHNESS_WINDOWS,
): BackupHealthAlert {
  const reasons: string[] = [];
  let severity: BackupHealthAlert['severity'] = 'ok';
  const bump = (s: BackupHealthAlert['severity']) => {
    const rank = { ok: 0, warn: 1, critical: 2 } as const;
    if (rank[s] > rank[severity]) severity = s;
  };

  // Field 3 — project status: paused/billing_at_risk is the approaching deletion path → CRITICAL (catch it early).
  if (payload.project_status === 'paused') {
    reasons.push('project is PAUSED — approaching the 90-day deletion window (billing lapse path, ADR-008)');
    bump('critical');
  } else if (payload.project_status === 'billing_at_risk') {
    reasons.push('project is BILLING_AT_RISK — heading toward pause → deletion (ADR-008 Context finding 1)');
    bump('critical');
  }

  // Field 4 — off-platform snapshot: the ONLY defense against the deletion path; a lapse here is critical.
  const off = freshness(payload.last_off_platform_snapshot_at, serverNow, windows.off_platform_seconds);
  if (off !== 'fresh') {
    reasons.push(
      `off-platform snapshot is ${off.toUpperCase()} — the only copy that survives project deletion is not current (NFR-DR.002)`,
    );
    bump('critical');
  }

  // Field 2 — in-project backup: a lapse is a warning (in-project dies on the deletion path anyway, but a lapse
  // still means fast in-place restore is unavailable).
  const inp = freshness(payload.last_in_project_backup_at, serverNow, windows.in_project_seconds);
  if (inp !== 'fresh') {
    reasons.push(`in-project backup is ${inp.toUpperCase()} — fast in-place restore may be unavailable (NFR-DR.001)`);
    bump('warn');
  }

  // Field 5 — restore rehearsal: a stale/never/failed rehearsal means "restore is not proven" — the #1 keystone.
  const reh = freshness(payload.last_rehearsal_at, serverNow, windows.rehearsal_seconds);
  if (reh !== 'fresh') {
    reasons.push(`restore rehearsal is ${reh.toUpperCase()} — "a backup exists" ≠ "a restore works"; restore is UNPROVEN (NFR-DR.003)`);
    bump('critical');
  } else if (payload.last_rehearsal_result === 'failed') {
    reasons.push('last restore rehearsal FAILED — the restore did not come back complete & queryable (NFR-DR.003)');
    bump('critical');
  }

  return {
    client_slug,
    alert: severity !== 'ok',
    severity,
    reasons,
    in_project_backup: inp,
    off_platform_snapshot: off,
    rehearsal: reh,
  };
}
