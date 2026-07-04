// ISSUE-004 — SPIKE: restore actually works (DB + pgvector + auth). Orchestrates the §8 build
// order end to end: read env → (seed source if empty) → dump → restore (A and/or B) → assert
// → time (RTO) → emit AF-069 evidence → print verdict + teardown reminder.
//
// R8 "you-present" spike: this exercises the OPERATOR's REAL Supabase infra + backup-ops
// credentials. main() REFUSES to run and prints exactly which env vars are missing rather than
// silently "passing" with no infra (a #3 silent-failure guard). Nothing here is fabricated;
// results/ holds only PENDING.md until a real operator-present run writes the evidence.

import 'dotenv/config';
import type pg from 'pg';
import { poolFor, readEnv, closeAll } from './db.js';
import { PROFILE, pathsFromEnv, REQUIRED_ENV } from './config.js';
import { seedSourceIfEmpty } from './seed.js';
import { pgDumpVersion, makeDump } from './dump.js';
import { pgRestoreVersion, restorePathB, restorePathA } from './restore.js';
import { assertRestored } from './assert.js';
import { rtoForA, rtoForB, timeRestoreSync, type Rto } from './rto.js';
import { writeEvidence, verdictOf, type Evidence, type PathEvidence } from './report.js';

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

// Gate: refuse to run without the infra this spike needs. Returns the reason string if the
// run must be refused, or null if it may proceed.
function refusalReason(): string | null {
  const missingAlways = REQUIRED_ENV.always.filter((k) => !process.env[k]);
  const hasTarget = REQUIRED_ENV.atLeastOneTarget.some((k) => process.env[k]);
  if (missingAlways.length === 0 && hasTarget) return null;

  const lines: string[] = [];
  if (missingAlways.length > 0) {
    lines.push(`  missing (required): ${missingAlways.join(', ')}`);
  }
  if (!hasTarget) {
    lines.push(
      `  need at least ONE restore target: ${REQUIRED_ENV.atLeastOneTarget.join(' or ')}`,
    );
  }
  return lines.join('\n');
}

async function teardownReminder(): Promise<void> {
  console.log(
    '\n  TEARDOWN REMINDER (do this manually — this spike never deletes a project):\n' +
      '   • Delete the THROWAWAY target project(s) in the Supabase dashboard (they now hold a\n' +
      '     full restore of the source, incl. auth rows). Disposable by design.\n' +
      '   • Delete the local dump artifact in results/*.dump (it may contain real client data).\n' +
      '   • Leave the SOURCE project as-is (the harness only seeded it if it was empty).\n',
  );
}

