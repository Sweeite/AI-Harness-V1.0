// ISSUE-055 — the LIVE HardLimitGate adapter (pg, against the client-owned silo Supabase). The only module
// that imports `pg`. It implements the same port as InMemoryHardLimitGate against the real DDL
// (schema.md §7 guardrail_log + the `check (not (guardrail_type='hard_limit' and status='approved'))`
// constraint + the append-only trigger enforce_audit_append_only()). NO migration is owned here — the
// guardrail_log table + enums + check + trigger are landed by the LOG slice (ISSUE-060). This adapter
// WRITES 'hard_limit' rows and RELIES on that schema check for the DB-level no-override guard.
//
// ⚠️ NOT YET RUN LIVE. The schema CHECK actually rejecting an approve, the append-only trigger, and the
// row write under the postgres owner (RLS-bypass) (ADR-004 — the agent path runs as the owner (RLS-bypass); runtime role = postgres owner per OD-193) are proven at the Stage-3
// checkpoint live capstone (results/issue-055-capstone.sql). This adapter is authored to the DDL so the
// seam is real and typechecks; the InMemoryHardLimitGate is the proven offline reference model. Do NOT
// claim these paths verified until the capstone records evidence.
//
// Design notes tied to the three non-negotiables:
//   - The gate DECISION (limits.classify) is pure and identical in both stores — the block is decided in
//     code before any DB call, so a DB outage can never turn a block into a permit (#2).
//   - The guardrail_log write is best-effort logging of an already-final block: a failed INSERT is caught
//     and surfaced (logWriteFailed), never rolled back into a permit (AC-6.HRD.002.1 / #3).
//   - The status→approved reject exists at BOTH layers: this adapter refuses it before issuing SQL, AND
//     the DB CHECK refuses it if it somehow reaches the table (defense in depth — AC-6.HRD.003.2).

import pg from 'pg';
import { classify, type ActionAttempt, type HardLimitDecision } from './limits.ts';
import {
  ERR_HARD_LIMIT_APPROVE_FORBIDDEN,
  InMemoryHardLimitGate,
  type AgentDefinition,
  type AlertSink,
  type CoverageRouting,
  type EnforcementOutcome,
  type GuardrailLogRow,
  type GuardrailStatus,
  type HardLimitAlert,
  type HardLimitGate,
} from './store.ts';

export class SupabaseHardLimitGate implements HardLimitGate {
  private pool: pg.Pool;
  // The pure/governance parts (classification, agent-def guard, coverage routing, set-change refusal) are
  // DB-free and identical to the reference model — delegate to it rather than duplicate the invariants.
  private readonly ref = new InMemoryHardLimitGate();

  constructor(connectionString: string) {
    const ssl = /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: false };
    this.pool = new pg.Pool({ connectionString, ssl });
  }

  check(attempt: ActionAttempt): HardLimitDecision {
    return classify(attempt);
  }

  async enforce(
    attempt: ActionAttempt,
    alerts: AlertSink,
    _now: number,
    taskId: string | null = null,
  ): Promise<EnforcementOutcome> {
    const decision = this.check(attempt);
    if (!decision.blocked) {
      return { decision, blocked: false, logRowId: null, logWriteFailed: false, alertDropped: false };
    }
    // Block is FINAL. Best-effort log + alert follow; neither can un-block.
    let logRowId: string | null = null;
    let logWriteFailed = false;
    let alertDropped = false;

    try {
      // postgres-owner (RLS-bypass) INSERT (ADR-004 — the agent path runs as the owner (RLS-bypass); runtime role = postgres owner per OD-193). created_at + id defaulted by DDL.
      const res = await this.pool.query<{ id: string }>(
        `insert into guardrail_log (task_id, guardrail_type, description, action_blocked, status)
         values ($1, 'hard_limit', $2, true, 'pending')
         returning id`,
        [taskId, decision.reason],
      );
      logRowId = res.rows[0]!.id;
    } catch {
      logWriteFailed = true; // surfaced; the block still holds (AC-6.HRD.002.1)
    }

    const alert: HardLimitAlert = {
      alert_type: 'hard_limit_hit',
      guardrail_log_id: logRowId,
      limit: decision.limit!,
      description: decision.reason,
      emitted_at: new Date(_now * 1000).toISOString(),
    };
    try {
      await alerts.emit(alert);
    } catch {
      alertDropped = true; // dropped-alert surfaced out-of-band (AC-6.HRD.002.2)
    }

    return { decision, blocked: true, logRowId, logWriteFailed, alertDropped };
  }

  async setStatus(rowId: string, status: GuardrailStatus): Promise<GuardrailLogRow> {
    // Application-layer guard (mirrors the DB CHECK). We must know the row's type to refuse an approve on a
    // hard_limit row before issuing the UPDATE — the DB CHECK is the backstop if it slips through.
    const cur = await this.pool.query<{ guardrail_type: string }>(
      `select guardrail_type from guardrail_log where id = $1`,
      [rowId],
    );
    const found = cur.rows[0];
    if (!found) throw new Error(`guardrail_log row ${rowId} not found`);
    if (found.guardrail_type === 'hard_limit' && status === 'approved') {
      throw new Error(ERR_HARD_LIMIT_APPROVE_FORBIDDEN);
    }
    // The reference fake (store.ts setStatus) ACCEPTS status='pending' — it is never rejected there (only
    // hard_limit+approved is). But the live append-only trigger permits only a FORWARD
    // pending→(approved|rejected|modified) transition, so an UPDATE to 'pending' would be rejected by the
    // DB — a FAKE-vs-LIVE divergence. To match the fake's accept-and-return contract exactly, a 'pending'
    // target is a no-op that returns the current (already-pending) row rather than issuing the
    // trigger-violating UPDATE. This keeps the live adapter's accept/reject surface identical to the fake.
    if (status === 'pending') {
      const same = await this.getRow(rowId);
      if (!same) throw new Error(`guardrail_log row ${rowId} not found`);
      return same;
    }
    // The append-only trigger permits only a forward pending→(approved|rejected|modified) transition that
    // leaves description/task_id unchanged; the DB CHECK still blocks hard_limit+approved as a backstop.
    const res = await this.pool.query<GuardrailLogRow>(
      `update guardrail_log set status = $2, reviewed_at = now()
       where id = $1
       returning id, task_id, guardrail_type, description, action_blocked, status, created_at`,
      [rowId, status],
    );
    // A vanished row (deleted between the select and the update) yields zero rows — never hand back
    // res.rows[0]! (which is `undefined` masquerading as a GuardrailLogRow). Throw the same not-found the
    // reference fake raises, matching its contract (store.ts setStatus) rather than corrupting the read (#1/#3).
    if (res.rowCount === 0 || !res.rows[0]) {
      throw new Error(`guardrail_log row ${rowId} not found`);
    }
    return res.rows[0];
  }

  async getRow(rowId: string): Promise<GuardrailLogRow | null> {
    const res = await this.pool.query<GuardrailLogRow>(
      `select id, task_id, guardrail_type, description, action_blocked, status, created_at
       from guardrail_log where id = $1`,
      [rowId],
    );
    return res.rows[0] ?? null;
  }

  // ── DB-free parts: delegate to the reference model (single source of the invariants) ──
  async saveAgentDefinition(def: AgentDefinition): Promise<AgentDefinition> {
    return this.ref.saveAgentDefinition(def);
  }
  classifyNewCapability(capability: string): CoverageRouting {
    return this.ref.classifyNewCapability(capability);
  }
  proposeHardLimitSetChange(change: string): never {
    return this.ref.proposeHardLimitSetChange(change);
  }
}
