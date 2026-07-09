// ISSUE-054 (C5 OPT) — the DAG step model this slice's planner + scheduler operate over, and the pure dependency
// resolver. This is a THIN LOCAL PORT over the task-graph step shape (task_graph_versions.steps jsonb, owned by
// ISSUE-049 / @harness/task-graphs GraphStep: step_id, kind, depends_on, failure_mode). It is NOT a redefinition of
// that store — the scheduler here consumes an injected, already-resolved step list and adds the OPT-layer markers
// the planner/DAG stamps for OD-056 approval semantics + ADR-004 per-key concurrency. Keeping it a local port keeps
// this package self-contained and its concurrency simulation deterministic (AF-113) without dragging in a sibling's
// live pg adapter / node_modules.
//
// Cites: schema.md §6 task_graph_versions.steps (per-step deps) · ADR-004 (per-key concurrency = disjoint-entity
// writes are safe to parallelise) · OD-056 (step-level approval semantics) · FR-5.OPT.001.

/** Step kinds mirror @harness/task-graphs STEP_KINDS. tool_write/memory_write are the side-effecting (irreversible
 * by default) kinds; tool_call/memory_read/ai_call are read-only/reversible by default. The planner may override
 * `reversible` explicitly (a tool_call CAN be irreversible), so the marker — not the kind — is authoritative. */
export const STEP_KINDS = ['tool_call', 'memory_read', 'ai_call', 'tool_write', 'memory_write'] as const;
export type StepKind = (typeof STEP_KINDS)[number];

const DEFAULT_IRREVERSIBLE_KINDS: ReadonlySet<StepKind> = new Set(['tool_write', 'memory_write']);

/** A step as the OPT scheduler sees it — the task-graph GraphStep plus the planner/DAG-stamped OPT markers. */
export interface OptStep {
  /** stable within the plan; the dependency-edge + idempotency identity (mirrors GraphStep.step_id). */
  step_id: string;
  kind: StepKind;
  /** step_ids this step depends on (mirrors GraphStep.depends_on). All must resolve earlier in the DAG order. */
  depends_on: string[];
  /** whether this step's effect is reversible/read-only. Absent ⇒ derived from `kind`. An IRREVERSIBLE step is the
   * one OD-056 guards: it may not fire ahead of a pending approval it should logically follow. */
  reversible?: boolean;
  /** true ⇒ this step is itself approval-gated: it blocks (itself + its dependents) until approved (OD-056). */
  approval_gated?: boolean;
  /** step_ids of approval-gated steps whose approval this (irreversible) step must LOGICALLY follow, even when
   * there is no hard data dependency edge. The planner/DAG stamps this ordering (AC-5.OPT.001.2). */
  follows_approval_of?: string[];
  /** the shared_context keys / entity ids this step WRITES — its ADR-004 per-key concurrency keys. Two steps that
   * share a write key must be serialised (never in the same concurrent wave); disjoint keys parallelise safely. */
  write_keys?: string[];
}

/** Is this step irreversible (a side effect that can't be undone)? The marker wins; else derive from kind. */
export function isIrreversible(step: OptStep): boolean {
  if (step.reversible !== undefined) return !step.reversible;
  return DEFAULT_IRREVERSIBLE_KINDS.has(step.kind);
}

/** The per-key concurrency keys a step writes (ADR-004). Empty ⇒ the step writes no shared state (always parallel-safe). */
export function writeKeys(step: OptStep): string[] {
  return step.write_keys ?? [];
}

export const ERR_DUP_STEP_ID = (id: string) =>
  `execution-optimisation: duplicate step_id '${id}' — step ids must be unique within a plan (FR-5.OPT.003)`;
export const ERR_UNKNOWN_DEP = (id: string, dep: string) =>
  `execution-optimisation: step '${id}' depends on unknown step '${dep}' (FR-5.OPT.001 DAG)`;
export const ERR_UNKNOWN_FOLLOWS = (id: string, dep: string) =>
  `execution-optimisation: step '${id}' follows_approval_of unknown step '${dep}' (OD-056 ordering marker)`;
export const ERR_CYCLE = (cycle: string[]) =>
  `execution-optimisation: dependency cycle detected (${cycle.join(' → ')}) — a plan must be a DAG (FR-5.OPT.001)`;

/** Validate the step set (unique ids, known deps + follows targets), then return a deterministic topological order
 * (Kahn; ties broken by original array position). Rejects unknown deps, dup ids, and cycles LOUD (#3). This is the
 * same DAG discipline @harness/task-graphs resolveDependencyOrder enforces, re-stated locally over OptStep. */
export function resolveDependencyOrder(steps: readonly OptStep[]): OptStep[] {
  const byId = new Map<string, OptStep>();
  for (const s of steps) {
    if (byId.has(s.step_id)) throw new Error(ERR_DUP_STEP_ID(s.step_id));
    byId.set(s.step_id, s);
  }
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const s of steps) {
    indegree.set(s.step_id, s.depends_on.length);
    for (const dep of s.depends_on) {
      if (!byId.has(dep)) throw new Error(ERR_UNKNOWN_DEP(s.step_id, dep));
      (dependents.get(dep) ?? dependents.set(dep, []).get(dep)!).push(s.step_id);
    }
    for (const f of s.follows_approval_of ?? []) {
      if (!byId.has(f)) throw new Error(ERR_UNKNOWN_FOLLOWS(s.step_id, f));
    }
  }
  // Kahn, seeding in original order for determinism.
  const queue: string[] = [];
  for (const s of steps) if ((indegree.get(s.step_id) ?? 0) === 0) queue.push(s.step_id);
  const order: OptStep[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(byId.get(id)!);
    for (const d of dependents.get(id) ?? []) {
      const next = (indegree.get(d) ?? 0) - 1;
      indegree.set(d, next);
      if (next === 0) queue.push(d);
    }
  }
  if (order.length !== steps.length) {
    const stuck = steps.filter((s) => !order.includes(s)).map((s) => s.step_id);
    throw new Error(ERR_CYCLE(stuck));
  }
  return order;
}

/** The transitive-dependent closure of a step id (itself excluded) — used to prove "an approval-gated step blocks
 * itself + its dependents" (AC-5.OPT.001.1). */
export function transitiveDependents(steps: readonly OptStep[], rootId: string): Set<string> {
  const dependents = new Map<string, string[]>();
  for (const s of steps) for (const dep of s.depends_on) (dependents.get(dep) ?? dependents.set(dep, []).get(dep)!).push(s.step_id);
  const out = new Set<string>();
  const stack = [...(dependents.get(rootId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    for (const d of dependents.get(id) ?? []) stack.push(d);
  }
  return out;
}
