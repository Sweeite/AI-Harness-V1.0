// ISSUE-003 — entry point. Assert boot config → run the battery → compute global checks →
// print a human summary → write the AF-068 evidence block. Exit non-zero on FAIL (a red spike is
// a design fork, R2 — CI/the operator must see it loudly).

import { BOOT_CONFIG } from './config.js';
import { runBattery } from './redteam.js';
import { writeEvidence, verdict, type GlobalChecks } from './report.js';

const EVIDENCE_DATE = '2026-07-04'; // spike run date (deterministic; no Date.now in the harness)

function main(): void {
  console.log('ISSUE-003 — injection-containment red-team (AF-068 gate)\n');

  // Boot assertion (AC-NFR-SEC.006.3) — semantic detector off by default.
  const semanticOff = BOOT_CONFIG.injection_semantic_detection_enabled === false;
  console.log(`boot: injection_semantic_detection_enabled = ${BOOT_CONFIG.injection_semantic_detection_enabled}  → ${semanticOff ? 'OK (off by default)' : 'FAIL'}`);

  const { results, store } = runBattery();

  // Global checks.
  const attacks = results.filter((r) => r.kind === 'attack');
  const negs = results.filter((r) => r.kind === 'negative_control');
  const hardLimitRows = store.guardrailLog.filter((r) => r.guardrail_type === 'hard_limit');
  const evasionReached = results.filter(
    (r) => r.kind === 'attack' && r.checks.find((c) => c.name === 'reached_model')?.ok,
  ).length;

  const g: GlobalChecks = {
    semantic_off: semanticOff,
    no_hard_limit_approved: hardLimitRows.every((r) => r.status !== 'approved'),
    all_attacks_contained: attacks.every((r) => r.checks.find((c) => c.name === 'contained')?.ok),
    all_attacks_logged: attacks.every((r) => (r.checks.find((c) => c.name === 'guardrail_logged') ? r.checks.find((c) => c.name === 'guardrail_logged')!.ok : true)),
    all_negatives_succeeded: negs.every((r) => r.passed),
    evasion_reached_model: evasionReached,
  };

  // Print per-payload summary.
  console.log('\nPer-payload:');
  for (const r of results) {
    const mark = r.passed ? '✅' : '❌';
    console.log(`  ${mark} ${r.id}  ${r.cell}`);
    for (const c of r.checks) if (!c.ok) console.log(`why       - FAILED ${c.name}: ${c.detail}`);
  }

  const v = verdict(results, g);
  console.log('\nGlobal checks:');
  console.log(`  semantic detector off ............ ${g.semantic_off ? '✅' : '❌'}`);
  console.log(`  no hard_limit row approved ....... ${g.no_hard_limit_approved ? '✅' : '❌'}`);
  console.log(`  all attacks contained ............ ${g.all_attacks_contained ? '✅' : '❌'} (${attacks.filter((r) => r.checks.find((c) => c.name === 'contained')?.ok).length}/${attacks.length})`);
  console.log(`  all attacks logged loudly ........ ${g.all_attacks_logged ? '✅' : '❌'}`);
  console.log(`  negative controls succeed ........ ${g.all_negatives_succeeded ? '✅' : '❌'} (${negs.filter((r) => r.passed).length}/${negs.length})`);
  console.log(`  evasion payloads reached model ... ${g.evasion_reached_model} (contained anyway)`);

  const { mdPath, jsonPath } = writeEvidence(results, g, store, EVIDENCE_DATE);

  console.log(`\n========================================`);
  console.log(`AF-068 VERDICT: ${v} ${v === 'PASS' ? '🟢' : '⛔'}`);
  console.log(`========================================`);
  console.log(`evidence: ${mdPath}`);
  console.log(`          ${jsonPath}`);

  if (v !== 'PASS') {
    console.error('\n⛔ FAIL — a bypass path exists. Per R2/ADR-007 this is a DESIGN FORK: close the path in code on the owning ISSUE-055/059/020, log an OD, re-run. Do NOT patch with a detection rule.');
    process.exit(1);
  }
}

main();
