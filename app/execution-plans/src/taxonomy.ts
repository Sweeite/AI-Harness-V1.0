// ISSUE-064 (C8 PLAN) — the CANONICAL step-failure-mode taxonomy. This slice OWNS the taxonomy (per the ISSUE-061
// routing.ts co-ownership comment). The canonical value set is the one the DB persists: the baseline 0001
// `step_failure_mode` enum = ('retry','skip_and_continue','halt_and_escalate'). Every value written into
// execution_plans.plan_body MUST be one of these, so a live read/validate against the enum never diverges.
//
// ⚠️ LOAD-BEARING RECONCILIATION ([[OD-201]]): the orchestrator (ISSUE-061, app/orchestrator/src/routing.ts) emits a
// SHORTHAND set `STEP_FAILURE_MODES = ['halt_escalate','retry','skip']` on its in-memory PlanStep.failure_mode. Those
// strings are NOT the DB enum values (`halt_escalate` ≠ `halt_and_escalate`; `skip` ≠ `skip_and_continue`). If the
// orchestrator's shorthand were persisted raw into plan_body, a downstream validator that checks against the DB enum
// would reject/mis-handle it — a silent semantic drift (#3). This module is the single reconciliation point:
// `toCanonicalFailureMode` maps the shorthand → canonical, and `assignFailureModes` (plan.ts) canonicalizes on the way
// in, so plan_body always stores canonical values. The proper long-term fix is for 061's buildPlan to emit canonical
// values (or route through this mapper) — tracked in OD-201; until then this slice absorbs the drift fail-safe.

/** The canonical, DB-aligned failure-mode set (baseline 0001 `step_failure_mode` enum). */
export const STEP_FAILURE_MODES = ['retry', 'skip_and_continue', 'halt_and_escalate'] as const;
export type StepFailureMode = (typeof STEP_FAILURE_MODES)[number];

/** The #2/#3-honest safe default (FR-8.PLAN.002): any step without an explicit mode is halt-and-escalate. */
export const DEFAULT_STEP_FAILURE_MODE: StepFailureMode = 'halt_and_escalate';

export function isStepFailureMode(v: unknown): v is StepFailureMode {
  return typeof v === 'string' && (STEP_FAILURE_MODES as readonly string[]).includes(v);
}

/** The orchestrator's (ISSUE-061) shorthand → canonical map (OD-201). Both the canonical values AND the shorthand
 * resolve, so this mapper is idempotent on already-canonical input and total over the orchestrator's output. */
const ALIAS_TO_CANONICAL: Readonly<Record<string, StepFailureMode>> = {
  // canonical (idempotent)
  retry: 'retry',
  skip_and_continue: 'skip_and_continue',
  halt_and_escalate: 'halt_and_escalate',
  // ISSUE-061 orchestrator shorthand
  halt_escalate: 'halt_and_escalate',
  skip: 'skip_and_continue',
};

/**
 * Map any recognized failure-mode string (canonical OR orchestrator-shorthand) to the canonical DB value. Returns
 * null for an unrecognized/blank value — the caller MUST treat null as "unassigned" and apply the halt-and-escalate
 * safe default (FR-8.PLAN.002), never silently pass an unknown string through to plan_body.
 */
export function toCanonicalFailureMode(v: string | null | undefined): StepFailureMode | null {
  if (v == null) return null;
  return ALIAS_TO_CANONICAL[v] ?? null;
}
