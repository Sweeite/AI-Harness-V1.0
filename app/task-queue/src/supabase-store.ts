// ISSUE-048 (C5 QUE) — the LIVE TaskQueue adapter (pg, against the client-owned silo Supabase). The only
// module that imports `pg`. It implements the same port as InMemoryTaskQueue against the real DDL
// (results/proposed-migration-0008_task_queue.sql, authored to schema.md §6).
//
// ⚠️ NOT YET RUN LIVE. The permanent-audit REVOKE actually rejecting a delete, the state-machine gate under
// concurrent writers, and the escalation INSERT landing on the live event_log are proven by the operator at
// the Stage-3 checkpoint (a 💻 full/live env). This adapter is authored to the DDL so the seam is real and
// typechecks; InMemoryTaskQueue is the proven reference model. Do NOT claim these paths verified until the
// live run records evidence.
//
// Design notes tied to the three non-negotiables:
//   #1 no delete method exists here either — the port has none, and DELETE is REVOKEd at the DB (0008). error
//      is appended via jsonb || (never overwritten). A hold into flagged persists work-in-progress to
//      task_history (ISSUE-050's store) so nothing is discarded.
//   #2 status writes run through the same ALLOWED_TRANSITIONS table (validated in TS before the UPDATE);
//      `flagged` is set only by setFlagged. Reads/writes run as the postgres owner (RLS-bypass) (ADR-006 harness-enforced path; runtime role = postgres owner per OD-193).
//   #3 the staleness escalation INSERTs onto event_log; a task never silently drops out of awaiting_approval.

import pg from 'pg';
import {
  ALLOWED_TRANSITIONS,
  DEFAULT_QUEUE_CONFIG,
  ERR_APPROVE_NOT_WAITING,
  ERR_BAD_TRANSITION,
  ERR_FLAGGED_NOT_C6,
  ERR_UNKNOWN_STATUS,
  isTaskStatus,
  type EventSink,
  type NewTask,
  type QueueConfig,
  type TaskQueue,
  type TaskQueueRow,
  type TaskStatus,
  type WorkInProgress,
} from './store.ts';

// error is `jsonb` with NO default in the baseline DDL (0001_baseline.sql) — a fresh row is NULL. The
// InMemoryTaskQueue fake (and the TaskQueueRow.error: ErrorAttempt[] type) promise an ARRAY, so EVERY read
// path coalesces NULL→'[]' here — one place, so enqueue-return / get / dequeue / transition can't drift.
// A consumer doing `row.error.map(...)` therefore never crashes on a not-yet-failed task (#1/#3).
const COLS = `id, type, task_name, payload, status, priority, requires_approval, approved_by, approved_at,
  awaiting_approval_at, originating_user_id, action_payload, attempts, next_retry_at, coalesce(error, '[]'::jsonb) as error, completed_at, created_at`;

export class SupabaseTaskQueue implements TaskQueue {
  private pool: pg.Pool;

