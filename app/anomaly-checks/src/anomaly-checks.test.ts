// ISSUE-057 — AC coverage for the five pre-step anomaly checks. One test per §4 AC, run against the
// in-memory fake reference model (offline; no live DB). Tests have TEETH: each asserts the FR invariant
// AND a negative counter-case so a tautological/always-green pass is impossible.
//
// AC-map (§4 Definition of done → test):
//   AC-6.ANM.001.1 — pre-step check resolves BEFORE any side-effecting action          → 'AC-6.ANM.001.1'
//   AC-6.ANM.002.1 — each of the five conditions fires its check + produces a flag      → 'AC-6.ANM.002.1'
//   AC-6.ANM.002.2 — contradiction check is the distinct live-vs-stored signal          → 'AC-6.ANM.002.2'
//   AC-6.ANM.003.1 — default-severity anomaly: pause + guardrail_log row + flag, never  → 'AC-6.ANM.003.1'
//                    silent-drop / auto-continue
//   AC-6.ANM.003.2 — severity-raised anomaly enters the hard-approval path              → 'AC-6.ANM.003.2'
//   AC-6.ANM.004.1 — a threshold edit takes effect with no code change (config-driven)  → 'AC-6.ANM.004.1'
//   AC-6.ANM.005.1 — a baseline change that would alter a gate needs admin confirmation → 'AC-6.ANM.005.1'

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_ANOMALY_THRESHOLDS,
  validateAnomalyThresholds,
  type AnomalyThresholdsConfig,
} from './config.js';
import {
  runAllDetectors,
  checkContradiction,
  type StepObservation,
} from './detectors.js';
import { preStepAnomalyCheck, type SideEffectSentinel } from './pipeline.js';
import { proposeBaselines, applyBaselineProposal, computeBaseline, type History } from './baseline.js';
import { InMemoryAnomalyStore } from './store.js';

const NOW = 1_700_000_000;

/** A benign observation that fires NO check under default config — the negative baseline for teeth. */
function calmObservation(): StepObservation {
  return {
    keyMemoryConfidence: 1.0, // above the 0.5 floor → confidence NOT fired
    plannedActionCount: 1, // below the 20 ceiling → volume NOT fired
    liveVsStoredConflicts: [], // none → contradiction NOT fired
    scopeExpansionRatio: 1.0, // unchanged → scope NOT fired
    sentimentScore: 0.0, // calm → sentiment NOT fired
  };
}

function cfg(overrides: Partial<AnomalyThresholdsConfig> = {}): AnomalyThresholdsConfig {
  return { ...structuredClone(DEFAULT_ANOMALY_THRESHOLDS), ...overrides };
}

// ── AC-6.ANM.001.1 — the check resolves BEFORE any side-effecting action of the step ──────────────
test('AC-6.ANM.001.1 pre-step check resolves before any side effect', async () => {
  const store = new InMemoryAnomalyStore();
  let sideEffectRan = false;
  const sentinel: SideEffectSentinel = { hasRun: () => sideEffectRan };

  const decision = await preStepAnomalyCheck(store, {
    taskId: 'task-1',
    observation: { ...calmObservation(), plannedActionCount: 50 }, // volume fires
    config: cfg(),
    now: NOW,
    sideEffect: sentinel,
  });
  // The side effect happens AFTER the check returns (the harness only acts on the decision).
  sideEffectRan = true;

  // TEETH: the check must have observed the side effect had NOT run, and it must have fully resolved
  // (written its row) before returning.
  assert.equal(decision.resolvedBeforeSideEffect, true);
  assert.equal(store.guardrailLog.length, 1, 'the row was written during the check, before the side effect');

  // Negative case: if the sentinel reports the side effect already ran, the check MUST throw (ordering
  // violation) — proving the assertion is real, not decorative.
  await assert.rejects(
    () =>
      preStepAnomalyCheck(store, {
        taskId: 'task-2',
        observation: { ...calmObservation(), plannedActionCount: 50 },
        config: cfg(),
        now: NOW,
        sideEffect: { hasRun: () => true },
      }),
    /ORDERING VIOLATION/,
  );
});

