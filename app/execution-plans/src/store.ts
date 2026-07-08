// ISSUE-064 (C8 PLAN) — FR-8.PLAN.004: execution-plan versioning + version→outcome attribution + HUMAN-DECIDED
// rollback. The `execution_plans` table is co-owned with ISSUE-061 (which owns routing-time saveVersion); THIS slice
// owns the version DISCIPLINE that 061 does not: the authority-gated, audited, never-automatic rollback (OOS-030 /
// OD-080) and the version→outcome attribution view. Port + in-memory reference model here; live pg adapter in
// supabase-store.ts. Append-only: a rollback never DELETEs a prior version — it appends a new one reinstating the old
// plan_body (you fix forward; the history is preserved — #1).

import { canonicalizePlanBody, type AssignedPlan } from './plan.ts';

// ── the persisted version row (mirrors execution_plans; plan_body is the assigned plan). ─────────────────
export interface PlanVersionRow {
  id: string;
  taskTypeName: string;
  version: number;
  planBody: AssignedPlan;
  previousVersionId: string | null;
  createdBy: string | null;
  createdAtMs: number;
}

export type PlanOutcomeStatus = 'success' | 'failure' | 'partial';
export interface OutcomeTally {
  success: number;
  failure: number;
  partial: number;
}
function emptyTally(): OutcomeTally {
  return { success: 0, failure: 0, partial: 0 };
}

// ── FR-8.PLAN.004.2 rollback authority (OD-080 — Super Admin/Admin). Injected; FAIL-CLOSED (deny unknown). ──
export type RollbackAuthority = (actorId: string) => boolean | Promise<boolean>;
/** The default authority: DENY everything. A deployment MUST inject the real OD-080 predicate — an un-wired rollback
 * authority denies rather than silently permitting a destructive version change (#2). */
export const denyAllRollback: RollbackAuthority = () => false;

export interface RollbackAudit {
  append(row: { actorId: string; taskTypeName: string; fromVersionId: string | null; toVersionId: string; newVersionId: string; reason: string }, nowMs: number): Promise<void>;
}
export class InMemoryRollbackAudit implements RollbackAudit {
  readonly rows: { atMs: number; actorId: string; taskTypeName: string; fromVersionId: string | null; toVersionId: string; newVersionId: string; reason: string }[] = [];
  async append(row: { actorId: string; taskTypeName: string; fromVersionId: string | null; toVersionId: string; newVersionId: string; reason: string }, nowMs: number): Promise<void> {
    this.rows.push({ atMs: nowMs, ...row });
  }
}

export const ERR_ROLLBACK_UNAUTHORIZED = (actorId: string) =>
  `execution-plans: actor '${actorId}' is not authorized to roll back a plan version (OD-080 — Super Admin/Admin only); denied (never automatic, AC-8.PLAN.004.2)`;
export const ERR_ROLLBACK_NO_REASON = 'execution-plans: a rollback requires a non-empty reason (it is audited, AC-8.PLAN.004.2)';
export const ERR_NO_SUCH_VERSION = (id: string) => `execution-plans: no such plan version '${id}'`;
export const ERR_NO_VERSIONS = (t: string) => `execution-plans: no versions exist for task type '${t}'`;

// ── the port. ───────────────────────────────────────────────────────────────────────────────────────────
export interface ExecutionPlanAdmin {
  /** Append a new version for a task type (append-only, unique(task_type_name, version)). */
  saveVersion(taskTypeName: string, planBody: AssignedPlan, previousVersionId: string | null, createdBy: string | null, nowMs: number): Promise<PlanVersionRow>;
  getVersion(id: string): Promise<PlanVersionRow | null>;
  /** The latest (highest-version) row for a task type, or null. */
  latest(taskTypeName: string): Promise<PlanVersionRow | null>;
  /** FR-8.PLAN.004.1 — attribute a recorded run outcome to the plan version that produced it. */
  attributeOutcome(planVersionId: string, status: PlanOutcomeStatus, nowMs: number): Promise<void>;
  /** FR-8.PLAN.004.1 — the per-version outcome tally for a task type (what "outcomes attributable to versions" reads). */
  outcomesByVersion(taskTypeName: string): Promise<Map<string, OutcomeTally>>;
  /**
   * FR-8.PLAN.004.2 — HUMAN-DECIDED rollback: reinstates a prior version's plan_body as a NEW appended version.
   * Authority-gated (OD-080, fail-closed), reason-mandatory, and AUDITED. NEVER automatic and NEVER deletes a prior
   * version (OOS-030 — fix forward, preserve history). Throws if the actor lacks authority or the reason is blank.
   */
  rollback(taskTypeName: string, toVersionId: string, actorId: string, reason: string, nowMs: number): Promise<PlanVersionRow>;
}

