// ISSUE-004 build order step (path B, half 2 + path A): drive the restores.
//
// PATH B (harness-driven end-to-end) — SUPABASE-CORRECT strategy (Session 55, learned empirically):
// a Supabase target's `auth` schema is MANAGED (owned by supabase_auth_admin); the restoring
// `postgres` role cannot drop/recreate it, so a whole-DB `pg_restore --clean` fails. Instead:
//   1. Ensure `extensions.vector` exists on the target (the memories.embedding column type; Supabase
//      installs pgvector in the `extensions` schema).
//   2. Restore the PUBLIC schema (memories + embeddings) — postgres owns public, so --clean is fine.
//   3. Load the auth.users ROWS (data-only) into the target's EXISTING auth.users — never touching
//      the managed auth schema structurally.
// This proves AF-069 (pgvector memory + auth rows survive a restore) without fighting the managed
// schema. `--no-owner --no-acl` so it lands regardless of the target's role names.
//
// PATH A (harness CANNOT drive from a connection string — HONESTY CAVEAT): the in-project daily/PITR
// backup is restored by Supabase into a NEW project via the dashboard / Management API / PITR. So the
// harness does NOT perform path A; it asserts against a target the operator restored out-of-band
// (TARGET_A_DB_URL) and uses the operator-recorded restore time.

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

// PATH B — restore the two artifacts into the throwaway target. This is the timed operation
// (rto.ts wraps the call); we return once both pg_restore steps exit.
export function restorePathB(publicArtifact: string, authArtifact: string, targetUrl: string): RestoreResult {
  // (1) Ensure the pgvector type exists where the dump references it (extensions.vector).
  const ext = spawnSync(
    'psql',
    [targetUrl, '-v', 'ON_ERROR_STOP=1', '-c', 'create extension if not exists vector with schema extensions;'],
    { encoding: 'utf8', stdio: 'inherit' },
  );
  if (ext.status !== 0 || ext.error) {
    throw new Error(
      'failed to ensure the pgvector extension on the target (needed for memories.embedding = ' +
        `extensions.vector). ${ext.error?.message ?? ''}`.trim(),
    );
  }

  // (2) Restore the PUBLIC schema (memories + embeddings). postgres owns public → --clean is safe.
  const pub = spawnSync(
    'pg_restore',
    ['--no-owner', '--no-acl', '--clean', '--if-exists', '--exit-on-error', '--dbname', targetUrl, publicArtifact],
    { encoding: 'utf8', stdio: 'inherit' },
  );
  if (pub.status !== 0 || pub.error) {
    throw new Error(
      `pg_restore (public schema) failed (exit ${pub.status}) into ${redact(targetUrl)}. ` +
        'Confirm TARGET_DB_URL is the DIRECT connection to a THROWAWAY project and pg client >= server major.',
    );
  }

  // (3) Load the auth.users ROWS (data-only) into the target's existing managed auth.users.
  //     Clear any prior rows first so the restore is idempotent (mirrors --clean on public) — a
  //     re-run into the same throwaway target otherwise hits duplicate-key. The target is a
  //     disposable throwaway (README), so clearing its auth.users is safe.
  const clr = spawnSync('psql', [targetUrl, '-v', 'ON_ERROR_STOP=1', '-c', 'delete from auth.users;'], {
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (clr.status !== 0 || clr.error) {
    throw new Error(
      `failed to clear the target auth.users before the data-only load (exit ${clr.status}). ` +
        'The target must be a THROWAWAY project whose auth.users postgres may delete.',
    );
  }
  const au = spawnSync(
    'pg_restore',
    ['--no-owner', '--no-acl', '--data-only', '--exit-on-error', '--dbname', targetUrl, authArtifact],
    { encoding: 'utf8', stdio: 'inherit' },
  );
  if (au.status !== 0 || au.error) {
    throw new Error(
      `pg_restore (auth.users data-only) failed (exit ${au.status}) into ${redact(targetUrl)}. ` +
        'The target auth.users must be present + writable by postgres (Supabase grants this).',
    );
  }

  return {
    path: 'B',
    performedByHarness: true,
    command:
      `psql "create extension vector" + pg_restore --clean public + ` +
      `pg_restore --data-only auth.users → --dbname ${redact(targetUrl)}`,
    note:
      'Supabase-correct restore: public schema (memories + embeddings) restored via pg_restore; ' +
      'auth.users ROWS loaded data-only into the target’s managed auth schema (the 217-object ' +
      'managed auth schema, owned by supabase_auth_admin, is never restored structurally).',
  };
}

// PATH A — the operator restored the in-project backup out-of-band; we only confirm the
// target the operator handed us is reachable, so the assertions can run against it.
export async function restorePathA(targetAPool: pg.Pool): Promise<RestoreResult> {
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