  constructor(
    connectionString: string,
    private readonly sink: EventSink,
    private readonly config: QueueConfig = DEFAULT_QUEUE_CONFIG,
  ) {
    const ssl = /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: false };
    this.pool = new pg.Pool({ connectionString, ssl });
  }

  async enqueue(task: NewTask, _now: number): Promise<TaskQueueRow> {
    const res = await this.pool.query<TaskQueueRow>(
      `insert into task_queue (type, task_name, payload, priority, requires_approval, originating_user_id, action_payload)
       values ($1, $2, $3::jsonb, $4, $5, $6, $7::jsonb)
       returning ${COLS}`,
      [
        task.type,
        task.task_name,
        JSON.stringify(task.payload ?? {}),
        task.priority ?? 100,
        task.requires_approval ?? false,
        task.originating_user_id ?? null,
        task.action_payload == null ? null : JSON.stringify(task.action_payload),
      ],
    );
    return res.rows[0]!;
  }

  async get(id: string): Promise<TaskQueueRow | null> {
    const res = await this.pool.query<TaskQueueRow>(`select ${COLS} from task_queue where id = $1`, [id]);
    return res.rows[0] ?? null;
  }

  async dequeue(_now: number): Promise<TaskQueueRow | null> {
    // Atomic claim: pick the highest-priority pending row (lower first when asc), lock it FOR UPDATE SKIP
    // LOCKED so concurrent workers never claim the same row, and move it to running — unless it requires
    // approval, in which case it goes to awaiting_approval and is NOT run (FR-5.QUE.005).
    const dir = this.config.priorityOrder === 'asc' ? 'asc' : 'desc';
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const pick = await client.query<TaskQueueRow>(
        `select ${COLS} from task_queue
         where status = 'pending'
         order by priority ${dir}, created_at asc
         limit 1
         for update skip locked`,
      );
      const row = pick.rows[0];
      if (!row) {
        await client.query('commit');
        return null;
      }
      const to: TaskStatus = row.requires_approval ? 'awaiting_approval' : 'running';
      // 0028: stamp awaiting_approval_at when the task parks in awaiting_approval (the FR-5.QUE.005.2 clock).
      const upd = await client.query<TaskQueueRow>(
        `update task_queue
         set status = $2,
             awaiting_approval_at = case when $2 = 'awaiting_approval' then now() else awaiting_approval_at end
         where id = $1 returning ${COLS}`,
        [row.id, to],
      );
      await client.query('commit');
      return upd.rows[0]!;
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }

  async transition(id: string, to: TaskStatus, _now: number): Promise<TaskQueueRow> {
    if (!isTaskStatus(to)) throw new Error(ERR_UNKNOWN_STATUS(to));
    if (to === 'flagged') throw new Error(ERR_FLAGGED_NOT_C6);
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const cur = await client.query<{ status: TaskStatus }>(
        `select status from task_queue where id = $1 for update`,
        [id],
      );
      const from = cur.rows[0]?.status;
      if (!from) throw new Error(`task_queue: no such task '${id}'`);
      if (!ALLOWED_TRANSITIONS[from].includes(to)) throw new Error(ERR_BAD_TRANSITION(from, to));
      const terminal = to === 'completed' || to === 'failed';
      const upd = await client.query<TaskQueueRow>(
        `update task_queue
         set status = $2,
             completed_at = case when $3 then now() else completed_at end,
             awaiting_approval_at = case when $2 = 'awaiting_approval' then now() else awaiting_approval_at end
         where id = $1
         returning ${COLS}`,
        [id, to, terminal],
      );
      await client.query('commit');
      return upd.rows[0]!;
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }

  async setFlagged(id: string, wip: WorkInProgress, _now: number): Promise<TaskQueueRow> {
    // C6-only quarantine hold. Persist the work-in-progress to task_history (ISSUE-050's originals store)
    // BEFORE flipping status so nothing is discarded on the hold (#1 / AC-5.QUE.003.2). The envelope_ref
    // points at the live context envelope; completed-step outputs are retained as task_history rows.
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const cur = await client.query<{ status: TaskStatus }>(
        `select status from task_queue where id = $1 for update`,
        [id],
      );
      const from = cur.rows[0]?.status;
      if (!from) throw new Error(`task_queue: no such task '${id}'`);
      if (from !== 'flagged' && !ALLOWED_TRANSITIONS[from].includes('flagged')) {
        throw new Error(ERR_BAD_TRANSITION(from, 'flagged'));
      }
      for (let idx = 0; idx < wip.completed_step_outputs.length; idx++) {
        await client.query(
          `insert into task_history (task_id, step_index, full_output)
           values ($1, $2, $3::jsonb)
           on conflict (task_id, step_index) do nothing`,
          [id, idx, JSON.stringify(wip.completed_step_outputs[idx])],
        );
      }
      const upd = await client.query<TaskQueueRow>(
        `update task_queue set status = 'flagged' where id = $1 returning ${COLS}`,
        [id],
      );
      await client.query('commit');
      return upd.rows[0]!;
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }

  async approve(id: string, approver: string, _now: number): Promise<TaskQueueRow> {
    const res = await this.pool.query<TaskQueueRow>(
      `update task_queue
       set approved_by = $2, approved_at = now(), status = 'running'
       where id = $1 and status = 'awaiting_approval'
       returning ${COLS}`,
      [id, approver],
    );
    if (!res.rows[0]) throw new Error(ERR_APPROVE_NOT_WAITING);
    return res.rows[0];
  }

  async reject(id: string, approver: string, reason: string, _now: number): Promise<TaskQueueRow> {
    const res = await this.pool.query<TaskQueueRow>(
      `update task_queue
       set approved_by = $2, approved_at = now(), status = 'failed', completed_at = now(),
           error = coalesce(error, '[]'::jsonb) || jsonb_build_array(
             jsonb_build_object('attempt', attempts + 1, 'message', $3::text, 'at', now()))
       where id = $1 and status = 'awaiting_approval'
       returning ${COLS}`,
      [id, approver, `approval rejected: ${reason}`],
    );
    if (!res.rows[0]) throw new Error(ERR_APPROVE_NOT_WAITING);
    return res.rows[0];
  }

  async recordError(id: string, message: string, _now: number): Promise<TaskQueueRow> {
    // FR-5.QUE.006 (#1): APPEND to the jsonb array — never overwrite. attempts increments in the same UPDATE.
    const res = await this.pool.query<TaskQueueRow>(
      `update task_queue
       set attempts = attempts + 1,
           error = coalesce(error, '[]'::jsonb) || jsonb_build_array(
             jsonb_build_object('attempt', attempts + 1, 'message', $2::text, 'at', now()))
       where id = $1
       returning ${COLS}`,
      [id, message],
    );
    if (!res.rows[0]) throw new Error(`task_queue: no such task '${id}'`);
    return res.rows[0];
  }

  async escalateStaleApprovals(_now: number): Promise<TaskQueueRow[]> {
    // AC-5.QUE.005.2: find awaiting_approval rows older than the threshold, EMIT an approval_queue_stale
    // event per row on event_log, and leave them awaiting_approval. Never auto-approve (#2), never drop (#3).
    const threshold = this.config.approvalStalenessThresholdSeconds;
    // 0028: measure time SINCE the task entered awaiting_approval — coalesce(awaiting_approval_at, created_at),
    // created_at fallback for pre-0028 rows — not total task age (FR-5.QUE.005.2), else a task that sat pending
    // behind other work escalates prematurely + misreports the human wait.
    const res = await this.pool.query<TaskQueueRow & { age_seconds: string }>(
      `select ${COLS},
              extract(epoch from (now() - coalesce(awaiting_approval_at, created_at)))::bigint as age_seconds
       from task_queue
       where status = 'awaiting_approval'
         and coalesce(awaiting_approval_at, created_at) < now() - ($1 || ' seconds')::interval
       order by coalesce(awaiting_approval_at, created_at) asc`,
      [String(threshold)],
    );
    for (const row of res.rows) {
      await this.sink.append({
        task_id: row.id,
        event_type: 'approval_queue_stale',
        entity_ids: [row.id],
        summary: `Task '${row.task_name}' has been awaiting approval for ${row.age_seconds}s (> ${threshold}s threshold) — escalating; not auto-approved.`,
        payload: { task_id: row.id, age_seconds: Number(row.age_seconds), threshold_seconds: threshold, status: row.status },
      });
    }
    return res.rows.map(({ age_seconds: _drop, ...r }) => r);
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}
