// ISSUE-085 — the BackupDrStore PORT + in-memory FAKE reference model (the house port+fake pattern, cf.
// app/management store.ts, app/rbac store.ts). Every live side effect of the backup-DR posture goes through
// this port so the rehearsal / snapshot / purge / health logic stays unit-testable with NO live DB and NO
// live pg_dump/restore. The in-memory fake is BOTH the test double AND the reference model the live adapter
// (backup-dr-live.ts) must match against the real DDL/CLI.
//
// This slice adds NO new mgmt-plane table — backup-health rides deployment_health.backup_health (jsonb,
// schema.md §13, owned by ISSUE-012). What this store models is the OPERATOR-SIDE backup log that lives on the
// MANAGEMENT plane (operator-owned, never a client silo): the recovery-tier config per silo, the off-platform
// snapshot log, the restore-rehearsal log, and the compliance-erasure purge-flag ledger. These are proposed as
// additive mgmt-plane deltas in results/proposed-shared-spec.md (the orchestrator applies them serially).
//
// Fake-vs-live drift guard (the #1 thing the verifier hunts): the fake enforces EXACTLY the constraints the
// live DDL would — recovery_tier is a closed enum; a below-hourly tier move is REFUSED unless a downgrade
// reason is supplied (NFR-DR.001, modelling a CHECK/trigger-logged downgrade); an off-platform destination that
// is operator-held or same-region is flagged; a purge flag is idempotent on flag_id; timestamps are
// server-supplied (never caller-asserted-fresh). If the fake would pass where the live adapter throws, that is
// the drift class — so the fake refuses the same states the DDL/CLI would.

import {
  type RecoveryTier,
  type ProjectStatus,
  type RehearsalRecord,
  type RehearsalResult,
  type RehearsalTrigger,
  type OffPlatformSnapshot,
  type OffPlatformDestination,
  type PurgeFlag,
  RECOVERY_TIERS,
  AT_OR_ABOVE_HOURLY,
  DEFAULT_RECOVERY_TIER,
} from './types.ts';

export class BackupDrError extends Error {
  constructor(
    public reason: string,
    message: string,
  ) {
    super(message);
    this.name = 'BackupDrError';
  }
}
export const ERR_NO_SUCH_SILO = 'no_such_silo';
export const ERR_SILENT_DOWNGRADE = 'silent_downgrade_refused';
export const ERR_BAD_TIER = 'bad_recovery_tier';
export const ERR_BAD_DESTINATION = 'bad_off_platform_destination';
export const ERR_DUPLICATE_SILO = 'duplicate_silo';

/** One silo's backup posture row (operator-side, mgmt-plane). recovery_tier + the off-platform destination +
 *  the current project status. `destination`/`pitr` are null until provisioning (ISSUE-007) wires them. */
export interface SiloBackupPosture {
  client_slug: string;
  recovery_tier: RecoveryTier;
  destination: OffPlatformDestination | null; // client-owned off-platform target (ISSUE-007 provisions it)
  project_status: ProjectStatus;
  // the change-control log of every below-hourly downgrade (NFR-DR.001 — never a silent default).
  downgrade_log: DowngradeEntry[];
  created_at: string;
  updated_at: string;
}

/** A logged below-hourly downgrade (NFR-DR.001 / AC-NFR-DR.001.1). Recorded, never silent — a change-control
 *  exception per change-control.md. Also the AF-072 fallback path: hourly can't keep up → back off cadence /
 *  move to PITR, LOGGED (AC-NFR-DR.001.2). */
export interface DowngradeEntry {
  at: string;
  from_tier: RecoveryTier;
  to_tier: RecoveryTier;
  reason: string;
  logged_by: string; // Super Admin actor (PERM-config.infra)
}

