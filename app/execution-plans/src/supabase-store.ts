// ISSUE-064 (C8 PLAN) — the LIVE pg adapter for execution-plan versioning + attribution + human-only rollback.
// Implements the SAME ExecutionPlanAdmin port as the in-memory reference model, against the REAL DDL:
//   • execution_plans (baseline 0001; co-owned w/ ISSUE-061) — the append-only versioned store.
//   • event_log (baseline 0001) — where a version→outcome attribution + a rollback audit are recorded (routing_outcome
//     / plan_rollback event_types; the routing_outcome convention matches ISSUE-061's recordOutcome).
//
// ⚠️ NOT YET RUN LIVE (R10). Authored to the DDL so the seam is real + typechecks; the in-memory reference model is
// the proven contract. Do NOT claim these paths verified until the live-adapter smoke records evidence.
//
// FAIL-SAFE, LIVE-SPECIFIC: plan_body always stores CANONICAL failure-mode values (taxonomy.ts) so a downstream read
// against the step_failure_mode enum never diverges (the OD-201 drift, closed here). The version number is derived
// with `coalesce(max(version),0)+1` and the unique(task_type_name, version) constraint is the race backstop (a
// concurrent save trips 23505 rather than duplicating a version). Rollback is authority-gated + audited BEFORE any
// insert (#2), and NEVER deletes a prior version (OOS-030).

import pg from 'pg';
import { canonicalizePlanBody, type AssignedPlan } from './plan.ts';
import {
  ERR_NO_SUCH_VERSION,
  ERR_NO_VERSIONS,
  ERR_ROLLBACK_NO_REASON,
  ERR_ROLLBACK_UNAUTHORIZED,
  denyAllRollback,
  type ExecutionPlanAdmin,
  type OutcomeTally,
  type PlanOutcomeStatus,
  type PlanVersionRow,
  type RollbackAuthority,
} from './store.ts';

export type QueryExec = <R extends pg.QueryResultRow>(text: string, params?: unknown[]) => Promise<{ rows: R[]; rowCount?: number | null }>;

/** The event_type values this slice writes to event_log (added additively in migration 0037). A live insert of an
 * unlisted value throws '22P02'; the `check` gate verifies these exist in the corpus so the write never fails silently. */
export const EVT_PLAN_OUTCOME = 'plan_outcome' as const;
export const EVT_PLAN_ROLLBACK = 'plan_rollback' as const;
export const PLAN_EVENT_TYPES: readonly string[] = [EVT_PLAN_OUTCOME, EVT_PLAN_ROLLBACK] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RawVersion {
  id: string;
  task_type_name: string;
  version: number;
  plan_body: AssignedPlan;
  previous_version_id: string | null;
  created_by: string | null;
  created_secs: string;
}
function toRow(r: RawVersion): PlanVersionRow {
  return {
    id: r.id,
    taskTypeName: r.task_type_name,
    version: r.version,
    planBody: r.plan_body,
    previousVersionId: r.previous_version_id,
    createdBy: r.created_by,
    createdAtMs: Math.round(Number(r.created_secs) * 1000),
  };
}
const COLS = `id, task_type_name, version, plan_body, previous_version_id::text as previous_version_id,
  created_by::text as created_by, extract(epoch from created_at) as created_secs`;