// ── AC-6.ANM.002.1 — each of the five conditions fires its check + produces a flag ────────────────
test('AC-6.ANM.002.1 each of the five checks fires on its condition', () => {
  const c = cfg();

  // Each observation trips EXACTLY one check; assert the right kind fired and the others did not.
  const cases: Array<{ kind: string; obs: StepObservation }> = [
    { kind: 'confidence', obs: { ...calmObservation(), keyMemoryConfidence: 0.4 } },
    { kind: 'volume', obs: { ...calmObservation(), plannedActionCount: 25 } },
    {
      kind: 'contradiction',
      obs: { ...calmObservation(), liveVsStoredConflicts: [{ field: 'email', liveValue: 'a', storedValue: 'b' }] },
    },
    { kind: 'scope', obs: { ...calmObservation(), scopeExpansionRatio: 3.0 } },
    { kind: 'sentiment', obs: { ...calmObservation(), sentimentScore: 0.95 } },
  ];

  for (const { kind, obs } of cases) {
    const flags = runAllDetectors(obs, c);
    assert.equal(flags.length, 1, `${kind}: exactly one check should fire`);
    assert.equal(flags[0]!.kind, kind, `${kind}: the right check fired`);
  }

  // TEETH: the calm observation fires NOTHING (guards against an always-fire tautology), and a metric
  // JUST short of the boundary does not fire while AT the boundary does (proves the comparator is real).
  assert.equal(runAllDetectors(calmObservation(), c).length, 0, 'calm observation fires no check');
  assert.equal(runAllDetectors({ ...calmObservation(), plannedActionCount: 19 }, c).length, 0, 'below ceiling: no fire');
  assert.equal(runAllDetectors({ ...calmObservation(), plannedActionCount: 20 }, c).length, 1, 'at ceiling: fires');
  assert.equal(runAllDetectors({ ...calmObservation(), keyMemoryConfidence: 0.51 }, c).length, 0, 'above floor: no fire');
  assert.equal(runAllDetectors({ ...calmObservation(), keyMemoryConfidence: 0.5 }, c).length, 1, 'at floor: fires');
});

// ── AC-6.ANM.002.2 — contradiction is the distinct live-vs-stored signal (NOT the C2 queue) ───────
test('AC-6.ANM.002.2 contradiction check is the distinct live-vs-stored signal', () => {
  const conflicts = [{ field: 'phone', liveValue: '555-1', storedValue: '555-2' }];
  const flag = checkContradiction(
    { ...calmObservation(), liveVsStoredConflicts: conflicts },
    cfg().contradiction,
  );
  assert.ok(flag, 'a live-vs-stored conflict fires the contradiction check');
  // TEETH: the flag is explicitly tagged as the live-vs-stored signal and carries the live+stored
  // values — the property that distinguishes it from the C2 stored-vs-stored memory-conflict queue.
  assert.equal(flag!.source, 'live_vs_stored');
  assert.deepEqual(flag!.details, conflicts);
  assert.equal(flag!.details![0]!.liveValue, '555-1');
  assert.equal(flag!.details![0]!.storedValue, '555-2');

  // Negative: no conflicts → no fire (a purely stored-vs-stored situation, resolved elsewhere by C2,
  // produces NO live-vs-stored anomaly here).
  assert.equal(checkContradiction(calmObservation(), cfg().contradiction), null);
});

// ── AC-6.ANM.003.1 — default severity: pause + guardrail_log row + flag; never drop/auto-continue ─
test('AC-6.ANM.003.1 default-severity anomaly pauses, logs, and flags — never silent', async () => {
  const store = new InMemoryAnomalyStore();
  const decision = await preStepAnomalyCheck(store, {
    taskId: 'task-soft',
    observation: { ...calmObservation(), sentimentScore: 0.9 }, // sentiment fires, default soft
    config: cfg(),
    now: NOW,
  });

  // Pause (never autonomously continued).
  assert.equal(decision.paused, true);
  assert.equal(decision.requiresHardApproval, false, 'default severity does NOT hard-escalate');

  // A guardrail_log row of type 'anomaly', pending, not blocked, not escalated (it is a signal).
  assert.equal(store.guardrailLog.length, 1);
  const row = store.guardrailLog[0]!;
  assert.equal(row.guardrail_type, 'anomaly');
  assert.equal(row.status, 'pending');
  assert.equal(row.action_blocked, false);
  assert.equal(row.escalated_at, null);

  // The task is flagged for review — TEETH against a silent drop: exactly one flag, tied to the row.
  assert.equal(store.reviewFlags.length, 1, 'the anomaly must flag for review, not silently drop');
  assert.equal(store.reviewFlags[0]!.guardrail_log_id, row.id);
  assert.equal(store.reviewFlags[0]!.task_id, 'task-soft');
  assert.equal(decision.dispositions[0]!.flaggedForReview, true);

  // TEETH — the negative: a calm step fires nothing, so it neither pauses nor writes nor flags (proves
  // the pause/log/flag are caused by the anomaly, not emitted unconditionally).
  const store2 = new InMemoryAnomalyStore();
  const calm = await preStepAnomalyCheck(store2, {
    taskId: 'task-calm',
    observation: calmObservation(),
    config: cfg(),
    now: NOW,
  });
  assert.equal(calm.paused, false);
  assert.equal(store2.guardrailLog.length, 0);
  assert.equal(store2.reviewFlags.length, 0);
});

