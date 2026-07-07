// ISSUE-085 — the LIVE pg/CLI adapters for the BackupDrStore port + the RestoreDriver / DumpDriver / PurgeDriver
// seams. Authored to the real management-plane DDL (the additive backup-DR tables proposed in
// results/proposed-shared-spec.md) and to the real Supabase CLI / pg_dump / pg_restore. NOT exercised by the
// offline suite — its behaviour is proven by the operator-present LIVE run owed to the orchestrator
// (results/proposed-shared-spec.md + the AF-069/072/137 spike harnesses). Every method mirrors an InMemory
// method 1:1, and every driver reuses the GREEN AF-069 restore harness (spikes/issue-004-restore-rehearsal).
//
// Fake-vs-live parity (the drift the verifier hunts): this adapter enforces the SAME constraints the fake does —
// recovery_tier is a closed enum (a CHECK); a below-hourly move without a logged downgrade row is REFUSED (a
// trigger/CHECK on the downgrade-audit table); an off-platform destination that is same-region or
// lifecycle-dependent is rejected; last_push_at-style timestamps are DB-clock (now()), never caller-asserted;
// a purge flag is UNIQUE on flag_id (idempotent receive). If the fake passes a state the live adapter would
// throw on, that is a bug — they are authored from the SAME invariants.

import type { Pool } from 'pg';
import {
  type BackupDrStore,
  type SiloBackupPosture,
  type PurgeFlagState,
  validateDestination,
  BackupDrError,
  ERR_NO_SUCH_SILO,
  ERR_SILENT_DOWNGRADE,
  ERR_BAD_DESTINATION,
} from './store.ts';
import {
  type RecoveryTier,
  type ProjectStatus,
  type RehearsalRecord,
  type OffPlatformSnapshot,
  type OffPlatformDestination,
  type PurgeFlag,
  RECOVERY_TIERS,
  AT_OR_ABOVE_HOURLY,
  DEFAULT_RECOVERY_TIER,
} from './types.ts';
import { type RestoreDriver, type RestoreProbe } from './rehearsal.ts';
import { type PurgeDriver, type PurgeDriverResult } from './purge-leg.ts';

/** The live BackupDrStore — realised against the mgmt-plane Supabase (operator-owned, NOT a client silo). The
 *  DDL is the additive backup-DR tables in results/proposed-shared-spec.md (silo_backup_posture,
 *  off_platform_snapshot_log, restore_rehearsal_log, off_platform_purge_flag, backup_downgrade_log). */
export class SupabaseBackupDrStore implements BackupDrStore {
  constructor(private readonly pool: Pool) {}

  async registerSilo(input: {
    client_slug: string;
    recovery_tier?: RecoveryTier;
    destination?: OffPlatformDestination | null;
    project_status?: ProjectStatus;
    now: number;
  }): Promise<SiloBackupPosture> {
    const tier = input.recovery_tier ?? DEFAULT_RECOVERY_TIER;
    if (!RECOVERY_TIERS.includes(tier)) throw new BackupDrError('bad_recovery_tier', `unknown recovery_tier '${tier}'`);
    if (!AT_OR_ABOVE_HOURLY.includes(tier)) {
      // Mirrors the fake + a DDL CHECK: default provision may not be below hourly (silent-default guard).
      throw new BackupDrError(ERR_SILENT_DOWNGRADE, `cannot provision '${input.client_slug}' below hourly by default (NFR-DR.001)`);
    }
    if (input.destination) {
      const problems = validateDestination(input.destination);
      if (problems.length) throw new BackupDrError(ERR_BAD_DESTINATION, problems.join('; '));
    }
    // insert into silo_backup_posture (recovery_tier enum CHECK; created_at/updated_at DB-clock now()).
    const { rows } = await this.pool.query(
      `insert into silo_backup_posture (client_slug, recovery_tier, destination, project_status, created_at, updated_at)
       values ($1,$2,$3,$4, now(), now()) returning *`,
      [input.client_slug, tier, input.destination ? JSON.stringify(input.destination) : null, input.project_status ?? 'active'],
    );
    return this.rowToPosture(rows[0]);
  }

