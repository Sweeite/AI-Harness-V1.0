// ISSUE-002 build order step 7: emit the AF-067 evidence block (fields a–h, mirroring the
// ISSUE-001 AF-001 block) → results/af-067-evidence.<date>.{json,md}. Paste the markdown
// into feasibility-register.md block G and flip AF-067 🔴→🟢 on PASS.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PROFILE, TARGETS } from './config.js';

const here = dirname(fileURLToPath(import.meta.url));
const resultsDir = join(here, '..', 'results');

export type Evidence = {
  verdict: 'PASS' | 'FAIL';
  date: string;
  env: { serverVersion: string; pgvector: string; efSearch: number };
  corpus: { memories: number; users: number; roles: number; entities: number };
  initPlan: Awaited<ReturnType<typeof import('./measure.js').measureInitPlan>>;
  cliff: Awaited<ReturnType<typeof import('./measure.js').measureCliff>>;
  lint: Awaited<ReturnType<typeof import('./measure.js').lintInitPlan>>;
  p95: Awaited<ReturnType<typeof import('./measure.js').measureP95>>;
  planner: Awaited<ReturnType<typeof import('./measure.js').measurePlanner>>;
};

export function verdictOf(e: Omit<Evidence, 'verdict' | 'date' | 'env'> & { env?: any }): 'PASS' | 'FAIL' {
  return e.initPlan.passOverhead && e.initPlan.oncePerStatement && e.lint.pass && e.p95.passP95
    ? 'PASS'
    : 'FAIL';
}

export function writeEvidence(e: Evidence): { json: string; md: string } {
  const status = e.verdict === 'PASS' ? '🟢' : '⛔';
  const json = JSON.stringify(e, null, 2);

  const md = `### AF-067 evidence — RLS hot-path latency spike (ISSUE-002)

**(a) Verdict:** ${e.verdict} → status ${status}
**(b) Date / method:** ${e.date} · SPIKE+LOAD (property-holds-at-scale, ≤~20-user/silo envelope)
**(b′) Environment:** Postgres ${e.env.serverVersion} · pgvector ${e.env.pgvector} · ef_search=${e.env.efSearch} · HNSW (vector_cosine_ops)

**(c) Declared corpus profile (the load basis — contestable by design):**
- ${e.corpus.memories.toLocaleString()} memories · ${e.corpus.users} users · ${e.corpus.roles} roles · ${e.corpus.entities} entities
- ADR-001 envelope: tiny, fully-indexed permission tables (why the live-RLS lookup is plausible); the memory batch is the contestable number.
- Distribution: visibility 60/30/10 global/team/private · sensitivity 70/20/10 normal/personal/restricted.
- Measured under the HEAVIEST predicate (a restricted-clearance subject exercising all four helpers).

**(d) initPlan overhead + once-per-statement (AC-NFR-PERF.001.1):**
- Wrapped \`(select …)\` policy: initPlan overhead **${e.initPlan.initPlanOverheadMs} ms/statement** vs < ${TARGETS.INITPLAN_MS_PER_STATEMENT} ms target → ${e.initPlan.passOverhead ? 'PASS' : 'FAIL'}
- initPlan Actual Loops = ${JSON.stringify(e.initPlan.initPlanLoops)} → once-per-statement: **${e.initPlan.oncePerStatement ? 'confirmed' : 'NOT confirmed'}** (each helper's initPlan runs exactly once, not per row)
- Index-path retrieval execution (server-side): ${e.initPlan.executionMs} ms

**(d′) The wrapped-vs-bare cliff — why the \`(select …)\` rule is binding:** isolated with \`select count(*) from memories\` over ${e.corpus.memories.toLocaleString()} rows (no vector distance to mask the signal — the query's cost IS the per-row predicate evaluation):
- Wrapped (each helper's initPlan runs once per statement): ${e.cliff.wrappedFullScanMs} ms
- Bare (helpers re-evaluated once per row, ~4×${e.corpus.memories.toLocaleString()} calls): ${
    e.cliff.bareTimedOut
      ? `**exceeded the ${e.cliff.bareTimeoutMs} ms statement timeout** — the per-row cliff, confirmed`
      : `${e.cliff.bareFullScanMs} ms → **${e.cliff.cliffFactor}× slower** than wrapped`
  }
- Helpers read tiny fully-indexed tables, so the ratio is smaller than Supabase's headline expensive-helper benchmark (178,000→12 ms); the direction and mechanism are identical — the wrapper is what keeps it once-per-statement.

**(e) auth_rls_initplan lint — splinter 0003 replica (AC-NFR-PERF.001.2):** ${e.lint.pass ? 'PASS' : 'FAIL'}
- policy \`${e.lint.policy}\`; violations: ${e.lint.violations.length ? e.lint.violations.join('; ') : 'none (every auth/helper call wrapped in (select …))'}

**(f) End-to-end retrieval p95 — production-intended index path (AC-NFR-PERF.003.2):**
- n=${e.p95.n} · min ${e.p95.min} · p50 ${e.p95.p50} · **p95 ${e.p95.p95} ms** · p99 ${e.p95.p99} · max ${e.p95.max} · mean ${e.p95.mean} (all ms)
- vs < ${TARGETS.RETRIEVAL_P95_MS} ms target → ${e.p95.passP95 ? 'PASS' : 'FAIL'}
- restricted-user (fattest predicate) p95: ${e.p95.restrictedUserP95 ?? 'n/a'} ms

**(f′) ⚠️ SURFACED FINDING → AF-019 / ISSUE-023 (NOT an AF-067 failure, but a hard build requirement):**
The RLS clearance predicate does not slow the initPlan — but it changes the pgvector planner's
choice. **By default the planner mis-costs the filtered vector search and falls back to a full Seq
Scan: ${e.planner.defaultPlannerMs} ms** (uses seqscan: ${e.planner.defaultUsesSeqScan}). Forced onto
the HNSW index it is **${e.planner.indexPathMs} ms** (uses seqscan: ${e.planner.indexPathUsesSeqScan})
— a **${e.planner.speedup}× cliff**. The HNSW index composes correctly with RLS; the planner just
won't pick it under a filter without help. **ISSUE-023 MUST guarantee the vector index is used under
the clearance predicate** (partial indexes / cost tuning / \`hnsw.iterative_scan\`), or every retrieval
is seconds and the product is non-viable. This is exactly the AF-019 "pgvector applies RLS after the
ANN scan" risk — now demonstrated real on ${e.corpus.memories.toLocaleString()} rows.

**(g) Scope note:** LATENCY only. Relevance/ranking quality = AF-002/ISSUE-025; HNSW recall-under-RLS starvation + production ef_search = AF-019/ISSUE-023 (see f′); aal2/RLS-coverage completeness = AF-076/AF-079. Random embeddings (correct for a latency measurement).

**(h) On ⛔ FAIL — documented fallback:** the D2 JWT-claim cache (rejected primary; retained as fallback → OOS-012), accepting a staleness window. A FAIL is a design fork (OD), not a bug to code around (ISSUE-002 §9 / R2).
`;

  writeFileSync(join(resultsDir, `af-067-evidence.${e.date}.json`), json);
  writeFileSync(join(resultsDir, `af-067-evidence.${e.date}.md`), md);
  return { json, md };
}

export { resultsDir };
