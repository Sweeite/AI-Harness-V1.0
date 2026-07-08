// ISSUE-052 (C5 JOB) — the LIVE pg adapters (against the client-owned silo Supabase). The only module in this
// slice that imports `pg`. Two adapters, both authored to the baseline DDL (app/silo/migrations/0001_baseline.sql):
//
//   • SupabaseProjectionSink — the OD-058 single-authority audit projection. Runs on the service_role/owner
//     connection (the harness background path, ADR-006 — authorization is harness-enforced, RLS is bypassed).
//     It UPDATEs the Inngest-projection columns on an EXISTING task_queue row (ISSUE-048 owns the schema; this
//     slice never adds/alters a column). It is a MIRROR of Inngest's reported lifecycle — it exposes no retry
//     scheduler (OD-058 / NFR-INF.011). Mirrors InMemoryProjectionSink 1:1.
//   • SupabaseEventSink — the append-only event_log sink (schema.md §8) for the run/DLQ records + the DLQ
//     liveness heartbeat. Validates the enum + non-empty summary BEFORE the round-trip (same gate as the fake).
//
// The DLQ itself (Inngest's failed-function queue) is Inngest-side operationally — its durable AUDIT tail is the
// task_queue row (status='failed' + full error history) written via SupabaseProjectionSink. There is therefore no
// pg `DlqStore` adapter: the resident-entry set + heartbeat clock are Inngest-managed; the reference model
// (InMemoryDlqStore) proves the state machine + human-only gate offline.
//
// ⚠️ NOT YET RUN LIVE. R10 (live-adapter hygiene sweep) is owed at the Stage-5 checkpoint against the real silo:
// a rolled-back smoke that (a) UPDATEs a seeded task_queue row's projection columns and reads them back, and
// (b) INSERTs each emitted event_type into event_log (proving no `invalid input value for enum event_type`).
// Until that records evidence, only the offline reference model is proven.

import pg from 'pg';
import {
  type ProjectionSink,
  type JobProjection,
  type EventSink,
  type EngineEvent,
  type ErrorAttempt,
  isEmittedEventType,
  isoSeconds as _isoSeconds,
  ERR_BAD_EVENT_TYPE,
  ERR_EMPTY_SUMMARY,
} from './store.ts';
import { isTaskStatus } from '@harness/task-queue/src/store.ts';
import { ERR_BAD_STATUS } from './store.ts';

void _isoSeconds; // (kept exported from store; not needed here — projection carries iso strings already)

function makePool(connectionString: string): pg.Pool {
  const ssl = /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: false };
  return new pg.Pool({ connectionString, ssl });
}

export class SupabaseProjectionSink implements ProjectionSink {
  private pool: pg.Pool;
  constructor(connectionString: string) {
    this.pool = makePool(connectionString);
  }

  async sync(taskId: string, p: JobProjection): Promise<void> {
    // Same #3 gate as the fake — never project an undefined/unknown status (the DB enum would reject it, but we
    // fail loud BEFORE the round-trip so the offline test proves the live contract).
    if (!isTaskStatus(p.status)) throw new Error(ERR_BAD_STATUS(p.status));
    // OD-058 MIRROR: UPDATE the projection columns on the EXISTING task_queue row. We never INSERT/DELETE a
    // task_queue row (ISSUE-048 owns the lifecycle) and never schedule a retry — this is a read-only-authority
    // projection of Inngest's reported lifecycle. If the row is absent, that is a loud error (#3), not a no-op.
    const res = await this.pool.query(
      `update task_queue
          set attempts      = $2,
              next_retry_at = $3,
              status        = $4::task_status,
              error         = $5::jsonb
        where id = $1`,
      [taskId, p.attempts, p.next_retry_at, p.status, JSON.stringify(p.error)],
    );
    if (res.rowCount === 0) {
      throw new Error(
        `inngest-dlq: projection sync found no task_queue row '${taskId}' — cannot mirror Inngest lifecycle onto a missing row (#3)`,
      );
    }
  }

  async read(taskId: string): Promise<JobProjection | null> {
    const res = await this.pool.query<{
      attempts: number;
      next_retry_at: string | null;
      status: string;
      error: ErrorAttempt[] | null;
    }>(
      `select attempts, next_retry_at, status, error from task_queue where id = $1`,
      [taskId],
    );
    if (res.rowCount === 0) return null;
    const row = res.rows[0]!;
    if (!isTaskStatus(row.status)) throw new Error(ERR_BAD_STATUS(row.status));
    return {
      attempts: row.attempts,
      next_retry_at: row.next_retry_at,
      status: row.status,
      error: row.error ?? [],
    };
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}

export class SupabaseEventSink implements EventSink {
  private pool: pg.Pool;
  constructor(connectionString: string) {
    this.pool = makePool(connectionString);
  }

  async append(ev: EngineEvent): Promise<void> {
    // Validate BEFORE the round-trip — same gate as the fake, so an offline-green test proves the live contract.
    if (!isEmittedEventType(ev.event_type)) throw new Error(ERR_BAD_EVENT_TYPE(ev.event_type));
    if (typeof ev.summary !== 'string' || ev.summary.trim().length === 0) throw new Error(ERR_EMPTY_SUMMARY);
    // event_log is append-only (schema.md §8). entity_ids is uuid[]; payload is redacted jsonb (no tokens/secrets
    // — FR-7.LOG.005). task_id references the task_queue row (nullable for a parent-level fan-out event).
    await this.pool.query(
      `insert into event_log (task_id, event_type, entity_ids, summary, payload)
       values ($1, $2::event_type, $3::uuid[], $4, $5::jsonb)`,
      [ev.task_id, ev.event_type, ev.entity_ids, ev.summary, JSON.stringify(ev.payload)],
    );
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}
