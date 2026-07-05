// ISSUE-057 §8 — the AnomalyStore PORT. Every live side effect of the anomaly pipeline goes through
// here so the detectors + disposition + baseline logic stay unit-testable with NO live DB (the house
// port+fake pattern — cf. app/webhook-auth/src/store.ts, app/config-store/src/store.ts). The in-memory
// fake below is the test double AND the reference model; the live pg adapter (supabase-store.ts) is the
// thin translation to the real DDL.
//
// Faithful to the DDL in schema.md §7 (guardrail_log — the append-only sink built by ISSUE-011; this
// slice WRITES `anomaly`-type rows, it does not create the table) and §12 (config_values — the
// `anomaly_thresholds` structured object). Invariants enforced in the fake exactly as the DB
// check/trigger would:
//   1. guardrail_log is APPEND-ONLY; the only mutation is a controlled forward status transition
//      (pending → approved|rejected|modified). schema.md §7 trigger t_append_only.
//   2. schema CHECK: a `hard_limit` row can never be `approved` (schema.md L528). (We never write
//      hard_limit here, but the port models the invariant so a mis-typed write fails loud, not silent.)
//   3. `escalated_at` is server-owned (schema.md L526) — set only when an anomaly takes the hard path.
//   4. A default-severity anomaly is NEVER silent-dropped and NEVER autonomously continued
//      (FR-6.ANM.003.1, ADR-007 detection-as-signal): the ONLY authorised disposition is a written
//      guardrail_log row + a review flag. The fake's `flagForReview` records that flag so a test can
//      prove the task was flagged, not dropped.

// ── guardrail_log (append-only) — schema.md §7 ──────────────────────────────────────
// guardrail_type/status enums mirror schema.md L120-121 exactly. This path only ever writes 'anomaly',
// but the full enums are listed so a mistyped value is a type error, not a silent bad insert.
export type GuardrailType = 'hard_limit' | 'approval_gate' | 'anomaly' | 'rate_limit' | 'prompt_injection';
export type GuardrailStatus = 'pending' | 'approved' | 'rejected' | 'modified';

export interface GuardrailLogRow {
  id: string;
  task_id: string | null;
  guardrail_type: GuardrailType;
  description: string;
  action_blocked: boolean;
  status: GuardrailStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  escalated_at: string | null;
  created_at: string;
}

/** A new guardrail_log row. id/created_at/reviewed_* are DB/server-owned; escalated_at is optional. */
export type NewGuardrail = Omit<
  GuardrailLogRow,
  'id' | 'created_at' | 'reviewed_by' | 'reviewed_at' | 'escalated_at'
> &
  Partial<Pick<GuardrailLogRow, 'escalated_at'>>;

/** The review flag raised on the task when an anomaly fires (FR-6.ANM.003 soft path). Modelled as a
 *  task_status → 'flagged' transition (schema.md L117 task_status enum + L487 "'flagged' set only by C6").
 *  The port stops at raising the flag; the queue/UI that consumes it is ISSUE-056/060. */
export interface ReviewFlag {
  task_id: string;
  guardrail_log_id: string;
  reason: string;
}

/** A baseline tighten/loosen proposal awaiting admin confirmation (FR-6.ANM.005). `gate_altering` = the
 *  proposed change would flip a GATE outcome (not merely a signal) → admin confirmation REQUIRED before
 *  it is applied; a non-gate-altering proposal is a plain signal-tuning suggestion. */
export interface BaselineProposal {
  id: string;
  kind: string; // AnomalyKind, kept as string here to avoid a config import cycle
  current_threshold: number;
  proposed_threshold: number;
  direction: 'tighten' | 'loosen';
  gate_altering: boolean;
  status: 'proposed' | 'confirmed' | 'applied' | 'rejected';
  confirmed_by: string | null;
}

// The port. Sync-shaped in the fake but modelled async for the DB adapter.
export interface AnomalyStore {
  /** Append a guardrail_log row (this slice always type 'anomaly'). Append-only. */
  logGuardrail(row: NewGuardrail): Promise<GuardrailLogRow>;
  /** Forward status transition on an existing guardrail_log row (pending → approved|rejected|modified). */
  transitionGuardrail(id: string, to: Exclude<GuardrailStatus, 'pending'>, reviewedBy: string, now: number): Promise<GuardrailLogRow>;
  /** Set escalated_at on a row (server-owned) when an anomaly takes the hard-approval path. */
  markEscalated(id: string, now: number): Promise<GuardrailLogRow>;
  /** Raise the human-review flag on the task (task_status → 'flagged'). Never a silent no-op. */
  flagForReview(flag: ReviewFlag): Promise<void>;