  async getSilo(slug: string): Promise<SiloBackupPosture | null> {
    const { rows } = await this.pool.query(`select * from silo_backup_posture where client_slug=$1`, [slug]);
    return rows[0] ? this.rowToPosture(rows[0]) : null;
  }
  async listSilos(): Promise<SiloBackupPosture[]> {
    const { rows } = await this.pool.query(`select * from silo_backup_posture order by client_slug`);
    return rows.map((r: unknown) => this.rowToPosture(r));
  }

  async setRecoveryTier(
    slug: string,
    to: RecoveryTier,
    opts: { now: number; downgrade?: { reason: string; logged_by: string } },
  ): Promise<SiloBackupPosture> {
    if (!RECOVERY_TIERS.includes(to)) throw new BackupDrError('bad_recovery_tier', `unknown recovery_tier '${to}'`);
    const current = await this.getSilo(slug);
    if (!current) throw new BackupDrError(ERR_NO_SUCH_SILO, `no backup posture for silo '${slug}'`);
    if (!AT_OR_ABOVE_HOURLY.includes(to)) {
      if (!opts.downgrade || !opts.downgrade.reason.trim() || !opts.downgrade.logged_by.trim()) {
        // Mirrors the fake: a below-hourly move REQUIRES a logged downgrade row (a trigger enforces this DDL-side).
        throw new BackupDrError(ERR_SILENT_DOWNGRADE, `below-hourly move for '${slug}' needs a logged downgrade (NFR-DR.001)`);
      }
      await this.pool.query(
        `insert into backup_downgrade_log (client_slug, from_tier, to_tier, reason, logged_by, at)
         values ($1,$2,$3,$4,$5, now())`,
        [slug, current.recovery_tier, to, opts.downgrade.reason, opts.downgrade.logged_by],
      );
    }
    const { rows } = await this.pool.query(
      `update silo_backup_posture set recovery_tier=$2, updated_at=now() where client_slug=$1 returning *`,
      [slug, to],
    );
    return this.rowToPosture(rows[0]);
  }

  async setDestination(slug: string, destination: OffPlatformDestination, now: number): Promise<SiloBackupPosture> {
    const problems = validateDestination(destination);
    if (problems.length) throw new BackupDrError(ERR_BAD_DESTINATION, problems.join('; '));
    const { rows } = await this.pool.query(
      `update silo_backup_posture set destination=$2, updated_at=now() where client_slug=$1 returning *`,
      [slug, JSON.stringify(destination)],
    );
    if (!rows[0]) throw new BackupDrError(ERR_NO_SUCH_SILO, `no backup posture for silo '${slug}'`);
    return this.rowToPosture(rows[0]);
  }

  async setProjectStatus(slug: string, status: ProjectStatus, now: number): Promise<SiloBackupPosture> {
    const { rows } = await this.pool.query(
      `update silo_backup_posture set project_status=$2, updated_at=now() where client_slug=$1 returning *`,
      [slug, status],
    );
    if (!rows[0]) throw new BackupDrError(ERR_NO_SUCH_SILO, `no backup posture for silo '${slug}'`);
    return this.rowToPosture(rows[0]);
  }

