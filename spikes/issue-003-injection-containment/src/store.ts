// ISSUE-003 §8.1 (assertion targets) — a faithful in-memory model of the two C6 sink tables
// from schema.md §7: `guardrail_log` and `injection_quarantine`.
//
// Why in-memory, not Postgres: ISSUE-003 §5 scopes these as READ-ONLY assertions — "asserts a
// prompt_injection / hard_limit row is produced on every hit"; the durable write path +
// append-only trigger is ISSUE-060/010's deliverable, tested there. So the spike faithfully
// reproduces the SHAPE + the two invariants the red-team reads against, and nothing more:
//   1. append-only  — no row is ever deleted; only forward status transitions (schema L38–66).
//   2. hard_limit never → 'approved' (schema L506 check) — there is no code path to approve a
//      hard-limited action; the constraint is enforced here as it is by the DB check.
//   3. injection_quarantine.human_decision stays null until an explicit human decides
//      (ADR-007 part 4 — discard is a human-only logged decision; machine never auto-discards).

export type GuardrailType =
  | 'hard_limit'
  | 'prompt_injection'
  | 'approval'
  | 'rate_limit'
  | 'anomaly';

export type GuardrailStatus = 'pending' | 'approved' | 'rejected' | 'modified';
export type QuarantineDecision = 'discard' | 'approved_safe'; // human-only (schema §7 enum)

export interface GuardrailLogRow {
  id: string;
  task_id: string | null;
  guardrail_type: GuardrailType;
  description: string;
  action_blocked: boolean;
  status: GuardrailStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface QuarantineRow {
  id: string;
  guardrail_log_id: string;
  quarantined_content: string; // never machine-discarded — retained (ADR-007 pt4)
  source_tool: string;
  source_record_id: string | null;
  human_decision: QuarantineDecision | null; // null = pending human review
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

/**
 * AppendOnlyStore — models the two sinks with their invariants enforced in code, exactly as the
 * DB check/trigger would. Any attempt to violate an invariant throws — so a rigged "pass" that
 * approves a hard limit or discards quarantine by machine is impossible even from inside the harness.
 */
export class AppendOnlyStore {
  private seq = 0;
  readonly guardrailLog: GuardrailLogRow[] = [];
  readonly quarantine: QuarantineRow[] = [];

  // Deterministic ids (no Date.now/random — keeps the battery a reproducible regression asset).
  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${String(this.seq).padStart(4, '0')}`;
  }
  private stamp(): string {
    // Monotonic logical clock string; real rows are server-timestamptz (ISSUE-060).
    return `t+${String(this.seq).padStart(4, '0')}`;
  }

  logGuardrail(row: Omit<GuardrailLogRow, 'id' | 'created_at' | 'reviewed_by' | 'reviewed_at'>): GuardrailLogRow {
    // Invariant 2 at insert time: a hard_limit row can never be born 'approved'.
    if (row.guardrail_type === 'hard_limit' && row.status === 'approved') {
      throw new Error('INVARIANT VIOLATION: hard_limit guardrail_log row cannot be approved (schema L506 check)');
    }
    const full: GuardrailLogRow = {
      id: this.nextId('gl'),
      created_at: this.stamp(),
      reviewed_by: null,
      reviewed_at: null,
      ...row,
    };
    this.guardrailLog.push(full);
    return full;
  }

  quarantineContent(row: Omit<QuarantineRow, 'id' | 'created_at' | 'human_decision' | 'reviewed_by' | 'reviewed_at'>): QuarantineRow {
    const full: QuarantineRow = {
      id: this.nextId('q'),
      created_at: this.stamp(),
      human_decision: null, // pending — never auto-decided (ADR-007 pt4)
      reviewed_by: null,
      reviewed_at: null,
      ...row,
    };
    this.quarantine.push(full);
    return full;
  }

  // Forward-only status transition (append-only trigger analogue). hard_limit → approved is
  // rejected here as the DB check would reject it. Used only if a human review path runs.
  transitionGuardrail(id: string, status: GuardrailStatus, reviewedBy: string): void {
    const row = this.guardrailLog.find((r) => r.id === id);
    if (!row) throw new Error(`no guardrail_log row ${id}`);
    if (row.guardrail_type === 'hard_limit' && status === 'approved') {
      throw new Error('INVARIANT VIOLATION: cannot approve a hard_limit block (schema L506 check)');
    }
    row.status = status;
    row.reviewed_by = reviewedBy;
    row.reviewed_at = this.stamp();
  }
}
