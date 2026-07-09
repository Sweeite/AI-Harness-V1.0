// ISSUE-023 / AF-019 spike — the measurements that make AF-019 PASS/FAIL for the ISSUE-023 GATE:
//   (A) the PLANNER CLIFF under the RLS predicate — default (seqscan) vs iterative_only vs the full ISSUE-023 contract.
//       This is the load-bearing one: it proves the contract FORCES the HNSW index under the clearance predicate,
//       resolving the ISSUE-002 ~308x seqscan cliff (the actual reason ISSUE-023 is the Stage-6 gate). Shows whether
//       iterative_scan alone tips the planner (it does NOT — enable_seqscan=off is the necessary lever).
//   (B) COMPLETENESS under the RLS predicate — does the contract return a FULL top-k of CLEARED rows for real users
//       (i.e. the clearance filter, applied AFTER the ANN scan, does not starve the result in the realistic case)?
//   (C) end-to-end retrieval p95 at the CFG default ef (server-side), against the NFR-PERF.003 budget.
//
// NOT measured here (honest scope): nearest-neighbour RANKING recall (does HNSW return the TRULY nearest cleared rows).
// That needs a REAL-embedding corpus — synthetic high-dim vectors suffer distance concentration (every point ~equidistant),
// so an exact-vs-HNSW id-overlap "recall" is an artifact, not a signal (the 2026-07-09 run-1/run-2 recall=0 was exactly
// this). Recall/relevance QUALITY at scale is AF-002 / ISSUE-025 (real embeddings) — carried as a residual, not faked.

import { asUser, q } from './db.js';
import { sampleProbe, topKIds, explainTopK } from './retrieval.js';
import { PROFILE, TARGETS } from './config.js';
import type { Subject } from './seed.js';

function round(n: number): number { return Math.round(n * 1000) / 1000; }

// Load the seeded subjects from the existing fixture (for --measure-only, which reuses the live corpus).
export async function loadSubjects(): Promise<Subject[]> {
  const r = await q<{ uid: string; role_id: number; aal: string }>(
    `select ur.user_id::text as uid, ur.role_id, au.aal from af019_user_roles ur join af019_app_users au on au.id = ur.user_id order by ur.role_id`,
  );
  return r.rows.map((x) => ({ uid: x.uid, roleId: x.role_id, aal: (x.aal === 'aal1' ? 'aal1' : 'aal2') }));
}

export interface ModePlan { mode: string; execMs: number; usesSeqScan: boolean; usesIndex: boolean; timedOut?: boolean }

// ---- (A) planner cliff -------------------------------------------------------------------------------------------
export async function measurePlannerCliff(subjects: Subject[]): Promise<{ heaviestRole: number; plans: ModePlan[]; speedupContractVsDefault: number | null }> {
  const s = subjects.find((x) => x.roleId === 6) ?? subjects[0]!; // super_admin/restricted — the fattest predicate.
  const probe = await sampleProbe();
  const plans: ModePlan[] = [];

  for (const mode of ['default', 'iterative_only', 'contract'] as const) {
    try {
      const p = await asUser(s.uid, s.aal, mode, PROFILE.EF_SWEEP[0]!, async (c) => {
        await c.query(`set local statement_timeout = '60000'`);
        return explainTopK(c, probe, PROFILE.TOP_K);
      });
      plans.push({ mode, execMs: round(p.execMs), usesSeqScan: p.usesSeqScan, usesIndex: p.usesIndex });
    } catch (e: any) {
      const timedOut = /statement timeout|canceling statement/i.test(e?.message ?? '');
      plans.push({ mode, execMs: 60000, usesSeqScan: true, usesIndex: false, timedOut });
      if (!timedOut) throw e;
    }
  }

  const def = plans.find((p) => p.mode === 'default')!;
  const con = plans.find((p) => p.mode === 'contract')!;
  const speedup = con.execMs > 0 ? round(def.execMs / con.execMs) : null;
  return { heaviestRole: s.roleId, plans, speedupContractVsDefault: speedup };
}

// ---- (B) completeness under RLS ----------------------------------------------------------------------------------
export interface CompletenessRow { role: number; clearedRows: number; contractReturned: number; expected: number; full: boolean }

export async function measureCompleteness(subjects: Subject[]): Promise<{ rows: CompletenessRow[]; allFull: boolean }> {
  const k = PROFILE.TOP_K;
  const byRole = new Map<number, Subject>();
  for (const s of subjects) if (!byRole.has(s.roleId)) byRole.set(s.roleId, s);

  const rows: CompletenessRow[] = [];
  for (const s of byRole.values()) {
    const probe = await sampleProbe();
    const { cleared, returned } = await asUser(s.uid, s.aal, 'contract', PROFILE.EF_SWEEP[0]!, async (c) => {
      const cr = await c.query<{ n: string }>('select count(*)::text as n from af019_memories');
      const ids = await topKIds(c, probe, k);
      return { cleared: Number(cr.rows[0]!.n), returned: ids.length };
    });
    const expected = Math.min(k, cleared);
    rows.push({ role: s.roleId, clearedRows: cleared, contractReturned: returned, expected, full: returned === expected });
    process.stdout.write(`\r  completeness role ${s.roleId}: cleared=${cleared} returned=${returned}/${expected}\n`);
  }
  return { rows, allFull: rows.every((r) => r.full) };
}

// ---- (C) p95 at the CFG default ef -------------------------------------------------------------------------------
export async function measureP95(subjects: Subject[], ef: number): Promise<{ n: number; p50: number; p95: number; p99: number; max: number; passP95: boolean }> {
  const iters = PROFILE.P95_ITERATIONS;
  const samples: number[] = [];
  for (let i = 0; i < iters; i++) {
    const s = subjects[i % subjects.length]!;
    const probe = await sampleProbe();
    const p = await asUser(s.uid, s.aal, 'contract', ef, async (c) => explainTopK(c, probe, PROFILE.TOP_K));
    samples.push(p.execMs);
    if (i % 20 === 0) process.stdout.write(`\r  p95 ${i}/${iters}`);
  }
  process.stdout.write('\n');
  const ms = samples.sort((a, b) => a - b);
  const pct = (p: number) => round(ms[Math.min(ms.length - 1, Math.floor((p / 100) * ms.length))]!);
  return { n: ms.length, p50: pct(50), p95: pct(95), p99: pct(99), max: round(ms[ms.length - 1]!), passP95: pct(95) < TARGETS.RETRIEVAL_P95_MS };
}

export async function rowCount(): Promise<number> {
  const r = await q<{ c: string }>('select count(*)::text as c from af019_memories');
  return Number(r.rows[0]!.c);
}
