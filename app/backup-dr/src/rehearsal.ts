// ISSUE-085 — the operator-run restore-REHEARSAL job (NFR-DR.003 / ADR-008 part 4 / RP-2).
//
// "A backup exists" ≠ "a restore works." Supabase verifies nothing; the operator does. This module is the
// STANDING rehearsal LOGIC built ON TOP of the GREEN AF-069 (ISSUE-004 Path B — off-platform pg_dump→pg_restore
// proven: 5000/5000 memories + embeddings intact, 25/25 auth rows, measured RTO 19.4s). We do NOT re-run the
// live restore here — we drive it through a RestoreDriver port so the rehearsal orchestration is offline-testable
// and the live driver (backup-dr-live.ts) reuses the AF-069 harness.
//
// A rehearsal restores a recent snapshot into a THROWAWAY project (never production) and asserts three things
// come back complete & queryable (AC-NFR-DR.003.1): the DB, pgvector memory (embeddings dimension-correct), and
// auth.users rows. It logs result + timestamp + the MEASURED RTO (NFR-DR.005 — measured, never assumed). A
// missing/failed/stale rehearsal drives a LOUD alert (via backup-health.ts, AC-NFR-DR.003.2 → NFR-DR.006).
//
// ⚠️ Residuals owed-to-live (do NOT fake a pass): the ACTUAL live rehearsal run, AF-072 (LOAD — hourly dump at
// volume), and AF-069 Path A (in-project PITR restore) are operator-present. Offline we prove the orchestration:
// due-computation, the three completeness assertions gate a pass, a driver failure logs FAILED (never green),
// and the record is logged.

import { type RehearsalRecord, type RehearsalTrigger, type RehearsalResult } from './types.ts';

/** The restore driver — the seam over the AF-069 restore harness (real `pg_restore` into a throwaway project
 *  in the live adapter; a deterministic fake offline). Returns the completeness assertions + measured RTO. It
 *  must NEVER report a pass on a restore that did not actually come back complete (the #1 keystone). */
export interface RestoreDriver {
  /** Restore the most recent snapshot for `client_slug` into a fresh THROWAWAY project and probe completeness.
   *  The live impl reuses the GREEN AF-069 harness (spikes/issue-004-restore-rehearsal). */
  restoreIntoThrowaway(client_slug: string): Promise<RestoreProbe>;
}

/** What a restore probe reports back — the three completeness checks + the measured RTO. All three must be true
 *  for a rehearsal to PASS (AC-NFR-DR.003.1). `measured_rto_seconds` is the real elapsed restore time (NFR-DR.005). */
export interface RestoreProbe {
  throwaway_ref: string; // the throwaway project restored into (NOT production)
  db_queryable: boolean;
  pgvector_memory_complete: boolean; // memories + embeddings restored, dimension-correct, cosine-queryable
  auth_rows_complete: boolean; // auth.users rows restored + resolvable
  measured_rto_seconds: number; // MEASURED elapsed restore time
  detail: string;
}

/** A restore driver that THROWS or reports an incomplete restore must yield a FAILED rehearsal, never a silent
 *  green. This error type lets the orchestrator record a FAILED record when the driver itself blows up. */
export class RestoreDriverError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RestoreDriverError';
  }
}

let __rseq = 0;
const nextRehearsalId = () => `rehearsal-${String(++__rseq).padStart(4, '0')}`;

/** Run ONE restore rehearsal (NFR-DR.003). Restores into a throwaway project via the driver, gates a PASS on ALL
 *  THREE completeness assertions, records the measured RTO, and returns a logged RehearsalRecord. A driver throw
 *  or ANY failed completeness check → a FAILED record (never assumed-green — #1/#3). */
