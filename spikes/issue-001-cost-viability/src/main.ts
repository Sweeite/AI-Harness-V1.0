/**
 * ISSUE-001 cost-viability spike — entrypoint.
 *
 * Runs one representative multi-agent task + drives memory events through the ADR-003 §4 write
 * path, captures real per-vendor tokens/$ (round-up), extrapolates to $/day against the declared
 * profile, compares to the thresholds, and writes the AF-001 evidence block.
 *
 *   npm run spike       — REAL paid calls (needs ANTHROPIC_API_KEY + OPENAI_API_KEY)
 *   npm run spike:dry   — mock tokens, no spend, exercises the whole flow (never PASSes)
 *
 * Non-negotiable #3 (never fail silently): any cost_unknown is surfaced; a dry run can never
 * yield a PASS.
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { CostLedger } from './ledger.js';
import { runTask } from './task.js';
import { writeMemory } from './memoryWrite.js';
import { TASK_PROMPT, MEMORY_EVENTS } from './corpus.js';
import { TYPICAL_PROFILE } from './profile.js';
import { extrapolateDaily, type PerUnitCosts } from './extrapolate.js';
import { verdictFor, THRESHOLDS, type Verdict } from './thresholds.js';
import { buildEvidence } from './report.js';
import { DRY_RUN } from './vendors.js';

const GLYPH: Record<Verdict, string> = {
  PASS: '🟢',
  FAIL: '🔴',
  'OVER-SOFT-ALERT': '🔴',
};

function sumUsdBySuffix(ledger: CostLedger, suffix: string): number {
  return ledger.all().filter((e) => e.label.endsWith(suffix)).reduce((s, e) => s + e.usd, 0);
}
function shapeBySuffix(ledger: CostLedger, suffix: string) {
  const rows = ledger.all().filter((e) => e.label.endsWith(suffix));
  return {
    sonnet: rows.filter((e) => e.model === 'sonnet').length,
    haiku: rows.filter((e) => e.model === 'haiku').length,
    embedding: rows.filter((e) => e.model === 'text-embedding-3-small').length,
  };
}

async function main(): Promise<void> {
  const dateIso = new Date().toISOString().slice(0, 10);
  console.log(`\n=== ISSUE-001 cost-viability spike ${DRY_RUN ? '(DRY RUN — mock tokens)' : '(LIVE — real paid calls)'} ===\n`);

  const ledger = new CostLedger();

  // 1) One real end-to-end multi-agent task.
  console.log('· running one multi-agent task (orchestrator→research→specialists→synthesis)…');
  await runTask(TASK_PROMPT, ledger);
  const taskUsd = ledger.totalUsd('task');
  console.log(`  task cost: $${taskUsd.toFixed(4)}\n`);

  // 2) Drive memory events through the ADR-003 §4 write path.
  const seen = new Set<string>();
  const outcomes: Record<string, { survived: boolean; diedAt: string | null }> = {};
  for (const ev of MEMORY_EVENTS) {
    const outcome = await writeMemory(ev, ledger, seen);
    outcomes[ev.id] = outcome;
    console.log(`· write ${ev.id}: ${outcome.survived ? 'SURVIVED (full path)' : `dropped @ ${outcome.diedAt}`}`);
  }
  console.log('');

  // 3) Per-unit costs.
  const survivingWriteUsd = sumUsdBySuffix(ledger, ':survivor-1');
  // Price one Haiku gate call: prefer a real gate-drop; fall back to the survivor's gate call.
  const gateDropCost = sumUsdBySuffix(ledger, 'gate:gatedrop-1');
  const survivorGateCost = sumUsdBySuffix(ledger, 'gate:survivor-1');
  const haikuGateUsd = gateDropCost > 0 ? gateDropCost : survivorGateCost;
  const perUnit: PerUnitCosts = { taskUsd, survivingWriteUsd, haikuGateUsd };

  // 4) Extrapolate to $/day.
  const daily = extrapolateDaily(perUnit, TYPICAL_PROFILE);

  // 5) Verdict. A dry run is structurally barred from PASS (mock tokens ≠ measurement).
  let verdict = verdictFor(daily.perDayUsd);
  if (DRY_RUN && verdict === 'PASS') verdict = 'FAIL';

  // Integrity checks for the evidence.
  const survivor = outcomes['survivor-1'];
  const writeSurvived = survivor?.survived === true;
  const nonSurvivorHitZeroSonnet = MEMORY_EVENTS.filter((e) => !outcomes[e.id]?.survived).every(
    (e) => sumUsdBySuffix(ledger, `writer:${e.id}`) === 0,
  );
  const writeShapeSurviving = shapeBySuffix(ledger, ':survivor-1');

  // 6) Build + persist evidence.
  const { json, markdown } = buildEvidence({
    dateIso,
    verdict,
    glyph: GLYPH[verdict],
    profile: TYPICAL_PROFILE,
    ledger,
    survivingWriteRollup: ledger.rollupWhere((entry) => entry.label.endsWith(':survivor-1')),
    perUnit,
    daily,
    writeShapeSurviving,
    writeSurvived,
    nonSurvivorHitZeroSonnet,
  });

  const here = dirname(fileURLToPath(import.meta.url));
  const outDir = join(here, '..', 'results');
  mkdirSync(outDir, { recursive: true });
  const suffix = DRY_RUN ? 'dryrun' : dateIso;
  writeFileSync(join(outDir, `af-001-evidence.${suffix}.json`), JSON.stringify(json, null, 2));
  writeFileSync(join(outDir, `af-001-evidence.${suffix}.md`), markdown);

  console.log(markdown);
  console.log(`\n--- verdict: ${verdict} ${GLYPH[verdict]} · extrapolated $${daily.perDayUsd.toFixed(2)}/day ` +
    `(target ~$${THRESHOLDS.viabilityTargetDailyUsd}, soft alert $${THRESHOLDS.softAlertDailyUsd}) ---`);
  console.log(`evidence → results/af-001-evidence.${suffix}.{json,md}\n`);

  if (ledger.hasUnknown()) {
    console.error('⚠️  cost_unknown present — measurement incomplete (non-negotiable #3). Not a clean PASS.');
    process.exitCode = 2;
  }
  if (!writeSurvived && !DRY_RUN) {
    console.error('⚠️  survivor-1 did NOT survive the gate — no full write-path measurement captured. Adjust the event and re-run.');
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error('\n❌ spike failed (loud, not silent):', err);
  process.exit(1);
});
