// ISSUE-023 / AF-019 spike — orchestrates the AF-019 LOAD gate end to end on an ISOLATED af019_ fixture:
//   stand up (af019_ tables + helpers + RLS) → seed 50k clustered → build HNSW → analyze → (A) planner cliff →
//   (B) completeness under RLS → (C) p95 → emit AF-019 evidence → teardown (drop only af019_* objects). Safe against
//   the live silo (af019_-prefixed, never touches real memories).
//
// RUN:  source ~/.ai-harness-secrets.env && DATABASE_URL="$SILO_DB_URL" npm run spike
//   measure only (reuse fixture):  DATABASE_URL="$SILO_DB_URL" npm run spike -- --measure-only
//   teardown only:                 DATABASE_URL="$SILO_DB_URL" npm run spike -- --teardown-only

import { close, q } from './db.js';
import { createExtensions, ensureAuthUid, createPermTables, createHelpers, createMemories, createHnsw, setPolicy, dropAll } from './schema.js';
import { seed, type Subject } from './seed.js';
import { measurePlannerCliff, measureCompleteness, measureP95, loadSubjects, rowCount } from './measure.js';
import { writeEvidence, verdictOf, type Evidence } from './report.js';
import { PROFILE } from './config.js';

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function env() {
  const v = await q<{ v: string }>(`select current_setting('server_version') as v`);
  let pgv = '(not installed)';
  try {
    const r = await q<{ extversion: string }>(`select extversion from pg_extension where extname='vector'`);
    pgv = r.rows[0]?.extversion ?? '(not installed)';
  } catch {}
  return { serverVersion: v.rows[0]!.v, pgvector: pgv };
}

async function main() {
  if (process.argv.includes('--teardown-only')) {
    await dropAll();
    console.log('  torn down (all af019_* objects dropped).');
    await close();
    return;
  }

  const measureOnly = process.argv.includes('--measure-only');
  console.log('\nISSUE-023 — AF-019 HNSW index-forcing + completeness under RLS (isolated af019_ fixture)\n');
  const environment = await env();
  console.log(`  env: Postgres ${environment.serverVersion} · pgvector ${environment.pgvector}${measureOnly ? ' · MEASURE-ONLY (reusing the existing fixture)' : ''}`);
  if (environment.pgvector === '(not installed)') throw new Error('pgvector not available on this DB.');

  let subjects: Subject[];
  if (measureOnly) {
    subjects = await loadSubjects();
    await setPolicy();
    console.log(`  reusing fixture: ${(await rowCount()).toLocaleString()} rows · ${subjects.length} subjects`);
  } else {
    console.log('  [1/6] resetting af019_ objects (idempotent)…');
    await dropAll();
    await createExtensions();
    await ensureAuthUid();

    console.log('  [2/6] creating af019_ permission tables + helpers + memories…');
    await createPermTables();
    await createHelpers();
    await createMemories();

    console.log(`  [3/6] seeding ${PROFILE.N_MEMORIES.toLocaleString()} clustered memories…`);
    ({ subjects } = await seed());

    console.log('  [4/6] building HNSW index (m=16, ef_construction=64) on the loaded corpus…');
    await createHnsw();
    await q('analyze af019_memories');
    await setPolicy();
    console.log(`        rows: ${(await rowCount()).toLocaleString()}`);
  }

  console.log('  (A) planner cliff (default vs iterative_only vs contract)…');
  const cliff = await measurePlannerCliff(subjects);
  for (const p of cliff.plans) console.log(`        ${p.mode.padEnd(15)} ${p.timedOut ? '>60s' : p.execMs + ' ms'}  seqscan=${p.usesSeqScan} index=${p.usesIndex}`);
  console.log(`        contract vs default: ${cliff.speedupContractVsDefault}×`);

  console.log('  (B) completeness under RLS (no starvation) + (C) p95…');
  const completeness = await measureCompleteness(subjects);
  console.log(`        all roles full = ${completeness.allFull}`);
  const p95 = await measureP95(subjects, PROFILE.EF_SWEEP[0]!);
  console.log(`        p95 ${p95.p95} ms (n=${p95.n})`);

  const partial = { corpus: { memories: PROFILE.N_MEMORIES, users: PROFILE.N_USERS, roles: PROFILE.N_ROLES, entities: PROFILE.N_ENTITIES }, cliff, completeness, p95 };
  const verdict = verdictOf(partial as any);
  const evidence: Evidence = { verdict, date: today(), env: environment, ...partial };
  const { md } = writeEvidence(evidence);

  console.log('\n' + '─'.repeat(72));
  console.log(md);
  console.log('─'.repeat(72));
  console.log(`\n  Evidence → results/af-019-evidence.${evidence.date}.{json,md}`);
  console.log(`  Verdict: ${verdict}. ${verdict === 'PASS' ? 'Flip AF-019 🔴→🟢 in the feasibility register + set CFG-ef_search production default.' : 'FAIL is a design fork (OD), not a code workaround (R2).'}`);
  console.log(`  Teardown: DATABASE_URL="$SILO_DB_URL" npm run spike -- --teardown-only\n`);

  await close();
}

main().catch(async (e) => {
  console.error('\n  SPIKE ERROR:', e instanceof Error ? e.message : e);
  await close().catch(() => {});
  process.exit(1);
});
