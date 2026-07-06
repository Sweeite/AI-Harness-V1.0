// ISSUE-077 §5 — the ports the C7 retention/export/tombstone layer reads/writes through (house port+fake
// pattern; cf. app/observability, app/management, app/guardrail-log). event_log / guardrail_log /
// config_audit_log / push_subscriptions are CLIENT-SILO tables created by ISSUE-008's 0001_baseline
// (app/silo/migrations). The in-memory fakes are the test doubles AND the reference model that re-implements
// the DB's guarantees faithfully — the append-only trigger, the ONE whitelisted redaction-tombstone mutation,
// and the retention-only DELETE path. The live pg adapter (supabase-store.ts) is the thin translation, authored
// to the DDL but NOT run in this offline half.

import { createHash } from "node:crypto";
import type {
  ConfigAuditLogRow,
  EventLogRow,
  GuardrailLogRow,
  PushSubscriptionRow,
} from "./types.ts";

// ── Errors that mirror the DB trigger/constraint RAISE EXCEPTIONs (schema.md §Immutability) ────────────

/** The append-only trigger's "arbitrary in-place UPDATE/DELETE forbidden". Only the retention prune and the
 *  redaction-tombstone are sanctioned; anything else on a historical row is tamper and is refused. */
export class AppendOnlyViolation extends Error {
  constructor(sink: string, op: string) {
    super(`audit sink ${sink}: ${op} forbidden (append-only / tamper-evident)`);
    this.name = "AppendOnlyViolation";
  }
}

/** A substrate write/read failure that must NOT proceed silently (drives fail-loud paths, #3). */
export class SinkSubstrateFailure extends Error {
  constructor(sink: string, cause: string) {
    super(`${sink} substrate failure: ${cause}`);
    this.name = "SinkSubstrateFailure";
  }
}

