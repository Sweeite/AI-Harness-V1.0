// ISSUE-060 §8 steps 5+6 — the single guarded write path every producer slice (HRD/APR/ANM/INJ/RTL) calls,
// plus the generic fail-closed wrapper the ANM/INJ/RTL checks run inside.
//
//   step 5 (FR-6.LOG.003): a block/flag/quarantine writes EXACTLY one guardrail_log row (AC-6.LOG.003.1) into
//           exactly one sink (AC-6.LOG.003.2), and — critically — the safe action HOLDS even if the row write
//           fails: the lost row is escalated out-of-band, the block is never abandoned (AC-6.LOG.003.3, #3).
//   step 6 (FR-6.FMM.001): every guardrail-class event is detected -> recorded -> surfaced (AC-6.FMM.001.1);
//           a guardrail check that ITSELF errors fails closed — it halts + flags + logs the check error,
//           never proceeds unchecked (AC-6.FMM.001.3).

import type { DegradedSink, GuardrailLogStore } from "./store.ts";
import { GuardrailLogWriteFailure } from "./store.ts";
import { isGuardrailType } from "./types.ts";
import type { GuardrailEventInput, GuardrailLogRow, GuardrailType } from "./types.ts";

/** A server-authoritative clock + id source, injectable so tests are deterministic (created_at is stamped by
 *  the server, never a caller-asserted time; AC-7.LOG timestamps posture reused). */
export interface WriterClock {
  now(): Date;
  newId(): string;
}

export class EmptyDescription extends Error {
  constructor(type: string) {
    super(`guardrail_log.description is empty for '${type}' — a plain-English description is required`);
    this.name = "EmptyDescription";
  }
}

export interface GuardrailWriterDeps {
  store: GuardrailLogStore;
  degraded: DegradedSink;
  clock: WriterClock;
}

export interface WriteResult {
  /** Whether the guardrail_log row landed. */
  logged: boolean;
  /** ALWAYS true — the safe action holds regardless of whether the row landed (AC-6.LOG.003.3). Present so a
   *  caller cannot mistake `logged:false` for "guardrail did not fire". */
  actionHeld: true;
  row?: GuardrailLogRow;
  /** Set when the write failed and the lost row was escalated out-of-band (AC-6.LOG.003.3). */
  degraded?: boolean;
  /** True when NO guardrail event fired and therefore nothing was written (a clean permit) — distinct from a
   *  `logged:false` write FAILURE. Lets a caller tell "no row because there was no event" apart from "the row
   *  was lost" (AC-6.LOG.003.1). Absent (undefined) whenever an event actually fired. */
  noEvent?: boolean;
}

/**
 * The write-completeness seam. `record()` builds a schema-faithful guardrail_log row and appends it. On a
 * substrate failure it does NOT re-throw into the caller (which would risk the block being abandoned); instead
 * it takes the out-of-band path (degraded sink) and returns {logged:false, actionHeld:true, degraded:true} —
 * the block/halt the caller already decided on STANDS, the loss is surfaced, nothing is swallowed.
 *
 * Producer slices call `record()` AFTER they have committed to the safe action, so the action is never
 * contingent on the row landing (AC-6.LOG.003.1's "bound together" = block-holds-even-if-row-fails).
 */
export class GuardrailWriter {
  constructor(private readonly deps: GuardrailWriterDeps) {}

  /**
   * Escalate a lost guardrail event out-of-band WITHOUT going through the (possibly-failing) validate+store
   * path of `record()`. Used by the fail-closed wrapper when `record()` ITSELF throws — a malformed
   * describe()/type, or any other pre-store validation error — so the block still holds and the loss is
   * surfaced rather than thrown back into the caller (AC-6.FMM.001.3 / AC-6.LOG.003.3 / #2 / #3).
   */
  escalateOutOfBand(entry: {
    reason: string;
    guardrail_type: string;
    description: string;
    action_blocked: boolean;
  }): void {
    this.deps.degraded.record({
      at: this.deps.clock.now().toISOString(),
      reason: entry.reason,
      guardrail_type: entry.guardrail_type,
      description: entry.description,
      action_blocked: entry.action_blocked,
    });
  }

  async record(input: GuardrailEventInput): Promise<WriteResult> {
    // Validate BEFORE any substrate call — caller errors are surfaced loudly, never coerced.
    if (!isGuardrailType(input.guardrail_type)) {
      // A blank/unknown type is a programming error; fail loud rather than write a malformed row (AC-6.LOG.001.1).
      throw new Error(`invalid guardrail_type '${input.guardrail_type}' (AC-6.LOG.001.1)`);
    }
    const description = (input.description ?? "").trim();
    if (description.length === 0) throw new EmptyDescription(input.guardrail_type);

    const row: GuardrailLogRow = {
      id: this.deps.clock.newId(),
      task_id: input.task_id ?? null,
      guardrail_type: input.guardrail_type,
      description,
      action_blocked: input.action_blocked,
      status: "pending", // every event begins unresolved; disambiguated by type (AC-6.LOG.001.3)
      reviewed_by: null,
      reviewed_at: null,
      escalated_at: null,
      created_at: this.deps.clock.now().toISOString(), // server-authoritative
    };

    try {
      await this.deps.store.append(row);
      return { logged: true, actionHeld: true, row };
    } catch (err) {
      // AC-6.LOG.003.3 / NFR-OBS.016 — the write failed. The safe action the caller already took HOLDS. We do
      // NOT rethrow (that could unwind the caller into proceeding). Record the lost row out-of-band (a path
      // that does NOT touch the DB that just failed) and escalate it. #2: no dangerous proceed. #3: no silent loss.
      const reason =
        err instanceof GuardrailLogWriteFailure ? err.message : `unexpected: ${(err as Error).message}`;
      this.deps.degraded.record({
        at: this.deps.clock.now().toISOString(),
        reason,
        guardrail_type: row.guardrail_type,
        description: row.description,
        action_blocked: row.action_blocked,
      });
      return { logged: false, actionHeld: true, degraded: true };
    }
  }
}

