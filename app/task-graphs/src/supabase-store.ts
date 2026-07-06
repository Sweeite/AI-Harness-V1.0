// ISSUE-049 (C5 GRP) — the LIVE adapters (pg, against the client-owned silo Supabase). The only module that
// imports `pg`. Implements the same ports as the in-memory fakes against the REAL baseline DDL
// (app/silo/migrations/0001_baseline.sql: task_graph_versions L419-429, task_history L432-439). The
// idempotency ledger REUSES the EXISTING baseline `idempotency_ledger` table (0001_baseline.sql L350-355,
// net-new for FR-3.CONN.004: `idempotency_key / connector / result / created_at`, guarded write-once by
// 0008_connector_runtime_triggers.sql) via a stable sentinel `connector` (LEDGER_CONNECTOR) — NO new table
// and NO migration (see results/proposed-shared-spec.md §2, verify-present). The ONLY additive delta this
// slice owes is the append-only trigger on task_graph_versions + the two additive event_type enum values
// (proposed-shared-spec §1/§5, migration 0011) — the orchestrator applies those serially after the fan-out.
//
// ⚠️ NOT YET RUN LIVE. The append-only trigger actually rejecting an UPDATE/DELETE on task_graph_versions,
// the crash-window key-before-side-effect ordering under a real crash, and the catch-up dedup at scale
// (AF-112) are proven by the operator at the Stage-4 checkpoint (a 💻 full/live env). AF-115 (originals
// retention outlives the longest chain + audit window) is a DOCS/SPIKE posture, owed to live. This adapter is
// authored to the DDL so the seam is real and typechecks; the in-memory classes are the proven reference model.
// Do NOT claim these paths verified until the live run records evidence.
//
// Design notes tied to the three non-negotiables:
//   #1 task_graph_versions is APPEND-ONLY by version — the proposed trigger REVOKEs UPDATE/DELETE so a prior
//      version is never overwritten/lost; resume reads the DURABLE originals (task_history), never a cache.
//   #2 a step's idempotency key is committed (INSERT ... ON CONFLICT DO NOTHING) BEFORE its side effect, so a
//      retry of a completed/in-flight step cannot double-fire.
//   #3 a graph-less type / an over-limit graph is RECORDED (config-error sink) and fails loudly at dequeue —
//      never left silently pending, never truncated mid-run.

import pg from 'pg';
import {
  DEFAULT_GRAPH_CONFIG,
  ERR_EMPTY_CHANGE_REASON,
  ERR_NO_GRAPH,
  ERR_OVER_LIMIT,
  LEDGER_CONNECTOR,
  eventTypeForKind,
  resolveDependencyOrder,
  stepIdempotencyKey,
  validateSteps,
  type ChainDepthOutcome,
  type ConfigErrorSink,
  type GraphConfig,
  type GraphStep,
  type GraphStore,
  type HistoryStore,
  type IdempotencyLedger,
  type LedgerEntry,
  type NewGraphVersion,
  type TaskGraphVersionRow,
  type TaskHistoryRow,
} from './store.ts';

const GRAPH_COLS = `id, task_type_name, version, steps, change_reason, previous_version_id, created_at, created_by`;

