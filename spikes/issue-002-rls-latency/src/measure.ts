// ISSUE-002 build order step 6: the measurements that make AF-067 PASS/FAIL. Three
// DISTINCT phenomena, kept separate so nothing is conflated:
//
//   (a) initPlan overhead + once-per-statement (AC-NFR-PERF.001.1) — the AF-067 core.
//   (a′) the wrapped-vs-bare cliff — WHY the `(select …)` rule exists (per-row vs once).
//   (b) the auth_rls_initplan lint replica (splinter 0003)          (AC-NFR-PERF.001.2).
//   (c) end-to-end retrieval p95, server-side                       (AC-NFR-PERF.003.2).
//   (c′) planner default(seqscan)-vs-index cliff — the AF-019 / ISSUE-023 handoff.
//
// Latencies are SERVER-SIDE Execution Time (EXPLAIN ANALYZE), not client wall-clock: the
// SLO is DB-side retrieval latency; client↔DB network is deployment-topology dependent
// (production colocates app + DB) and would otherwise dominate a remote-spike measurement.

import { pool, q, asUser } from './db.js';
import { setPolicy, type PolicyMode } from './schema.js';
import { retrieve, explainHotpath } from './retrieval.js';
import { PROFILE, TARGETS } from './config.js';
import type { Subject } from './seed.js';

type PlanNode = {
  ['Node Type']?: string;
  ['Subplan Name']?: string;
  ['Actual Total Time']?: number;
  ['Actual Loops']?: number;
  ['Plans']?: PlanNode[];
};

function walk(node: PlanNode, visit: (n: PlanNode) => void): void {
  visit(node);
  for (const c of node['Plans'] ?? []) walk(c, visit);
}

function initPlanStats(plan: PlanNode): { overheadMs: number; loops: number[] } {
  let overheadMs = 0;
  const loops: number[] = [];
  walk(plan, (n) => {
    if (/InitPlan/i.test(n['Subplan Name'] ?? '')) {
      overheadMs += n['Actual Total Time'] ?? 0;
      loops.push(n['Actual Loops'] ?? 0);
    }
  });
  return { overheadMs, loops };
}

// ---- (a) initPlan overhead + once-per-statement ------------------------------
// Measured on the INDEX path: the InitPlan helpers are evaluated once per statement
// regardless of scan type, and the index path isolates their cost from the AF-019 scan.

export async function measureInitPlan(subjects: Subject[]) {
  const heavy = subjects.find((s) => s.roleId === 6) ?? subjects[0];
  await setPolicy('wrapped');

  const plan = await asUser(
    heavy.uid,
    heavy.aal,
    async (client) => {
      await explainHotpath(client); // warmup
      return explainHotpath(client);
    },
    { forceIndex: true },
  );
  const stats = initPlanStats(plan['Plan'] as PlanNode);
  // Once-per-statement = no initPlan runs more than once. A loop count of 0 means that
  // initPlan short-circuited (AND/OR) and never ran — still not per-row. Per-row evaluation
  // would show loops = (rows scanned) ≫ 1. So the test is: every initPlan loops ≤ 1.
  const oncePerStatement = stats.loops.length > 0 && stats.loops.every((l) => l <= 1);

  return {
    initPlanOverheadMs: round(stats.overheadMs),
    initPlanLoops: stats.loops,
    executionMs: round(plan['Execution Time'] as number),
    oncePerStatement,
    passOverhead: stats.overheadMs < TARGETS.INITPLAN_MS_PER_STATEMENT,
  };
}

// ---- (a′) the wrapped-vs-bare cliff ------------------------------------------
// Isolated with a plain `select count(*) from memories` full scan — NO vector distance to
// swamp the signal. This query's cost IS the per-row RLS predicate evaluation: bare calls
// the four helpers once PER ROW (~4×50k calls — the 178,000ms→12ms footgun), wrapped runs
// each helper's initPlan once per statement. The delta is the cliff, cleanly attributable
// to the `(select …)` wrapper. (Helpers here read tiny fully-indexed tables, so the ratio
// is smaller than Supabase's headline expensive-helper benchmark — reported honestly.)
const CLIFF_SQL = `explain (analyze, timing off, format json) select count(*) from memories`;

export async function measureCliff(subjects: Subject[]) {
  const heavy = subjects.find((s) => s.roleId === 6) ?? subjects[0];

  const wrapped = await runCliff('wrapped', heavy, 60_000);
  const bare = await runCliff('bare', heavy, 60_000);
  await setPolicy('wrapped'); // restore production policy

  return {
    wrappedFullScanMs: wrapped.ms,
    bareFullScanMs: bare.timedOut ? null : bare.ms,
    bareTimedOut: bare.timedOut,
    bareTimeoutMs: 60_000,
    cliffFactor:
      !bare.timedOut && wrapped.ms > 0 ? round(bare.ms / wrapped.ms) : null,
  };
}

async function runCliff(
  mode: PolicyMode,
  s: Subject,
  timeoutMs: number,
): Promise<{ ms: number; timedOut: boolean }> {
  await setPolicy(mode);
  try {
    return await asUser(s.uid, s.aal, async (client) => {
      await client.query(`set local statement_timeout = '${timeoutMs}'`);
      const r = await client.query(CLIFF_SQL);
      const plan = (r.rows[0] as any)['QUERY PLAN'][0];
      return { ms: round(plan['Execution Time'] as number), timedOut: false };
    });
  } catch (e: any) {
    if (/statement timeout|canceling statement/i.test(e?.message ?? '')) {
      return { ms: timeoutMs, timedOut: true };
    }
    throw e;
  }
}

