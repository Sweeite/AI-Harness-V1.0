// ISSUE-047 — the TriggerStore PORT + in-memory fake reference model (the house port+fake pattern, cf.
// app/rbac, app/config-store, app/webhook-auth). Every live side effect of the C5 TRG entry boundary goes
// through this port so the freeze gate, the at-least-once enqueue, the trigger registry, and the chained
// handoff stay unit-testable with NO live DB. The in-memory fake is BOTH the test double AND the reference
// model the live pg adapter (supabase-store.ts) must match.
//
// Faithful to schema.md §6 (task_queue), §8 (event_log), §14 (deployment_settings). Invariants enforced in
// the fake EXACTLY as the DB / this slice would:
//   1. task_queue.type is enum-constrained to `scheduled | event | human | chained` — any other value is
//      rejected at insert (schema §5 `task_type` enum; AC-5.TRG.001.1). Insert stamps only `type` + `payload`
//      (+ task_name / originating_user_id); the row's full lifecycle is ISSUE-048.
//   2. deployment_settings is a SINGLE row per deployment, read LOCALLY (no cross-deployment key) — OD-162.
//      `frozen_at` non-null (or an UNRESOLVABLE settings read) => the deployment is frozen / ambiguous.
//   3. event_log is APPEND-ONLY — the store exposes appendEvent only (no update/delete of an event row).
//   4. The at-least-once enqueue keeps a delivery watermark keyed by the verified event's delivery id; an
//      insert that fails is NOT watermarked (so it is not acknowledged as processed — AC-5.TRG.005.1) and a
//      re-delivery of an already-watermarked id is de-duplicated (AC-5.TRG.005.2, FR-5.GRP.003 seam).

// ── Domain enums / rows (schema.md §5/§6/§8/§14) ────────────────────────────────────────────────────
export const TASK_TYPES = ['scheduled', 'event', 'human', 'chained'] as const;
export type TaskType = (typeof TASK_TYPES)[number];
export function isTaskType(v: string): v is TaskType {
  return (TASK_TYPES as readonly string[]).includes(v);
}

/** A task_queue row — this slice writes only `type` + `payload` (+ task_name / originating_user_id) on the
 *  trigger-created insert; status/priority/approval/lifecycle are ISSUE-048's QUE. */
export interface TaskRow {
  id: string;
  type: TaskType;
  task_name: string;
  payload: Record<string, unknown>;
  originating_user_id: string | null;
  /** OD-059 chained provenance: the parent task id this successor was handed off from (null = root). */
  parent_task_id: string | null;
  created_at: string;
}

/** deployment_settings (schema §14) — single row per deployment, read locally (OD-162). */
export interface DeploymentSettingsRow {
  frozen_at: string | null; // null = not frozen
  frozen_reason: string | null;
}

/** An append-only event_log row (schema §8) — this slice writes freeze-block + ingest-failure events via the
 *  C7 sink. `event_type` is a string here (not the C7 enum type) because the two values this slice needs —
 *  `dispatch_frozen_blocked` + `ingest_failure` — are a proposed additive enum delta (results/, same
 *  change-control class as OD-170/OD-179); the fake records the string the live adapter will cast. */
export interface EventRow {
  event_type: string;
  task_id: string | null;
  summary: string; // plain-English, never empty (AC-7.LOG.002.2)
  payload: Record<string, unknown>;
}

/** A verified event handed to the harness at the C3→C5 ingress seam. It arrives ALREADY authenticated
 *  (C0 ISSUE-017) + receiver-contracted (C3 ISSUE-037); this slice never re-verifies. `delivery_id` is the
 *  connector's per-delivery id used for the at-least-once watermark + de-dup (FR-5.GRP.003 seam). */
export interface VerifiedEvent {
  delivery_id: string;
  verified: boolean; // MUST be true to be accepted (defence-in-depth; C0/C3 already rejected the rest)
  task_name: string;
  payload: Record<string, unknown>;
}

/** Raised by every gate/guard failure — carries a machine reason so callers surface, never swallow (#3). */
export class TriggerError extends Error {
  constructor(
    public reason: string,
    message: string,
  ) {
    super(message);
    this.name = 'TriggerError';
  }
}
export const ERR_FROZEN = 'deployment_frozen'; // the freeze gate blocked a dispatch (AC-5.TRG.001.3)
export const ERR_BAD_TYPE = 'bad_task_type'; // a non-enum task type (AC-5.TRG.001.1)
export const ERR_UNVERIFIED = 'unverified_event'; // an event that did not pass C0/C3 (AC-5.TRG.003.1)
export const ERR_INGEST_FAILURE = 'ingest_failure'; // insert/engine failure on a verified event (AC-5.TRG.005.1)

// ── The port ────────────────────────────────────────────────────────────────────────────────────
export interface TriggerStore {
  // Freeze gate read — LOCAL, single-row, no cross-deployment key (OD-162). Returns the settings row, or
  // throws to model an UNRESOLVABLE read (which the gate MUST treat as frozen — fail closed on ambiguity).
  readDeploymentSettings(): Promise<DeploymentSettingsRow>;

