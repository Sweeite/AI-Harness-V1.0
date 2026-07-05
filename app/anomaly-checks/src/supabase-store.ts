// ISSUE-057 — the LIVE AnomalyStore adapter (pg, against the client-owned silo Supabase). It is the
// only module that imports `pg`. It implements the same port as InMemoryAnomalyStore against the real
// DDL (schema.md §7 guardrail_log — the append-only sink built by ISSUE-011; §12 config_values). This
// slice WRITES `anomaly`-type guardrail_log rows and consumes status/escalated_at; it does NOT create
// the table (owned by ISSUE-011) and it authors NO migration.
//
// ⚠️ NOT YET RUN LIVE. Authored to the DDL so the seam is real and typechecks; the InMemoryAnomalyStore
// is the proven reference model. The append-only trigger + forward-status-transition behaviour is
// proven live at the ISSUE-011/Stage checkpoint, not here. Do NOT claim these code paths verified until
// that live run records evidence.
//
// Design notes tied to the three non-negotiables:
//   - guardrail_log is append-only (#1/#3): the ONLY mutation is a forward status transition
//     (pending → approved|rejected|modified) or setting server-owned escalated_at. transitionGuardrail
//     asserts the from-state in the WHERE so a non-pending row is a 0-row no-op (the trigger enforces
//     the same), never a silent overwrite.
//   - the baseline-proposal table is owned by ISSUE-060's reusable learning mechanism; until it lands
//     the adapter routes proposals through a guardrail-adjacent record. To avoid inventing a table this
//     slice does not own, the proposal methods here throw NOT_IMPLEMENTED with a pointer — the offline
//     reference model (InMemoryAnomalyStore) carries the proven behaviour, and the live wiring is owed
//     to the ISSUE-060 integration (recorded in results/notes). Never a silent stub (#3).

import pg from 'pg';
import type {
  AnomalyStore,
  BaselineProposal,
  GuardrailLogRow,
  GuardrailStatus,
  NewGuardrail,
  ReviewFlag,
} from './store.js';

export class SupabaseAnomalyStore implements AnomalyStore {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    const ssl = /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: false };
    this.pool = new pg.Pool({ connectionString, ssl });
  }

  async logGuardrail(row: NewGuardrail): Promise<GuardrailLogRow> {
    const res = await this.pool.query<GuardrailLogRow>(
      `insert into guardrail_log (task_id, guardrail_type, description, action_blocked, status, escalated_at)
       values ($1, $2, $3, $4, $5, $6)
       returning id, task_id, guardrail_type, description, action_blocked, status,
                 reviewed_by, reviewed_at, escalated_at, created_at`,
      [row.task_id, row.guardrail_type, row.description, row.action_blocked, row.status, row.escalated_at ?? null],
    );
    return res.rows[0]!;
  }

  async transitionGuardrail(
    id: string,
    to: Exclude<GuardrailStatus, 'pending'>,
    reviewedBy: string,
    now: number,
  ): Promise<GuardrailLogRow> {
    // Forward transition ONLY from 'pending' (the WHERE mirrors the schema.md §7 trigger). A 0-row
    // result means the row was not pending → we surface it loudly rather than pretend success (#3).
    const res = await this.pool.query<GuardrailLogRow>(
      `update guardrail_log
         set status = $2, reviewed_by = $3, reviewed_at = to_timestamp($4)
       where id = $1 and status = 'pending'
       returning id, task_id, guardrail_type, description, action_blocked, status,
                 reviewed_by, reviewed_at, escalated_at, created_at`,
      [id, to, reviewedBy, now],
    );
    if (res.rowCount === 0) {
      throw new Error(`guardrail_log ${id} was not 'pending' — forward-only transition refused`);
    }
    return res.rows[0]!;
  }

  async markEscalated(id: string, now: number): Promise<GuardrailLogRow> {
    // OD-182 monotonic escalation stamp: escalated_at null→ts (write-once), status stays 'pending',
    // action_blocked false→true. The `and escalated_at is null` guard makes an already-escalated row
    // (or a missing row) return rowCount 0 → a LOUD throw, never a silent no-op or a trigger rollback.
    const res = await this.pool.query<GuardrailLogRow>(
      `update guardrail_log set escalated_at = to_timestamp($2), action_blocked = true
       where id = $1 and escalated_at is null
       returning id, task_id, guardrail_type, description, action_blocked, status,
                 reviewed_by, reviewed_at, escalated_at, created_at`,
      [id, now],
    );
    if (res.rowCount === 0) throw new Error(`no pending guardrail_log row ${id} to escalate (missing or already escalated)`);
    return res.rows[0]!;
  }

  async flagForReview(flag: ReviewFlag): Promise<void> {
    // FR-6.ANM.003.1 / #3: a review flag with no task cannot be routed — fail LOUD, never a silent no-op
    // (the previous `if (flag.task_id)` silently dropped a null-task flag while the fake recorded it — a
    // fake-vs-adapter drift + a silent-failure). task_status → 'flagged' (schema.md §Types; "'flagged' set only by C6").
    if (!flag.task_id) {
      throw new Error('flagForReview: task_id is required — an anomaly review flag with no task cannot be routed (never silently dropped, #3)');
    }
    await this.pool.query(`update task_queue set status = 'flagged' where id = $1`, [flag.task_id]);
  }

  async recordBaselineProposal(): Promise<BaselineProposal> {
    // The proposal store is the reusable learning mechanism owned by ISSUE-060 (FR-6.OPT.002). This
    // slice does not create that table; the live wiring is owed to the ISSUE-060 integration. The
    // in-memory reference model proves the behaviour offline. Fail loud, never silent (#3).
    throw new Error(
      'recordBaselineProposal: live store owned by ISSUE-060 (FR-6.OPT.002) — wiring owed at integration; ' +
        'proven offline in InMemoryAnomalyStore. See results/notes.md.',
    );
  }

  async confirmBaselineProposal(): Promise<BaselineProposal> {
    throw new Error(
      'confirmBaselineProposal: live store owned by ISSUE-060 (FR-6.OPT.002) — wiring owed at integration; ' +
        'proven offline in InMemoryAnomalyStore. See results/notes.md.',
    );
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}
