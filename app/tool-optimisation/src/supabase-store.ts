// ISSUE-036 — the LIVE OptEventSink adapter (pg, against the client-owned silo Supabase). The only OPT
// module that imports `pg`. It writes the two OPT observability events to `event_log` (append-only,
// 0001 baseline DDL L483-496): tool_selection_ask (FR-3.OPT.001) + tool_unavailable (FR-3.OPT.004).
//
// ⚠️ NOT YET RUN LIVE — AND it depends on an ADDITIVE ENUM DELTA that is NOT yet applied. The 0001
// baseline `event_type` enum (L60-65) does NOT include 'tool_selection_ask' or 'tool_unavailable'; the
// two OPT events cannot be inserted until that additive enum value lands (results/proposed-shared-spec.md
// describes the exact ALTER TYPE … ADD VALUE the orchestrator applies serially). Until then this adapter
// typechecks + is authored to the DDL, but a live INSERT would raise `invalid input value for enum
// event_type` — which is the CORRECT fail-closed behaviour (#3): never silently drop the ask/gap event.
// The InMemoryOptEventSink is the proven reference model; do NOT claim these paths verified until a live
// run (post-delta) records evidence.
//
// Non-negotiables: payload MUST be redacted — no tokens/secrets (FR-7.LOG.005); summary is NOT NULL
// (AC-7.LOG.002.2); event_log is append-only (baseline trigger t_append_only) so this adapter only ever
// INSERTs.

import pg from 'pg';
import { OPT_EVENT_TYPES, type OptEvent, type OptEventSink } from './store.js';

export class SupabaseOptEventSink implements OptEventSink {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    const ssl = /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: false };
    this.pool = new pg.Pool({ connectionString, ssl });
  }

  async append(ev: OptEvent): Promise<void> {
    // Belt to the fake's braces: reject a bad event_type before the DB does (fail-closed, same message).
    if (!OPT_EVENT_TYPES.includes(ev.event_type)) {
      throw new Error(
        `event_log: event_type '${String(ev.event_type)}' not in the OPT-admitted set {${OPT_EVENT_TYPES.join(', ')}}`,
      );
    }
    if (!ev.summary || ev.summary.trim() === '') {
      throw new Error('event_log: summary must be non-empty (NOT NULL — AC-7.LOG.002.2)');
    }
    // Append-only INSERT. event_type is cast to the enum — a value not yet in the enum raises here
    // (fail-closed, never silent). payload is the redacted structured detail (no secrets — FR-7.LOG.005).
    await this.pool.query(
      `insert into event_log (task_id, event_type, summary, payload)
       values ($1, $2::event_type, $3, $4)`,
      [ev.task_id, ev.event_type, ev.summary, JSON.stringify(ev.payload)],
    );
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}
