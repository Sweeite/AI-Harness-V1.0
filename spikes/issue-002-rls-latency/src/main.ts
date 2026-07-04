// ISSUE-002 — SPIKE: RLS hot-path latency (AF-067 gate). Orchestrates the build order
// (§8) end to end: stand up → seed → index → measure → emit AF-067 evidence.

import { close, q } from './db.js';
import {
  createExtensions,
  ensureAuthUid,
  createPermTables,
  createHelpers,
  createMemories,
  createHnsw,
  setPolicy,
  dropAll,
} from './schema.js';
import { seed } from './seed.js';
import {
  measureInitPlan,
  measureCliff,
  lintInitPlan,
  measureP95,
  measurePlanner,
  rowCount,
} from './measure.js';
import { writeEvidence, verdictOf, type Evidence } from './report.js';
import { PROFILE } from './config.js';

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

async function env() {
  const v = await q<{ v: string }>(`select current_setting('server_version') as v`);
  let pgv = '(not installed)';
  try {
    const r = await q<{ extversion: string }>(
      `select extversion from pg_extension where extname='vector'`,
    );
    pgv = r.rows[0]?.extversion ?? '(not installed)';
  } catch {}
  return { serverVersion: v.rows[0].v, pgvector: pgv, efSearch: PROFILE.EF_SEARCH };
}

async function main() {
  const teardownOnly = process.argv.includes('--teardown-only');
  if (teardownOnly) {
    await dropAll();
    console.log('  torn down (all spike objects dropped).');
    await close();
    return;
  }

  console.log('\nISSUE-002 — RLS hot-path latency spike (AF-067)\n');

  console.log('  [0/6] connecting + reading environment…');
  const environment = await env();
  console.log(
    `        Postgres ${environment.serverVersion} · pgvector ${environment.pgvector}`,
  );
  if (environment.pgvector === '(not installed)') {
    throw new Error(
      'pgvector not available. On Supabase: Dashboard → Database → Extensions → enable "vector".',
    );
  }

  console.log('  [1/6] resetting spike objects (idempotent)…');
  await dropAll();
  await createExtensions();
  await ensureAuthUid();

  console.log('  [2/6] creating permission tables + helpers + memories table…');
  await createPermTables();
  await createHelpers();
  await createMemories();

  console.log(`  [3/6] seeding corpus (${PROFILE.N_MEMORIES.toLocaleString()} memories)…`);
  const { subjects } = await seed();

  console.log('  [4/6] building HNSW index on the loaded corpus…');
  await createHnsw();
  await q('analyze memories');
  await setPolicy('wrapped');
  console.log(`        rows in memories: ${(await rowCount()).toLocaleString()}`);

  console.log('  [5/6] measuring initPlan overhead + once-per-statement + lint…');
  const initPlan = await measureInitPlan(subjects);
  const lint = await lintInitPlan();
  console.log(
    `        initPlan ${initPlan.initPlanOverheadMs} ms/stmt · once-per-statement=${initPlan.oncePerStatement} · lint ${lint.pass ? 'PASS' : 'FAIL'}`,
  );
  console.log('        measuring the wrapped-vs-bare cliff (full-scan, ~1 min)…');
  const cliff = await measureCliff(subjects);
  console.log(
    `        cliff: wrapped ${cliff.wrappedFullScanMs} ms vs bare ${cliff.bareTimedOut ? '>timeout' : cliff.bareFullScanMs + ' ms'}`,
  );

  console.log('  [6/6] measuring planner (default vs index) + retrieval p95…');
  const planner = await measurePlanner(subjects);
  console.log(
    `        planner default ${planner.defaultPlannerMs} ms (seqscan=${planner.defaultUsesSeqScan}) → index ${planner.indexPathMs} ms (${planner.speedup}× — AF-019/ISSUE-023)`,
  );
  const p95 = await measureP95(subjects);
  console.log(`        p95 ${p95.p95} ms (n=${p95.n}, index path, server-side)`);

  const partial = { corpus: c(), initPlan, cliff, lint, p95, planner };
  const verdict = verdictOf(partial as any);
  const evidence: Evidence = {
    verdict,
    date: today(),
    env: environment,
    ...partial,
  };
  const { md } = writeEvidence(evidence);

  console.log('\n' + '─'.repeat(72));
  console.log(md);
  console.log('─'.repeat(72));
  console.log(
    `\n  Evidence written → results/af-067-evidence.${evidence.date}.{json,md}\n` +
      `  Verdict: ${verdict}. ` +
      (verdict === 'PASS'
        ? 'Paste the block into feasibility-register.md block G and flip AF-067 🔴→🟢.\n'
        : 'FAIL is a design fork — open an OD and consider the OOS-012 JWT-cache fallback (R2/R9).\n'),
  );

  await close();
}

function c() {
  return {
    memories: PROFILE.N_MEMORIES,
    users: PROFILE.N_USERS,
    roles: PROFILE.N_ROLES,
    entities: PROFILE.N_ENTITIES,
  };
}

main().catch(async (e) => {
  console.error('\n  SPIKE ERROR:', e instanceof Error ? e.message : e);
  await close().catch(() => {});
  process.exit(1);
});
