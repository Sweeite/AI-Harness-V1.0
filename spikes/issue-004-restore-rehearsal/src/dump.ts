// ISSUE-004 build order step (path B, half 1): produce the off-platform logical `pg_dump`
// artifact of the SOURCE — the ADR-008 §2 client-owned copy the rehearsal restores from.
//
// Either:
//  - accept a pre-existing artifact via env PGDUMP_ARTIFACT (the operator already has an
//    off-platform copy), or
//  - shell out to `pg_dump` against SOURCE_DB_URL into results/.
//
// We use the CUSTOM format (-Fc): it is compressed, restorable with pg_restore, and lets us
// selectively restore (schemas, parallel jobs). We dump BOTH the public schema (memories +
// embeddings) AND the auth schema (auth.users) — the whole point of the rehearsal is that
// both survive. The harness NEVER hard-codes the connection string; it takes SOURCE_DB_URL
// from the environment and passes it to pg_dump.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const resultsDir = join(here, '..', 'results');

export interface DumpResult {
  artifactPath: string;
  bytes: number;
  reused: boolean; // true if PGDUMP_ARTIFACT supplied, false if we generated it
  command: string; // the pg_dump invocation (URL redacted) — for the evidence trail
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

export function makeDump(sourceUrl: string, date: string): DumpResult {
  const preexisting = process.env.PGDUMP_ARTIFACT;
  if (preexisting) {
    if (!existsSync(preexisting)) {
      throw new Error(`PGDUMP_ARTIFACT is set but the file does not exist: ${preexisting}`);
    }
    return {
      artifactPath: preexisting,
      bytes: statSync(preexisting).size,
      reused: true,
      command: `(pre-existing artifact supplied via PGDUMP_ARTIFACT)`,
    };
  }

  mkdirSync(resultsDir, { recursive: true });
  const artifactPath = join(resultsDir, `source-dump.${date}.dump`);

  // -Fc custom format · include public + auth schemas · --no-owner/--no-acl so it restores
  // cleanly into a fresh throwaway project whose roles differ from the source.
  const args = [
    '--format=custom',
    '--no-owner',
    '--no-acl',
    '--schema=public',
    '--schema=auth',
    '--file',
    artifactPath,
    sourceUrl,
  ];
  const printable = `pg_dump ${args.slice(0, -1).join(' ')} ${redact(sourceUrl)}`;

  const r = spawnSync('pg_dump', args, { encoding: 'utf8', stdio: 'inherit' });
  if (r.status !== 0 || r.error) {
    throw new Error(
      `pg_dump failed (exit ${r.status}). Command: ${printable}. ` +
        `Check SOURCE_DB_URL is the DIRECT connection (port 5432) and the client version ` +
        `is >= the server major version.`,
    );
  }

  return {
    artifactPath,
    bytes: existsSync(artifactPath) ? statSync(artifactPath).size : 0,
    reused: false,
    command: printable,
  };
}

export { resultsDir };
