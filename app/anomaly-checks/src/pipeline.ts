// ISSUE-057 §8 steps 3-4 — the pre-step check entry point (FR-6.ANM.001) + disposition (FR-6.ANM.003).
//
// FR-6.ANM.001 / AC-6.ANM.001.1: `preStepAnomalyCheck` is the single callable the harness invokes at
// the step boundary. It runs ALL configured detectors and RESOLVES their disposition (writes the log
// rows + raises the flags / escalations) and returns a decision BEFORE the caller performs any
// side-effecting action of the step. This slice does NOT wire itself into the run pipeline — ISSUE-053
// calls it (C5 FR-5.ASM.007). To make "resolves before any side effect" testable offline, the caller
// passes an optional `sideEffect` sentinel the check asserts has NOT run yet (the harness-invocation
// stub from §9); the check records the ordering fact it observed.
//
// FR-6.ANM.003 / OD-063 / ADR-007 detection-as-signal — the ONLY authorised dispositions:
//   - severity 'soft' (default): PAUSE the step + write a guardrail_log row (type 'anomaly',
//     action_blocked=false, status pending) + FLAG the task for review. Never silent-drop, never
//     autonomous-continue (AC-6.ANM.003.1).
//   - severity 'hard' (deployment raised THIS anomaly): write the row, set escalated_at, and route
//     into the FR-6.APR.002 hard-approval path (action_blocked=true). (AC-6.ANM.003.2.)
// There is NO autonomous block-and-act and NO autonomous discard.

import type { AnomalyThresholdsConfig, AnomalySeverity } from './config.js';
import { runAllDetectors, type AnomalyFlag, type StepObservation } from './detectors.js';
import type { AnomalyStore, GuardrailLogRow } from './store.js';

/** How a single fired anomaly was disposed of (FR-6.ANM.003). */
export interface Disposition {
  flag: AnomalyFlag;
  severity: AnomalySeverity;
  guardrailRow: GuardrailLogRow;
  /** true when the anomaly was escalated to the hard-approval path (severity 'hard'). */
  escalated: boolean;
  /** true when the task was flagged for human review (soft path). */
  flaggedForReview: boolean;
}

export interface PreStepDecision {
  /** true if any anomaly fired → the step is PAUSED (never autonomously continued). */
  paused: boolean;
  /** true if any fired anomaly escalated to the hard-approval gate. */
  requiresHardApproval: boolean;
  dispositions: Disposition[];
  /** Ordering evidence for AC-6.ANM.001.1 — the check observed the side effect had NOT run. */
  resolvedBeforeSideEffect: boolean;
}

/** A sentinel the harness-invocation stub uses to prove the check resolves before the side effect. */
export interface SideEffectSentinel {
  hasRun(): boolean;
}

export interface PreStepInput {
  taskId: string | null;
  observation: StepObservation;
  config: AnomalyThresholdsConfig;
  now: number;
  /** Optional — the §9 harness stub passes this so the check can assert side-effect ordering. */
  sideEffect?: SideEffectSentinel;
}

/**
 * FR-6.ANM.001 pre-step entry point. Runs all configured detectors, disposes each fired anomaly per
 * its per-deployment severity (FR-6.ANM.003), and returns the decision — all BEFORE the caller acts.
 */
export async function preStepAnomalyCheck(store: AnomalyStore, input: PreStepInput): Promise<PreStepDecision> {
  const { taskId, observation, config, now, sideEffect } = input;

  // AC-6.ANM.001.1: if a side-effect sentinel is supplied, it MUST NOT have run yet — the whole point
  // is that the check resolves first. A fired side effect here is a #2/#3 breach → fail loud.
  if (sideEffect && sideEffect.hasRun()) {
    throw new Error('ORDERING VIOLATION: pre-step anomaly check ran AFTER a side effect (AC-6.ANM.001.1)');
  }

  const flags = runAllDetectors(observation, config);
  const dispositions: Disposition[] = [];

  for (const flag of flags) {
    const severity = config[flag.kind].severity;
    const hard = severity === 'hard';

    // FR-6.ANM.003: write the guardrail_log row (type 'anomaly'). action_blocked mirrors the path:
    // soft = flagged-but-not-blocked (signal); hard = blocked pending the approval gate.
    const row = await store.logGuardrail({
      task_id: taskId,
      guardrail_type: 'anomaly',
      description: flag.reason,
      action_blocked: hard,
      status: 'pending',
    });

    let escalated = false;
    let flaggedForReview = false;
    let persisted = row;

    if (hard) {
      // AC-6.ANM.003.2: escalate into the FR-6.APR.002 hard-approval path (owned by ISSUE-056).
      persisted = await store.markEscalated(row.id, now);
      escalated = true;
    } else {
      // AC-6.ANM.003.1: default soft path — flag for review. Never silent-drop, never auto-continue.
      await store.flagForReview({ task_id: taskId ?? '', guardrail_log_id: row.id, reason: flag.reason });
      flaggedForReview = true;
    }

    dispositions.push({ flag, severity, guardrailRow: persisted, escalated, flaggedForReview });
  }

  return {
    paused: dispositions.length > 0, // any anomaly pauses the step (never autonomously continued)
    requiresHardApproval: dispositions.some((d) => d.escalated),
    dispositions,
    resolvedBeforeSideEffect: sideEffect ? !sideEffect.hasRun() : true,
  };
}