export class SupabaseExecutionPlanAdmin implements ExecutionPlanAdmin {
  private pool: pg.Pool | null = null;
  private readonly exec: QueryExec;
  constructor(
    connectionString: string,
    private readonly deps: { authority?: RollbackAuthority; queryExec?: QueryExec } = {},
  ) {
    if (deps.queryExec) {
      this.exec = deps.queryExec;
    } else {
      const ssl = /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: false };
      const pool = new pg.Pool({ connectionString, ssl });
      this.pool = pool;
      this.exec = (text, params) => pool.query(text, params);
    }
  }

  /** Run `fn` inside a real single-client transaction when a pool exists (correct atomicity — pool.query() would
   * spread statements across connections); against the injected seam (tests) it emits begin/commit/rollback through
   * the seam so the wrapping + on-error rollback are observable. */
  private async withTx<T>(fn: (exec: QueryExec) => Promise<T>): Promise<T> {
    if (this.pool) {
      const client = await this.pool.connect();
      try {
        await client.query('begin');
        const bound: QueryExec = (text, params) => client.query(text, params);
        const r = await fn(bound);
        await client.query('commit');
        return r;
      } catch (e) {
        await client.query('rollback');
        throw e;
      } finally {
        client.release();
      }
    }
    await this.exec('begin');
    try {
      const r = await fn(this.exec);
      await this.exec('commit');
      return r;
    } catch (e) {
      await this.exec('rollback');
      throw e;
    }
  }

  private async insertVersion(exec: QueryExec, taskTypeName: string, planBody: AssignedPlan, previousVersionId: string | null, createdBy: string | null, nowMs: number): Promise<PlanVersionRow> {
    // canonicalize + assert at the WRITE boundary (OD-201) — plan_body never stores orchestrator shorthand.
    const clean = canonicalizePlanBody(planBody);
    const res = await exec<RawVersion>(
      `insert into execution_plans (task_type_name, version, plan_body, previous_version_id, created_by, created_at)
       values ($1, (select coalesce(max(version),0)+1 from execution_plans where task_type_name = $1), $2::jsonb, $3::uuid, $4::uuid, $5::timestamptz)
       returning ${COLS}`,
      [taskTypeName, JSON.stringify(clean), previousVersionId, createdBy, new Date(nowMs).toISOString()],
    );
    return toRow(res.rows[0]!);
  }

  async saveVersion(taskTypeName: string, planBody: AssignedPlan, previousVersionId: string | null, createdBy: string | null, nowMs: number): Promise<PlanVersionRow> {
    return this.insertVersion(this.exec, taskTypeName, planBody, previousVersionId, createdBy, nowMs);
  }

  async getVersion(id: string): Promise<PlanVersionRow | null> {
    if (!UUID_RE.test(id)) return null; // a non-uuid id cannot be a row — match the in-memory model's null (not a raw 22P02).
    const res = await this.exec<RawVersion>(`select ${COLS} from execution_plans where id = $1::uuid`, [id]);
    return res.rows[0] ? toRow(res.rows[0]) : null;
  }

  async latest(taskTypeName: string): Promise<PlanVersionRow | null> {
    const res = await this.exec<RawVersion>(`select ${COLS} from execution_plans where task_type_name = $1 order by version desc limit 1`, [taskTypeName]);
    return res.rows[0] ? toRow(res.rows[0]) : null;
  }

  async attributeOutcome(planVersionId: string, status: PlanOutcomeStatus, nowMs: number): Promise<void> {
    const exists = await this.getVersion(planVersionId);
    if (!exists) throw new Error(ERR_NO_SUCH_VERSION(planVersionId));
    await this.exec(
      `insert into event_log (event_type, entity_ids, summary, payload, created_at)
       values ($1::event_type, array[]::uuid[], $2, $3::jsonb, $4::timestamptz)`,
      [EVT_PLAN_OUTCOME, `plan outcome ${status} attributed to version ${planVersionId}`, JSON.stringify({ plan_version_id: planVersionId, status }), new Date(nowMs).toISOString()],
    );
  }

  async outcomesByVersion(taskTypeName: string): Promise<Map<string, OutcomeTally>> {
    const versions = await this.exec<{ id: string }>(`select id::text as id from execution_plans where task_type_name = $1`, [taskTypeName]);
    const out = new Map<string, OutcomeTally>();
    for (const v of versions.rows) out.set(v.id, { success: 0, failure: 0, partial: 0 });
    if (out.size === 0) return out;
    const ids = [...out.keys()];
    const rows = await this.exec<{ plan_version_id: string; status: PlanOutcomeStatus }>(
      `select payload->>'plan_version_id' as plan_version_id, payload->>'status' as status
         from event_log
        where event_type = $1::event_type and payload->>'plan_version_id' = any($2::text[])`,
      [EVT_PLAN_OUTCOME, ids],
    );
    for (const r of rows.rows) {
      const t = out.get(r.plan_version_id);
      if (t && (r.status === 'success' || r.status === 'failure' || r.status === 'partial')) t[r.status] += 1;
    }
    return out;
  }

  async rollback(taskTypeName: string, toVersionId: string, actorId: string, reason: string, nowMs: number): Promise<PlanVersionRow> {
    const authority = this.deps.authority ?? denyAllRollback;
    if (!(await authority(actorId))) throw new Error(ERR_ROLLBACK_UNAUTHORIZED(actorId));
    if (typeof reason !== 'string' || reason.trim().length === 0) throw new Error(ERR_ROLLBACK_NO_REASON);

    if (!UUID_RE.test(toVersionId)) throw new Error(ERR_NO_SUCH_VERSION(toVersionId));
    const target = await this.exec<RawVersion>(`select ${COLS} from execution_plans where id = $1::uuid and task_type_name = $2`, [toVersionId, taskTypeName]);
    if (!target.rows[0]) throw new Error(ERR_NO_SUCH_VERSION(toVersionId));
    const latest = await this.latest(taskTypeName);
    if (!latest) throw new Error(ERR_NO_VERSIONS(taskTypeName));
    const targetBody = target.rows[0].plan_body;

    // BLOCKER-fix: the version-append AND its audit are ONE transaction — a reinstated version is never committed
    // without its audit (AC-8.PLAN.004.2). Append-only (never deletes the prior — OOS-030 fix-forward).
    return this.withTx(async (tx) => {
      const reinstated = await this.insertVersion(tx, taskTypeName, targetBody, latest.id, actorId, nowMs);
      await tx(
        `insert into event_log (event_type, entity_ids, summary, payload, created_at)
         values ($1::event_type, array[]::uuid[], $2, $3::jsonb, $4::timestamptz)`,
        [
          EVT_PLAN_ROLLBACK,
          `human rollback of '${taskTypeName}' to version ${toVersionId} by ${actorId}`,
          JSON.stringify({ actor_id: actorId, task_type_name: taskTypeName, from_version_id: latest.id, to_version_id: toVersionId, new_version_id: reinstated.id, reason }),
          new Date(nowMs).toISOString(),
        ],
      );
      return reinstated;
    });
  }

  async close(): Promise<void> {
    await this.pool?.end();
  }
}

export { SupabaseExecutionPlanAdmin as default };