// ── the in-memory reference model. ──────────────────────────────────────────────────────────────────────
export interface PlanBacking {
  versions: PlanVersionRow[];
  outcomes: { planVersionId: string; status: PlanOutcomeStatus; atMs: number }[];
  seq: number;
}
export function newPlanBacking(): PlanBacking {
  return { versions: [], outcomes: [], seq: 0 };
}

export class InMemoryExecutionPlanAdmin implements ExecutionPlanAdmin {
  constructor(
    private readonly backing: PlanBacking,
    private readonly deps: { authority?: RollbackAuthority; audit?: RollbackAudit } = {},
  ) {}

  private nextId(): string {
    this.backing.seq += 1;
    return `plan-${String(this.backing.seq).padStart(4, '0')}`;
  }

  async saveVersion(taskTypeName: string, planBody: AssignedPlan, previousVersionId: string | null, createdBy: string | null, nowMs: number): Promise<PlanVersionRow> {
    // canonicalize + assert at the WRITE boundary (OD-201) — plan_body never stores orchestrator shorthand.
    const clean = canonicalizePlanBody(planBody);
    const existing = this.backing.versions.filter((v) => v.taskTypeName === taskTypeName);
    const version = existing.length === 0 ? 1 : Math.max(...existing.map((v) => v.version)) + 1;
    const row: PlanVersionRow = { id: this.nextId(), taskTypeName, version, planBody: clean, previousVersionId, createdBy, createdAtMs: nowMs };
    this.backing.versions.push(row);
    return { ...row };
  }

  async getVersion(id: string): Promise<PlanVersionRow | null> {
    const v = this.backing.versions.find((x) => x.id === id);
    return v ? { ...v } : null;
  }

  async latest(taskTypeName: string): Promise<PlanVersionRow | null> {
    const rows = this.backing.versions.filter((v) => v.taskTypeName === taskTypeName);
    if (rows.length === 0) return null;
    return { ...rows.reduce((a, b) => (b.version > a.version ? b : a)) };
  }

  async attributeOutcome(planVersionId: string, status: PlanOutcomeStatus, nowMs: number): Promise<void> {
    if (!this.backing.versions.some((v) => v.id === planVersionId)) throw new Error(ERR_NO_SUCH_VERSION(planVersionId));
    this.backing.outcomes.push({ planVersionId, status, atMs: nowMs });
  }

  async outcomesByVersion(taskTypeName: string): Promise<Map<string, OutcomeTally>> {
    const ids = new Set(this.backing.versions.filter((v) => v.taskTypeName === taskTypeName).map((v) => v.id));
    const out = new Map<string, OutcomeTally>();
    for (const id of ids) out.set(id, emptyTally());
    for (const o of this.backing.outcomes) {
      if (!ids.has(o.planVersionId)) continue;
      const t = out.get(o.planVersionId)!;
      t[o.status] += 1;
    }
    return out;
  }

  async rollback(taskTypeName: string, toVersionId: string, actorId: string, reason: string, nowMs: number): Promise<PlanVersionRow> {
    // FAIL-CLOSED authority gate FIRST (OD-080) — a non-authorized or un-wired caller is denied, never permitted.
    const authority = this.deps.authority ?? denyAllRollback;
    if (!(await authority(actorId))) throw new Error(ERR_ROLLBACK_UNAUTHORIZED(actorId));
    if (typeof reason !== 'string' || reason.trim().length === 0) throw new Error(ERR_ROLLBACK_NO_REASON);

    const target = this.backing.versions.find((v) => v.id === toVersionId && v.taskTypeName === taskTypeName);
    if (!target) throw new Error(ERR_NO_SUCH_VERSION(toVersionId));
    const latest = await this.latest(taskTypeName);
    if (!latest) throw new Error(ERR_NO_VERSIONS(taskTypeName));

    // append a NEW version reinstating the target's plan_body (never delete the prior — OOS-030 fix-forward).
    const reinstated = await this.saveVersion(taskTypeName, target.planBody, latest.id, actorId, nowMs);
    await this.deps.audit?.append(
      { actorId, taskTypeName, fromVersionId: latest.id, toVersionId, newVersionId: reinstated.id, reason },
      nowMs,
    );
    return reinstated;
  }
}