  // task_queue insert — the ONLY write this slice makes to the queue. Stamps `type` + `payload` (+ name +
  // originating_user_id + parent_task_id). Throws to model an insert failure (unreachable engine / DB error)
  // so the at-least-once path can prove a loud ingest-failure (AC-5.TRG.005.1).
  insertTask(row: {
    type: TaskType;
    task_name: string;
    payload: Record<string, unknown>;
    originating_user_id: string | null;
    parent_task_id: string | null;
  }): Promise<TaskRow>;

  // event_log append (C7 sink) — freeze-block + ingest-failure events. Append-only.
  appendEvent(row: EventRow): Promise<void>;

  // Delivery watermark (FR-5.TRG.005 / FR-5.GRP.003 seam) — has this delivery id already produced a row?
  isDelivered(deliveryId: string): Promise<boolean>;
  markDelivered(deliveryId: string, taskId: string): Promise<void>;
}

let __id = 0;
const nextId = () => `task-${++__id}`;

// ── The in-memory fake reference model ────────────────────────────────────────────────────────────
export class InMemoryTriggerStore implements TriggerStore {
  private settings: DeploymentSettingsRow = { frozen_at: null, frozen_reason: null };
  private tasks: TaskRow[] = [];
  private events: EventRow[] = [];
  private watermark = new Map<string, string>(); // delivery_id -> task_id
  /** Test seam: when true, readDeploymentSettings throws — models an UNRESOLVABLE settings read (the gate
   *  must fail closed on this ambiguity, AC-NFR-INF.012.2). */
  private settingsUnresolvable = false;
  /** Test seam: when true, the NEXT insertTask throws — models an engine-unreachable / DB insert failure
   *  (AC-5.TRG.005.1). One-shot so a retry can succeed. */
  private failNextInsert = false;
  /** Test seam: when true, the NEXT markDelivered throws — models a POST-commit watermark-write failure
   *  (trigger_delivery contention / transient outage AFTER task_queue committed). One-shot. Distinct from
   *  failNextInsert because the watermark is a separate, non-atomic write (logic-sweep fix triggers.ts:177). */
  private failNextMark = false;

  async readDeploymentSettings(): Promise<DeploymentSettingsRow> {
    if (this.settingsUnresolvable) {
      throw new TriggerError('settings_unresolvable', 'deployment_settings could not be resolved');
    }
    return { ...this.settings };
  }

  async insertTask(row: {
    type: TaskType;
    task_name: string;
    payload: Record<string, unknown>;
    originating_user_id: string | null;
    parent_task_id: string | null;
  }): Promise<TaskRow> {
    // Enum guard — the DB `task_type` enum rejects any other value (AC-5.TRG.001.1). Defence-in-depth: the
    // typed API already constrains this, but a value arriving as a raw string must still be rejected.
    if (!isTaskType(row.type)) {
      throw new TriggerError(ERR_BAD_TYPE, `task_queue.type '${row.type}' is not a valid task_type`);
    }
    if (this.failNextInsert) {
      this.failNextInsert = false;
      throw new TriggerError('insert_failed', 'task_queue insert failed (engine unreachable)');
    }
    const created: TaskRow = {
      id: nextId(),
      type: row.type,
      task_name: row.task_name,
      payload: { ...row.payload },
      originating_user_id: row.originating_user_id,
      parent_task_id: row.parent_task_id,
      created_at: new Date().toISOString(),
    };
    this.tasks.push(created);
    return created;
  }

  async appendEvent(row: EventRow): Promise<void> {
    if (!row.summary || row.summary.trim() === '') {
      // event_log.summary is NOT NULL and never empty (AC-7.LOG.002.2) — refuse a blank-summary event so a
      // freeze-block/ingest-failure can never land as an unreadable row.
      throw new TriggerError('empty_summary', 'event_log.summary must not be empty');
    }
    this.events.push({ ...row, payload: { ...row.payload } });
  }

  async isDelivered(deliveryId: string): Promise<boolean> {
    return this.watermark.has(deliveryId);
  }
  async markDelivered(deliveryId: string, taskId: string): Promise<void> {
    if (this.failNextMark) {
      this.failNextMark = false;
      throw new TriggerError('watermark_failed', 'trigger_delivery watermark write failed (contention/outage)');
    }
    this.watermark.set(deliveryId, taskId);
  }

  // ── Test-seam helpers (not part of the port; the live adapter's state is the real silo) ───────────
  _setFrozen(frozenAt: string | null, reason: string | null = null): void {
    this.settings = { frozen_at: frozenAt, frozen_reason: reason };
  }
  _setSettingsUnresolvable(v: boolean): void {
    this.settingsUnresolvable = v;
  }
  _failNextInsert(): void {
    this.failNextInsert = true;
  }
  _failNextMark(): void {
    this.failNextMark = true;
  }
  _tasks(): TaskRow[] {
    return this.tasks.map((t) => ({ ...t }));
  }
  _events(): EventRow[] {
    return this.events.map((e) => ({ ...e }));
  }
  _taskCount(): number {
    return this.tasks.length;
  }
}
