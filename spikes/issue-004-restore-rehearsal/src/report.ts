// ISSUE-004 build order step 6–7: emit the AF-069 evidence block (fields a–h, mirroring the
// AF-067/AF-068 house style) → results/af-069-evidence.<date>.{json,md} AT RUN TIME ONLY.
// Paste the markdown block into feasibility-register.md block I and flip AF-069 🔴→🟢 on PASS.
//
// IMPORTANT: this file is only ever invoked by main.ts during a real operator-present run.
// Until then results/ holds only PENDING.md — no fabricated evidence.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { AssertionSet } from './assert.js';
import type { RestoreResult } from './restore.js';
import type { Rto } from './rto.js';
import { fmtRto } from './rto.js';
import { PROFILE } from './config.js';

const here = dirname(fileURLToPath(import.meta.url));
const resultsDir = join(here, '..', 'results');

export interface PathEvidence {
  exercised: boolean;
  restore?: RestoreResult;
  assertions?: AssertionSet;
  rto: Rto;
}

export interface Evidence {
  verdict: 'PASS' | 'FAIL';
  date: string;
  env: {
    source: { serverVersion: string; pgvector: string };
    targetB?: { serverVersion: string; pgvector: string };
    targetA?: { serverVersion: string; pgvector: string };
  };
  corpus: { memories: number; authUsers: number; embedDim: number; seeded: boolean };
  pathA: PathEvidence;
  pathB: PathEvidence;
}

// AF-069 PASS = at least one path exercised end-to-end AND every assertion of every EXERCISED
// path passed. A path that wasn't exercised is neither a pass nor a fail — it's simply not
// part of the evidence (recorded honestly as "not exercised"). If NO path was exercised the
// run never reaches here (main.ts refuses without a target).
export function verdictOf(e: Omit<Evidence, 'verdict'>): 'PASS' | 'FAIL' {
  const exercised = [e.pathA, e.pathB].filter((p) => p.exercised);
  if (exercised.length === 0) return 'FAIL';
  return exercised.every((p) => p.assertions?.pass === true) ? 'PASS' : 'FAIL';
}

function assertionLines(a: AssertionSet | undefined): string {
  if (!a) return '  - (path not exercised)';
  return a.assertions
    .map((x) => `  - ${x.pass ? '✅' : '❌'} \`${x.name}\` — ${x.detail}`)
    .join('\n');
}

function pathBlock(label: string, p: PathEvidence): string {
  if (!p.exercised) {
    return `- **${label}: NOT EXERCISED** this run (no connection string supplied). Recorded honestly as not-proven — not as a pass. To include it, set the relevant env var (see .env.example) and re-run.`;
  }
  const a = p.assertions;
  return (
    `- **${label}: ${a?.pass ? 'PASS ✅' : 'FAIL ❌'}** — ${p.restore?.note ?? ''}\n` +
    `  - restore: ${p.restore?.performedByHarness ? 'driven by harness' : 'operator out-of-band'} · \`${p.restore?.command ?? ''}\`\n` +
    `  - counts: memories restored ${a?.counts.targetMemories ?? '?'} / source ${a?.counts.sourceMemories ?? '?'} · auth.users restored ${a?.counts.targetAuthUsers ?? '?'} / source ${a?.counts.sourceAuthUsers ?? '?'}\n` +
    assertionLines(a) +
    `\n  - **measured RTO: ${fmtRto(p.rto)}** (${p.rto.source})`
  );
}

