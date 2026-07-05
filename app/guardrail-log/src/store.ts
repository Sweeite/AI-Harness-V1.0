// ISSUE-060 §5/§8 — the ports the guardrail_log sink reads/writes through (house port+fake pattern; cf.
// app/observability, app/config-store). guardrail_log + injection_quarantine are CLIENT-SILO tables created by
// migration 0009_guardrails (results/proposed-migration-0009_guardrails.sql). The in-memory fakes are the test
// doubles AND the reference model that re-implements the DB's guarantees faithfully — the append-only trigger
// (schema.md §Global rules L44-78), the `check (not (hard_limit and approved))` constraint (schema.md L528),
// and the injection_quarantine -> guardrail_log(id) FK. The live pg adapter (supabase-store.ts) is the thin
// translation, authored to the DDL but NOT run in this offline half.

import type {
  GuardrailLogRow,
  GuardrailStatus,
  QuarantineDecision,
  QuarantineRow,
  Resolution,
} from "./types.ts";
import { isGuardrailType, isResolvedStatus } from "./types.ts";

// ── Errors that mirror the DB constraint/trigger RAISE EXCEPTIONs (schema.md §7 / §Global rules) ─────

/** The DB append-only trigger's "in-place UPDATE/DELETE forbidden" (AC-6.LOG.002.1). */
export class AppendOnlyViolation extends Error {
  constructor(op: "UPDATE" | "DELETE" | "REWRITE") {
    super(`audit sink guardrail_log: ${op} forbidden (append-only / tamper-evident) — AC-6.LOG.002.1`);
    this.name = "AppendOnlyViolation";
  }
}

/** The `check (not (guardrail_type='hard_limit' and status='approved'))` rejection (AC-6.LOG.001.2). */
export class HardLimitApprovalForbidden extends Error {
  constructor() {
    super("guardrail_log: a hard_limit row can never reach status='approved' (AC-6.LOG.001.2 — no override)");
    this.name = "HardLimitApprovalForbidden";
  }
}

/** The `guardrail_type` enum rejection (AC-6.LOG.001.1 — never blank/unknown, rejected not coerced). */
export class InvalidGuardrailType extends Error {
  constructor(value: string) {
    super(`guardrail_type '${value}' is outside the five-value set — rejected, not coerced (AC-6.LOG.001.1)`);
    this.name = "InvalidGuardrailType";
  }
}

/** A substrate write failure that must NOT proceed silently — drives the fail-closed path (AC-6.LOG.003.3). */
export class GuardrailLogWriteFailure extends Error {
  constructor(cause: string) {
    super(`guardrail_log write failed: ${cause}`);
    this.name = "GuardrailLogWriteFailure";
  }
}

/** The FK injection_quarantine.guardrail_log_id -> guardrail_log(id) (schema.md L533). */
export class DanglingQuarantineFk extends Error {
  constructor(guardrailLogId: string) {
    super(`injection_quarantine.guardrail_log_id='${guardrailLogId}' has no guardrail_log row (FK)`);
    this.name = "DanglingQuarantineFk";
  }
}

// ── The guardrail_log write/read port ────────────────────────────────────────────────────────────────

export interface GuardrailLogStore {
  /** Append a fully-formed row (id/created_at assigned by the writer). Rejects out-of-enum guardrail_type,
   *  rejects a hard_limit row that arrives already `approved` (the check constraint), and refuses to clobber
   *  an existing id (append-only). Throws GuardrailLogWriteFailure on a substrate failure so the write path
   *  can trip the fail-closed out-of-band route. */
  append(row: GuardrailLogRow): Promise<void>;
  /** Read all rows (offline reference model; the live adapter would query with predicates). */
  all(): Promise<GuardrailLogRow[]>;
  /** Apply the ONE whitelisted forward transition the trigger permits: pending -> a resolved status, with
   *  description + task_id UNCHANGED, timestamped/attributed. Rejects anything else as append-only violation,
   *  and rejects hard_limit -> approved (the check constraint) even via this path. */
  resolve(id: string, resolution: Resolution): Promise<void>;
  /** A raw content rewrite of a historical row — the model exposes it ONLY so a test can prove the trigger
   *  rejects it. It always throws (there is no legal in-place content rewrite). */
  rewriteContent(id: string, description: string): Promise<void>;
  /** A raw delete — the model exposes it ONLY to prove the trigger rejects it. It always throws (guardrail_log
   *  has no non-retention DELETE path; retention is C7/ISSUE-077, outside this slice). */
  delete(id: string): Promise<void>;
}

/**
 * The reference in-memory guardrail_log. It re-implements every DB-level guarantee so the offline tests prove
 * the SAME invariants the substrate enforces:
 *   - `guardrail_type` ∈ the five values (else rejected — AC-6.LOG.001.1)
 *   - `check (not (hard_limit and approved))` on insert AND on any resolution (AC-6.LOG.001.2)
 *   - append-only: no clobber-insert, no content rewrite, no delete; only the whitelisted forward transition
 *     with description/task_id unchanged (AC-6.LOG.002.1)
 * A `failNext` hook lets a test induce a substrate write failure to drive the fail-closed path (AC-6.LOG.003.3).
 */
export class InMemoryGuardrailLogStore implements GuardrailLogStore {
  private readonly rows = new Map<string, GuardrailLogRow>();
  private failNextCause: string | null = null;

  constructor(seed: readonly GuardrailLogRow[] = []) {
    for (const r of seed) this.rows.set(r.id, { ...r });
  }

  /** Fault injection: make the next append() fail as though the silo DB were unreachable (AC-6.LOG.003.3). */
  induceWriteFailure(cause = "store unreachable"): void {
    this.failNextCause = cause;
  }

