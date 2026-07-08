// ISSUE-064 (C8 PLAN) — the build-time discipline kernels: failure-mode assignment (PLAN.001), the halt-and-escalate
// safe default + the unattended-halt re-escalation (PLAN.002), and the build-time chain-depth gate (PLAN.003). Pure,
// deterministic (caller-supplied `nowMs`; no Date.now/random). This slice ASSIGNS + VALIDATES; C5 (ISSUE-052) executes.

import {
  DEFAULT_STEP_FAILURE_MODE,
  isStepFailureMode,
  toCanonicalFailureMode,
  type StepFailureMode,
} from './taxonomy.ts';

// ── the plan shape (a projection of ISSUE-061's ExecutionPlan/PlanStep; failure_mode may arrive canonical, in the
//    orchestrator's shorthand, or absent — this slice normalizes it). ──────────────────────────────────────────────
export interface PlanStepInput {
  index: number;
  agent_id: string;
  agent_name?: string;
  depends_on?: number[];
  parallel_eligible?: boolean;
  failure_mode?: string | null; // canonical OR orchestrator-shorthand OR absent
}

/** A step after assignment — its `failure_mode` is a CANONICAL, DB-aligned value; never absent, never shorthand. */
export interface AssignedPlanStep {
  index: number;
  agent_id: string;
  agent_name: string | null;
  depends_on: number[];
  parallel_eligible: boolean;
  failure_mode: StepFailureMode;
  /** true iff this step's mode came from the safe default (no explicit/recognized mode was supplied). */
  defaulted: boolean;
}

export interface AssignedPlan {
  task_type_name: string;
  steps: AssignedPlanStep[];
  parallel: boolean;
}

/**
 * FR-8.PLAN.001 + FR-8.PLAN.002 — assign exactly one CANONICAL failure mode to EVERY step at build time. A step with a
 * recognized mode (canonical or orchestrator-shorthand) is canonicalized; a step with no/unrecognized mode is
 * defaulted to halt-and-escalate (never silently left unset — #3) and flagged `defaulted`. This is the single place a
 * mode is decided; C5 (ISSUE-052) reads the stored mode at failure time and NEVER re-decides (AC-8.PLAN.001.2).
 */
export function assignFailureModes(task_type_name: string, steps: readonly PlanStepInput[]): AssignedPlan {
  const assigned: AssignedPlanStep[] = steps.map((s) => {
    const canonical = toCanonicalFailureMode(s.failure_mode);
    return {
      index: s.index,
      agent_id: s.agent_id,
      agent_name: s.agent_name ?? null,
      depends_on: s.depends_on ?? [],
      parallel_eligible: s.parallel_eligible ?? false,
      failure_mode: canonical ?? DEFAULT_STEP_FAILURE_MODE,
      defaulted: canonical === null,
    };
  });
  return { task_type_name, steps: assigned, parallel: assigned.some((s) => s.parallel_eligible) };
}

/**
 * Re-canonicalize + assert a plan_body at a WRITE boundary — the defensive close for the OD-201 taxonomy drift. Even
 * if a caller hands a plan whose steps carry orchestrator shorthand (or an unassigned step), this returns a clean
 * AssignedPlan with every failure_mode canonical + assigned. Persisting THROUGH this guarantees plan_body never stores
 * shorthand, so a downstream read/enum-validate never diverges (the fake-passes-offline / live-diverges class).
 */
export function canonicalizePlanBody(plan: AssignedPlan): AssignedPlan {
  const inputs: PlanStepInput[] = plan.steps.map((s) => ({
    index: s.index,
    agent_id: s.agent_id,
    agent_name: s.agent_name ?? undefined,
    depends_on: s.depends_on,
    parallel_eligible: s.parallel_eligible,
    failure_mode: s.failure_mode,
  }));
  const clean = assignFailureModes(plan.task_type_name, inputs);
  assertEveryStepAssigned(clean);
  return clean;
}

export const ERR_STEP_UNASSIGNED = (index: number) =>
  `execution-plans: step ${index} has no assigned failure mode — a built plan must assign one to EVERY step (FR-8.PLAN.001 / #3)`;

/**
 * AC-8.PLAN.001.1 — assert every step carries a valid canonical failure mode. Throws LOUD on the first violation
 * (used as a build-time gate before a plan is persisted/executed; the safe-default path means an assignFailureModes'd
 * plan always passes, but a plan assembled by another path is verified here rather than trusted). #3 never-silent.
 */