// ---- (b) auth_rls_initplan lint replica (splinter 0003) ----------------------

const GUARDED_CALLS = [
  'auth.uid()',
  'user_visibility(',
  'user_clearances(',
  'user_restricted(',
  'user_aal(',
];

// Character spans of every `(select … )` subquery in `qual`, matched by balanced parens.
function subquerySpans(qual: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const re = /\(\s*select\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(qual)) !== null) {
    const start = m.index; // the '('
    let depth = 0;
    for (let i = start; i < qual.length; i++) {
      if (qual[i] === '(') depth++;
      else if (qual[i] === ')') {
        depth--;
        if (depth === 0) {
          spans.push([start, i + 1]);
          break;
        }
      }
    }
  }
  return spans;
}

export async function lintInitPlan() {
  await setPolicy('wrapped');
  const res = await q<{ policyname: string; qual: string }>(
    `select policyname, qual from pg_policies
     where tablename = 'memories' and policyname = 'memories_clearance'`,
  );
  const row = res.rows[0];
  const qual = (row?.qual ?? '').toLowerCase();

  // Compute the character spans covered by a `(select … )` subquery (balanced parens). A
  // guarded call is safe iff every occurrence sits inside one of those spans — this matches
  // splinter 0003's intent (the call is inside a scalar subquery → per-statement initPlan)
  // and correctly handles auth.uid() nested as an argument to a wrapped helper.
  const spans = subquerySpans(qual);
  const inSpan = (i: number) => spans.some(([a, b]) => i >= a && i < b);

  const violations: string[] = [];
  for (const call of GUARDED_CALLS) {
    const needle = call.toLowerCase();
    let idx = qual.indexOf(needle);
    while (idx !== -1) {
      if (!inSpan(idx)) violations.push(`${call} not wrapped in (select …)`);
      idx = qual.indexOf(needle, idx + needle.length);
    }
  }
  return {
    pass: violations.length === 0,
    policy: row?.policyname ?? '(none)',
    qual: row?.qual ?? '',
    violations: [...new Set(violations)],
  };
}

// ---- (c′) planner default-vs-index (AF-019 handoff) --------------------------

export async function measurePlanner(subjects: Subject[]) {
  await setPolicy('wrapped');
  const s = subjects.find((x) => x.roleId === 6) ?? subjects[0];

  const probe = async (opts: { forceIndex?: boolean }) =>
    asUser(
      s.uid,
      s.aal,
      async (c) => {
        if (!opts.forceIndex) await c.query(`set local statement_timeout = '40000'`);
        const p = await explainHotpath(c, false);
        return { exec: p['Execution Time'] as number, seq: /Seq Scan/.test(JSON.stringify(p)) };
      },
      opts,
    );

  const def = await probe({});
  const idx = await probe({ forceIndex: true });
  return {
    defaultPlannerMs: round(def.exec),
    defaultUsesSeqScan: def.seq,
    indexPathMs: round(idx.exec),
    indexPathUsesSeqScan: idx.seq,
    speedup: idx.exec > 0 ? round(def.exec / idx.exec) : null,
  };
}

// ---- (c) end-to-end retrieval p95, server-side, on the index path ------------
// One dedicated session connection (GUCs set once → ~2 round-trips/iteration instead of 7).
// We record server-side Execution Time via EXPLAIN (ANALYZE, TIMING OFF).

export async function measureP95(subjects: Subject[]) {
  await setPolicy('wrapped');
  const iterations = PROFILE.ITERATIONS;
  const warmup = 10;
  const samples: { ms: number; roleId: number }[] = [];

  const client = await pool.connect();
  try {
    await client.query('set role authenticated');
    await client.query('set hnsw.ef_search = ' + PROFILE.EF_SEARCH);
    await client.query(`set hnsw.iterative_scan = 'relaxed_order'`);
    await client.query('set enable_seqscan = off');

    for (let i = 0; i < warmup + iterations; i++) {
      const s = subjects[i % subjects.length];
      const claims = JSON.stringify({ sub: s.uid, role: 'authenticated', aal: s.aal });
      await client.query('select set_config($1,$2,false)', ['request.jwt.claims', claims]);
      const plan = await explainHotpath(client, false);
      if (i >= warmup) {
        samples.push({ ms: plan['Execution Time'] as number, roleId: s.roleId });
      }
      if (i % 25 === 0) process.stdout.write(`\r  retrieval ${i}/${warmup + iterations}`);
    }
    process.stdout.write('\n');
  } finally {
    await client.query('reset role').catch(() => {});
    client.release();
  }

  const ms = samples.map((s) => s.ms).sort((a, b) => a - b);
  const pct = (p: number) => round(ms[Math.min(ms.length - 1, Math.floor((p / 100) * ms.length))]);

  const byRole: Record<number, number[]> = {};
  for (const s of samples) (byRole[s.roleId] ??= []).push(s.ms);
  const restrictedP95 = byRole[6] ? pctOf(byRole[6], 95) : null;

  return {
    n: ms.length,
    min: round(ms[0]),
    p50: pct(50),
    p95: pct(95),
    p99: pct(99),
    max: round(ms[ms.length - 1]),
    mean: round(ms.reduce((a, b) => a + b, 0) / ms.length),
    restrictedUserP95: restrictedP95,
    passP95: pct(95) < TARGETS.RETRIEVAL_P95_MS,
  };
}

function pctOf(arr: number[], p: number): number {
  const s = [...arr].sort((a, b) => a - b);
  return round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]);
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export async function rowCount(): Promise<number> {
  const r = await q<{ c: string }>('select count(*)::text as c from memories');
  return Number(r.rows[0].c);
}
