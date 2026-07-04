// ISSUE-004 build order step 5: time the end-to-end restore for each path and produce the
// MEASURED RTO number (AC-NFR-DR.005.1 — measured, not assumed). This spike is where the
// "minutes-to-hours, to be confirmed" RTO in backup-dr.md / NFR-DR.005 becomes a real number.
//
// RTO posture (ADR-008): restore-WITH-downtime, "minutes-to-hours, NOT instant" — there is no
// hot failover. So we time the restore operation itself:
//  - Path B: wall-clock around the pg_restore call (the harness drives it, so this is a fully
//    measured number).
//  - Path A: the operator restores the in-project backup out-of-band; the harness cannot time
//    an operation it doesn't run, so path A's RTO is the wall-clock the operator RECORDED via
//    TARGET_A_RESTORE_MINUTES. Still a measured number — measured by the operator during the
//    real restore — never an assumed one. If not supplied, path A RTO is reported as "not
//    recorded" rather than fabricated.

export interface Rto {
  path: 'A' | 'B';
  measured: boolean;
  seconds: number | null;
  source: 'harness-wall-clock' | 'operator-recorded' | 'not-recorded';
}

// Time a synchronous restore call the harness drives (path B). Returns the result and the
// measured seconds.
export function timeRestoreSync<T>(fn: () => T): { result: T; seconds: number } {
  const start = process.hrtime.bigint();
  const result = fn();
  const end = process.hrtime.bigint();
  const seconds = Number(end - start) / 1e9;
  return { result, seconds };
}

export function rtoForB(seconds: number): Rto {
  return { path: 'B', measured: true, seconds, source: 'harness-wall-clock' };
}

// Path A RTO from the operator-recorded minutes (TARGET_A_RESTORE_MINUTES), if present.
export function rtoForA(): Rto {
  const raw = process.env.TARGET_A_RESTORE_MINUTES;
  if (raw === undefined || raw === '') {
    return { path: 'A', measured: false, seconds: null, source: 'not-recorded' };
  }
  const minutes = Number.parseFloat(raw);
  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new Error(`TARGET_A_RESTORE_MINUTES must be a non-negative number, got: ${raw}`);
  }
  return { path: 'A', measured: true, seconds: minutes * 60, source: 'operator-recorded' };
}

export function fmtRto(rto: Rto): string {
  if (!rto.measured || rto.seconds === null) return 'not recorded';
  const s = rto.seconds;
  if (s < 90) return `${s.toFixed(1)} s`;
  const m = s / 60;
  if (m < 90) return `${m.toFixed(1)} min`;
  return `${(m / 60).toFixed(2)} h`;
}