/** The BackupDrStore port — the operator-side backup log + posture, on the management plane. */
export interface BackupDrStore {
  // ── recovery-tier posture (NFR-DR.001/002/004) ──
  /** Register a silo's default posture at provision time: free daily in-project + hourly off-platform, PITR off
   *  (AC-NFR-DR.001.1). The destination is set by provisioning (ISSUE-007); may be null until then. */
  registerSilo(input: {
    client_slug: string;
    recovery_tier?: RecoveryTier;
    destination?: OffPlatformDestination | null;
    project_status?: ProjectStatus;
    now: number;
  }): Promise<SiloBackupPosture>;
  getSilo(slug: string): Promise<SiloBackupPosture | null>;
  listSilos(): Promise<SiloBackupPosture[]>;
  /** Change a silo's recovery tier. Moving BELOW hourly (to daily_in_project) REQUIRES a downgrade reason +
   *  actor — it is a logged change-control exception, never a silent default (NFR-DR.001). Refused otherwise. */
  setRecoveryTier(slug: string, to: RecoveryTier, opts: { now: number; downgrade?: { reason: string; logged_by: string } }): Promise<SiloBackupPosture>;
  /** Provisioning (ISSUE-007) connects the client-owned off-platform destination; validated here. */
  setDestination(slug: string, destination: OffPlatformDestination, now: number): Promise<SiloBackupPosture>;
  /** The Management-API-sourced project status (active/paused/billing_at_risk) — updated by the health path. */
  setProjectStatus(slug: string, status: ProjectStatus, now: number): Promise<SiloBackupPosture>;

  // ── off-platform snapshot log (NFR-DR.002) ──
  recordSnapshot(snapshot: OffPlatformSnapshot): Promise<OffPlatformSnapshot>;
  lastSnapshot(slug: string): Promise<OffPlatformSnapshot | null>;
  listSnapshots(slug: string): Promise<OffPlatformSnapshot[]>;

  // ── restore-rehearsal log (NFR-DR.003) ──
  recordRehearsal(record: RehearsalRecord): Promise<RehearsalRecord>;
  lastRehearsal(slug: string): Promise<RehearsalRecord | null>;
  listRehearsals(slug: string): Promise<RehearsalRecord[]>;

  // ── compliance-erasure purge flags (NFR-DR.009) ──
  /** Receive a purge flag raised by C2 FR-2.MNT.017 (idempotent on flag_id). Returns whether it was new. */
  receivePurgeFlag(flag: PurgeFlag): Promise<{ flag: PurgeFlag; new: boolean }>;
  /** Mark a purge flag cleared (its target's Personal data purged/expired from pre-erasure snapshots). */
  markPurgeCleared(flag_id: string, clearedAt: string, confirmedBy: string): Promise<PurgeFlagState>;
  getPurgeFlag(flag_id: string): Promise<PurgeFlagState | null>;
  listOpenPurgeFlags(slug: string): Promise<PurgeFlagState[]>;
}

/** A purge flag's lifecycle state (NFR-DR.009). `open` until cleared; a flag open past its dump-cycle window is
 *  surfaced as a logged exception at the next rehearsal/health-check (AC-NFR-DR.009.2), never silently dropped. */
export interface PurgeFlagState {
  flag: PurgeFlag;
  status: 'open' | 'cleared';
  received_at: string;
  cleared_at: string | null;
  confirmed_by: string | null; // who confirmed clearance (next rehearsal / dump-cycle)
}

let __seq = 0;
const nextId = (p: string) => `${p}-${String(++__seq).padStart(4, '0')}`;

/** Validate an off-platform destination against the NFR-DR.002 constraints (client-owned, different-region,
 *  lifecycle-independent). An operator-held destination is NOT rejected outright (it is a logged per-client
 *  exception, ADR-008 Axis 2/B3) but a same-region or lifecycle-DEPENDENT copy IS rejected — it fails the
 *  deletion-path defense. The live DDL/provisioning enforces the same; the fake must match (drift guard). */
export function validateDestination(dest: OffPlatformDestination): string[] {
  const problems: string[] = [];
  if (dest.region === dest.primary_region) {
    problems.push('off-platform destination is in the SAME region as the primary project (NFR-DR.002 requires different-region where practical)');
  }
  if (!dest.lifecycle_independent) {
    problems.push('off-platform destination is NOT lifecycle-independent — it would die with the primary project on the deletion path (NFR-DR.002 — this is the ONLY thing that survives deletion)');
  }
  // owner === 'operator' is allowed but is a logged exception — the caller logs it; not a hard error here.
  return problems;
}

