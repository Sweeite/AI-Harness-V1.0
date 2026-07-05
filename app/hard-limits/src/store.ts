// ISSUE-055 — the HardLimitGate PORT + in-memory fake reference model (the house port+fake pattern, cf.
// app/config-store store.ts, app/webhook-auth store.ts). The fake IS the reference model the live pg
// adapter (supabase-store.ts) must match against the DDL (schema.md §7 guardrail_log + the
// `check (not (guardrail_type='hard_limit' and status='approved'))` constraint + the append-only trigger).
//
// This slice owns the CODE half of the seven hard limits (limits.ts) plus:
//   - the immediate guardrail_log write (type 'hard_limit') on every hit, FAIL-CLOSED w.r.t. the write
//     (the block is final; the row is best-effort logging of an already-taken decision — FR-6.HRD.002 /
//     AC-6.HRD.002.1);
//   - the alert emit to C7's surfacing path, with a DROPPED alert itself surfaced (AC-6.HRD.002.2);
//   - the NO-override posture: no approve affordance; a status→approved transition on a 'hard_limit' row is
//     rejected at every path (DB check + application) — FR-6.HRD.003 / AC-6.HRD.003.2;
//   - the agent-definition write guard: a definition granting Comms-send / Finance-transact / non-Memory-
//     Agent memory-write is REJECTED at save, not merely audited (AC-NFR-SEC.004.2);
//   - the coverage-gap governance posture: a new dangerous capability routes to hard-approval + a rate cap,
//     NEVER to an eighth hard limit; any change to the set is change-control (FR-6.HRD.004 / NFR-SEC.005).
//
// It does NOT own: the guardrail_log table DDL / append-only trigger (LOG slice), alert DELIVERY (C7 /
// ISSUE-011/075), the connector-grain application of the limits (ISSUE-035), the approval tiers (ISSUE-056).

import {
  classify,
  HARD_LIMITS,
  type ActionAttempt,
  type HardLimitDecision,
  type HardLimitId,
} from './limits.ts';

// ── guardrail_log row (schema.md §7) — the subset this slice writes/reads ─────────────────────────────
export type GuardrailType = 'hard_limit' | 'approval_gate' | 'anomaly' | 'rate_limit' | 'prompt_injection';
export type GuardrailStatus = 'pending' | 'approved' | 'rejected' | 'modified';

export interface GuardrailLogRow {
  id: string;
  task_id: string | null;
  guardrail_type: GuardrailType;
  description: string;
  action_blocked: boolean;
  status: GuardrailStatus;
  created_at: string;
}

// ── the alert event emitted to C7 (schema.md alert_type enum: 'hard_limit_hit') ───────────────────────
export interface HardLimitAlert {
  alert_type: 'hard_limit_hit';
  guardrail_log_id: string | null; // null when the row write failed (block still held)
  limit: HardLimitId;
  description: string;
  emitted_at: string;
}

/** The C7 alert sink seam. Delivery is C7/ISSUE-011/075; this slice only emits the event. */
export interface AlertSink {
  emit(alert: HardLimitAlert): Promise<void>;
}

// The exact message the DB CHECK / application reject raises, so a test asserts the same failure the live
// silo produces. Mirrors schema.md §7: check (not (guardrail_type='hard_limit' and status='approved')).
export const ERR_HARD_LIMIT_APPROVE_FORBIDDEN =
  "guardrail_log: a 'hard_limit' event can never be marked 'approved' " +
  '(no-override; schema check not(hard_limit and approved) / FR-6.HRD.003 / AC-6.HRD.003.2)';

// ── the outcome of enforcing the gate on one attempt ──────────────────────────────────────────────────
export interface EnforcementOutcome {
  decision: HardLimitDecision;
  /** true iff the attempt was blocked by a hard limit (the block is FINAL regardless of logging). */
  blocked: boolean;
  /** the guardrail_log row id if the write succeeded; null if it failed (block still held). */
  logRowId: string | null;
  /** true iff the log write failed — surfaced, never swallowed (#3). */
  logWriteFailed: boolean;
  /** true iff the alert emit failed — surfaced out-of-band, never a silent loss (AC-6.HRD.002.2). */
  alertDropped: boolean;
}

// ── the agent-definition write guard (AC-NFR-SEC.004.2) ───────────────────────────────────────────────
// A saved agent definition may not GRANT a hard-limited capability. The three named at NFR-SEC.004.2:
// Comms-send, Finance-transact, and a non-Memory-Agent memory write. Rejected at save, not audited.
export type AgentCapability =
  | 'comms_send'
  | 'finance_transact'
  | 'memory_write'
  | 'read'
  | 'draft'
  | 'search';

