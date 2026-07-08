// ISSUE-058 — the GuardrailLogSink PORT + in-memory reference fake, and the RateCostLadder coordinator that
// ties the pure decisions (ladder.ts) to the sink so the #3 invariant HOLDS: every cap breach and every cost
// rung transition writes a `guardrail_log` row of type `rate_limit` (never silent). This slice is a PRODUCER
// of guardrail_log rows — the table + enums + append-only trigger are landed by ISSUE-060 (C6 LOG).
//
// Decide/execute boundary (AC-NFR-COST.004.1): the coordinator DECIDES (emits a disposition) and LOGS; it
// never throttles/kills a run or touches a queue — that is C5's job. The only side effect here is the loud log.

import {
  decideRateBreach,
  decideCostRung,
  type RateBreachInput,
  type RateBreachDecision,
  type CostRungSignal,
  type CostDisposition,
} from './ladder.ts';

/** The guardrail_type value this slice writes (schema.md §7 enum; 0001 baseline). Single source of truth. */
export const GUARDRAIL_TYPE_RATE_LIMIT = 'rate_limit' as const;

/** A draft guardrail_log row (schema.md §7). id/status/created_at are DB-defaulted; status starts 'pending'. */
export interface GuardrailLogRowDraft {
  taskId: string | null;
  guardrailType: typeof GUARDRAIL_TYPE_RATE_LIMIT;
  description: string; // plain-English, NEVER empty (#3 — a silent-cause log is no log)
  actionBlocked: boolean;
}

export interface GuardrailLogSink {
  /** Append one rate_limit-class guardrail_log row; returns the new row id. */
  writeRateLimitRow(row: GuardrailLogRowDraft): Promise<string>;
}

// guardrail_log.task_id is `uuid references task_queue(id)` (schema.md §7). A non-null taskId that is not a
// canonical UUID is rejected by Postgres at INSERT ('invalid input syntax for type uuid'); left unvalidated
// that surfaces late as logWriteFailed and — under the house log-failure posture — the breach/rung row is
// SILENTLY LOST (#1 knowledge loss, #3 near-silent). We reject a malformed task_id LOUDLY at the boundary
// instead, and share this guard between the in-memory fake and the live adapter so the fake matches live 1:1
// (a non-UUID no longer "passes" offline while throwing live). The FK-existence half (a well-formed UUID not
// present in task_queue) is inherently a live check — it is exercised by the R10 live-adapter smoke.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Guard a draft against a silent/contentless row (#3) and a malformed task_id that live would reject (#1). */
export function assertLoudDraft(row: GuardrailLogRowDraft): void {
  if (row.guardrailType !== GUARDRAIL_TYPE_RATE_LIMIT) {
    throw new Error(`guardrail_log row must be type '${GUARDRAIL_TYPE_RATE_LIMIT}', got '${row.guardrailType}'.`);
  }
  if (!row.description || !row.description.trim()) {
    throw new Error('guardrail_log row must carry a non-empty description (a silent breach/rung log is a #3 violation).');
  }
  if (row.taskId !== null && !UUID_RE.test(row.taskId)) {
    throw new Error(
      `guardrail_log.task_id must be null or a canonical UUID (task_queue.id), got '${row.taskId}' — refusing a write the DB would reject and lose (#1).`,
    );
  }
}

// ── In-memory reference fake — the semantics the live adapter must match 1:1 (proven by the R10 smoke) ──
export interface StoredGuardrailLogRow extends GuardrailLogRowDraft {
  id: string;
  status: 'pending';
  createdAt: number;
}

export class InMemoryGuardrailLogSink implements GuardrailLogSink {
  readonly rows: StoredGuardrailLogRow[] = [];
  private seq = 0;
  /** When set, the next write throws — used to prove a log-write failure is surfaced, never swallowed (#3). */
  failNextWrite = false;