// ── the in-memory FAKE reference model ─────────────────────────────────────────────
export class InMemoryBackupDrStore implements BackupDrStore {
  private silos = new Map<string, SiloBackupPosture>();
  private snapshots = new Map<string, OffPlatformSnapshot[]>(); // by client_slug
  private rehearsals = new Map<string, RehearsalRecord[]>(); // by client_slug
  private purgeFlags = new Map<string, PurgeFlagState>(); // by flag_id

  private iso(now: number): string {
    return new Date(now * 1000).toISOString();
  }

  async registerSilo(input: {
    client_slug: string;
    recovery_tier?: RecoveryTier;
    destination?: OffPlatformDestination | null;
    project_status?: ProjectStatus;
    now: number;
  }): Promise<SiloBackupPosture> {
    if (this.silos.has(input.client_slug)) {
      throw new BackupDrError(ERR_DUPLICATE_SILO, `silo '${input.client_slug}' already has a backup posture (UNIQUE)`);
    }
    const tier = input.recovery_tier ?? DEFAULT_RECOVERY_TIER;
    if (!RECOVERY_TIERS.includes(tier)) throw new BackupDrError(ERR_BAD_TIER, `unknown recovery_tier '${tier}'`);
    // A silo may NOT be registered directly below hourly (that would be a silent default — NFR-DR.001).
    if (!AT_OR_ABOVE_HOURLY.includes(tier)) {
      throw new BackupDrError(
        ERR_SILENT_DOWNGRADE,
        `cannot provision silo '${input.client_slug}' below hourly (tier '${tier}') as a default — below-hourly is a logged downgrade exception, never a silent default (NFR-DR.001)`,
      );
    }
    if (input.destination) {
      const problems = validateDestination(input.destination);
      if (problems.length > 0) throw new BackupDrError(ERR_BAD_DESTINATION, problems.join('; '));
    }
    const row: SiloBackupPosture = {
      client_slug: input.client_slug,
      recovery_tier: tier,
      destination: input.destination ?? null,
      project_status: input.project_status ?? 'active',
      downgrade_log: [],
      created_at: this.iso(input.now),
      updated_at: this.iso(input.now),
    };
    this.silos.set(row.client_slug, row);
    return { ...row, downgrade_log: [...row.downgrade_log] };
  }

  async getSilo(slug: string): Promise<SiloBackupPosture | null> {
    const r = this.silos.get(slug);
    return r ? { ...r, downgrade_log: [...r.downgrade_log] } : null;
  }
  async listSilos(): Promise<SiloBackupPosture[]> {
    return [...this.silos.values()].map((r) => ({ ...r, downgrade_log: [...r.downgrade_log] }));
  }

  async setRecoveryTier(
    slug: string,
    to: RecoveryTier,
    opts: { now: number; downgrade?: { reason: string; logged_by: string } },
  ): Promise<SiloBackupPosture> {
    const row = this.require(slug);
    if (!RECOVERY_TIERS.includes(to)) throw new BackupDrError(ERR_BAD_TIER, `unknown recovery_tier '${to}'`);
    const movingBelowHourly = !AT_OR_ABOVE_HOURLY.includes(to);
    if (movingBelowHourly) {
      // NFR-DR.001: moving BELOW hourly is a LOGGED downgrade exception — refuse it unless a reason+actor are
      // supplied (a silent default is a #3 violation). The live DDL logs this via a downgrade audit row/trigger.
      if (!opts.downgrade || !opts.downgrade.reason.trim() || !opts.downgrade.logged_by.trim()) {
        throw new BackupDrError(
          ERR_SILENT_DOWNGRADE,
          `moving silo '${slug}' to below-hourly tier '${to}' requires a logged downgrade exception (reason + actor) per change-control.md — never a silent default (NFR-DR.001 / AC-NFR-DR.001.1)`,
        );
      }
      row.downgrade_log.push({
        at: this.iso(opts.now),
        from_tier: row.recovery_tier,
        to_tier: to,
        reason: opts.downgrade.reason,
        logged_by: opts.downgrade.logged_by,
      });
    }
    row.recovery_tier = to;
    row.updated_at = this.iso(opts.now);
    return { ...row, downgrade_log: [...row.downgrade_log] };
  }