export async function runRehearsal(
  driver: RestoreDriver,
  input: { client_slug: string; trigger: RehearsalTrigger; serverNow: number },
): Promise<RehearsalRecord> {
  const ran_at = new Date(input.serverNow * 1000).toISOString();
  let probe: RestoreProbe | null = null;
  let driverError: string | null = null;
  try {
    probe = await driver.restoreIntoThrowaway(input.client_slug);
  } catch (e) {
    driverError = e instanceof Error ? e.message : String(e);
  }

  if (!probe) {
    // The restore harness itself failed — a FAILED rehearsal, logged loud, never a phantom pass (#1/#3).
    return {
      rehearsal_id: nextRehearsalId(),
      client_slug: input.client_slug,
      ran_at,
      result: 'failed',
      restored_into: '(restore-aborted)',
      db_queryable: false,
      pgvector_memory_complete: false,
      auth_rows_complete: false,
      measured_rto_seconds: null,
      trigger: input.trigger,
      detail: `restore driver failed: ${driverError} — rehearsal FAILED, restore is NOT proven (NFR-DR.003)`,
    };
  }

  const complete = probe.db_queryable && probe.pgvector_memory_complete && probe.auth_rows_complete;
  const result: RehearsalResult = complete ? 'passed' : 'failed';
  const missing: string[] = [];
  if (!probe.db_queryable) missing.push('DB not queryable');
  if (!probe.pgvector_memory_complete) missing.push('pgvector memory incomplete');
  if (!probe.auth_rows_complete) missing.push('auth.users rows incomplete');

  return {
    rehearsal_id: nextRehearsalId(),
    client_slug: input.client_slug,
    ran_at,
    result,
    restored_into: probe.throwaway_ref,
    db_queryable: probe.db_queryable,
    pgvector_memory_complete: probe.pgvector_memory_complete,
    auth_rows_complete: probe.auth_rows_complete,
    // a MEASURED RTO (NFR-DR.005). Only recorded on a pass (a failed/aborted restore has no valid RTO).
    measured_rto_seconds: complete ? probe.measured_rto_seconds : null,
    trigger: input.trigger,
    detail: complete
      ? `restore rehearsal PASSED — DB + pgvector + auth complete & queryable, measured RTO ${probe.measured_rto_seconds}s (NFR-DR.003 / NFR-DR.005)`
      : `restore rehearsal FAILED — ${missing.join('; ')}; "a backup exists" ≠ "a restore works" (NFR-DR.003)`,
  };
}

// ── cadence: monthly + on every schema-migration release (RP-2, NFR-DR.003) ──────────────────────────────

/** Approx month in seconds — the monthly-rehearsal cadence floor (NFR-DR.003). Slightly under 30d so a
 *  monthly job that runs on a fixed day-of-month is never judged "not yet due". */
export const MONTHLY_SECONDS = 60 * 60 * 24 * 30;

/** Is a rehearsal DUE? A rehearsal is due when EITHER a month has elapsed since the last one OR a
 *  schema-migration release has shipped since the last one (AC-NFR-DR.003.2). A never-rehearsed silo is ALWAYS
 *  due (and reads UNPROVEN loud until it runs). Returns the trigger that makes it due, or null if not due. */
export function rehearsalDue(input: {
  lastRehearsalAt: string | null;
  lastMigrationReleaseAt: string | null; // the most recent schema-migration release timestamp
  serverNow: number;
  monthlySeconds?: number;
}): RehearsalTrigger | null {
  const monthly = input.monthlySeconds ?? MONTHLY_SECONDS;
  // Never rehearsed → due now (monthly cadence, and restore is UNPROVEN until it runs).
  if (input.lastRehearsalAt === null) return 'monthly';
  const lastAt = Math.floor(Date.parse(input.lastRehearsalAt) / 1000);

  // A schema-migration release SINCE the last rehearsal makes it due (per-migration cadence).
  if (input.lastMigrationReleaseAt !== null) {
    const migAt = Math.floor(Date.parse(input.lastMigrationReleaseAt) / 1000);
    if (migAt > lastAt) return 'migration-release';
  }
  // A month elapsed since the last rehearsal makes it due (monthly cadence).
  if (input.serverNow - lastAt >= monthly) return 'monthly';
  return null;
}

export { nextRehearsalId };
