/**
 * Build the AF-001 evidence block — the exact fields (a)–(h) ISSUE-001 step 7 enumerates
 * (the register has no evidence template, so the issue names the shape). Emitted as both a
 * JSON object (results/af-001-evidence.json) and a markdown block (paste into
 * feasibility-register.md). A zero-context reader must be able to re-derive the verdict from it.
 */
import type { CostLedger, VendorRollup } from './ledger.js';
import type { DailyEstimate, PerUnitCosts } from './extrapolate.js';
import type { WorkloadProfile } from './profile.js';
import { THRESHOLDS, type Verdict } from './thresholds.js';
import { MODELS, DRY_RUN } from './vendors.js';
import { CORPUS_COMPOSITION } from './corpus.js';

export interface EvidenceInput {
  dateIso: string;
  verdict: Verdict;
  glyph: string;
  profile: WorkloadProfile;
  ledger: CostLedger;
  survivingWriteRollup: VendorRollup[]; // survivor-only, so the display matches shape (e)
  perUnit: PerUnitCosts;
  daily: DailyEstimate;
  writeShapeSurviving: { sonnet: number; haiku: number; embedding: number };
  writeSurvived: boolean;
  nonSurvivorHitZeroSonnet: boolean;
}

const usd = (n: number) => `$${n.toFixed(4)}`;
const usd2 = (n: number) => `$${n.toFixed(2)}`;

function rollupLines(rows: VendorRollup[]): string {
  if (rows.length === 0) return '  (none)';
  return rows
    .map(
      (r) =>
        `  - ${r.vendor}/${r.model}: ${r.calls} call(s), ${r.attempts} attempt(s), ` +
        `${r.inputTokens} in + ${r.outputTokens} out tok → ${usd(r.usd)}` +
        (r.unknownCalls > 0 ? `  ⚠️ ${r.unknownCalls} cost_unknown` : ''),
    )
    .join('\n');
}

export function buildEvidence(e: EvidenceInput): { json: object; markdown: string } {
  const taskRollup = e.ledger.rollup('task');
  const writeRollup = e.survivingWriteRollup; // one surviving write only (not the whole phase)
  const dryFlag = DRY_RUN ? ' [DRY-RUN — NOT A REAL MEASUREMENT]' : '';

  const json = {
    af: 'AF-001',
    verdict: e.verdict,
    glyph: e.glyph,
    date: e.dateIso,
    method: 'SPIKE+EVAL',
    dryRun: DRY_RUN,
    models: MODELS,
    thresholds: THRESHOLDS,
    profile: e.profile,
    corpus: CORPUS_COMPOSITION,
    perUnitUsd: e.perUnit,
    daily: e.daily,
    measured: { task: taskRollup, memoryWrite: writeRollup, hasCostUnknown: e.ledger.hasUnknown() },
    memoryWriteShape: {
      surviving: e.writeShapeSurviving,
      survivedAsExpected: e.writeSurvived,
      nonSurvivorZeroSonnet: e.nonSurvivorHitZeroSonnet,
    },
  };

  const markdown = `### AF-001 evidence — cost-viability spike (ISSUE-001)${dryFlag}

**(a) Verdict:** ${e.verdict} → status ${e.glyph}
**(b) Date / method:** ${e.dateIso} · SPIKE+EVAL${DRY_RUN ? ' · ⚠️ DRY-RUN (mock tokens — re-run with live keys for a real verdict)' : ''}
**(b′) Models called:** Sonnet=${MODELS.SONNET_MODEL} · Haiku=${MODELS.HAIKU_MODEL} · embed=${MODELS.EMBED_MODEL}

**(c) Declared typical-volume profile (extrapolation basis):**
- ${e.profile.realTasksPerDay} real multi-agent tasks/day
- ${e.profile.writeEventsPerDay} write-path events/day, of which ${e.profile.survivingWritesPerDay} survive
- loops/day: ${e.profile.loops.fast} fast · ${e.profile.loops.medium} medium · ${e.profile.loops.slow} slow (idle-gated → ~$0 model)
- rationale:
${e.profile.rationale.split('\n').map((l) => '  ' + l).join('\n')}

**(d) Measured per-vendor cost + tokens (round-up estimator, all vendors):**
- one task (${usd(e.perUnit.taskUsd)}):
${rollupLines(taskRollup)}
- one surviving memory write (${usd(e.perUnit.survivingWriteUsd)}):
${rollupLines(writeRollup)}
- one Haiku gate (non-survivor unit cost): ${usd(e.perUnit.haikuGateUsd)}
- **Extrapolated: ${usd2(e.daily.perDayUsd)}/day** vs ~$${THRESHOLDS.viabilityTargetDailyUsd} target / $${THRESHOLDS.softAlertDailyUsd} soft alert
  - tasks ${usd2(e.daily.breakdown.tasksUsd)} · surviving writes ${usd2(e.daily.breakdown.survivingWritesUsd)} · non-survivor gates ${usd2(e.daily.breakdown.nonSurvivingWritesUsd)} · loops ${usd2(e.daily.breakdown.loopIdleUsd)}

**(e) Observed memory-write shape (AF-043):** surviving write = ${e.writeShapeSurviving.sonnet} Sonnet + ${e.writeShapeSurviving.haiku} Haiku + ${e.writeShapeSurviving.embedding} embed (ADR-003 §4 asserts 1 Sonnet + 3 Haiku). Non-survivor 0 Sonnet: ${e.nonSurvivorHitZeroSonnet ? 'confirmed' : 'NOT confirmed'}.

**(f) Estimate-vs-invoice basis (AF-042):** cost is token-derived via \`cost_tokens × price_table\` (schema.md §8), round-up (retries charged, standard non-batch rates, no cache discount) → biased ABOVE the real vendor invoice by construction. Reconciliation against a real Anthropic/OpenAI bill is the AF-042 fast-follow.

**(g) Assembled corpus composition:** ${CORPUS_COMPOSITION.tasks} task (${CORPUS_COMPOSITION.taskType}); ${CORPUS_COMPOSITION.memoryEventsFed} memory events fed (${CORPUS_COMPOSITION.designedSurvivors} survivor / ${CORPUS_COMPOSITION.designedGateDrops} gate-drop / ${CORPUS_COMPOSITION.designedCodeFilterDrops} code-filter drop).

**(h) Over-soft-alert lever path:** ${e.verdict === 'OVER-SOFT-ALERT' ? 'TRIGGERED — apply COST.007 levers (model routing → selective-write gate → loop idle-gating → memory-injection limit → orchestrator confidence threshold) and re-measure BEFORE raising any ceiling (AC-NFR-COST.006.2).' : 'n/a — under the soft alert.'}
${e.ledger.hasUnknown() ? '\n> ⚠️ One or more calls recorded cost_unknown — totals are incomplete; investigate before trusting the verdict (non-negotiable #3).' : ''}`;

  return { json, markdown };
}
