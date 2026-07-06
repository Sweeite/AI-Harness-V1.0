// ISSUE-051 (C5 LOP) — the LIVE event_log sink adapter (pg, against the client-owned silo Supabase). The only
// module in this slice that imports `pg`. It writes the loop run-log / loop_missed / loop-failure heartbeat rows
// to event_log against the real baseline DDL (app/silo/migrations/0001_baseline.sql §8) — NO new table.
//
// ⚠️ NOT YET RUN LIVE. AF-112 (LOAD/EVAL — force missed runs + overruns on a live loop against a populated queue
// and assert ZERO duplicate side effects) is owed at the Stage-4 checkpoint (a 💻 full/live env). This adapter is
// authored to the DDL so the seam is real and typechecks; InMemoryLoopRunner is the proven reference model. Do
// NOT claim the "no duplicate side effect at scale" path verified until the live run records evidence.
//
// Design notes tied to the three non-negotiables:
//   #3 every emitted row carries an enum-VALID event_type (loop_missed / task_failure_spike / task_completed /
//      task_failed) — all present in the baseline event_type enum, so the INSERT cannot throw
//      `invalid input value for enum event_type`. summary is text NOT NULL → we send a non-empty string.
//   #1/#3 the loop-failure heartbeat is a real INSERT (never a console log that could be lost) — an unattended
//      failing loop becomes a durable, queryable event_log row (the alert seam C7 delivers on).
//   The idempotency guard that makes a catch-up a no-op lives at the DISPATCH boundary (the ISSUE-048 queue's
//      idempotency key + the ISSUE-049 graph keys) — this adapter is only the event_log SINK, so it never writes
//      task rows; the LiveLoopWorkSource the boot wiring supplies owns the enqueue-by-key path.

import pg from 'pg';
import { ERR_BAD_EVENT_TYPE, ERR_EMPTY_SUMMARY, isLoopEventType, type EventSink, type LoopEvent } from './store.ts';

export class SupabaseEventSink implements EventSink {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    const ssl = /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: false };
    this.pool = new pg.Pool({ connectionString, ssl });
  }

  async append(ev: LoopEvent): Promise<void> {
    // Validate BEFORE the round-trip — same gate as the fake, so an offline-green test proves the live contract.
    if (!isLoopEventType(ev.event_type)) throw new Error(ERR_BAD_EVENT_TYPE(ev.event_type));
    if (typeof ev.summary !== 'string' || ev.summary.trim().length === 0) throw new Error(ERR_EMPTY_SUMMARY);
    // event_log is append-only (schema.md §8). entity_ids is uuid[]; a loop event carries no entity so we send
    // an empty array. payload is redacted jsonb (no tokens/secrets — FR-7.LOG.005). task_id left null (loop-level
    // events are not tied to a single task_queue row).
    await this.pool.query(
      `insert into event_log (event_type, entity_ids, summary, payload)
       values ($1::event_type, $2::uuid[], $3, $4::jsonb)`,
      [ev.event_type, ev.entity_ids, ev.summary, JSON.stringify(ev.payload)],
    );
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}

// ── The LIVE work source (skeleton, authored to the seam). The precheck is a cheap DB-condition query (no LLM);
// dispatch enqueues through the ISSUE-048 task_queue by idempotency key so a re-dispatch is a DB-level no-op.
// Left as a documented seam because the concrete queries belong to the generators (ISSUE-069) that ride these
// loops; the runner owns only the ordering + dedup. NOT run live. ────────────────────────────────────────────
//
// Example precheck (fast loop): `select 1 from task_queue where status='pending' limit 1` plus the trigger
// conditions (new leads / overdue tasks) — returns qualifying WorkUnits keyed by a stable idempotency key
// (e.g. `${loop}:${task_type}:${window_start}`), EMPTY ⇒ idle short-circuit (no orchestrator wake).