export interface AgentDefinition {
  name: string;
  /** the role the agent plays; only the Memory-Agent may hold 'memory_write'. */
  isMemoryAgent: boolean;
  /** the capabilities the definition grants (maps to tools_allowed at the tool grain, ISSUE-035). */
  grants: readonly AgentCapability[];
}

export class AgentDefinitionRejected extends Error {
  constructor(
    public readonly capability: AgentCapability,
    message: string,
  ) {
    super(message);
    this.name = 'AgentDefinitionRejected';
  }
}

// ── coverage-gap governance (FR-6.HRD.004 / NFR-SEC.005) ──────────────────────────────────────────────
// A newly-identified dangerous capability is routed to hard-approval + a rate cap — NEVER promoted to an
// eighth hard limit. classifyNewCapability returns that routing; it can never return "add a hard limit".
export interface CoverageRouting {
  capability: string;
  /** always the pair — a new dangerous capability lands on hard-approval AND a rate cap. */
  route: 'hard_approval_and_rate_cap';
  handoffApr: 'ISSUE-056'; // APR tier assignment (FR-6.APR.001/002)
  handoffRtl: 'ISSUE-058'; // rate-limit cap (FR-6.RTL.001)
  promotedToHardLimit: false; // structurally impossible — the set of seven is frozen
}

export class HardLimitSetChangeRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HardLimitSetChangeRejected';
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// THE PORT. Sync-modelled in the fake; async so the pg adapter matches. Everything a live silo would
// enforce is enforced here so a test against the fake proves the contract the silo must uphold.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
export interface HardLimitGate {
  /** Pure classification — un-overridable, fail-closed. Delegates to limits.classify. */
  check(attempt: ActionAttempt): HardLimitDecision;

  /** The enforcement path: classify, and on a block write the guardrail_log row (best-effort) + emit the
   *  alert. The block is FINAL and returned even if the row write or the alert fails (fail-closed w.r.t.
   *  logging — the block never waits on or rolls back for the write). */
  enforce(attempt: ActionAttempt, alerts: AlertSink, now: number, taskId?: string | null): Promise<EnforcementOutcome>;

  /** Reject a status→approved transition on a 'hard_limit' row at the application layer (mirrors the DB
   *  CHECK). Any other guardrail_type may transition; a 'hard_limit' row can never be approved. */
  setStatus(rowId: string, status: GuardrailStatus): Promise<GuardrailLogRow>;

  /** Read a written guardrail_log row (for the dashboard no-affordance assertion). */
  getRow(rowId: string): Promise<GuardrailLogRow | null>;

  /** Agent-definition write guard — reject at save any grant of a hard-limited capability (AC-NFR-SEC.004.2). */
  saveAgentDefinition(def: AgentDefinition): Promise<AgentDefinition>;

  /** Coverage-gap governance — route a new dangerous capability to hard-approval + rate cap, never a new
   *  hard limit (FR-6.HRD.004 / NFR-SEC.005). */
  classifyNewCapability(capability: string): CoverageRouting;

  /** Any change to the hard-limit set is a change-control item, never a config/code edit (AC-6.HRD.004.2). */
  proposeHardLimitSetChange(change: string): never;
}

// A fault-injecting sink lets a test drive the "log write fails" / "alert dropped" paths.
export interface FaultConfig {
  failLogWrite?: boolean;
  failAlert?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// In-memory fake — the reference model. Deterministic: `now` (epoch seconds) is caller-supplied; no
// Date.now()/random (house discipline).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
export class InMemoryHardLimitGate implements HardLimitGate {
  private seq = 0;
  readonly rows = new Map<string, GuardrailLogRow>();
  /** dropped-alert log — the out-of-band surface for AC-6.HRD.002.2 (a dropped alert is never silent). */
  readonly droppedAlerts: HardLimitAlert[] = [];