export class SupabaseGraphStore implements GraphStore {
  private pool: pg.Pool;
  constructor(connectionString: string) {
    const ssl = /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: false };
    this.pool = new pg.Pool({ connectionString, ssl });
  }

  async putVersion(v: NewGraphVersion, _now: number): Promise<TaskGraphVersionRow> {
    // AC-5.GRP.002.1 (#1): change_reason mandatory + non-empty; validate the DAG BEFORE inserting a row.
    if (typeof v.change_reason !== 'string' || v.change_reason.trim().length === 0) {
      throw new Error(ERR_EMPTY_CHANGE_REASON);
    }
    validateSteps(v.steps);
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      // Lock the type's version line so two concurrent edits can't both compute the same next version.
      const prior = await client.query<TaskGraphVersionRow>(
        `select ${GRAPH_COLS} from task_graph_versions
         where task_type_name = $1
         order by version desc limit 1
         for update`,
        [v.task_type_name],
      );
      const priorRow = prior.rows[0];
      const nextVersion = priorRow ? priorRow.version + 1 : 1;
      const ins = await client.query<TaskGraphVersionRow>(
        `insert into task_graph_versions
           (task_type_name, version, steps, change_reason, previous_version_id, created_by)
         values ($1, $2, $3::jsonb, $4, $5, $6)
         returning ${GRAPH_COLS}`,
        [
          v.task_type_name,
          nextVersion,
          JSON.stringify(v.steps),
          v.change_reason,
          priorRow ? priorRow.id : null,
          v.created_by ?? null,
        ],
      );
      await client.query('commit');
      return ins.rows[0]!;
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }

  async getCurrent(taskTypeName: string): Promise<TaskGraphVersionRow | null> {
    const res = await this.pool.query<TaskGraphVersionRow>(
      `select ${GRAPH_COLS} from task_graph_versions
       where task_type_name = $1
       order by version desc limit 1`,
      [taskTypeName],
    );
    return res.rows[0] ?? null;
  }

  async listVersions(taskTypeName: string): Promise<TaskGraphVersionRow[]> {
    const res = await this.pool.query<TaskGraphVersionRow>(
      `select ${GRAPH_COLS} from task_graph_versions
       where task_type_name = $1
       order by version asc`,
      [taskTypeName],
    );
    return res.rows;
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}

// ── the durable originals store, READ on resume (ISSUE-050 owns writes in production; this reads task_history).
export class SupabaseHistoryStore implements HistoryStore {
  private pool: pg.Pool;
  constructor(connectionString: string) {
    const ssl = /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: false };
    this.pool = new pg.Pool({ connectionString, ssl });
  }
  async getOutput(taskId: string, stepIndex: number): Promise<TaskHistoryRow | null> {
    const res = await this.pool.query<TaskHistoryRow>(
      `select task_id, step_index, full_output from task_history where task_id = $1 and step_index = $2`,
      [taskId, stepIndex],
    );
    return res.rows[0] ?? null;
  }
  async listOutputs(taskId: string): Promise<TaskHistoryRow[]> {
    const res = await this.pool.query<TaskHistoryRow>(
      `select task_id, step_index, full_output from task_history where task_id = $1 order by step_index asc`,
      [taskId],
    );
    return res.rows;
  }
  async end(): Promise<void> {
    await this.pool.end();
  }
}