// ── AC-6.ANM.003.2 — a severity-raised anomaly enters the hard-approval path ──────────────────────
test('AC-6.ANM.003.2 severity-raised anomaly enters the hard-approval path', async () => {
  const store = new InMemoryAnomalyStore();
  // Raise ONLY the volume check to hard; leave the rest soft.
  const config = cfg();
  config.volume.severity = 'hard';

  const decision = await preStepAnomalyCheck(store, {
    taskId: 'task-hard',
    // trip volume (hard) AND sentiment (still soft) in the same step — prove per-anomaly severity.
    observation: { ...calmObservation(), plannedActionCount: 100, sentimentScore: 0.9 },
    config,
    now: NOW,
  });

  assert.equal(decision.paused, true);
  assert.equal(decision.requiresHardApproval, true, 'the hard-raised anomaly escalates');

  const volDisp = decision.dispositions.find((d) => d.flag.kind === 'volume')!;
  const sentDisp = decision.dispositions.find((d) => d.flag.kind === 'sentiment')!;

  // The hard one: escalated, blocked, escalated_at set → routed to the FR-6.APR.002 gate.
  assert.equal(volDisp.escalated, true);
  assert.equal(volDisp.guardrailRow.action_blocked, true);
  assert.notEqual(volDisp.guardrailRow.escalated_at, null);
  assert.equal(volDisp.flaggedForReview, false);

  // TEETH — per-anomaly, not global: the soft one in the SAME step did NOT escalate and stayed a signal.
  assert.equal(sentDisp.escalated, false);
  assert.equal(sentDisp.guardrailRow.action_blocked, false);
  assert.equal(sentDisp.guardrailRow.escalated_at, null);
  assert.equal(sentDisp.flaggedForReview, true);
});

// ── AC-6.ANM.004.1 — a threshold edit takes effect with no code change (config-driven) ────────────
test('AC-6.ANM.004.1 a threshold edit takes effect without a code change', async () => {
  const store = new InMemoryAnomalyStore();
  const obs: StepObservation = { ...calmObservation(), plannedActionCount: 10 };

  // Under the shipped ceiling (20) an action count of 10 does NOT fire.
  const before = await preStepAnomalyCheck(store, { taskId: 't', observation: obs, config: cfg(), now: NOW });
  assert.equal(before.paused, false, '10 actions is fine under the default ceiling of 20');

  // Operator edits ONLY the config object (the `anomaly_thresholds` row) — no code changes. Same input.
  const edited = cfg();
  edited.volume.threshold = 5;
  const after = await preStepAnomalyCheck(store, { taskId: 't', observation: obs, config: edited, now: NOW });

  // TEETH: the SAME observation now fires purely because the config bar moved — proving it is read from
  // config at check time, not compiled in.
  assert.equal(after.paused, true, 'lowering the ceiling to 5 makes 10 actions fire — config-driven');
  assert.equal(after.dispositions[0]!.flag.kind, 'volume');
  assert.equal(after.dispositions[0]!.flag.threshold, 5);

  // And the edited config still validates as a well-formed `anomaly_thresholds` row (round-trip).
  const roundTripped = validateAnomalyThresholds(JSON.parse(JSON.stringify(edited)));
  assert.equal(roundTripped.volume.threshold, 5);
});

