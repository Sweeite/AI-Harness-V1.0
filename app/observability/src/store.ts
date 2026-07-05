// ISSUE-011 §5 — the ports the observability skeleton reads/writes through (house port+fake pattern; cf.
// app/release, app/webhook-auth, app/silo). All tables are CLIENT-SILO tables created by ISSUE-008's
// 0001_baseline (app/silo/migrations). The in-memory fakes are the test doubles + the reference model that
// re-implements the DB's append-only-trigger semantics faithfully; the live pg adapter (supabase-store.ts)
// is the thin translation, authored to the DDL but NOT run in this offline half.

import type {
  EventLogRow,
  GuardrailLogRow,
  NotificationInput,
  NotificationRow,
  TaskTerminalRow,
} from "./types.ts";
import { isEventType } from "./types.ts";

// ── Errors that mirror the DB trigger's RAISE EXCEPTIONs (schema.md §Immutability) ──────────────────

/** The DB append-only trigger's "in-place UPDATE/DELETE forbidden" (AC-7.LOG.001.1). */
export class AppendOnlyViolation extends Error {
  constructor(op: "UPDATE" | "DELETE") {
    super(`audit sink event_log: ${op} forbidden (append-only / tamper-evident)`);
    this.name = "AppendOnlyViolation";
  }
}

/** The `event_type` enum rejection (AC-7.LOG.001.2 — rejected, not silently coerced). */
export class InvalidEventType extends Error {
  constructor(value: string) {
    super(`event_type '${value}' is outside the enumerated set — rejected, not coerced (AC-7.LOG.001.2)`);
    this.name = "InvalidEventType";
  }
}

/** A write failure that must NOT proceed silently (drives the out-of-band path, AC-7.LOG.003.2). */
export class EventLogWriteFailure extends Error {
  constructor(cause: string) {
    super(`event_log write failed: ${cause}`);
    this.name = "EventLogWriteFailure";
  }
}

// ── The event_log write/read port ───────────────────────────────────────────────────────────────────

export interface EventLogStore {
  /** Append a fully-formed row (id/created_at already assigned by the writer). Rejects out-of-enum
   *  event_type and refuses to clobber an existing id (append-only). Throws EventLogWriteFailure on a
   *  substrate failure so the writer can trip the out-of-band path. */
  append(row: EventLogRow): Promise<void>;
  /** Read all rows (offline reference model convenience; the live adapter would query with predicates). */
  all(): Promise<EventLogRow[]>;
  /** Apply the whitelisted one-way redaction-tombstone (sets redacted_at, scrubs summary/entity_ids in
   *  place). This is the ONE UPDATE the trigger permits (AC-7.LOG.006.3). */
  redactTombstone(id: string, redactedAt: string): Promise<void>;
  /** Delete a row — ONLY the retention job may call this; models the trigger's single removal path.
   *  Live (OD-180 / migration 0005) this DELETE is permitted only inside a `set local
   *  app.retention_prune='on'` transaction; the InMemory model treats prune() as that sole sanctioned
   *  path (no other DELETE exists on this store), so it stays faithful to the DB trigger. */
  prune(id: string): Promise<void>;
}

/**
 * The reference in-memory event_log. It re-implements the DB append-only trigger's semantics so the offline
 * tests prove the SAME invariants the trigger enforces (AC-7.LOG.001.1/.2, AC-7.LOG.006.3):
 *   - no arbitrary UPDATE (only the redaction-tombstone path mutates a row)
 *   - no DELETE except via prune() (the retention path)
 *   - an out-of-enum event_type is rejected
 * A `failNext` hook lets a test induce a substrate write failure (AF-119 fault injection).
 */
export class InMemoryEventLogStore implements EventLogStore {
  private readonly rows = new Map<string, EventLogRow>();
  /** When set, the NEXT append throws EventLogWriteFailure (fault injection — models DB unreachable). */
  private failNextCause: string | null = null;

  constructor(seed: readonly EventLogRow[] = []) {
    for (const r of seed) this.rows.set(r.id, r);
  }

  /** Fault injection: make the next append() fail as though the silo DB were unreachable (AF-119). */
  induceWriteFailure(cause = "DB unreachable"): void {
    this.failNextCause = cause;
  }

  async append(row: EventLogRow): Promise<void> {
    if (this.failNextCause !== null) {
      const cause = this.failNextCause;
      this.failNextCause = null;
      throw new EventLogWriteFailure(cause);
    }
    if (!isEventType(row.event_type)) throw new InvalidEventType(row.event_type);
    if (this.rows.has(row.id)) throw new AppendOnlyViolation("UPDATE"); // clobber = an in-place update
    this.rows.set(row.id, { ...row });
  }

  async all(): Promise<EventLogRow[]> {
    return [...this.rows.values()].map((r) => ({ ...r }));
  }

