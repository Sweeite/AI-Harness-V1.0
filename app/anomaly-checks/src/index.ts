// @harness/anomaly-checks — ISSUE-057 (C6 ANM). Public surface: the pre-step anomaly check entry point
// (the seam ISSUE-053 wires into the run pipeline at the C5 FR-5.ASM.007 step boundary), the five
// detectors, the disposition/signal handling, the per-deployment `anomaly_thresholds` config, the
// baseline-learning proposal machinery, and the AnomalyStore port + in-memory fake. The live pg
// adapter is exported for the integration seam but is NOT run in this slice's tests (offline).

export {
  ANOMALY_KINDS,
  DEFAULT_ANOMALY_THRESHOLDS,
  validateAnomalyThresholds,
  ConfigValidationError,
  type AnomalyKind,
  type AnomalySeverity,
  type Comparator,
  type AnomalyThreshold,
  type AnomalyThresholdsConfig,
} from './config.js';

export {
  runAllDetectors,
  checkConfidence,
  checkVolume,
  checkContradiction,
  checkScope,
  checkSentiment,
  type StepObservation,
  type LiveVsStoredConflict,
  type AnomalyFlag,
} from './detectors.js';

export {
  preStepAnomalyCheck,
  type PreStepInput,
  type PreStepDecision,
  type Disposition,
  type SideEffectSentinel,
} from './pipeline.js';

export {
  proposeBaselines,
  applyBaselineProposal,
  computeBaseline,
  type History,
} from './baseline.js';

export {
  type AnomalyStore,
  InMemoryAnomalyStore,
  type GuardrailLogRow,
  type GuardrailType,
  type GuardrailStatus,
  type NewGuardrail,
  type ReviewFlag,
  type BaselineProposal,
} from './store.js';

// ── `npm run check` — a tiny offline smoke of the wired pipeline (no live DB). Mirrors the house
//    `check` script (cf. app/config-store). Fires a volume anomaly at default config and asserts the
//    disposition contract, so `check` is a fast "does the slice hang together" gate. ──
async function main(): Promise<void> {
  const { InMemoryAnomalyStore } = await import('./store.js');
  const { preStepAnomalyCheck } = await import('./pipeline.js');
  const { DEFAULT_ANOMALY_THRESHOLDS } = await import('./config.js');

  const store = new InMemoryAnomalyStore();
  const decision = await preStepAnomalyCheck(store, {
    taskId: 'task-check',
    observation: {
      keyMemoryConfidence: 1.0,
      plannedActionCount: 999, // >> volume ceiling
      liveVsStoredConflicts: [],
      scopeExpansionRatio: 1.0,
      sentimentScore: 0.0,
    },
    config: DEFAULT_ANOMALY_THRESHOLDS,
    now: 1_000_000,
  });

  if (!decision.paused) throw new Error('check FAILED: a fired anomaly must pause the step');
  if (store.guardrailLog.length !== 1) throw new Error('check FAILED: expected one anomaly guardrail_log row');
  if (store.guardrailLog[0]!.guardrail_type !== 'anomaly') throw new Error('check FAILED: wrong guardrail_type');
  if (store.reviewFlags.length !== 1) throw new Error('check FAILED: soft anomaly must flag for review');
  // eslint-disable-next-line no-console
  console.log('anomaly-checks check OK — pre-step pipeline wired, soft disposition upheld');
}

if (process.argv[2] === 'check') {
  main().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  });
}