// ── AC-6.ANM.005.1 — a baseline change that would alter a gate requires admin confirmation ────────
test('AC-6.ANM.005.1 gate-altering baseline change requires admin confirmation', async () => {
  const store = new InMemoryAnomalyStore();

  // Learning enabled; volume is a GATE (severity hard) and scope is a SIGNAL (severity soft).
  const config = cfg({ baseline_learning_enabled: true });
  config.volume.severity = 'hard';
  config.scope.severity = 'soft';

  // History where the demonstrated-normal p95 differs from the shipped thresholds → both propose.
  const history: History = {
    confidence: [1, 1, 1, 1, 1],
    volume: [40, 41, 42, 43, 44], // p95 ~44 ≠ 20 → propose a loosen for volume (gate)
    contradiction: [0, 0, 0, 0, 0],
    scope: [4, 4, 5, 5, 6], // p95 ~6 ≠ 2.0 → propose for scope (signal)
    sentiment: [0.1, 0.1, 0.1, 0.1, 0.1],
  };

  const proposals = await proposeBaselines(store, config, history);
  const volProp = proposals.find((p) => p.kind === 'volume')!;
  const scopeProp = proposals.find((p) => p.kind === 'scope')!;
  assert.ok(volProp, 'a volume baseline is proposed');
  assert.ok(scopeProp, 'a scope baseline is proposed');

  // The gate one is flagged gate-altering; the signal one is not.
  assert.equal(volProp.gate_altering, true);
  assert.equal(scopeProp.gate_altering, false);

  // TEETH — the guardrail: applying the GATE-ALTERING proposal WITHOUT admin confirmation throws
  // (never silent auto-apply).
  assert.throws(() => applyBaselineProposal(config, volProp), /ADMIN-CONFIRM REQUIRED/);

  // After an admin confirms it, it applies and the threshold actually moves.
  const confirmed = await store.confirmBaselineProposal(volProp.id, 'admin-user');
  assert.equal(confirmed.confirmed_by, 'admin-user');
  const applied = applyBaselineProposal(config, confirmed);
  assert.equal(applied.volume.threshold, volProp.proposed_threshold);
  assert.notEqual(applied.volume.threshold, config.volume.threshold);

  // The SIGNAL-only proposal needs no gate-confirmation — it applies directly (proving the guard is
  // scoped to gate-altering changes, not blanket).
  const appliedScope = applyBaselineProposal(config, scopeProp);
  assert.equal(appliedScope.scope.threshold, scopeProp.proposed_threshold);

  // Learning disabled → NO proposals at all (the deployment knob is honoured).
  const off = await proposeBaselines(new InMemoryAnomalyStore(), cfg({ baseline_learning_enabled: false }), history);
  assert.equal(off.length, 0);

  // Sanity on the percentile helper itself (deterministic).
  assert.equal(computeBaseline('confidence', [0.2, 0.4, 0.6, 0.8, 1.0]), 0.2); // p05 low
  assert.equal(computeBaseline('volume', [10, 20, 30, 40, 50]), 50); // p95 high
});

// ── AC-6.ANM.003.2 (regression, Stage-3 verify) — markEscalated is a MONOTONIC write-once stamp that the
//    fake models exactly as the OD-182-widened append-only trigger would: first stamp succeeds (escalated_at
//    set + action_blocked false→true, status untouched); a SECOND stamp is REJECTED (fake == live DDL). ──
test('AC-6.ANM.003.2 markEscalated is a monotonic write-once stamp (append-only, OD-182)', async () => {
  const store = new InMemoryAnomalyStore();
  const row = await store.logGuardrail({
    task_id: 'task-hard', guardrail_type: 'anomaly', description: 'volume spike',
    action_blocked: true, status: 'pending',
  });
  assert.equal(row.escalated_at, null, 'starts un-escalated');

  const first = await store.markEscalated(row.id, 1_000);
  assert.notEqual(first.escalated_at, null, 'first stamp sets escalated_at');
  assert.equal(first.status, 'pending', 'status is untouched by escalation (not a status transition)');
  assert.equal(first.action_blocked, true, 'action_blocked stays/goes true (false→true only)');

  // TEETH: a re-stamp is rejected exactly as the widened trigger rejects a non-monotonic escalated_at move.
  await assert.rejects(() => store.markEscalated(row.id, 2_000), /already escalated|write-once|OD-182/,
    'a second escalation stamp must be rejected (write-once), never silently overwrite');
});

// ── AC-6.ANM.003.1 (regression, Stage-3 verify) — a review flag with no task FAILS LOUD, never a silent
//    no-op (the prior adapter silently dropped a null-task flag; fake + adapter now agree on the throw). ──
test('AC-6.ANM.003.1 flagForReview with no task_id fails loud (never silently dropped, #3)', async () => {
  const store = new InMemoryAnomalyStore();
  await assert.rejects(
    () => store.flagForReview({ task_id: '', guardrail_log_id: 'g1', reason: 'null-task soft anomaly' }),
    /task_id is required|never silently dropped/,
    'an un-routable review flag must raise, not vanish',
  );
  // TEETH: a genuine task_id is still recorded (no over-rejection).
  await store.flagForReview({ task_id: 'task-ok', guardrail_log_id: 'g2', reason: 'ok' });
});