  private static violatesHardLimitCheck(type: string, status: GuardrailStatus): boolean {
    // schema.md L528 — the DB check constraint, enforced identically here.
    return type === "hard_limit" && status === "approved";
  }

  async append(row: GuardrailLogRow): Promise<void> {
    if (this.failNextCause !== null) {
      const cause = this.failNextCause;
      this.failNextCause = null;
      throw new GuardrailLogWriteFailure(cause);
    }
    if (!isGuardrailType(row.guardrail_type)) throw new InvalidGuardrailType(row.guardrail_type);
    if (InMemoryGuardrailLogStore.violatesHardLimitCheck(row.guardrail_type, row.status)) {
      throw new HardLimitApprovalForbidden();
    }
    if (this.rows.has(row.id)) throw new AppendOnlyViolation("UPDATE"); // clobber = an in-place update
    this.rows.set(row.id, { ...row });
  }

  async all(): Promise<GuardrailLogRow[]> {
    return [...this.rows.values()].map((r) => ({ ...r }));
  }

  async resolve(id: string, resolution: Resolution): Promise<void> {
    const row = this.rows.get(id);
    if (!row) throw new Error(`guardrail_log row ${id} not found for resolution`);
    // The trigger's whitelist (schema.md L61): ONLY pending -> a resolved status is permitted.
    if (row.status !== "pending") throw new AppendOnlyViolation("UPDATE");
    if (!isResolvedStatus(resolution.status)) throw new AppendOnlyViolation("UPDATE");
    // The check constraint still applies to the resulting row: hard_limit can never become approved.
    if (InMemoryGuardrailLogStore.violatesHardLimitCheck(row.guardrail_type, resolution.status)) {
      throw new HardLimitApprovalForbidden();
    }
    // description + task_id must be UNCHANGED (the trigger compares new.description=old.description,
    // new.task_id=old.task_id) — a resolution is a forward state change, never a rewrite of history.
    this.rows.set(id, {
      ...row,
      status: resolution.status,
      reviewed_by: resolution.reviewed_by,
      reviewed_at: resolution.reviewed_at,
    });
  }

  async rewriteContent(_id: string, _description: string): Promise<void> {
    // There is NO legal in-place content rewrite (the trigger rejects it — new.description!=old.description).
    throw new AppendOnlyViolation("REWRITE");
  }

  async delete(_id: string): Promise<void> {
    // guardrail_log has no non-retention DELETE path in this slice (AC-6.LOG.002.1).
    throw new AppendOnlyViolation("DELETE");
  }
}

// ── The injection_quarantine write/read port (table created here; write PATH is ISSUE-059) ────────────

export interface QuarantineStore {
  /** Append a shadow-retain row. Enforces the FK to guardrail_log(id) and append-only. */
  append(row: QuarantineRow): Promise<void>;
  all(): Promise<QuarantineRow[]>;
  /** The whitelisted forward human decision (pending -> discard|approved_safe), timestamped/attributed.
   *  Note: even a `discard` decision does NOT remove the row — the content is shadow-retained (ADR-007 pt4). */
  decide(id: string, decision: QuarantineDecision, reviewedBy: string, reviewedAt: string): Promise<void>;
  delete(id: string): Promise<void>;
}

export class InMemoryQuarantineStore implements QuarantineStore {
  private readonly rows = new Map<string, QuarantineRow>();

  constructor(
    private readonly log: InMemoryGuardrailLogStore,
    seed: readonly QuarantineRow[] = [],
  ) {
    for (const r of seed) this.rows.set(r.id, { ...r });
  }

  async append(row: QuarantineRow): Promise<void> {
    // FK: the referenced guardrail_log row must exist.
    const parent = (await this.log.all()).find((r) => r.id === row.guardrail_log_id);
    if (!parent) throw new DanglingQuarantineFk(row.guardrail_log_id);
    if (this.rows.has(row.id)) throw new AppendOnlyViolation("UPDATE");
    this.rows.set(row.id, { ...row });
  }

  async all(): Promise<QuarantineRow[]> {
    return [...this.rows.values()].map((r) => ({ ...r }));
  }

  async decide(id: string, decision: QuarantineDecision, reviewedBy: string, reviewedAt: string): Promise<void> {
    const row = this.rows.get(id);
    if (!row) throw new Error(`injection_quarantine row ${id} not found`);
    if (row.human_decision !== null) throw new AppendOnlyViolation("UPDATE"); // forward-only
    // shadow-retain: the content column is retained regardless of the verdict (never machine-discarded).
    this.rows.set(id, { ...row, human_decision: decision, reviewed_by: reviewedBy, reviewed_at: reviewedAt });
  }

  async delete(_id: string): Promise<void> {
    throw new AppendOnlyViolation("DELETE");
  }
}

// ── The out-of-band degraded sink (AC-6.LOG.003.3 — a path that does NOT depend on the DB that just failed) ──

export interface DegradedSinkRecord {
  at: string; // ISO-8601
  reason: string;
  guardrail_type: string;
  description: string;
  action_blocked: boolean;
}

/**
 * The last-resort surface: when a guardrail_log write fails, the lost row is recorded HERE and escalated
 * out-of-band — a path that does NOT depend on the silo DB that just failed. The live impl writes stderr + a
 * local append file; this in-memory double captures the records for assertion (AC-6.LOG.003.3 / NFR-OBS.016).
 */
export interface DegradedSink {
  record(entry: DegradedSinkRecord): void;
  drain(): DegradedSinkRecord[];
}

export class InMemoryDegradedSink implements DegradedSink {
  private readonly entries: DegradedSinkRecord[] = [];
  record(entry: DegradedSinkRecord): void {
    this.entries.push(entry);
  }
  drain(): DegradedSinkRecord[] {
    return [...this.entries];
  }
}
