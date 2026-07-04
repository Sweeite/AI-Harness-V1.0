// ISSUE-004 build order step (path B, half 2 + path A): drive the restores.
//
// PATH B (the harness CAN drive this end-to-end): pg_restore the custom-format artifact from
// dump.ts into the THROWAWAY TARGET_DB_URL. We restore into an existing (empty) throwaway
// project's `postgres` database — pg_restore recreates the public + auth objects and reloads
// rows. `--no-owner --no-acl` (dump was taken the same way) so it lands cleanly regardless of
// the target's role names; `--clean --if-exists` so a re-run is idempotent.
//
// PATH A (the harness CANNOT drive this from a connection string — HONESTY CAVEAT): the
// in-project daily/PITR backup is restored by Supabase into a NEW project via the dashboard /
// Management API / PITR, NOT by piping a URL. So for path A the harness does NOT perform the
// restore; it EXPECTS the operator to have restored the in-project backup into a throwaway
// project out-of-band and to have given us TARGET_A_DB_URL. restorePathA() therefore only
// confirms the target is reachable (the restore already happened) and returns the measured
// out-of-band restore time the operator recorded (TARGET_A_RESTORE_MINUTES), so the SAME
// assertions in assert.ts can run against it. This keeps path A HONEST: we assert what was
// restored; we never claim to have driven a restore we structurally can't.

import { spawnSync } from 'node:child_process';
import type pg from 'pg';
import { q } from './db.js';

export interface RestoreResult {
  path: 'A' | 'B';
  performedByHarness: boolean; // B: true; A: false (operator restored out-of-band)
  command: string; // redacted invocation, or the manual-step note for path A
  note: string;
}

function redact(url: string): string {
  return url.replace(/:\/\/[^@]*@/, '://<redacted>@');
}

// Verify pg_restore is installed (fail loud — a #3 guard).
export function pgRestoreVersion(): string {
  const r = spawnSync('pg_restore', ['--version'], { encoding: 'utf8' });
  if (r.status !== 0 || r.error) {
    throw new Error(
      'pg_restore not found on PATH. Install the Postgres client tools (matching the server ' +
        'major version) and retry. See .env.example "TOOLING".',
    );
  }
  return r.stdout.trim();
}

// PATH B — restore the artifact into the throwaway target. This is the timed operation
// (rto.ts wraps the call); we return once pg_restore exits.
export function restorePathB(artifactPath: string, targetUrl: string): RestoreResult {
  const args = [
    '--no-owner',
    '--no-acl',
    '--clean',
    '--if-exists',
    '--exit-on-error',
    '--dbname',
    targetUrl,
    artifactPath,
  ];
  const printable = `pg_restore ${args.slice(0, -2).join(' ')} --dbname ${redact(
    targetUrl,
  )} ${artifactPath}`;

  const r = spawnSync('pg_restore', args, { encoding: 'utf8', stdio: 'inherit' });
  if (r.status !== 0 || r.error) {
    throw new Error(
      `pg_restore failed (exit ${r.status}). Command: ${printable}. ` +
        `Confirm TARGET_DB_URL is the DIRECT connection to a THROWAWAY project and the ` +
        `client version is >= the server major version.`,
    );
  }

  return {
    path: 'B',
    performedByHarness: true,
    command: printable,
    note: 'off-platform pg_dump (ADR-008 §2) restored via pg_restore into the throwaway target.',
  };
}

// PATH A — the operator restored the in-project backup out-of-band; we only confirm the
// target the operator handed us is reachable, so the assertions can run against it.
export async function restorePathA(targetAPool: pg.Pool): Promise<RestoreResult> {
  // A trivial round-trip proves the operator-restored project is up and we can query it.
  await q(targetAPool, 'select 1');
  return {
    path: 'A',
    performedByHarness: false,
    command:
      '(in-project backup restored OUT-OF-BAND by the operator via Supabase dashboard / ' +
      'Management API / PITR into a throwaway project; harness asserts against TARGET_A_DB_URL)',
    note:
      'Path A cannot be driven from a connection string — Supabase restores the in-project ' +
      'backup into a NEW project. The harness verifies + asserts against that restored target.',
  };
}
