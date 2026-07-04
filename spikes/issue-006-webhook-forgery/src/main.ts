// ISSUE-006 — entry point. Orchestrates the §8 order: read operator inputs → select MODE (M vs R by
// which env vars are present) → run the battery → compute the verdict → print a human summary → write
// the AF-078 evidence block. It REFUSES to claim a GREEN AF-078 in MODE M (mechanics only), and exits
// non-zero on FAIL (a red spike is a design fork, R2 — CI/the operator must see it loudly).
//
// This spike is R8 "you-present": the OPERATOR runs it (present) so the evidence is trustworthy. The
// builder does NOT run it and never fabricates evidence.

import { readOperatorInputs, selectMode } from './config.js';
import { runBattery } from './battery.js';
import { writeEvidence } from './report.js';

const EVIDENCE_DATE = '2026-07-04'; // spike run date (logical; deterministic)

function main(): void {
  console.log('ISSUE-006 — webhook forgery / replay rejected end-to-end (AF-078 gate)\n');

  const inputs = readOperatorInputs();
  const mode = selectMode(inputs);

  console.log(`MODE: ${mode} ${mode === 'R' ? '(real — operator GHL infra present)' : '(mechanics — self-contained; NO operator infra)'}`);
  if (mode === 'M') {
    console.log(
      'note: MODE M generates its own Slack secret, a THROWAWAY Ed25519 keypair to simulate GHL, and a\n' +
        '      local JWKS for Google. It proves the verifier LOGIC but CANNOT resolve AF-090 (the real GHL\n' +
        '      signing base string). To flip AF-078 GREEN, supply a live GHL payload + GHL public key (.env).',
    );
  } else {
    console.log('note: MODE R resolves AF-090 by confirming the GHL signing base string against the LIVE captured payload + real key.');
  }
  console.log('');

  const battery = runBattery(mode, inputs);

  console.log(`§8.0 discovered facts:`);
  console.log(`  GHL signing input (AF-090) ... ${battery.discovered.ghl_signing_input}`);
  console.log(`  GHL public key source ........ ${battery.discovered.ghl_public_key_source}`);
  console.log(`  Google expected audience ..... ${battery.discovered.google_expected_audience}`);
  console.log('');

  console.log('Per-case:');
  for (const r of battery.results) {
    console.log(`  ${r.passed ? '✅' : '❌'} ${r.id.padEnd(30)} [${r.connector}] ${r.cell} → HTTP ${r.gotStatus} (expect ${r.expect})`);
    if (!r.passed) console.log(`why       - ${r.note}`);
  }

  console.log('\nParse-before-verify proof (AC-0.WHK.005.1):');
  console.log(`  raw-first ingress verifies ........... ${battery.parseBeforeVerify.rawFirstVerifies ? '✅' : '❌'}`);
  console.log(`  parse-then-verify FAILS same sig ..... ${battery.parseBeforeVerify.parseThenVerifyFails ? '✅' : '❌'}`);

  const { mdPath, jsonPath, verdict } = writeEvidence(battery, EVIDENCE_DATE);

  console.log(`\n========================================`);
  console.log(`AF-078 VERDICT: ${verdict.verdict} ${verdict.green ? '🟢 GREEN' : verdict.verdict === 'PASS' ? '🟡 mechanics-only (NOT green)' : '⛔'}`);
  console.log(`  ${verdict.reason}`);
  console.log(`========================================`);
  console.log(`evidence: ${mdPath}`);
  console.log(`          ${jsonPath}`);

  if (verdict.verdict !== 'PASS') {
    console.error(
      '\n⛔ FAIL — a forged/replayed event verified, or the parse-before-verify proof did not hold. Per R2/ADR-007 ' +
        'this is a DESIGN FORK: close the path in code on ISSUE-017, log an OD, re-run. Do NOT patch with a detection rule.',
    );
    process.exit(1);
  }

  if (!verdict.green) {
    console.log(
      '\n🟡 MECHANICS PROVEN, AF-078 NOT GREEN. AF-090 / the GHL real-signature assertion is still owed. ' +
        'Run MODE R with the operator’s live GHL payload + public key to resolve AF-090 and flip AF-078 🔴→🟢. ' +
        'Do NOT log AF-078 GREEN off a MODE M run.',
    );
    // Intentionally exit 0: MODE M is a legitimate, complete mechanics pass — it just is not the gate.
  }
}

main();
