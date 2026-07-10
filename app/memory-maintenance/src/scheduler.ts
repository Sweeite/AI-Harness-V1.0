// ISSUE-027 (C2 MNT) — FR-2.MNT.015: the maintenance scheduler + run log. It runs the documented jobs on their
// cadences and LOGS EVERY RUN — time, outcome, records-affected — so no maintenance job ever runs or fails
// silently. A failure is caught, logged LOUD (outcome:'failed' + the error string) AND alerted, never swallowed
// (#3). The completion-rate metric flags when work piles up, and producer liveness (NFR-OBS.005) makes a STOPPED
// producer read 'stale', never a carried-forward green.
//
// The scheduler RUNTIME (the actual cron/loops/watchdog firing) is a C7 seam (ISSUE-011) — this slice provides the
// run-wrapper + the run-log + the liveness/completion metric the runtime drives; it does not own the timer.

import type { MaintenanceConfig } from './config.ts';
import type { JobCadence, JobRunRecord, MaintenanceJob, MaintenanceStore } from './store.ts';

/** What a job's body returns — the count + a human detail, plus an optional zero-work flag (the empty-audit case). */
export interface JobResult {
  recordsAffected: number;
  detail: string;
  flaggedEmpty?: boolean;
}

/** The stale window per cadence: a producer overdue past this reads 'stale', never green (NFR-OBS.005). Each window
 *  is the cadence interval + a grace factor (~1.5×) so a single late run is not a false-stale but a stopped
 *  producer is caught. */
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
export const STALE_WINDOW_MS: Readonly<Record<JobCadence, number>> = Object.freeze({
  real_time: 15 * MIN,
  daily: Math.round(1.5 * DAY),
  weekly: Math.round(1.5 * 7 * DAY),
  monthly: Math.round(1.5 * 30 * DAY),
});

export type ProducerHealth = 'green' | 'stale';

/**
 * The maintenance scheduler. `run()` wraps a job body: it stamps start/finish, records the outcome, emits the
 * FR-2.MNT.015 run record (ALWAYS — ok, failed, or empty), and on failure emits a loud job_failure alert. It tracks
 * a per-job heartbeat for producer liveness. It never rethrows — one failing job must not stop the cadence — but
 * the failure is fully surfaced (#3).
 */
export class MaintenanceScheduler {
  private readonly heartbeat = new Map<MaintenanceJob, number>();
  private readonly runs: JobRunRecord[] = [];

  constructor(
    private readonly store: MaintenanceStore,
    private readonly cfg: MaintenanceConfig,
  ) {
    void this.cfg;
  }

  async run(job: MaintenanceJob, cadence: JobCadence, body: () => Promise<JobResult>, nowMs: number = Date.now()): Promise<JobRunRecord> {
    const startedAt = new Date(nowMs).toISOString();
    this.heartbeat.set(job, nowMs); // the producer ran — heartbeat stamped whether it succeeds or errors
    let record: JobRunRecord;
    try {
      const res = await body();
      const record0: JobRunRecord = {
        job,
        cadence,
        startedAt,
        finishedAt: new Date(Date.now()).toISOString(),
        outcome: 'ok',
        recordsAffected: res.recordsAffected,
        detail: res.detail,
      };
      record = res.flaggedEmpty ? { ...record0, flaggedEmpty: true } : record0;
    } catch (e) {
      const error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      record = {
        job,
        cadence,
        startedAt,
        finishedAt: new Date(Date.now()).toISOString(),
        outcome: 'failed',
        recordsAffected: 0,
        detail: `job '${job}' FAILED — surfaced + alerted, not swallowed`,
        error,
      };
      // Loud alert — the failure is never silent (#3 / AC-2.MNT.015.2).
      await this.store.alert({ kind: 'job_failure', memoryIds: [], detail: `maintenance job '${job}' (${cadence}) failed: ${error}`, at: record.finishedAt });
    }
    this.runs.push(record);
    await this.store.jobRun(record); // ALWAYS logged (AC-2.MNT.015.1) — ok, failed, or empty
    return record;
  }

  /** Producer liveness (NFR-OBS.005): a job never run, or overdue past its cadence stale-window, reads 'stale'. A
   *  stalled producer NEVER reads green — "no signal" is not "all clear". */
  producerHealth(job: MaintenanceJob, cadence: JobCadence, nowMs: number = Date.now()): ProducerHealth {
    const last = this.heartbeat.get(job);
    if (last === undefined) return 'stale'; // never ran → stale/unknown, not green
    return nowMs - last > STALE_WINDOW_MS[cadence] ? 'stale' : 'green';
  }

  /** FR-2.MNT.015 completion-rate metric: ok runs / total runs over the recorded window. A backlog (many failed or
   *  no runs) drives it down, flagging that work is piling up. Returns 1 when nothing has run yet is WRONG (that
   *  would read green on no data) — so with zero runs it returns null (unknown/stale), never a false 1.0. */
  completionRate(): number | null {
    if (this.runs.length === 0) return null; // no data ≠ 100% healthy (#3)
    const ok = this.runs.filter((r) => r.outcome === 'ok').length;
    return ok / this.runs.length;
  }

  recordedRuns(): JobRunRecord[] {
    return this.runs.map((r) => ({ ...r }));
  }
}

/**
 * The weekly Haiku-gate sampled-drop audit (FR-2.ING.001 / OD-036) — the maintenance-side run record. Even a week
 * with ZERO sampled drops reviewed still returns a logged, FLAGGED result (AC-2.MNT.015.3) — a missed/empty audit
 * is never silently skipped.
 */
export function runHaikuGateAudit(sampledDropsReviewed: number): JobResult {
  if (sampledDropsReviewed === 0) {
    return { recordsAffected: 0, detail: 'weekly Haiku-gate sampled-drop audit — ZERO drops reviewed this week (flagged missed/empty, not silently skipped)', flaggedEmpty: true };
  }
  return { recordsAffected: sampledDropsReviewed, detail: `weekly Haiku-gate sampled-drop audit — ${sampledDropsReviewed} sampled drops reviewed` };
}