  async recordSnapshot(snapshot: OffPlatformSnapshot): Promise<OffPlatformSnapshot> {
    await this.pool.query(
      `insert into off_platform_snapshot_log (snapshot_id, client_slug, taken_at, destination, encrypted, size_bytes)
       values ($1,$2,$3,$4,$5,$6)`,
      [snapshot.snapshot_id, snapshot.client_slug, snapshot.taken_at, JSON.stringify(snapshot.destination), snapshot.encrypted, snapshot.size_bytes],
    );
    return snapshot;
  }
  async lastSnapshot(slug: string): Promise<OffPlatformSnapshot | null> {
    const { rows } = await this.pool.query(
      `select * from off_platform_snapshot_log where client_slug=$1 order by taken_at desc limit 1`,
      [slug],
    );
    return rows[0] ? this.rowToSnapshot(rows[0]) : null;
  }
  async listSnapshots(slug: string): Promise<OffPlatformSnapshot[]> {
    const { rows } = await this.pool.query(`select * from off_platform_snapshot_log where client_slug=$1 order by taken_at`, [slug]);
    return rows.map((r: unknown) => this.rowToSnapshot(r));
  }

  async recordRehearsal(record: RehearsalRecord): Promise<RehearsalRecord> {
    await this.pool.query(
      `insert into restore_rehearsal_log (rehearsal_id, client_slug, ran_at, result, restored_into, db_queryable,
         pgvector_memory_complete, auth_rows_complete, measured_rto_seconds, trigger, detail)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [record.rehearsal_id, record.client_slug, record.ran_at, record.result, record.restored_into, record.db_queryable,
        record.pgvector_memory_complete, record.auth_rows_complete, record.measured_rto_seconds, record.trigger, record.detail],
    );
    return record;
  }
  async lastRehearsal(slug: string): Promise<RehearsalRecord | null> {
    const { rows } = await this.pool.query(`select * from restore_rehearsal_log where client_slug=$1 order by ran_at desc limit 1`, [slug]);
    return rows[0] ? this.rowToRehearsal(rows[0]) : null;
  }
  async listRehearsals(slug: string): Promise<RehearsalRecord[]> {
    const { rows } = await this.pool.query(`select * from restore_rehearsal_log where client_slug=$1 order by ran_at`, [slug]);
    return rows.map((r: unknown) => this.rowToRehearsal(r));
  }

  async receivePurgeFlag(flag: PurgeFlag): Promise<{ flag: PurgeFlag; new: boolean }> {
    // UNIQUE(flag_id) makes receive idempotent — on conflict do nothing, report new=false.
    const { rowCount } = await this.pool.query(
      `insert into off_platform_purge_flag (flag_id, client_slug, target_ref, raised_at, erasure_effective_at, status, received_at)
       values ($1,$2,$3,$4,$5,'open',$4) on conflict (flag_id) do nothing`,
      [flag.flag_id, flag.client_slug, flag.target_ref, flag.raised_at, flag.erasure_effective_at],
    );
    return { flag, new: (rowCount ?? 0) > 0 };
  }
  async markPurgeCleared(flag_id: string, clearedAt: string, confirmedBy: string): Promise<PurgeFlagState> {
    const { rows } = await this.pool.query(
      `update off_platform_purge_flag set status='cleared', cleared_at=$2, confirmed_by=$3 where flag_id=$1 returning *`,
      [flag_id, clearedAt, confirmedBy],
    );
    if (!rows[0]) throw new BackupDrError(ERR_NO_SUCH_SILO, `no purge flag '${flag_id}'`);
    return this.rowToPurgeState(rows[0]);
  }
  async getPurgeFlag(flag_id: string): Promise<PurgeFlagState | null> {
    const { rows } = await this.pool.query(`select * from off_platform_purge_flag where flag_id=$1`, [flag_id]);
    return rows[0] ? this.rowToPurgeState(rows[0]) : null;
  }
  async listOpenPurgeFlags(slug: string): Promise<PurgeFlagState[]> {
    const { rows } = await this.pool.query(`select * from off_platform_purge_flag where client_slug=$1 and status='open'`, [slug]);
    return rows.map((r: unknown) => this.rowToPurgeState(r));
  }

  // ── row mappers (jsonb columns come back parsed by pg; text[] as arrays) ──
  private rowToPosture(r: any): SiloBackupPosture {
    return {
      client_slug: r.client_slug,
      recovery_tier: r.recovery_tier,
      destination: r.destination ?? null,
      project_status: r.project_status,
      downgrade_log: [], // downgrade_log lives in backup_downgrade_log; joined on demand, not inlined here
      created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
      updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
    };
  }
  private rowToSnapshot(r: any): OffPlatformSnapshot {
    return {
      snapshot_id: r.snapshot_id,
      client_slug: r.client_slug,
      taken_at: r.taken_at instanceof Date ? r.taken_at.toISOString() : r.taken_at,
      destination: r.destination,
      encrypted: r.encrypted,
      size_bytes: r.size_bytes ?? null,
    };
  }
  private rowToRehearsal(r: any): RehearsalRecord {
    return {
      rehearsal_id: r.rehearsal_id,
      client_slug: r.client_slug,
      ran_at: r.ran_at instanceof Date ? r.ran_at.toISOString() : r.ran_at,
      result: r.result,
      restored_into: r.restored_into,
      db_queryable: r.db_queryable,
      pgvector_memory_complete: r.pgvector_memory_complete,
      auth_rows_complete: r.auth_rows_complete,
      measured_rto_seconds: r.measured_rto_seconds ?? null,
      trigger: r.trigger,
      detail: r.detail,
    };
  }
  private rowToPurgeState(r: any): PurgeFlagState {
    return {
      flag: {
        flag_id: r.flag_id,
        client_slug: r.client_slug,
        target_ref: r.target_ref,
        raised_at: r.raised_at instanceof Date ? r.raised_at.toISOString() : r.raised_at,
        erasure_effective_at: r.erasure_effective_at instanceof Date ? r.erasure_effective_at.toISOString() : r.erasure_effective_at,
      },
      status: r.status,
      received_at: r.received_at instanceof Date ? r.received_at.toISOString() : r.received_at,
      cleared_at: r.cleared_at ? (r.cleared_at instanceof Date ? r.cleared_at.toISOString() : r.cleared_at) : null,
      confirmed_by: r.confirmed_by ?? null,
    };
  }
}

/** The LIVE restore driver — reuses the GREEN AF-069 harness (spikes/issue-004-restore-rehearsal): pg_dump the
 *  latest off-platform snapshot → pg_restore `public` (memories + embeddings) into a fresh THROWAWAY Supabase
 *  project + load `auth.users` ROWS data-only into the target's managed auth schema (the Supabase-correct restore
 *  learned in the AF-069 run), then probe: memories count + embeddings dimension + a cosine query, auth.users
 *  resolvable. Measures the real RTO. NOT run offline — operator-present. */
export class Af069RestoreDriver implements RestoreDriver {
  constructor(
    private readonly runRestoreHarness: (client_slug: string) => Promise<RestoreProbe>,
  ) {}
  async restoreIntoThrowaway(client_slug: string): Promise<RestoreProbe> {
    // Delegates to the AF-069 harness runner (real pg_restore into a throwaway project). Never reports a pass on
    // an incomplete restore — the harness probes memories/embeddings/auth and reports the measured RTO honestly.
    return this.runRestoreHarness(client_slug);
  }
}

/** The LIVE purge driver — expires/rewrites the target's Personal data out of pre-erasure off-platform snapshots
 *  in the client-owned store (the AF-137 spike harness). NOT run offline. Reports honestly which snapshots held
 *  residue and which were cleared — never reports cleared on residue it did not purge (#1). */
export class Af137PurgeDriver implements PurgeDriver {
  constructor(
    private readonly runPurgeHarness: (input: { client_slug: string; target_ref: string; erasure_effective_at: string }) => Promise<PurgeDriverResult>,
  ) {}
  async purgeFromPreErasureSnapshots(input: { client_slug: string; target_ref: string; erasure_effective_at: string }): Promise<PurgeDriverResult> {
    return this.runPurgeHarness(input);
  }
}