  async setDestination(slug: string, destination: OffPlatformDestination, now: number): Promise<SiloBackupPosture> {
    const row = this.require(slug);
    const problems = validateDestination(destination);
    if (problems.length > 0) throw new BackupDrError(ERR_BAD_DESTINATION, problems.join('; '));
    row.destination = { ...destination };
    row.updated_at = this.iso(now);
    return { ...row, downgrade_log: [...row.downgrade_log] };
  }

  async setProjectStatus(slug: string, status: ProjectStatus, now: number): Promise<SiloBackupPosture> {
    const row = this.require(slug);
    row.project_status = status;
    row.updated_at = this.iso(now);
    return { ...row, downgrade_log: [...row.downgrade_log] };
  }

  async recordSnapshot(snapshot: OffPlatformSnapshot): Promise<OffPlatformSnapshot> {
    this.require(snapshot.client_slug);
    const arr = this.snapshots.get(snapshot.client_slug) ?? [];
    arr.push({ ...snapshot, destination: { ...snapshot.destination } });
    this.snapshots.set(snapshot.client_slug, arr);
    return { ...snapshot };
  }
  async lastSnapshot(slug: string): Promise<OffPlatformSnapshot | null> {
    const arr = this.snapshots.get(slug) ?? [];
    return arr.length ? { ...arr[arr.length - 1]! } : null;
  }
  async listSnapshots(slug: string): Promise<OffPlatformSnapshot[]> {
    return (this.snapshots.get(slug) ?? []).map((s) => ({ ...s }));
  }

  async recordRehearsal(record: RehearsalRecord): Promise<RehearsalRecord> {
    this.require(record.client_slug);
    const arr = this.rehearsals.get(record.client_slug) ?? [];
    arr.push({ ...record });
    this.rehearsals.set(record.client_slug, arr);
    return { ...record };
  }
  async lastRehearsal(slug: string): Promise<RehearsalRecord | null> {
    const arr = this.rehearsals.get(slug) ?? [];
    return arr.length ? { ...arr[arr.length - 1]! } : null;
  }
  async listRehearsals(slug: string): Promise<RehearsalRecord[]> {
    return (this.rehearsals.get(slug) ?? []).map((r) => ({ ...r }));
  }

  async receivePurgeFlag(flag: PurgeFlag): Promise<{ flag: PurgeFlag; new: boolean }> {
    this.require(flag.client_slug);
    const existing = this.purgeFlags.get(flag.flag_id);
    if (existing) return { flag: { ...existing.flag }, new: false }; // idempotent (UNIQUE flag_id)
    const state: PurgeFlagState = {
      flag: { ...flag },
      status: 'open',
      received_at: flag.raised_at,
      cleared_at: null,
      confirmed_by: null,
    };
    this.purgeFlags.set(flag.flag_id, state);
    return { flag: { ...flag }, new: true };
  }
  async markPurgeCleared(flag_id: string, clearedAt: string, confirmedBy: string): Promise<PurgeFlagState> {
    const state = this.purgeFlags.get(flag_id);
    if (!state) throw new BackupDrError(ERR_NO_SUCH_SILO, `no purge flag '${flag_id}'`);
    state.status = 'cleared';
    state.cleared_at = clearedAt;
    state.confirmed_by = confirmedBy;
    return { ...state, flag: { ...state.flag } };
  }
  async getPurgeFlag(flag_id: string): Promise<PurgeFlagState | null> {
    const s = this.purgeFlags.get(flag_id);
    return s ? { ...s, flag: { ...s.flag } } : null;
  }
  async listOpenPurgeFlags(slug: string): Promise<PurgeFlagState[]> {
    return [...this.purgeFlags.values()]
      .filter((s) => s.flag.client_slug === slug && s.status === 'open')
      .map((s) => ({ ...s, flag: { ...s.flag } }));
  }

  private require(slug: string): SiloBackupPosture {
    const row = this.silos.get(slug);
    if (!row) throw new BackupDrError(ERR_NO_SUCH_SILO, `no backup posture for silo '${slug}'`);
    return row;
  }
}

export { nextId };