export function assertEveryStepAssigned(plan: AssignedPlan): void {
  for (const s of plan.steps) {
    if (!isStepFailureMode(s.failure_mode)) throw new Error(ERR_STEP_UNASSIGNED(s.index));
  }
}

/**
 * AC-8.PLAN.001.2 — what C5 reads at failure time: the PRE-ASSIGNED mode stored on the step, canonicalized. C5 must
 * use THIS, never choose a mode at failure time. Returns the safe default only if the stored value is somehow
 * unrecognized (a torn plan_body) — fail-safe to halt-and-escalate, never to "continue".
 */
export function readPreAssignedMode(step: { failure_mode?: string | null }): StepFailureMode {
  return toCanonicalFailureMode(step.failure_mode ?? null) ?? DEFAULT_STEP_FAILURE_MODE;
}

// ── FR-8.PLAN.002.2 — the unattended-halt re-escalation (reuses the AC-5.QUE.005.2 / OD-077 staleness pattern). ──
export interface HaltRecord {
  taskId: string;
  planVersionId: string | null;
  haltedAtMs: number;
  escalatedAtMs: number | null;
  resolvedAtMs: number | null;
}

/**
 * A halt-and-escalate that goes unattended past `staleThresholdMs` must RE-escalate (never park unseen) — the same
 * escalate-don't-abandon guarantee the clarification/approval paths carry (OD-077, AC-5.QUE.005.2). True iff the halt
 * is unresolved, not-yet-(re)escalated, and stale. Deterministic on the persisted `haltedAtMs`.
 */
export function haltReEscalationDue(h: HaltRecord, staleThresholdMs: number, nowMs: number): boolean {
  return h.resolvedAtMs === null && h.escalatedAtMs === null && nowMs - h.haltedAtMs >= staleThresholdMs;
}

// ── FR-8.PLAN.003 — the build-time chain-depth gate. ────────────────────────────────────────────────────
export const CFG_CHAIN_DEPTH_LIMIT = 'chain_depth_limit' as const;
export const DEFAULT_CHAIN_DEPTH_LIMIT = 6; // FR-8.PLAN.003 / ORC.005 default

export type DepthDecision =
  | { action: 'ok'; steps: number; limit: number }
  | { action: 'reject'; steps: number; limit: number; confidence: 'low'; reason: string };

/**
 * FR-8.PLAN.003 → AC-8.PLAN.003.1 — enforce the chain-depth limit AT BUILD TIME. An over-limit plan is NOT executed
 * as-is: it is rejected and its routing confidence dropped to `low` so the task falls to ORC.006 low-confidence
 * clarification (surfaced), rather than spawning an unbounded chain. This is a BUILD-time gate ONLY — it NEVER trims a
 * chain mid-execution (that would be a silent #3 truncation). The reason is returned so the caller can log the hit.
 */
export function enforceDepthLimit(stepCount: number, limit: number = DEFAULT_CHAIN_DEPTH_LIMIT): DepthDecision {
  if (stepCount > limit) {
    return {
      action: 'reject',
      steps: stepCount,
      limit,
      confidence: 'low',
      reason: `plan has ${stepCount} steps, exceeding chain_depth_limit=${limit} — rejected at build time, dropped to low-confidence clarification (never silently truncated mid-chain, FR-8.PLAN.003)`,
    };
  }
  return { action: 'ok', steps: stepCount, limit };
}

// ── the single WIRED build entry: assign + depth-gate + assert, so the depth gate can't be bypassed. ────
export type BuildResult =
  | { ok: true; plan: AssignedPlan }
  | { ok: false; depth: Extract<DepthDecision, { action: 'reject' }> };

/**
 * Build a validated plan from raw steps: enforce the chain-depth gate FIRST (PLAN.003 — an over-limit plan is rejected
 * to low-confidence, never assembled/executed), then assign a canonical failure mode to every step (PLAN.001/002) and
 * assert completeness. This is the recommended entry so the depth gate is applied at the persistence boundary rather
 * than being a standalone function a caller can forget (the MINOR the verify flagged).
 */
export function buildValidatedPlan(taskTypeName: string, steps: readonly PlanStepInput[], limit: number = DEFAULT_CHAIN_DEPTH_LIMIT): BuildResult {
  const depth = enforceDepthLimit(steps.length, limit);
  if (depth.action === 'reject') return { ok: false, depth };
  const plan = assignFailureModes(taskTypeName, steps);
  assertEveryStepAssigned(plan);
  return { ok: true, plan };
}