export function writeEvidence(e: Evidence): { json: string; md: string } {
  const status = e.verdict === 'PASS' ? '🟢' : '⛔';
  const json = JSON.stringify(e, null, 2);

  const envLine = (x?: { serverVersion: string; pgvector: string }) =>
    x ? `Postgres ${x.serverVersion} · pgvector ${x.pgvector}` : '(not exercised)';

  const md = `### AF-069 evidence — restore-rehearsal spike (ISSUE-004)

**(a) Verdict:** ${e.verdict} → status ${status}
**(b) Date / method:** ${e.date} · SPIKE — restore rehearsal (a REAL, logged restore of a recent backup into a throwaway project; the launch go/no-go gate, test-strategy.md §4). First manual run of the standing rehearsal AC-NFR-DR.003.2 (the automated cadence lands in ISSUE-085).
**(b′) Environment:**
- Source: ${envLine(e.env.source)}
- Path-A target (in-project backup, restored out-of-band): ${envLine(e.env.targetA)}
- Path-B target (off-platform pg_dump → pg_restore): ${envLine(e.env.targetB)}

**(c) Corpus / profile (the restore basis — contestable by design):**
- ${e.corpus.memories.toLocaleString()} \`memories\` rows with \`vector(${e.corpus.embedDim})\` embeddings · ${e.corpus.authUsers} \`auth.users\` rows${e.corpus.seeded ? ' (seeded by the harness into an empty source)' : ' (pre-existing in source)'}.
- A few-thousand-row corpus makes the restore MEANINGFUL (embeddings + identity survive, similarity query works) without a multi-hour dump. Restore CORRECTNESS is what AF-069 proves; whether the hourly dump fits-the-hour AT SCALE is AF-072 (ISSUE-085), out of scope here.

**(d) Path A — in-project PITR/daily backup → throwaway project (AC-NFR-DR.003.1):**
${pathBlock('Path A (in-project backup)', e.pathA)}

**(e) Path B — off-platform \`pg_dump\` → \`pg_restore\` into throwaway (AC-NFR-DR.003.1):**
${pathBlock('Path B (off-platform pg_dump)', e.pathB)}

**(f) MEASURED RTO (AC-NFR-DR.005.1 — measured, not assumed):**
- Path A: **${fmtRto(e.pathA.rto)}** (${e.pathA.rto.source})
- Path B: **${fmtRto(e.pathB.rto)}** (${e.pathB.rto.source})
- Posture (ADR-008): restore-WITH-downtime, minutes-to-hours, NOT instant — no hot failover. This run is where that number becomes MEASURED.

**(g) Scope note:** RESTORE CORRECTNESS + measured RTO only, run ONCE by hand and logged. OUT OF SCOPE (ISSUE-004 §2, owned by ISSUE-085): the STANDING automated rehearsal cadence + lapse/stale alert wiring · scheduling the hourly off-platform dump + client-owned-destination provisioning (ISSUE-007) · whether the hourly dump fits-the-hour at scale (AF-072, LOAD) · Management-API backup-health payload (AF-070) · region/residency confirmation (AF-071, DOCS) · off-platform purge-on-erasure (NFR-DR.009 / AF-137). A missing/failed/stale rehearsal being a LOUD alert is asserted here only as the first manual log entry; the alert wiring is ISSUE-085.

**(h) On ⛔ FAIL — documented fork (R2 / R9 / RP-1):** a backup that does not restore complete + queryable is a **non-negotiable #1 catastrophe** (knowledge lost). AF-069 STAYS 🔴, a **launch-blocking OD is opened**, and the DESIGN DOES NOT PROCEED — the backup/DR mechanism (ADR-008) must change and re-rehearse before go-live. ISSUE-085 stays blocked. A FAIL is a design fork, not a bug to code around.

**Log entry (AC-NFR-DR.003.2 — first manual rehearsal):** rehearsal run ${e.date}; verdict ${e.verdict}; paths exercised: ${[e.pathA.exercised ? 'A' : null, e.pathB.exercised ? 'B' : null].filter(Boolean).join(' + ') || 'none'}.
`;

  writeFileSync(join(resultsDir, `af-069-evidence.${e.date}.json`), json);
  writeFileSync(join(resultsDir, `af-069-evidence.${e.date}.md`), md);
  return { json, md };
}

export { resultsDir };