async function main() {
  const teardown = process.argv.includes('--teardown');
  if (teardown) {
    // The harness has NO destructive teardown to run itself — deleting a throwaway Supabase
    // project and the local dump is an operator action (we must never auto-delete infra). We
    // print the exact checklist instead.
    console.log('\nISSUE-004 — restore-rehearsal spike · teardown checklist\n');
    await teardownReminder();
    return;
  }

  console.log('\nISSUE-004 — restore-rehearsal spike (AF-069) — R8 you-present\n');

  const reason = refusalReason();
  if (reason) {
    console.error(
      '  REFUSING TO RUN — this is a "you-present" spike; it needs the operator\'s real\n' +
        '  Supabase infra + backup-ops credentials. It will NOT fabricate a pass with no infra.\n\n' +
        reason +
        '\n\n  Copy .env.example → .env and fill in the connection strings, then re-run.\n' +
        '  (SOURCE_DB_URL is always required; supply TARGET_DB_URL for path B and/or\n' +
        '   TARGET_A_DB_URL for path A — see .env.example for exactly what each is.)\n',
    );
    process.exit(2);
  }

  const paths = pathsFromEnv();
  const date = today();
  const pools: pg.Pool[] = [];

  try {
    // [0] connect + read environment ------------------------------------------------------
    console.log('  [0/6] connecting + reading environment…');
    const source = poolFor(process.env.SOURCE_DB_URL!, 'SOURCE_DB_URL');
    pools.push(source);
    const sourceEnv = await readEnv(source);
    console.log(`        source: Postgres ${sourceEnv.serverVersion} · pgvector ${sourceEnv.pgvector}`);
    if (sourceEnv.pgvector === '(not installed)') {
      throw new Error(
        'pgvector not enabled on SOURCE. Supabase → Database → Extensions → enable "vector".',
      );
    }

    // Verify client tools up-front if we'll drive path B (fail loud before doing work).
    if (paths.B) {
      console.log(`        ${pgDumpVersion()} · ${pgRestoreVersion()}`);
    }

    // [1] seed source if empty ------------------------------------------------------------
    console.log('  [1/6] ensuring the source holds representative data (seed if empty)…');
    const seed = await seedSourceIfEmpty(source);
    console.log(
      `        source ${seed.seeded ? 'was empty — seeded' : 'already had data'}: ` +
        `${seed.memoriesCount.toLocaleString()} memories · ${seed.authUsersCount} auth.users`,
    );

    // Path evidence accumulators.
    let pathA: PathEvidence = { exercised: false, rto: { path: 'A', measured: false, seconds: null, source: 'not-recorded' } };
    let pathB: PathEvidence = { exercised: false, rto: { path: 'B', measured: false, seconds: null, source: 'not-recorded' } };
    let targetAEnv: { serverVersion: string; pgvector: string } | undefined;
    let targetBEnv: { serverVersion: string; pgvector: string } | undefined;

    // [2–5] PATH B: dump → restore → assert → time ---------------------------------------
    if (paths.B) {
      console.log('  [2/6] PATH B — pg_dump of source (off-platform copy, ADR-008 §2)…');
      const dump = makeDump(process.env.SOURCE_DB_URL!, date);
      console.log(
        `        ${dump.reused ? 'using pre-existing artifact' : 'dumped'}: ` +
          `${dump.artifactPath} (${(dump.bytes / 1e6).toFixed(2)} MB)`,
      );

      const target = poolFor(process.env.TARGET_DB_URL!, 'TARGET_DB_URL');
      pools.push(target);
      targetBEnv = await readEnv(target);

      console.log('  [3/6] PATH B — pg_restore into throwaway target (timed)…');
      const { result: restore, seconds } = timeRestoreSync(() =>
        restorePathB(dump.artifactPath, process.env.TARGET_DB_URL!),
      );
      const rtoB: Rto = rtoForB(seconds);
      console.log(`        restored in ${seconds.toFixed(1)} s (measured RTO, harness wall-clock)`);

      console.log('  [4/6] PATH B — asserting completeness + queryability…');
      const assertions = await assertRestored('B', source, target);
      for (const a of assertions.assertions) {
        console.log(`        ${a.pass ? '✅' : '❌'} ${a.name} — ${a.detail}`);
      }
      pathB = { exercised: true, restore, assertions, rto: rtoB };
    } else {
      console.log('  [2-4/6] PATH B — skipped (TARGET_DB_URL not set).');
    }

    // PATH A: operator restored the in-project backup out-of-band; assert against it -------
    if (paths.A) {
      console.log('  [5/6] PATH A — asserting against operator-restored in-project backup…');
      const targetA = poolFor(process.env.TARGET_A_DB_URL!, 'TARGET_A_DB_URL');
      pools.push(targetA);
      targetAEnv = await readEnv(targetA);
      const restore = await restorePathA(targetA);
      const assertions = await assertRestored('A', source, targetA);
      for (const a of assertions.assertions) {
        console.log(`        ${a.pass ? '✅' : '❌'} ${a.name} — ${a.detail}`);
      }
      const rtoA = rtoForA();
      console.log(
        `        path-A RTO: ${rtoA.measured ? (rtoA.seconds! / 60).toFixed(1) + ' min (operator-recorded)' : 'not recorded (set TARGET_A_RESTORE_MINUTES)'}`,
      );
      pathA = { exercised: true, restore, assertions, rto: rtoA };
    } else {
      console.log('  [5/6] PATH A — skipped (TARGET_A_DB_URL not set; in-project backup not restored out-of-band).');
    }

    // [6] emit evidence -------------------------------------------------------------------
    console.log('  [6/6] emitting AF-069 evidence…');
    const partial: Omit<Evidence, 'verdict'> = {
      date,
      env: { source: sourceEnv, targetA: targetAEnv, targetB: targetBEnv },
      corpus: {
        memories: seed.memoriesCount,
        authUsers: seed.authUsersCount,
        embedDim: PROFILE.EMBED_DIM,
        seeded: seed.seeded,
      },
      pathA,
      pathB,
    };
    const verdict = verdictOf(partial);
    const evidence: Evidence = { verdict, ...partial };
    const { md } = writeEvidence(evidence);

    console.log('\n' + '─'.repeat(72));
    console.log(md);
    console.log('─'.repeat(72));
    console.log(
      `\n  Evidence written → results/af-069-evidence.${date}.{json,md}\n` +
        `  Verdict: ${verdict}. ` +
        (verdict === 'PASS'
          ? 'Paste the block into feasibility-register.md block I and flip AF-069 🔴→🟢.\n'
          : 'FAIL is a #1 catastrophe → open a launch-blocking OD; the design does not proceed (R2/R9/RP-1).\n'),
    );

    await teardownReminder();
  } finally {
    await closeAll(pools);
  }
}

main().catch(async (e) => {
  console.error('\n  SPIKE ERROR:', e instanceof Error ? e.message : e);
  process.exit(1);
});