// ── the idempotency ledger, authored against the EXISTING baseline `idempotency_ledger` table (0001_baseline
// L350-355: idempotency_key / connector / result / created_at; write-once trigger from 0008). NO new table,
// NO migration. Task-graph keys live under a stable sentinel `connector` (LEDGER_CONNECTOR) so they never
// collide with a connector's own FR-3.CONN.004 intent rows. The reserved-vs-completed distinction rides the
// `result` column: SQL-NULL = reserved (crash window); a jsonb value (incl. the JSON `null` token) = complete.
//   • reserve(key)  = insert (idempotency_key, connector, result=NULL) ON CONFLICT DO NOTHING  (#2 key-first)
//   • complete(key) = update ... set result = $::jsonb where idempotency_key=$ and result is null  (write-once
//                     NULL→value — the 0008 trigger permits exactly this and blocks any re-write / delete)
//   • get(key)      = select; `result is not null` ⇒ completed, and result decodes to the output.
// The primary-key unique(idempotency_key) is what makes a retried step a no-op (#2). ─────────────────────────
export class SupabaseIdempotencyLedger implements IdempotencyLedger {
  private pool: pg.Pool;
  constructor(connectionString: string) {
    const ssl = /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: false };
    this.pool = new pg.Pool({ connectionString, ssl });
  }
  async reserve(key: string, _now: number): Promise<LedgerEntry> {
    // ON CONFLICT DO NOTHING → the key is committed at most once; a concurrent/retry reserve is a no-op and we
    // read back the surviving row. This is the key-before-side-effect commit (AC-5.GRP.003.2). `result` is
    // left NULL to mark the row reserved-but-not-complete (the crash window). `connector` is the sentinel.
    await this.pool.query(
      `insert into idempotency_ledger (idempotency_key, connector, result)
       values ($1, $2, null)
       on conflict (idempotency_key) do nothing`,
      [key, LEDGER_CONNECTOR],
    );
    const row = await this.get(key);
    if (!row) throw new Error(`idempotency: reserve failed to persist key '${key}'`);
    return row;
  }
  async complete(key: string, output: unknown, _now: number): Promise<void> {
    // NULL → value fills `result` exactly once (permitted by the 0008 write-once trigger); guarding on
    // `result is null` makes a re-complete of an already-completed key a 0-row no-op (idempotent).
    const res = await this.pool.query(
      `update idempotency_ledger
       set result = $2::jsonb
       where idempotency_key = $1 and result is null`,
      [key, JSON.stringify(output ?? null)],
    );
    // If 0 rows updated the key was either unreserved or already completed; a re-complete is idempotent (a
    // completed key stays completed) — but an UNRESERVED key is a contract violation (#3), surface it.
    if (res.rowCount === 0) {
      const existing = await this.get(key);
      if (!existing) throw new Error(`idempotency: cannot complete an unreserved key '${key}'`);
      // else: already completed — no-op (idempotent complete).
    }
  }
  async get(key: string): Promise<LedgerEntry | null> {
    // Derive the port's LedgerEntry from the baseline columns: completed = (result is not null); output =
    // the decoded jsonb; created_at = the reservation instant. No reserved_at/completed_at columns exist.
    const res = await this.pool.query<{ idempotency_key: string; completed: boolean; result: unknown | null; created_at: string }>(
      `select idempotency_key,
              (result is not null) as completed,
              result,
              created_at::text as created_at
       from idempotency_ledger where idempotency_key = $1`,
      [key],
    );
    const row = res.rows[0];
    if (!row) return null;
    return { key: row.idempotency_key, completed: row.completed, output: row.result, created_at: row.created_at };
  }
  async end(): Promise<void> {
    await this.pool.end();
  }
}

// ── a live config-error sink authored against event_log (ISSUE-011 owns the table). A graph-less type / an
// over-limit graph is RECORDED here, never silently swallowed (#3). ──────────────────────────────────────
export class SupabaseConfigErrorSink implements ConfigErrorSink {
  private pool: pg.Pool;
  constructor(connectionString: string) {
    const ssl = /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: false };
    this.pool = new pg.Pool({ connectionString, ssl });
  }
  async record(ev: {
    task_id: string | null;
    task_type_name: string;
    kind: 'no_graph' | 'chain_depth_over_limit';
    summary: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    // eventTypeForKind() resolves the kind→event_type AND asserts the value is an admitted enum member — the
    // two values (`task_graph_missing` / `task_graph_chain_depth_over_limit`) must be added to the event_type
    // enum by migration 0011 (proposed-shared-spec §5) before this write can land live; until then this INSERT
    // would throw `invalid input value for enum event_type` and the loud audit write would be lost (#3).
    await this.pool.query(
      `insert into event_log (event_type, entity_ids, summary, payload)
       values ($1, $2, $3, $4::jsonb)`,
      [
        eventTypeForKind(ev.kind),
        ev.task_id ? [ev.task_id] : [],
        ev.summary,
        JSON.stringify(ev.payload),
      ],
    );
  }
  async end(): Promise<void> {
    await this.pool.end();
  }
}

// Re-export the pure resolution helpers so the live path uses the SAME dependency-order + key derivation +
// over-limit messages as the fake (one source of truth for the contract).
export {
  DEFAULT_GRAPH_CONFIG,
  ERR_NO_GRAPH,
  ERR_OVER_LIMIT,
  resolveDependencyOrder,
  stepIdempotencyKey,
  type ChainDepthOutcome,
  type GraphConfig,
  type GraphStep,
};