  async redactTombstone(id: string, redactedAt: string): Promise<void> {
    const row = this.rows.get(id);
    if (!row) throw new Error(`event_log row ${id} not found for redaction`);
    if (row.redacted_at !== null) return; // idempotent; the trigger only allows null→non-null (one-way)
    // The whitelisted mutation: scrub PII in place, retain existence + audit metadata (AC-7.LOG.006.3).
    this.rows.set(id, {
      ...row,
      summary: "[redacted]",
      entity_ids: null,
      payload: null,
      redacted_at: redactedAt,
    });
  }

  async prune(id: string): Promise<void> {
    // The retention path — the ONLY DELETE the model permits. Any other caller must not reach this.
    this.rows.delete(id);
  }
}

// ── task_queue terminal-status read port (silent-failure detector) ──────────────────────────────────

export interface TaskQueueStore {
  /** Tasks that have reached a TERMINAL task_queue status (completed/failed). The detector joins these
   *  against terminal event_log rows (AC-7.LOG.003.1). */
  terminalTasks(): Promise<TaskTerminalRow[]>;
}

export class InMemoryTaskQueueStore implements TaskQueueStore {
  private readonly rows: TaskTerminalRow[];
  constructor(seed: readonly TaskTerminalRow[] = []) {
    this.rows = seed.map((r) => ({ ...r }));
  }
  put(row: TaskTerminalRow): void {
    this.rows.push({ ...row });
  }
  async terminalTasks(): Promise<TaskTerminalRow[]> {
    return this.rows.map((r) => ({ ...r }));
  }
}

// ── guardrail_log read port (cross-sink reconciliation) ─────────────────────────────────────────────

export interface GuardrailLogStore {
  all(): Promise<GuardrailLogRow[]>;
}

export class InMemoryGuardrailLogStore implements GuardrailLogStore {
  private readonly rows: GuardrailLogRow[];
  constructor(seed: readonly GuardrailLogRow[] = []) {
    this.rows = seed.map((r) => ({ ...r }));
  }
  async all(): Promise<GuardrailLogRow[]> {
    return this.rows.map((r) => ({ ...r }));
  }
}

// ── notifications write port (the watchdog's critical alert lands here) ─────────────────────────────

export interface NotificationStore {
  /** Persist a notification (dashboard-first; FR-7.ALR.006 — the durable row precedes any Slack fan-out). */
  create(input: NotificationInput, id: string, createdAt: string): Promise<NotificationRow>;
  all(): Promise<NotificationRow[]>;
}

export class InMemoryNotificationStore implements NotificationStore {
  private readonly rows: NotificationRow[] = [];
  async create(input: NotificationInput, id: string, createdAt: string): Promise<NotificationRow> {
    const row: NotificationRow = {
      id,
      type: input.type,
      severity: input.severity,
      title: input.title,
      body: input.body,
      recipient: input.recipient ?? null,
      recipient_role: input.recipient_role ?? null,
      read_state: "unread", // unread-until-actioned (FR-7.ALR.001)
      escalation_state: null,
      escalated_at: null,
      actioned_at: null,
      delivery_state: null,
      created_at: createdAt,
    };
    this.rows.push(row);
    return { ...row };
  }
  async all(): Promise<NotificationRow[]> {
    return this.rows.map((r) => ({ ...r }));
  }
}

// ── The out-of-band degraded sink (AC-7.LOG.003.2 / NFR-OBS.002 — stderr/file, NOT the DB) ───────────

export interface DegradedSinkRecord {
  at: string; // ISO-8601
  reason: string;
  event_type: string;
  summary: string;
}

/**
 * The last-resort surface: when an event_log write fails, the failure is recorded HERE — a path that does
 * NOT depend on the DB substrate that just failed (AF-119). The live impl writes stderr + a local append
 * file; this in-memory double captures the same records for assertion.
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

// ── The health-bit channel carried on the mgmt-plane push (ADR-001 §7; ISSUE-012 owns the actual push) ──

/**
 * The operational-metadata bits this slice SETS for the mgmt-plane health reporter to CARRY (ISSUE-012).
 * `log_write_failing` (AC-7.LOG.003.2) and `alert_engine_stalled` (AC-7.ALR.008.2) let a fully-down silo
 * still surface on the Super Admin grid. This is a latch: once set it stays visible until explicitly
 * cleared, so a transient failure is not lost between pushes (#3).
 */
export interface HealthBits {
  log_write_failing: boolean;
  alert_engine_stalled: boolean;
}

export interface HealthBitChannel {
  set(bit: keyof HealthBits, value: boolean): void;
  snapshot(): HealthBits;
}

export class InMemoryHealthBitChannel implements HealthBitChannel {
  private readonly bits: HealthBits = { log_write_failing: false, alert_engine_stalled: false };
  set(bit: keyof HealthBits, value: boolean): void {
    this.bits[bit] = value;
  }
  snapshot(): HealthBits {
    return { ...this.bits };
  }
}
