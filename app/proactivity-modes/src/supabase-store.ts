// ISSUE-068 — the LIVE pg adapter for ProactivityStore (pg, against the client-owned silo Supabase). The only
// module that imports `pg`. It implements the same port as InMemoryProactivityStore against the real baseline
// DDL (app/silo/migrations/0001_baseline.sql):
//   • proactive_suggestions — persistMode UPDATEs `mode` (the proactive_mode enum column, 0001 L79/L836).
//   • config_values — loadMatrix reads value WHERE key = 'action_autonomy_matrix'; writeMatrix UPSERTs it.
//   • access_audit — every committed AND denied matrix edit is appended (append-only; #3 — never silent).
//
// ⚠️ NOT EXERCISED BY THE OFFLINE SUITE. Its behaviour is proven by the R10 live-adapter smoke (results/
// live-smoke.sql, rolled back) — offline-green is not enough to flip this issue `done`. Every method mirrors an
// InMemoryProactivityStore method 1:1; the #2 gate + floor DECISION is pure (planMatrixWrite / assignMode) and
// identical in both stores, decided in code BEFORE any SQL, so a DB outage can never lower a floored sub-type,
// admit an Act ceiling, or turn a denied edit into a silent commit. The DB proactive_mode enum is the backstop.
//
// Non-negotiables tied to this adapter:
//   #2  The floor + PERM gate are decided in planMatrixWrite (pure) before the UPSERT; the DB enum rejects any
//       out-of-enum mode as a last backstop. Act is never written.
//   #3  A denied matrix edit is appended to access_audit exactly like a committed one — never swallowed. A mode
//       the enum would reject fails loud (the INSERT/UPDATE throws) rather than silently no-op.
//   #1  persistMode never deletes/overwrites a suggestion's other columns — it stamps `mode` only.

import type { Pool, PoolClient } from 'pg';

import { isProactivityMode, type ProactivityMode } from './modes.ts';
import {
  planMatrixWrite,
  StoredAutonomyMatrix,
  CFG_ACTION_AUTONOMY_MATRIX,
  type AuditEntry,
  type AutonomyMatrixWriteRequest,
  type MatrixWriteOutcome,
  type ProactivityStore,
} from './store.ts';

/** A pg query runner — satisfied by both `Pool` and a checked-out `PoolClient`, so appendAudit can run either
 *  standalone (denied edit → its own atomic INSERT on the pool) or INSIDE a transaction (committed edit →
 *  same client as the config UPSERT, so audit + commit are all-or-nothing — #1). */
type SqlRunner = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

/** config_values.updated_by is `uuid references profiles(id)` (0001_baseline.sql L630). A committed matrix edit
 *  must carry the actor's profile UUID — a free-text name throws 22P02 (invalid uuid) / 23503 (FK) live, and
 *  the offline InMemory fake ignores updated_by, so this can only be caught here. Fail LOUD before any write
 *  (never a cryptic mid-transaction error; never a NULL-attributed committed config change — #1/#3). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function requireActorProfileId(id: string | null | undefined): string {
  if (typeof id === 'string' && UUID_RE.test(id)) return id;
  throw new Error(
    `writeMatrix: a committed autonomy-matrix edit requires the actor's profile UUID for config_values.updated_by ` +
      `(uuid FK → profiles.id); got ${JSON.stringify(id)}. A free-text actorIdentity is the AUDIT name, not this ` +
      `FK — refusing to write an unattributed / uuid-invalid config change (#1/#3).`,
  );
}

export class SupabaseProactivityStore implements ProactivityStore {
  constructor(private readonly pool: Pool) {}

  async persistMode(suggestionId: string, mode: ProactivityMode): Promise<void> {
    if (!isProactivityMode(mode)) {
      // Fail loud before we ever touch the DB — the proactive_mode enum would reject it anyway (#3).
      throw new Error(`persistMode: '${String(mode)}' is not a valid proactive_mode — refusing to persist (#3).`);
    }
    const res = await this.pool.query(
      `update public.proactive_suggestions set mode = $2 where id = $1`,
      [suggestionId, mode],
    );
    if (res.rowCount === 0) {
      // A stamp that hit no row is a lost write — surface it, never silently succeed (#1/#3).
      throw new Error(`persistMode: no proactive_suggestions row with id '${suggestionId}' — mode stamp lost (#1/#3).`);
    }
  }

  async loadMatrix(): Promise<StoredAutonomyMatrix> {
    const res = await this.pool.query<{ value: unknown }>(
      `select value from public.config_values where key = $1`,
      [CFG_ACTION_AUTONOMY_MATRIX],
    );
    if (res.rowCount === 0) return new StoredAutonomyMatrix({}); // unset key → empty matrix, code defaults.
    return StoredAutonomyMatrix.fromValue(res.rows[0]!.value);
  }

  async writeMatrix(req: AutonomyMatrixWriteRequest): Promise<MatrixWriteOutcome> {
    // Read the current object (the before-value for the audit + the base to merge the committed edit into).
    const current = await this.loadMatrix();
    const plan = planMatrixWrite(req, current.toJSON());

    // DENIED edit — no config write. A single append-only INSERT is atomic on its own; record it and return
    // (AC-9.MODE.004.4; #3 never silent).
    if (!plan.commit) {
      await this.appendAudit(plan.audit);
      return plan.outcome;
    }

    // COMMITTED edit — the audit row and the config UPSERT MUST be one atomic unit (#1). Previously the audit
    // was appended on a SEPARATE pool.query BEFORE the UPSERT; if the UPSERT threw (e.g. the uuid/FK error
    // below), the append-only access_audit permanently held a false 'committed' row for a change that never
    // happened — knowledge-integrity corruption the offline fake can never surface. Now both writes run on one
    // checked-out client inside BEGIN/COMMIT, so a failed config write ROLLS BACK the audit too.
    //
    // Validate the actor's profile UUID FIRST — before opening the transaction — so a bad id fails loud with a
    // clear message and NOTHING (not even the audit) is written for a commit that cannot land (#1/#3).
    const updatedBy = requireActorProfileId(req.actorProfileId);
    const merged = { ...current.toJSON(), [plan.commit.subType]: plan.commit.ceiling };

    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await this.appendAudit(plan.audit, client); // same transaction as the UPSERT — all-or-nothing (#1).
      await client.query(
        `insert into public.config_values (key, value, updated_by)
           values ($1, $2, $3)
         on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`,
        [CFG_ACTION_AUTONOMY_MATRIX, JSON.stringify(merged), updatedBy],
      );
      await client.query('commit');
    } catch (err) {
      await client.query('rollback').catch(() => {}); // best-effort; the original error is what matters.
      throw err;
    } finally {
      client.release();
    }
    return plan.outcome;
  }

  /** Append an access_audit row. `runner` defaults to the pool (standalone atomic INSERT for a denied edit);
   *  a committed edit passes the transaction's checked-out client so the audit + the config UPSERT commit or
   *  roll back together (#1). actor_identity is the free-text human name; actor_type is 'user' (a Super-Admin
   *  matrix edit; enum actor_type ∈ user|agent|system). */
  async appendAudit(entry: AuditEntry, runner: SqlRunner = this.pool): Promise<void> {
    await runner.query(
      `insert into public.access_audit (audit_type, actor_identity, actor_type, action, target_type, before_value, after_value, reason)
       values ($1, $2, 'user', $3, $4, $5, $6, $7)`,
      [
        entry.auditType,
        entry.actorIdentity,
        entry.action,
        entry.targetType,
        JSON.stringify(entry.beforeValue),
        JSON.stringify(entry.afterValue),
        entry.reason,
      ],
    );
  }
}