// ── The fail-closed guardrail-check wrapper (FR-6.FMM.001 / AC-6.FMM.001.3) ───────────────────────────

/** A guardrail check decides `blocked` (true = the action is denied). ANM/INJ/RTL implement this. It MAY throw
 *  (model timeout, regex/embedding engine error) — the wrapper turns any throw into a fail-CLOSED outcome. */
export type GuardrailCheck<T> = (subject: T) => Promise<boolean> | boolean;

export interface CheckOutcome {
  /** The action is denied. On a check that ERRORS this is FORCED to true (fail closed) — never left to a
   *  default-allow (AC-6.FMM.001.3). */
  blocked: boolean;
  /** True when the check itself errored and we defaulted to blocked (as opposed to a clean block decision). */
  checkErrored: boolean;
  /** True when recording the guardrail event ITSELF threw (a malformed describe()/type, or a store failure that
   *  surfaced as a throw) and the wrapper took the out-of-band escalation path instead of letting the throw
   *  unwind the caller into proceeding. `blocked` is still true (AC-6.FMM.001.3 / #2 / #3). */
  recordEscalated: boolean;
  /** The guardrail_log write result — a check that errors is ALSO recorded + surfaced (detected->recorded->
   *  surfaced, AC-6.FMM.001.1), never swallowed. */
  write: WriteResult;
}

/**
 * Run a guardrail check fail-CLOSED. If the check throws (it "cannot decide"), the step is halted (blocked=true)
 * AND the check error is written to guardrail_log + surfaced — a guardrail evaluation error NEVER lets the step
 * proceed unchecked (AC-6.FMM.001.3). A clean `blocked=true` decision is also recorded (AC-6.FMM.001.1). A clean
 * `blocked=false` (the check ran and permitted the action) writes no row — there is no guardrail event to log.
 */
export async function runGuardrailCheck<T>(
  writer: GuardrailWriter,
  guardrailType: GuardrailType,
  subject: T,
  check: GuardrailCheck<T>,
  describe: (r: { blocked: boolean; errored: boolean; error?: unknown }) => string,
  taskId?: string | null,
): Promise<CheckOutcome> {
  let blocked: boolean;
  let checkErrored = false;
  let error: unknown;
  try {
    blocked = await check(subject);
  } catch (e) {
    // The check cannot decide -> FAIL CLOSED. Halt (blocked) and record the error itself as a guardrail event.
    blocked = true;
    checkErrored = true;
    error = e;
  }

  if (!blocked) {
    // The check ran and permitted the action — no guardrail event fired, nothing to record. `noEvent:true`
    // (NOT logged:true) so the caller can tell "no row because nothing fired" from "a row landed" (AC-6.LOG.003.1).
    return {
      blocked: false,
      checkErrored: false,
      recordEscalated: false,
      write: { logged: false, actionHeld: true, noEvent: true },
    };
  }

  // A block (clean or fail-closed) is a guardrail-class event: detected -> recorded -> surfaced.
  //
  // CRITICAL (AC-6.FMM.001.3 / #2 / #3): record() VALIDATES before its own try/catch, so a malformed
  // describe() (EmptyDescription) or an out-of-set guardrail_type throws UNCAUGHT out of record(). If we let
  // that throw escape the wrapper, a non-defensive caller (try/catch-and-proceed) would proceed UNCHECKED —
  // the exact hole the AC forbids. So we catch ANY throw from record() here and STILL return blocked:true,
  // escalating the lost event out-of-band. The wrapper NEVER throws the caller into proceeding.
  const description = describe({ blocked, errored: checkErrored, error });
  try {
    const write = await writer.record({
      task_id: taskId ?? null,
      guardrail_type: guardrailType,
      description,
      action_blocked: true,
    });
    return { blocked: true, checkErrored, recordEscalated: false, write };
  } catch (recErr) {
    // record() threw before/while persisting (invalid type, empty description, or an unexpected store throw).
    // The block STILL holds. Surface the lost event out-of-band — a path that does not re-enter record().
    const reason = `guardrail event record() threw (fail-closed held): ${(recErr as Error).message}`;
    writer.escalateOutOfBand({
      reason,
      guardrail_type: guardrailType,
      // description may be the offender (empty); fall back to the reason so the sink entry is never itself blank.
      description: description.trim().length > 0 ? description : reason,
      action_blocked: true,
    });
    return {
      blocked: true,
      checkErrored,
      recordEscalated: true,
      write: { logged: false, actionHeld: true, degraded: true },
    };
  }
}
