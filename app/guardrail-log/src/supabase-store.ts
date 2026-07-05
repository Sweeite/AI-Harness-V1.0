// ISSUE-060 — the LIVE pg adapters for the guardrail_log + injection_quarantine ports, authored to migration
// 0009_guardrails (results/proposed-migration-0009_guardrails.sql). This is the ONLY module that imports `pg`.
//
// ⚠️ NOT YET RUN LIVE in this offline half. The InMemory* stores (store.ts) are the proven reference model;
// these adapters are the thin translation so the seam is real and typechecks. They will be exercised against a
// real silo Supabase at Stage-3 integration time. Every guarantee the fake enforces is enforced at the substrate:
//   - the `guardrail_type` enum rejects an out-of-set value;
//   - the `check (not (hard_limit and approved))` constraint (schema.md L528) rejects the override;
//   - the t_append_only trigger (schema.md §Global rules) rejects a delete/content-rewrite and permits ONLY the
//     forward pending->resolved transition with description+task_id unchanged;
//   - the injection_quarantine.guardrail_log_id FK rejects a dangling reference.
//
// Isolation (#2): both tables are CLIENT-SILO tables (schema.md §7) — this reads/writes the silo DB
// (DATABASE_URL), never the management plane. No client_slug column exists (OD-096 / FR-10.ISO.001).

import pg from "pg";
import type { GuardrailLogRow, QuarantineDecision, QuarantineRow, Resolution } from "./types.ts";
import { isGuardrailType } from "./types.ts";
import {
  AppendOnlyViolation,
  DanglingQuarantineFk,
  GuardrailLogWriteFailure,
  HardLimitApprovalForbidden,
  InvalidGuardrailType,
  type GuardrailLogStore,
  type QuarantineStore,
} from "./store.ts";

const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";
const FK_VIOLATION = "23503";
const INVALID_ENUM = "22P02";

export class SupabaseGuardrailLogStore implements GuardrailLogStore {
  private pool: pg.Pool;
  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString });
  }

  async append(row: GuardrailLogRow): Promise<void> {
    if (!isGuardrailType(row.guardrail_type)) throw new InvalidGuardrailType(row.guardrail_type);
    try {
      await this.pool.query(
        `insert into guardrail_log
           (id, task_id, guardrail_type, description, action_blocked, status, reviewed_by, reviewed_at,
            escalated_at, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          row.id,
          row.task_id,
          row.guardrail_type,
          row.description,
          row.action_blocked,
          row.status,
          row.reviewed_by,
          row.reviewed_at,
          row.escalated_at,
          row.created_at,
        ],
      );
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === UNIQUE_VIOLATION) throw new AppendOnlyViolation("UPDATE"); // id clobber = an in-place update
      if (code === CHECK_VIOLATION) throw new HardLimitApprovalForbidden(); // the hard_limit!=approved check
      if (code === INVALID_ENUM) throw new InvalidGuardrailType(row.guardrail_type);
      // Anything else is a substrate failure the writer must surface out-of-band (AC-6.LOG.003.3).
      throw new GuardrailLogWriteFailure((e as Error).message);
    }
  }

  async all(): Promise<GuardrailLogRow[]> {
    const { rows } = await this.pool.query<GuardrailLogRow>(
      `select id, task_id, guardrail_type, description, action_blocked, status, reviewed_by,
              reviewed_at::text as reviewed_at, escalated_at::text as escalated_at, created_at::text as created_at
         from guardrail_log order by created_at`,
    );
    return rows;
  }

  async resolve(id: string, resolution: Resolution): Promise<void> {
    // The whitelisted forward transition. The trigger ALSO enforces pending->resolved with description/task_id
    // unchanged; we guard status=pending here so a no-op / re-resolve surfaces as an append-only violation
    // rather than silently affecting 0 rows.
    try {
      const res = await this.pool.query(
        `update guardrail_log
            set status = $2, reviewed_by = $3, reviewed_at = $4
          where id = $1 and status = 'pending'`,
        [id, resolution.status, resolution.reviewed_by, resolution.reviewed_at],
      );
      if (res.rowCount === 0) throw new AppendOnlyViolation("UPDATE"); // not pending / not found -> not permitted
    } catch (e) {
      if (e instanceof AppendOnlyViolation) throw e;
      const code = (e as { code?: string }).code;
      if (code === CHECK_VIOLATION) throw new HardLimitApprovalForbidden();
      // The trigger raises a plpgsql exception (not a constraint code) for a forbidden transition.
      throw new AppendOnlyViolation("UPDATE");
    }
  }

  async rewriteContent(id: string, description: string): Promise<void> {
    // The trigger rejects new.description != old.description; surface it as the append-only violation it is.
    try {
      await this.pool.query(`update guardrail_log set description = $2 where id = $1`, [id, description]);
    } catch {
      throw new AppendOnlyViolation("REWRITE");
    }
    // If the substrate somehow did not raise, still treat any content rewrite as forbidden (belt-and-braces).
    throw new AppendOnlyViolation("REWRITE");
  }

  async delete(id: string): Promise<void> {
    try {
      await this.pool.query(`delete from guardrail_log where id = $1`, [id]);
    } catch {
      throw new AppendOnlyViolation("DELETE");
    }
    throw new AppendOnlyViolation("DELETE");
  }
}

export class SupabaseQuarantineStore implements QuarantineStore {
  private pool: pg.Pool;
  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString });
  }

  async append(row: QuarantineRow): Promise<void> {
    try {
      await this.pool.query(
        `insert into injection_quarantine
           (id, guardrail_log_id, quarantined_content, source_tool, source_record_id, human_decision,
            reviewed_by, reviewed_at, escalated_at, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          row.id,
          row.guardrail_log_id,
          row.quarantined_content,
          row.source_tool,
          row.source_record_id,
          row.human_decision,
          row.reviewed_by,
          row.reviewed_at,
          row.escalated_at,
          row.created_at,
        ],
      );
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === FK_VIOLATION) throw new DanglingQuarantineFk(row.guardrail_log_id);
      if (code === UNIQUE_VIOLATION) throw new AppendOnlyViolation("UPDATE");
      throw new GuardrailLogWriteFailure((e as Error).message);
    }
  }

  async all(): Promise<QuarantineRow[]> {
    const { rows } = await this.pool.query<QuarantineRow>(
      `select id, guardrail_log_id, quarantined_content, source_tool, source_record_id, human_decision,
              reviewed_by, reviewed_at::text as reviewed_at, escalated_at::text as escalated_at,
              created_at::text as created_at
         from injection_quarantine order by created_at`,
    );
    return rows;
  }

  async decide(id: string, decision: QuarantineDecision, reviewedBy: string, reviewedAt: string): Promise<void> {
    const res = await this.pool.query(
      `update injection_quarantine
          set human_decision = $2, reviewed_by = $3, reviewed_at = $4
        where id = $1 and human_decision is null`,
      [id, decision, reviewedBy, reviewedAt],
    );
    if (res.rowCount === 0) throw new AppendOnlyViolation("UPDATE"); // already decided / not found
  }

  async delete(id: string): Promise<void> {
    try {
      await this.pool.query(`delete from injection_quarantine where id = $1`, [id]);
    } catch {
      throw new AppendOnlyViolation("DELETE");
    }
    throw new AppendOnlyViolation("DELETE");
  }
}
