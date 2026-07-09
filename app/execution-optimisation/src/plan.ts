// ISSUE-054 (C5 OPT) — FR-5.OPT.003 Task decomposition (planning step). Build order step 1: the planner produces the
// ordered, dependency-aware execution_plan the parallel scheduler then reads. For a COMPLEX-flagged task an upfront
// planning step runs BEFORE any side-effecting step; the plan is written into the envelope's execution_plan
// (AC-5.OPT.003.1). The plan is bound to chain_depth_limit at build (the NFR-PERF.007 boundary owned by C8/ISSUE-064)
// — over-limit is REJECTED (fail-closed) or TRIMMED with a recorded, visible outcome, NEVER silently truncated (#3 /
// AC-NFR-PERF.007.1). C8 (ISSUE-064) still owns the authoritative depth gate on the persisted plan; this slice binds
// at decomposition time so no over-limit plan is ever handed to the scheduler.
//
// The envelope is owned by ISSUE-050 (@harness/context-envelope ContextEnvelope); this module touches only the two
// fields it needs via a THIN LOCAL PORT: execution_plan (the ordered plan it writes) and previous_outputs (to PROVE
// no step has run yet when the plan is written). It never persists — the live envelope lives in Inngest step-state.

import type { OptConfig } from './config.ts';
import { resolveConfig } from './config.ts';
import type { OptStep } from './dag.ts';
import { resolveDependencyOrder } from './dag.ts';

/** The minimal envelope surface the planner touches (subset of ISSUE-050 ContextEnvelope). */
export interface PlanEnvelope {
  task_id: string;
  /** the ordered execution plan (FR-5.ENV.001 field, populated by THIS slice). */
  execution_plan: unknown[];
  /** every completed step's output. MUST be empty when the plan is written — planning precedes execution. */
  previous_outputs: { step_index: number }[];
}

/** A built plan: the resolved, DAG-ordered steps + the visible depth outcome. */
export interface ExecutionPlan {
  steps: OptStep[];
  /** the resolved chain depth (step count after ordering). */
  depth: number;
  /** how the depth ceiling was applied — 'ok' (within limit), or 'trimmed' (over-limit, visibly cut w/ lowered
   * confidence). 'rejected' never returns a plan — it throws. */
  depth_outcome: 'ok' | 'trimmed';
  /** true when the plan was trimmed — the scheduler/operator must treat it as lower-confidence (AC-NFR-PERF.007.1). */
  trimmed: boolean;
  /** plain-English record of the depth decision (never empty) — the #3 visible-outcome trail. */
  depth_detail: string;
}

export const ERR_NOT_COMPLEX =
  'execution-optimisation: decompose() is the complex-task planning path — a task not flagged complex needs no upfront plan (FR-5.OPT.003)';
export const ERR_PLAN_AFTER_SIDE_EFFECT =
  'execution-optimisation: refusing to write execution_plan after a step already ran — decomposition must precede execution (AC-5.OPT.003.1 / #3)';
export const ERR_OVER_LIMIT = (depth: number, limit: number) =>
  `execution-optimisation: plan resolves to ${depth} steps > chain_depth_limit ${limit} — rejected at build, never silently truncated (AC-NFR-PERF.007.1 / #3)`;

/** Decompose a complex-flagged task into an ordered, dependency-aware execution plan, bound to chain_depth_limit.
 *
 * @param isComplex  the task's complex flag (only complex tasks get an upfront decomposition step, FR-5.OPT.003).
 * @param proposed   the planner's candidate steps (already carrying deps + OPT markers).
 * @param overLimit  what to do when the resolved depth exceeds chain_depth_limit — 'reject' (default, fail-closed)
 *                   or 'trim' (visible cut + lowered confidence). BOTH are visible; neither is a silent truncation.
 */
export function decompose(
  isComplex: boolean,
  proposed: readonly OptStep[],
  cfg: Partial<OptConfig> = {},
  overLimit: 'reject' | 'trim' = 'reject',
): ExecutionPlan {
  if (!isComplex) throw new Error(ERR_NOT_COMPLEX);
  const config: OptConfig = resolveConfig(cfg);
  const ordered = resolveDependencyOrder(proposed); // rejects dup ids / unknown deps / cycles LOUD
  const limit = config.chainDepthLimit;
  if (ordered.length > limit) {
    if (overLimit === 'reject') throw new Error(ERR_OVER_LIMIT(ordered.length, limit));
    // trim: keep the first `limit` steps in dependency order, but only if the kept prefix is still a valid DAG
    // (every kept step's deps are also kept). We keep a dependency-closed prefix, never an arbitrary cut.
    const kept: OptStep[] = [];
    const keptIds = new Set<string>();
    for (const s of ordered) {
      if (kept.length >= limit) break;
      if (s.depends_on.every((d) => keptIds.has(d))) {
        kept.push(s);
        keptIds.add(s.step_id);
      }
    }
    return {
      steps: kept,
      depth: kept.length,
      depth_outcome: 'trimmed',
      trimmed: true,
      depth_detail: `plan of ${ordered.length} steps exceeded chain_depth_limit ${limit}; trimmed to a dependency-closed prefix of ${kept.length} with lowered confidence (visible, never silent — AC-NFR-PERF.007.1)`,
    };
  }
  return {
    steps: ordered,
    depth: ordered.length,
    depth_outcome: 'ok',
    trimmed: false,
    depth_detail: `plan resolves to ${ordered.length} steps within chain_depth_limit ${limit}`,
  };
}

/** Write the built plan into the envelope's execution_plan — REJECTING if any step has already run (planning must
 * precede execution, AC-5.OPT.003.1). Returns the mutated envelope (execution_plan set to the ordered steps). This
 * is the "plan before any side-effecting step" guarantee, enforced loud rather than assumed. */
export function writePlanToEnvelope(env: PlanEnvelope, plan: ExecutionPlan): PlanEnvelope {
  if (env.previous_outputs.length > 0) throw new Error(ERR_PLAN_AFTER_SIDE_EFFECT);
  env.execution_plan = [...plan.steps];
  return env;
}
