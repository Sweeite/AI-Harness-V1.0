// ISSUE-054 (C5 OPT) — FR-5.OPT.001 Parallel step execution over the dependency DAG, with OD-056 step-level approval
// semantics. Build order step 2 (the core). Given the resolved plan (dag.ts) + the live scheduler state, decide which
// steps may START concurrently, honouring — in strict precedence:
//   (1) the dependency DAG            — a step waits for all depends_on to complete;
//   (2) OD-056 approval gating         — an approval-gated step blocks ITSELF + (via the DAG) its dependents; an
//        irreversible step WAITS for any pending approval it should logically follow (follows_approval_of), even
//        with no hard data edge (AC-5.OPT.001.2 — no side effect outruns its gate, #2);
//   (3) ADR-004 per-key concurrency    — two steps that write the same key never run concurrently (they serialise on
//        the concurrency key); disjoint-key steps parallelise safely.
// When parallel_execution_enabled is OFF the wave collapses to a single step — plain sequential execution — so the
// layer is provably additive (the FLAG-OFF regression).
//
// This module decides ELIGIBILITY + WAVE COMPOSITION (pure, deterministic). The actual concurrent side effects ride
// Inngest fan-out (ISSUE-052) live; the race-freedom + approval-ordering proof runs offline in simulate.ts (AF-113).

import type { OptConfig } from './config.ts';
import { resolveConfig } from './config.ts';
import type { OptStep } from './dag.ts';
import { isIrreversible, writeKeys } from './dag.ts';

/** Live scheduling state. `granted` is the set of approval-gated step_ids whose approval has been granted. */
export interface SchedulerState {
  completed: ReadonlySet<string>;
  running: ReadonlySet<string>;
  granted: ReadonlySet<string>;
}

/** Why a step is not (yet) eligible — a VISIBLE reason, never a silent skip (#3). null ⇒ eligible. */
export type IneligibleReason =
  | null
  | 'done' // already completed or running
  | 'deps_pending' // a depends_on has not completed
  | 'awaiting_own_approval' // approval_gated and not yet granted (OD-056: blocks itself)
  | 'awaiting_followed_approval' // irreversible + a follows_approval_of gate still pending (AC-5.OPT.001.2)
  | 'concurrency_key_busy'; // ADR-004: a running step holds a shared write key

/** The precedence-ordered eligibility decision for one step. Pure. */
export function eligibility(step: OptStep, steps: readonly OptStep[], state: SchedulerState): IneligibleReason {
  if (state.completed.has(step.step_id) || state.running.has(step.step_id)) return 'done';
  // (1) DAG deps.
  for (const dep of step.depends_on) if (!state.completed.has(dep)) return 'deps_pending';
  // (2a) OD-056: an approval-gated step blocks itself until granted (its dependents block transitively via (1)).
  if (step.approval_gated && !state.granted.has(step.step_id)) return 'awaiting_own_approval';
  // (2b) AC-5.OPT.001.2: an irreversible step waits for any pending approval it should logically follow.
  // Fail CLOSED (#2): an UNRESOLVED gate (not in the step set) or a gate whose approval is not (yet) GRANTED both
  // BLOCK the irreversible step. A latch that no-ops when its referenced gate is absent/ungranted is a textbook
  // fail-open on an inviolable-#2 control — the approval the step must follow would be silently ignored and the
  // side effect would outrun it. An unknown/ungranted gate must block, never release. (The planner stamps
  // follows_approval_of only for approval-gated targets; a non-gated target is never granted ⇒ it blocks here.)
  if (isIrreversible(step)) {
    for (const gate of step.follows_approval_of ?? []) {
      const gateStep = steps.find((s) => s.step_id === gate);
      if (gateStep === undefined) return 'awaiting_followed_approval'; // unresolved gate ⇒ block, never skip
      if (!state.granted.has(gate)) return 'awaiting_followed_approval'; // pending (or non-gated) approval ⇒ block
    }
  }
  // (3) ADR-004 per-key concurrency: cannot run while a RUNNING step holds a shared write key.
  const keys = new Set(writeKeys(step));
  if (keys.size > 0) {
    for (const other of steps) {
      if (!state.running.has(other.step_id)) continue;
      if (writeKeys(other).some((k) => keys.has(k))) return 'concurrency_key_busy';
    }
  }
  return null;
}

export function isEligible(step: OptStep, steps: readonly OptStep[], state: SchedulerState): boolean {
  return eligibility(step, steps, state) === null;
}

export const ERR_UNRESOLVED_FOLLOWS = (id: string, gate: string) =>
  `execution-optimisation: step '${id}' follows_approval_of unresolved step '${gate}' — refusing to schedule (fail-closed, #2)`;