  constructor(private readonly faults: FaultConfig = {}) {}

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${String(this.seq).padStart(4, '0')}`;
  }
  private iso(now: number): string {
    return new Date(now * 1000).toISOString();
  }

  check(attempt: ActionAttempt): HardLimitDecision {
    return classify(attempt);
  }

  async enforce(
    attempt: ActionAttempt,
    alerts: AlertSink,
    now: number,
    taskId: string | null = null,
  ): Promise<EnforcementOutcome> {
    const decision = this.check(attempt);
    if (!decision.blocked) {
      return { decision, blocked: false, logRowId: null, logWriteFailed: false, alertDropped: false };
    }

    // The block is FINAL from here. Logging + alerting are best-effort; neither can un-block (#2/#3).
    const limit = decision.limit!;
    let logRowId: string | null = null;
    let logWriteFailed = false;
    let alertDropped = false;

    // 1) Immediate guardrail_log row (type 'hard_limit'). Best-effort — a failure does NOT roll the block
    //    back (AC-6.HRD.002.1). We swallow the write error into a surfaced flag, never into a permit.
    try {
      if (this.faults.failLogWrite) throw new Error('injected log-write failure');
      const row: GuardrailLogRow = {
        id: this.nextId('gl'),
        task_id: taskId,
        guardrail_type: 'hard_limit',
        description: decision.reason,
        action_blocked: true, // ALWAYS true for a hard-limit hit — the block already happened
        status: 'pending', // and it can NEVER become 'approved' (setStatus + DB check)
        created_at: this.iso(now),
      };
      this.rows.set(row.id, row);
      logRowId = row.id;
    } catch {
      logWriteFailed = true; // surfaced in the outcome — the block still holds
    }

    // 2) Emit the alert to C7. A dropped alert is itself surfaced out-of-band (AC-6.HRD.002.2) — never a
    //    silent loss (#3). The block does not depend on the alert either.
    const alert: HardLimitAlert = {
      alert_type: 'hard_limit_hit',
      guardrail_log_id: logRowId,
      limit,
      description: decision.reason,
      emitted_at: this.iso(now),
    };
    try {
      if (this.faults.failAlert) throw new Error('injected alert-delivery failure');
      await alerts.emit(alert);
    } catch {
      alertDropped = true;
      this.droppedAlerts.push(alert); // out-of-band surface, mirrors the DLQ-heartbeat pattern (AC-5.JOB.006.2)
    }

    return { decision, blocked: true, logRowId, logWriteFailed, alertDropped };
  }

  async setStatus(rowId: string, status: GuardrailStatus): Promise<GuardrailLogRow> {
    const row = this.rows.get(rowId);
    if (!row) throw new Error(`guardrail_log row ${rowId} not found`);
    // The no-override invariant — mirrors the DB CHECK not(hard_limit and approved). A 'hard_limit' row
    // can NEVER be marked 'approved' via ANY path (FR-6.HRD.003 / AC-6.HRD.003.2). This holds regardless
    // of role/config — there is deliberately no parameter by which a caller could authorise it.
    if (row.guardrail_type === 'hard_limit' && status === 'approved') {
      throw new Error(ERR_HARD_LIMIT_APPROVE_FORBIDDEN);
    }
    const next: GuardrailLogRow = { ...row, status };
    this.rows.set(rowId, next);
    return next;
  }

  async getRow(rowId: string): Promise<GuardrailLogRow | null> {
    return this.rows.get(rowId) ?? null;
  }

  async saveAgentDefinition(def: AgentDefinition): Promise<AgentDefinition> {
    for (const cap of def.grants) {
      // Comms-send and Finance-transact are hard-limited capabilities — no agent definition may grant
      // them (they would let the agent autonomously ①/②). Rejected at save (AC-NFR-SEC.004.2).
      if (cap === 'comms_send') {
        throw new AgentDefinitionRejected(cap, `agent '${def.name}': cannot grant Comms-send (hard limit ① — rejected at save, AC-NFR-SEC.004.2)`);
      }
      if (cap === 'finance_transact') {
        throw new AgentDefinitionRejected(cap, `agent '${def.name}': cannot grant Finance-transact (hard limit ② — rejected at save, AC-NFR-SEC.004.2)`);
      }
      // A memory write is the SOLE privilege of the Memory-Agent (ADR-004 sole-writer). Any OTHER agent
      // granted a memory write is rejected at save.
      if (cap === 'memory_write' && !def.isMemoryAgent) {
        throw new AgentDefinitionRejected(cap, `agent '${def.name}': non-Memory-Agent cannot grant memory-write (ADR-004 sole-writer — rejected at save, AC-NFR-SEC.004.2)`);
      }
    }
    return def;
  }

  classifyNewCapability(capability: string): CoverageRouting {
    // Structurally cannot return "promote to hard limit": a new dangerous capability ALWAYS lands on
    // hard-approval + a rate cap (FR-6.HRD.004 / NFR-SEC.005 / AC-NFR-SEC.005.1), routed to ISSUE-056 (APR)
    // and ISSUE-058 (RTL). It is never silently auto-allowed.
    return {
      capability,
      route: 'hard_approval_and_rate_cap',
      handoffApr: 'ISSUE-056',
      handoffRtl: 'ISSUE-058',
      promotedToHardLimit: false,
    };
  }

  proposeHardLimitSetChange(change: string): never {
    // Any add/remove/relax of the seven is a change-control item (supersede ADR-007 / open an OD), NOT a
    // config edit and not before AF-068 clears (AC-6.HRD.004.2). This entry point can only refuse.
    throw new HardLimitSetChangeRejected(
      `hard-limit-set change '${change}' is a change-control item (supersede ADR-007 / OD), never a config or code edit (AC-6.HRD.004.2). ` +
        `The set of ${HARD_LIMITS.length} is frozen.`,
    );
  }
}