  async writeRateLimitRow(row: GuardrailLogRowDraft): Promise<string> {
    assertLoudDraft(row);
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error('simulated guardrail_log write failure');
    }
    const id = `gl_${++this.seq}`;
    this.rows.push({ ...row, id, status: 'pending', createdAt: this.seq });
    return id;
  }

  /** Test helper: rate_limit rows written so far. */
  rateLimitRows(): StoredGuardrailLogRow[] {
    return this.rows.filter((r) => r.guardrailType === GUARDRAIL_TYPE_RATE_LIMIT);
  }
}

// ── The coordinator: decision + guaranteed-loud log (the #3 seam every breach/rung reports into) ──────────────
export interface BreachRecord {
  decision: RateBreachDecision;
  logRowId: string | null;
  /** true if the guardrail_log write failed — SURFACED, never swallowed; the safety decision still holds. */
  logWriteFailed: boolean;
}

export interface RungRecord {
  disposition: CostDisposition;
  logRowId: string | null;
  logWriteFailed: boolean;
}

export class RateCostLadder {
  constructor(private readonly sink: GuardrailLogSink) {}

  /** Record a rate-limit cap breach: decide the consistent C6 response (AC-6.RTL.002.1) AND write the loud
   *  guardrail_log row (AC-6.RTL.001.2 / #3). Same response regardless of which owner's counter called it. */
  async recordCapBreach(input: RateBreachInput, taskId: string | null = null): Promise<BreachRecord> {
    const decision = decideRateBreach(input);
    const description =
      `rate_limit breach: cap=${input.cap} severity=${input.severity}` +
      (input.irreversibleOrBilled ? ' irreversible/billed' : '') +
      ` → ${decision.outcome}` +
      (decision.autoRetryEligible ? '' : ' (excluded from auto-retry)');
    const { logRowId, logWriteFailed } = await this.write({
      taskId,
      guardrailType: GUARDRAIL_TYPE_RATE_LIMIT,
      description,
      actionBlocked: decision.actionBlocked,
    });
    return { decision, logRowId, logWriteFailed };
  }

  /** Record a cost-ladder rung transition: decide the C6 disposition (AC-6.RTL.004.*) AND write the loud
   *  guardrail_log row (AC-NFR-COST.001.2/002.1/003.2 — every rung transition is logged, never silent). */
  async recordCostRung(signal: CostRungSignal, taskId: string | null = null): Promise<RungRecord> {
    const disposition = decideCostRung(signal);
    const est = signal.estimatedDailyUsd !== undefined ? ` est=$${signal.estimatedDailyUsd}/day` : '';
    const description =
      `cost_ladder rung=${disposition.rung} action=${disposition.action}${est}` +
      (disposition.stopNewConsequentialSpend ? ' stop-new-consequential-spend' : '') +
      (signal.source ? ` (signal from ${signal.source})` : '');
    // A cost rung is logged as a rate_limit-class row (AC-NFR-COST.003.2 wording) — the cost ladder is a
    // sibling guardrail class to the rate-limit ladder. action_blocked reflects whether new spend is stopped.
    const { logRowId, logWriteFailed } = await this.write({
      taskId,
      guardrailType: GUARDRAIL_TYPE_RATE_LIMIT,
      description,
      actionBlocked: disposition.action === 'hard_kill',
    });
    return { disposition, logRowId, logWriteFailed };
  }

  private async write(row: GuardrailLogRowDraft): Promise<{ logRowId: string | null; logWriteFailed: boolean }> {
    try {
      const logRowId = await this.sink.writeRateLimitRow(row);
      return { logRowId, logWriteFailed: false };
    } catch (e) {
      // Never swallowed: the failure is surfaced on the record so the caller (C5) sees a loud "we could not
      // log this decision" signal (#3). The safety decision itself still stands and is returned to the caller.
      console.error(`✗ rate-cost-ladder: guardrail_log write FAILED — ${(e as Error).message}. Decision stands; surfacing logWriteFailed (#3).`);
      return { logRowId: null, logWriteFailed: true };
    }
  }
}