// ── A tamper-evidence integrity digest over the immutable fields of an audit row (AC-7.LOG.007.3) ──────
//
// The live DB carries the tamper-evidence as an append-only trigger that rejects any content rewrite; offline
// we ALSO model an explicit integrity digest so a test can prove that a post-hoc content mutation is DETECTABLE
// and that an AUTHORIZED redaction-tombstone is distinguishable from tampering (the digest is recomputed to
// include redacted_at, so a legitimate tombstone verifies while a covert edit does not). This is the "integrity
// check" AC-7.LOG.007.3 names, sitting alongside the append-only trigger.
export function guardrailIntegrityDigest(row: GuardrailLogRow): string {
  // The immutable, tamper-relevant fields. `description` is included so a covert content rewrite is caught;
  // `redacted_at` is included so an AUTHORIZED tombstone (which also blanks description) re-verifies while an
  // unauthorized rewrite (description changed, redacted_at still null) does not.
  const canonical = JSON.stringify({
    id: row.id,
    task_id: row.task_id,
    guardrail_type: row.guardrail_type,
    description: row.description,
    action_blocked: row.action_blocked,
    status: row.status,
    reviewed_by: row.reviewed_by,
    reviewed_at: row.reviewed_at,
    escalated_at: row.escalated_at,
    redacted_at: row.redacted_at,
    created_at: row.created_at,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

// ── event_log port (retention + redaction-tombstone; write/read of content is ISSUE-011) ──────────────

export interface EventLogStore {
  all(): Promise<EventLogRow[]>;
  /** The ONE whitelisted mutation: set redacted_at, scrub summary/entity_ids/payload in place, retain the row
   *  + audit metadata (created_at/event_type/task_id). Idempotent + one-way (AC-7.LOG.006.3). */
  redactTombstone(id: string, redactedAt: string): Promise<void>;
  /** The retention path — the ONLY DELETE this store permits (models the trigger's single sanctioned removal
   *  under `set local app.retention_prune='on'`). */
  prune(id: string): Promise<void>;
}

export class InMemoryEventLogStore implements EventLogStore {
  private readonly rows = new Map<string, EventLogRow>();
  private failNextCause: string | null = null;

  constructor(seed: readonly EventLogRow[] = []) {
    for (const r of seed) this.rows.set(r.id, { ...r });
  }

  /** Fault injection: make the next read fail as though the silo DB were unreachable (fail-loud proof). */
  induceReadFailure(cause = "DB unreachable"): void {
    this.failNextCause = cause;
  }

  async all(): Promise<EventLogRow[]> {
    if (this.failNextCause !== null) {
      const cause = this.failNextCause;
      this.failNextCause = null;
      throw new SinkSubstrateFailure("event_log", cause);
    }
    return [...this.rows.values()].map((r) => ({ ...r }));
  }

  async redactTombstone(id: string, redactedAt: string): Promise<void> {
    const row = this.rows.get(id);
    if (!row) throw new Error(`event_log row ${id} not found for redaction`);
    if (row.redacted_at !== null) return; // idempotent; one-way (null → non-null only)
    this.rows.set(id, { ...row, summary: "[redacted]", entity_ids: null, payload: null, redacted_at: redactedAt });
  }

  async prune(id: string): Promise<void> {
    this.rows.delete(id); // the retention path — the ONLY DELETE the model permits
  }
}

// ── guardrail_log port (view/retention/tamper-evidence/export/tombstone) ──────────────────────────────

export interface GuardrailLogStore {
  all(): Promise<GuardrailLogRow[]>;
  /** Read rows whose created_at falls in [fromIso, toIso] inclusive — the export window (AC-7.LOG.007.1). The
   *  live adapter pushes this predicate to SQL; the fake filters in memory. `expectedCount` lets the caller
   *  reconcile against an independently-counted total so a silent truncation fails loud (AF-133 / NFR-CMP.009). */
  inRange(fromIso: string, toIso: string): Promise<GuardrailLogRow[]>;
  /** An independent COUNT(*) over the same window — the export reconciles rows.length against this; a mismatch
   *  is a shortfall the export must fail loud on (never emit a partial "complete" file). */
  countInRange(fromIso: string, toIso: string): Promise<number>;
  redactTombstone(id: string, redactedAt: string): Promise<void>;
  prune(id: string): Promise<void>;
  /** Prove the append-only trigger rejects a covert content rewrite (there is no legal in-place rewrite). */
  rewriteContent(id: string, description: string): Promise<void>;
}

export class InMemoryGuardrailLogStore implements GuardrailLogStore {
  private readonly rows = new Map<string, GuardrailLogRow>();
  /** When set, the NEXT countInRange returns a value INCONSISTENT with inRange — models a substrate mid-read
   *  divergence (a row vanished/added between the count and the fetch), which the export must catch (AF-133). */
  private countSkew = 0;

  constructor(seed: readonly GuardrailLogRow[] = []) {
    for (const r of seed) this.rows.set(r.id, { ...r });
  }

  /** Fault injection: force the next reconciliation count to disagree with the fetched rows by `delta`. */
  induceCountSkew(delta: number): void {
    this.countSkew = delta;
  }

  async all(): Promise<GuardrailLogRow[]> {
    return [...this.rows.values()].map((r) => ({ ...r }));
  }

  private within(row: GuardrailLogRow, fromIso: string, toIso: string): boolean {
    const t = Date.parse(row.created_at);
    return t >= Date.parse(fromIso) && t <= Date.parse(toIso);
  }

  async inRange(fromIso: string, toIso: string): Promise<GuardrailLogRow[]> {
    return [...this.rows.values()]
      .filter((r) => this.within(r, fromIso, toIso))
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
      .map((r) => ({ ...r }));
  }

  async countInRange(fromIso: string, toIso: string): Promise<number> {
    const real = [...this.rows.values()].filter((r) => this.within(r, fromIso, toIso)).length;
    const skewed = real + this.countSkew;
    this.countSkew = 0;
    return skewed;
  }

  async redactTombstone(id: string, redactedAt: string): Promise<void> {
    const row = this.rows.get(id);
    if (!row) throw new Error(`guardrail_log row ${id} not found for redaction`);
    if (row.redacted_at !== null) return; // idempotent; one-way
    // Scrub the PII narrative; RETAIN the security event + audit metadata (type/status/action_blocked/created).
    this.rows.set(id, { ...row, description: "[redacted]", redacted_at: redactedAt });
  }

  async prune(id: string): Promise<void> {
    this.rows.delete(id); // retention path only
  }

  async rewriteContent(id: string, description: string): Promise<void> {
    // There is NO legal in-place content rewrite of a historical audit row. The trigger rejects it; the model
    // does too. (A test calls this to prove tampering is refused — AC-7.LOG.007.3.)
    void description;
    if (this.rows.has(id)) throw new AppendOnlyViolation("guardrail_log", "in-place content REWRITE");
    throw new AppendOnlyViolation("guardrail_log", "REWRITE of a nonexistent row");
  }
}

// ── config_audit_log read port (third-sink floor parity only; FR-7.LOG.008 governed by ISSUE-010) ─────

export interface ConfigAuditLogStore {
  all(): Promise<ConfigAuditLogRow[]>;
}

export class InMemoryConfigAuditLogStore implements ConfigAuditLogStore {
  private readonly rows: ConfigAuditLogRow[];
  constructor(seed: readonly ConfigAuditLogRow[] = []) {
    this.rows = seed.map((r) => ({ ...r }));
  }
  async all(): Promise<ConfigAuditLogRow[]> {
    return this.rows.map((r) => ({ ...r }));
  }
}

// ── push_subscriptions read port (mobile push routing target; FR-7.VIEW.003) ──────────────────────────

export interface PushSubscriptionStore {
  forUser(userId: string): Promise<PushSubscriptionRow[]>;
}

export class InMemoryPushSubscriptionStore implements PushSubscriptionStore {
  private readonly rows: PushSubscriptionRow[];
  constructor(seed: readonly PushSubscriptionRow[] = []) {
    this.rows = seed.map((r) => ({ ...r }));
  }
  async forUser(userId: string): Promise<PushSubscriptionRow[]> {
    return this.rows.filter((r) => r.user_id === userId).map((r) => ({ ...r }));
  }
}

// ── A LOCAL event_log write sink (retention/erasure runs LOG themselves; pruning is never silent) ─────
//
// Retention/erasure operations record a summary event through this sink (AC-7.LOG.006.2). It is deliberately a
// narrow write interface — this slice does NOT re-implement the ISSUE-011 event-write API; it appends an
// operational summary row.
export interface EventWriteSink {
  writeSummary(entry: { event_type: string; summary: string; payload: Record<string, unknown> }): Promise<void>;
}

export class InMemoryEventWriteSink implements EventWriteSink {
  readonly written: Array<{ event_type: string; summary: string; payload: Record<string, unknown> }> = [];
  async writeSummary(entry: { event_type: string; summary: string; payload: Record<string, unknown> }): Promise<void> {
    this.written.push({ ...entry, payload: { ...entry.payload } });
  }
}