  /** Persist a baseline proposal (FR-6.ANM.005). */
  recordBaselineProposal(p: Omit<BaselineProposal, 'id' | 'status' | 'confirmed_by'>): Promise<BaselineProposal>;
  /** Admin-confirm a gate-altering proposal. Throws if the proposal is unknown. */
  confirmBaselineProposal(id: string, adminId: string): Promise<BaselineProposal>;
}

// ───────────────────────────────────────────────────────────────────────────────────
// In-memory fake — the test double AND the reference model. Deterministic: a logical `now`
// (epoch seconds) is supplied by the caller; no Date.now()/random (house discipline — testable,
// resumable). Enforces every guardrail_log invariant the DB would.
// ───────────────────────────────────────────────────────────────────────────────────
export class InMemoryAnomalyStore implements AnomalyStore {
  private seq = 0;
  readonly guardrailLog: GuardrailLogRow[] = [];
  readonly reviewFlags: ReviewFlag[] = [];
  readonly baselineProposals: BaselineProposal[] = [];

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${String(this.seq).padStart(4, '0')}`;
  }
  private stamp(now?: number): string {
    if (now !== undefined) return new Date(now * 1000).toISOString();
    this.seq += 1;
    return `t+${String(this.seq).padStart(4, '0')}`;
  }

  async logGuardrail(row: NewGuardrail): Promise<GuardrailLogRow> {
    // Invariant 2 (schema.md L528): a hard_limit row can never be approved.
    if (row.guardrail_type === 'hard_limit' && row.status === 'approved') {
      throw new Error('INVARIANT VIOLATION: a hard_limit guardrail_log row can never be approved (schema CHECK)');
    }
    const full: GuardrailLogRow = {
      id: this.nextId('gl'),
      created_at: this.stamp(),
      reviewed_by: null,
      reviewed_at: null,
      escalated_at: row.escalated_at ?? null,
      ...row,
    };
    this.guardrailLog.push(full);
    return full;
  }

  async transitionGuardrail(
    id: string,
    to: Exclude<GuardrailStatus, 'pending'>,
    reviewedBy: string,
    now: number,
  ): Promise<GuardrailLogRow> {
    const row = this.guardrailLog.find((r) => r.id === id);
    if (!row) throw new Error(`no guardrail_log row ${id}`);
    // Invariant 1 (schema.md §7 trigger): ONLY a forward transition from 'pending' is permitted.
    if (row.status !== 'pending') {
      throw new Error(`APPEND-ONLY: guardrail_log ${id} is ${row.status}; only pending→terminal is allowed`);
    }
    row.status = to;
    row.reviewed_by = reviewedBy;
    row.reviewed_at = this.stamp(now);
    return row;
  }

  async markEscalated(id: string, now: number): Promise<GuardrailLogRow> {
    const row = this.guardrailLog.find((r) => r.id === id);
    if (!row) throw new Error(`no guardrail_log row ${id}`);
    // OD-182 monotonic escalation stamp (schema.md §Immutability enforcement, migration 0009): the widened
    // append-only trigger permits escalated_at null→ts ONLY once, status unchanged, action_blocked only
    // false→true. Model it faithfully so the fake == live DDL — a re-stamp is rejected exactly as the trigger
    // would (the drift the verifier caught was that this had NO append-only guard).
    if (row.escalated_at !== null) {
      throw new Error(`APPEND-ONLY: guardrail_log ${id} already escalated (escalated_at is write-once — OD-182)`);
    }
    row.escalated_at = this.stamp(now);
    row.action_blocked = true; // hard path blocks; false→true is the only permitted action_blocked move
    return row;
  }

  async flagForReview(flag: ReviewFlag): Promise<void> {
    // FR-6.ANM.003.1 / #3: a review flag with no task cannot be routed — fail LOUD, never a silent no-op.
    // (The caller persists the guardrail_log row BEFORE this runs, so the anomaly itself is never lost;
    // only the un-routable flag raises.) Fake + adapter agree on this rule.
    if (!flag.task_id) {
      throw new Error('flagForReview: task_id is required — an anomaly review flag with no task cannot be routed (never silently dropped, #3)');
    }
    this.reviewFlags.push(flag);
  }

  async recordBaselineProposal(
    p: Omit<BaselineProposal, 'id' | 'status' | 'confirmed_by'>,
  ): Promise<BaselineProposal> {
    const full: BaselineProposal = { id: this.nextId('bp'), status: 'proposed', confirmed_by: null, ...p };
    this.baselineProposals.push(full);
    return full;
  }

  async confirmBaselineProposal(id: string, adminId: string): Promise<BaselineProposal> {
    const p = this.baselineProposals.find((x) => x.id === id);
    if (!p) throw new Error(`no baseline proposal ${id}`);
    p.status = 'confirmed';
    p.confirmed_by = adminId;
    return p;
  }
}