export const ERR_UNRESOLVED_DEP = (id: string, dep: string) =>
  `execution-optimisation: step '${id}' depends_on unresolved step '${dep}' — refusing to schedule (fail-closed, #3)`;

/** Defense-in-depth, INDEPENDENT of decompose()/resolveDependencyOrder: every depends_on + follows_approval_of id
 * MUST resolve to a step in the set before we compose a wave. The live Inngest driver reads a PERSISTED plan that
 * may never have been routed through decompose(); a dangling reference there is a malformed plan and must fail
 * LOUD + CLOSED (#2/#3) — the scheduler never schedules around an unresolved control (that is exactly the fail-open
 * eligibility() also guards against, hoisted to a loud pre-check so a bad plan is rejected before any dispatch). */
export function assertReferencesResolve(steps: readonly OptStep[]): void {
  const ids = new Set(steps.map((s) => s.step_id));
  for (const s of steps) {
    for (const dep of s.depends_on) if (!ids.has(dep)) throw new Error(ERR_UNRESOLVED_DEP(s.step_id, dep));
    for (const gate of s.follows_approval_of ?? []) if (!ids.has(gate)) throw new Error(ERR_UNRESOLVED_FOLLOWS(s.step_id, gate));
  }
}

/** Compose the next wave of steps to dispatch concurrently. Steps are:
 *   • individually eligible (eligibility === null), AND
 *   • pairwise write-key-disjoint within the wave (ADR-004 — two same-key steps never co-dispatch; the later one
 *     waits for the next wave), evaluated in the plan's given order for determinism.
 * With parallel_execution_enabled OFF the wave is capped at ONE step ⇒ plain sequential execution. */
export function nextWave(steps: readonly OptStep[], state: SchedulerState, cfg: Partial<OptConfig> = {}): OptStep[] {
  const config: OptConfig = resolveConfig(cfg);
  assertReferencesResolve(steps); // fail LOUD + CLOSED on a dangling dep/gate before any step is dispatched (#2/#3)
  const wave: OptStep[] = [];
  const claimed = new Set<string>(); // write keys claimed by steps already in this wave
  for (const step of steps) {
    if (!isEligible(step, steps, state)) continue;
    const keys = writeKeys(step);
    if (keys.some((k) => claimed.has(k))) continue; // per-key exclusion within the wave
    wave.push(step);
    for (const k of keys) claimed.add(k);
    if (!config.parallelExecutionEnabled) break; // FLAG-OFF ⇒ sequential (one step per wave)
  }
  return wave;
}

/** What a step does when it runs, in the deterministic scheduler driver. Returns nothing; side effects (if any) are
 * recorded by the caller's RunStep. Injected so the driver is engine-agnostic (Inngest supplies the live one). */
export type RunStep = (step: OptStep) => Promise<void> | void;
/** Resolve whether an approval-gated step is (now) granted. Injected — the live source is the C6 approval store. */
export type ApprovalOracle = (stepId: string) => boolean;

export interface DriveResult {
  /** the ordered waves actually dispatched (each an array of step_ids) — the schedule trace. */
  waves: string[][];
  /** step_ids that never became eligible (e.g. a permanently-pending approval blocked them + their dependents). */
  blocked: string[];
}

/** Drive the whole plan to completion (or to a fixpoint where remaining steps are all blocked), one wave at a time.
 * Deterministic: a wave's steps are "run" (awaited) before the next wave forms, so `running` is empty between waves
 * — the per-key-concurrency check inside a wave (nextWave) is what keeps same-key steps apart. Approvals are polled
 * via the oracle each round, so a mid-run grant unblocks the step (and its dependents) on the next wave. */
export async function driveSchedule(
  steps: readonly OptStep[],
  runStep: RunStep,
  approvals: ApprovalOracle,
  cfg: Partial<OptConfig> = {},
): Promise<DriveResult> {
  const completed = new Set<string>();
  const granted = new Set<string>();
  const waves: string[][] = [];
  const total = steps.length;
  for (;;) {
    for (const s of steps) if (s.approval_gated && approvals(s.step_id)) granted.add(s.step_id);
    const state: SchedulerState = { completed, running: new Set(), granted };
    const wave = nextWave(steps, state, cfg);
    if (wave.length === 0) break; // fixpoint: nothing more eligible
    waves.push(wave.map((s) => s.step_id));
    // "concurrent" dispatch: run all wave steps, then mark them complete (they are write-key-disjoint by nextWave).
    await Promise.all(wave.map((s) => Promise.resolve(runStep(s))));
    for (const s of wave) completed.add(s.step_id);
    if (completed.size === total) break;
  }
  const blocked = steps.filter((s) => !completed.has(s.step_id)).map((s) => s.step_id);
  return { waves, blocked };
}
