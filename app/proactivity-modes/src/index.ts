// @harness/proactivity-modes — ISSUE-068 (C9 MODE) public surface + the `check` command. `check` is a no-DB,
// CI-safe gate that catches the drift/invariant breaks that must hold BY CONSTRUCTION before integration:
//   (1) NO ENUM DRIFT — the code's PROACTIVITY_MODES must EQUAL the live `proactive_mode` enum (0001 baseline
//       L79). A renamed/typo'd mode would make persistMode emit a value the DB rejects — a silent-failure of
//       the very stamp meant to make autonomy visible (#3).
//   (2) ACT UNREACHABLE IN THE MATRIX — no sub-type's code-default ceiling is Act, AND validateMatrixEdit
//       rejects an Act ceiling for EVERY sub-type (OD-161 / AC-9.MODE.004.1).
//   (3) FLOOR NON-DOWNGRADABLE — validateMatrixEdit rejects any floored-sub-type edit (AC-9.MODE.004.2), and
//       assignMode NEVER yields Act for a floored sub-type even under an Act-forcing matrix + auto tier
//       (AC-9.MODE.002.2 — the load-bearing #2).
// Run: `tsx src/index.ts check`.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  assignMode,
  validateMatrixEdit,
  FLOORED_SUBTYPES,
  PROACTIVITY_MODES,
  RISK_SUBTYPES,
  SUBTYPE_CEILING,
  type AutonomyMatrix,
} from './modes.ts';

// ── Public exports ──────────────────────────────────────────────────────────────────────────────────────
export * from './modes.ts';
export * from './store.ts';
export { SupabaseProactivityStore } from './supabase-store.ts';

// ── check ───────────────────────────────────────────────────────────────────────────────────────────────
const BASELINE = '0001_baseline.sql';

/** Extract the proactive_mode enum's value set from the 0001 baseline `create type proactive_mode as enum(...)`. */
function baselineProactiveModes(): Set<string> {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(here, '..', '..', 'silo', 'migrations', BASELINE);
  const sql = readFileSync(path, 'utf8');
  const m = sql.match(/create\s+type\s+proactive_mode\s+as\s+enum\s*\(([\s\S]*?)\)\s*;/i);
  if (!m) throw new Error(`${BASELINE}: could not locate the proactive_mode enum`);
  return new Set([...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!));
}

interface Finding {
  gate: string;
  ok: boolean;
  detail: string;
}

// A matrix that tries to force EVERY sub-type to Act — the adversary the floor + ceiling must resist.
const FORCE_ACT: AutonomyMatrix = { ceilingFor: () => 'act' };

function runChecks(): Finding[] {
  const findings: Finding[] = [];

  // (1) NO ENUM DRIFT — PROACTIVITY_MODES == the live proactive_mode enum, exactly (both directions).
  const enumValues = baselineProactiveModes();
  const codeModes = new Set<string>(PROACTIVITY_MODES);
  const missingInDb = [...codeModes].filter((m) => !enumValues.has(m));
  const missingInCode = [...enumValues].filter((m) => !codeModes.has(m));
  findings.push({
    gate: 'proactive_mode-enum-no-drift',
    ok: missingInDb.length === 0 && missingInCode.length === 0,
    detail:
      missingInDb.length === 0 && missingInCode.length === 0
        ? `PROACTIVITY_MODES == proactive_mode enum {${[...enumValues].join(',')}}`
        : `DRIFT — missing in DB: [${missingInDb.join(',')}]; missing in code: [${missingInCode.join(',')}] (#3: persistMode would emit a value the DB rejects).`,
  });

  // (2a) ACT UNREACHABLE — no sub-type's code-default ceiling is Act.
  const actDefault = RISK_SUBTYPES.filter((s) => SUBTYPE_CEILING[s] === 'act');
  findings.push({
    gate: 'no-subtype-ceiling-is-act',
    ok: actDefault.length === 0,
    detail: actDefault.length === 0 ? 'every SUBTYPE_CEILING ≤ Prepare (OD-161)' : `sub-types defaulting to Act: [${actDefault.join(',')}]`,
  });

  // (2b) ACT UNREACHABLE — validateMatrixEdit rejects an Act ceiling for EVERY sub-type (AC-9.MODE.004.1).
  const actAccepted = RISK_SUBTYPES.filter((s) => validateMatrixEdit(s, 'act').ok);
  findings.push({
    gate: 'matrix-write-rejects-act',
    ok: actAccepted.length === 0,
    detail: actAccepted.length === 0 ? 'validateMatrixEdit rejects Act for all sub-types (AC-9.MODE.004.1)' : `Act wrongly accepted for: [${actAccepted.join(',')}]`,
  });

  // (3a) FLOOR NON-DOWNGRADABLE — validateMatrixEdit rejects any floored-sub-type edit (AC-9.MODE.004.2).
  const flooredAccepted = FLOORED_SUBTYPES.filter((s) => validateMatrixEdit(s, 'prepare').ok || validateMatrixEdit(s, 'suggest').ok);
  findings.push({
    gate: 'matrix-write-rejects-floored-edit',
    ok: flooredAccepted.length === 0,
    detail: flooredAccepted.length === 0 ? 'validateMatrixEdit rejects every floored-sub-type edit (AC-9.MODE.004.2)' : `floored edit wrongly accepted for: [${flooredAccepted.join(',')}]`,
  });

  // (3b) FLOORED NEVER ACT — assignMode yields ≤ Prepare for every floored sub-type even under auto tier + an
  //      Act-forcing matrix (AC-9.MODE.002.2 / AC-9.MODE.004.5 — the load-bearing #2).
  const flooredAct = FLOORED_SUBTYPES.filter(
    (s) => assignMode({ hasAction: true, tier: 'auto', subType: s, matrix: FORCE_ACT }).mode === 'act',
  );
  // plus the ambiguity-forced floor:
  const ambiguousAct = assignMode({ hasAction: true, tier: 'auto', ambiguous: true, matrix: FORCE_ACT }).mode === 'act';
  findings.push({
    gate: 'floored-never-act',
    ok: flooredAct.length === 0 && !ambiguousAct,
    detail: flooredAct.length === 0 && !ambiguousAct ? 'no floored/ambiguous sub-type reaches Act under auto-tier + Act-forcing matrix' : `Act leaked for floored: [${flooredAct.join(',')}] ambiguous=${ambiguousAct}`,
  });

  return findings;
}

async function main(): Promise<void> {
  const findings = runChecks();
  let failed = 0;
  for (const f of findings) {
    const mark = f.ok ? 'PASS' : 'FAIL';
    if (!f.ok) failed++;
    console.log(`[${mark}] ${f.gate} — ${f.detail}`);
  }
  if (failed > 0) {
    console.error(`\n${failed} build-time gate(s) failed.`);
    process.exit(1);
  }
  console.log(`\nall ${findings.length} build-time gates passed.`);
}

// Run only when invoked as the CLI (tsx src/index.ts check), never on import.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && process.argv[2] === 'check') {
  void main();
}
