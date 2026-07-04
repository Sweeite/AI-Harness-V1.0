// ISSUE-004 build order step (path B, half 1): produce the off-platform logical `pg_dump`
// artifact(s) of the SOURCE — the ADR-008 §2 client-owned copy the rehearsal restores from.
//
// SUPABASE-CORRECT SPLIT (learned empirically, Session 55): a Supabase target has a MANAGED
// `auth` schema (217 objects owned by supabase_auth_admin) that the restoring `postgres` role
// may NOT drop/recreate — so a whole-database `pg_restore --clean` fails ("must be owner of
// table ...")). We therefore take TWO artifacts:
//   1. PUBLIC schema (structure + data): the `memories` table incl. its `extensions.vector(1536)`
//      embedding column — restored cleanly into the target's postgres-owned public schema.
//   2. auth.users DATA-ONLY: just the identity ROWS — loaded into the target's EXISTING (managed)
//      auth.users, so we never touch the managed auth schema structurally.
// This proves exactly what AF-069 asserts (pgvector memory + auth rows survive) without fighting
// Supabase's managed schema. `-Fc` custom format · --no-owner/--no-acl so it lands regardless of
// the target's role names. The harness NEVER hard-codes the connection string.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const resultsDir = join(here, '..', 'results');

export interface DumpResult {
  publicArtifact: string; // pg_dump of the public schema (memories + embeddings)
  authArtifact: string; // pg_dump --data-only --table=auth.users (the identity rows)
  bytes: number; // total size of both artifacts
  reused: boolean; // true if PGDUMP_ARTIFACT supplied the public artifact
  command: string; // the pg_dump invocations (URL redacted) — for the evidence trail
}

function redact(url: string): string {
  return url.replace(/:\/\/[^@]*@/, '://<redacted>@');
}

// Verify pg_dump is installed and print its version (fail loud if the client tools are
// missing — a #3 guard: never silently skip the dump).
export function pgDumpVersion(): string {
  const r = spawnSync('pg_dump', ['--version'], { encoding: 'utf8' });
  if (r.status !== 0 || r.error) {
    throw new Error(
      'pg_dump not found on PATH. Install the Postgres client tools (matching the server ' +
        'major version) and retry. See .env.example "TOOLING".',
    );
  }
  return r.stdout.trim();
}

function runPgDump(args: string[], sourceUrl: string, label: string): void {
  const r = spawnSync('pg_dump', args, { encoding: 'utf8', stdio: 'inherit' });
  if (r.status !== 0 || r.error) {
    throw new Error(
      `pg_dump (${label}) failed (exit ${r.status}). Check SOURCE_DB_URL is the DIRECT ` +
        `connection (port 5432) and the client version is >= the server major version. ` +
        `(${redact(sourceUrl)})`,
    );
  }
}

export function makeDump(sourceUrl: string, date: string): DumpResult {
  mkdirSync(resultsDir, { recursive: true });

  // (1) public schema — memories + embeddings. Optional pre-existing artifact via PGDUMP_ARTIFACT.
  const preexisting = process.env.PGDUMP_ARTIFACT;
  const publicArtifact = preexisting ?? join(resultsDir, `source-public.${date}.dump`);
  const reused = Boolean(preexisting);
  if (reused) {
    if (!existsSync(publicArtifact)) {
      throw new Error(`PGDUMP_ARTIFACT is set but the file does not exist: ${publicArtifact}`);
    }
  } else {
    runPgDump(
      ['--format=custom', '--no-owner', '--no-acl', '--schema=public', '--file', publicArtifact, sourceUrl],
      sourceUrl,
      'public schema (memories + embeddings)',
    );
  }

  // (2) auth.users rows only (data-only) — never the managed auth schema structure.
  const authArtifact = join(resultsDir, `source-authusers.${date}.dump`);
  runPgDump(
    ['--format=custom', '--no-owner', '--no-acl', '--data-only', '--table=auth.users', '--file', authArtifact, sourceUrl],
    sourceUrl,
    'auth.users rows (data-only)',
  );

  const bytes =
    (existsSync(publicArtifact) ? statSync(publicArtifact).size : 0) +
    (existsSync(authArtifact) ? statSync(authArtifact).size : 0);

  return {
    publicArtifact,
    authArtifact,
    bytes,
    reused,
    command: `pg_dump --schema=public + pg_dump --data-only --table=auth.users ${redact(sourceUrl)}`,
  };
}

export { resultsDir };
