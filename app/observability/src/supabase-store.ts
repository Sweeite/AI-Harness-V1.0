// ISSUE-011 — the LIVE pg adapters for the observability ports, authored to the ISSUE-008 0001_baseline DDL
// (app/silo/migrations/0001_baseline.sql). This is the ONLY module that imports `pg`.
//
// ⚠️ NOT YET RUN LIVE in this offline half. The InMemory* stores (store.ts) are the proven reference model;
// these adapters are the thin translation so the seam is real and typechecks. They will be exercised against
// a real silo Supabase at integration time. Every write is append-only: the DB's own t_append_only trigger
// (0001_baseline.sql L707) enforces the immutability these adapters rely on — a spurious UPDATE/DELETE is
// rejected at the substrate, not just here.
//
// Isolation (#2): every table here is a CLIENT-SILO table (schema.md §8) — this reads/writes the silo DB
// (DATABASE_URL), never the management plane. The mgmt-plane push that CARRIES the health bits is ISSUE-012.

import pg from "pg";
import type {
  EventLogRow,
  GuardrailLogRow,
  NotificationInput,
  NotificationRow,
  TaskTerminalRow,
} from "./types.ts";
import { isEventType } from "./types.ts";
import {
  AppendOnlyViolation,
  EventLogWriteFailure,
  InvalidEventType,
  type EventLogStore,
  type GuardrailLogStore,
  type NotificationStore,
  type TaskQueueStore,
} from "./store.ts";

export class SupabaseEventLogStore implements EventLogStore {
  private pool: pg.Pool;
  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString });
  }

  async append(row: EventLogRow): Promise<void> {
    if (!isEventType(row.event_type)) throw new InvalidEventType(row.event_type);
    try {
      await this.pool.query(
        `insert into event_log
           (id, task_id, event_type, entity_ids, summary, payload, duration_ms, cost_tokens, cost_unknown,
            answer_mode, redacted_at, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          row.id,
          row.task_id,
          row.event_type,
          row.entity_ids,
          row.summary,
          row.payload === null ? null : JSON.stringify(row.payload),
          row.duration_ms,
          row.cost_tokens,
          row.cost_unknown,
          row.answer_mode,
          row.redacted_at,
          row.created_at,
        ],
      );
    } catch (e) {
      // A unique-violation on id is an attempted clobber (append-only); anything else is a substrate failure
      // the writer must surface out-of-band (AC-7.LOG.003.2).
      const code = (e as { code?: string }).code;
      if (code === "23505") throw new AppendOnlyViolation("UPDATE");
      throw new EventLogWriteFailure((e as Error).message);
    }
  }

  async all(): Promise<EventLogRow[]> {
    const { rows } = await this.pool.query<EventLogRow>(
      `select id, task_id, event_type, entity_ids, summary, payload, duration_ms, cost_tokens, cost_unknown,
              answer_mode, redacted_at, created_at
         from event_log`,
    );
    return rows;
  }

  async redactTombstone(id: string, redactedAt: string): Promise<void> {
    // The ONE whitelisted UPDATE (null→non-null redacted_at) the t_append_only trigger permits.
    const res = await this.pool.query(
      `update event_log
          set summary = '[redacted]', entity_ids = null, payload = null, redacted_at = $2
        where id = $1 and redacted_at is null`,
      [id, redactedAt],
    );
    // A 0-row update is ambiguous: either the id does not exist (a lost compliance-erasure that MUST be loud —
    // #3, finding M10) or the row is already redacted (a legitimate one-way idempotent no-op). Distinguish by
    // re-reading, matching InMemoryEventLogStore.redactTombstone — never resolve silently on a missing id.
    if (res.rowCount === 0) {
      const check = await this.pool.query<{ redacted_at: string | null }>(
        `select redacted_at from event_log where id = $1`,
        [id],
      );
      if (check.rowCount === 0) throw new Error(`event_log row ${id} not found for redaction`);
      // else: row exists and is already redacted — idempotent no-op (the intended one-way behaviour).
    }
  }

  async prune(id: string): Promise<void> {
    // OD-180 (migration 0005): the t_append_only trigger forbids DELETE on event_log EXCEPT inside a
    // transaction that has declared itself the retention job via `set local app.retention_prune = 'on'`.
    // `set local` is transaction-scoped, so it auto-resets at COMMIT/ROLLBACK and cannot leak past this one
    // prune. The DELETE and the flag MUST share the same connection+transaction — so we check out a single
    // client (a Pool would otherwise run them on different connections and the flag wouldn't apply).
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("set local app.retention_prune = 'on'");
      await client.query(`delete from event_log where id = $1`, [id]);
      await client.query("commit");
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}

export class SupabaseTaskQueueStore implements TaskQueueStore {
  private pool: pg.Pool;
  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString });
  }
  async terminalTasks(): Promise<TaskTerminalRow[]> {
    const { rows } = await this.pool.query<{ task_id: string; status: string }>(
      `select id as task_id, status::text as status
         from task_queue
        where status in ('completed','failed')`,
    );
    return rows.map((r) => ({ task_id: r.task_id, status: r.status as TaskTerminalRow["status"] }));
  }
  async end(): Promise<void> {
    await this.pool.end();
  }
}

export class SupabaseGuardrailLogStore implements GuardrailLogStore {
  private pool: pg.Pool;
  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString });
  }
  async all(): Promise<GuardrailLogRow[]> {
    const { rows } = await this.pool.query<{ id: string; task_id: string | null; created_at: Date }>(
      `select id, task_id, created_at from guardrail_log`,
    );
    return rows.map((r) => ({ id: r.id, task_id: r.task_id, created_at: r.created_at.toISOString() }));
  }
  async end(): Promise<void> {
    await this.pool.end();
  }
}

export class SupabaseNotificationStore implements NotificationStore {
  private pool: pg.Pool;
  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString });
  }
  async create(input: NotificationInput, id: string, createdAt: string): Promise<NotificationRow> {
    await this.pool.query(
      `insert into notifications (id, type, severity, title, body, recipient, recipient_role, read_state, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,'unread',$8)`,
      [id, input.type, input.severity, input.title, input.body, input.recipient ?? null, input.recipient_role ?? null, createdAt],
    );
    return {
      id,
      ...input,
      recipient: input.recipient ?? null,
      recipient_role: input.recipient_role ?? null,
      read_state: "unread",
      escalation_state: null,
      escalated_at: null,
      actioned_at: null,
      delivery_state: null,
      created_at: createdAt,
    };
  }
  async all(): Promise<NotificationRow[]> {
    const { rows } = await this.pool.query<NotificationRow>(`select * from notifications`);
    return rows;
  }
  async end(): Promise<void> {
    await this.pool.end();
  }
}
