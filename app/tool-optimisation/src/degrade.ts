// ISSUE-036 §8 step 4 — FR-3.OPT.004: graceful degradation (the #3 guarantee at the tool grain).
//
// When a required tool is UNAVAILABLE, the runtime must:
//   1. LOG the gap (event_log tool_unavailable — never silent, #3 / ADR-007 containment-first);
//   2. COMPLETE the doable part with the available tools (FR-3.OPT.004 happy path);
//   3. attach a STRUCTURED, MANDATORY-TO-READ gap field to the result (AC-3.OPT.004.2) so a downstream
//      consumer cannot present the partial result AS complete;
//   4. for a FULLY BLOCKING dependency, raise a RECOVERABLE PAUSE (handed to DSC / ISSUE-038,
//      FR-3.DSC.003) rather than hard-failing (FR-3.OPT.004 Branch).
//
// ADR-007 (containment-first): degradation must NEVER mask a gap. A silent partial-as-complete is
// forbidden — the whole point of the mandatory gap field. The result's completeness is DERIVED from the
// gaps (isComplete below), never asserted independently, so a partial can never claim to be whole.

import type { DegradableResult, GapReason, OptEvent, OptEventSink, ResultGap } from './store.js';

/** A degradation the runtime raises when a tool it needs is unavailable. */
export interface Degradation {
  missing_tool: string;
  reason: GapReason;
  /** The sub-task(s) that could not be done without the tool. */
  skipped: string[];
  /** True when this dependency is FULLY BLOCKING — the task cannot proceed at all without it. */
  blocking: boolean;
}

/**
 * Apply a set of degradations to a doable-part output. Produces the DegradableResult with the mandatory
 * structured gap field, and emits a tool_unavailable event per missing tool (logged, never silent).
 *
 * If ANY degradation is fully blocking, the result is marked `paused` (recoverable — handed to DSC), NOT
 * hard-failed: the task pauses and can resume once the connector is reconnected (FR-3.OPT.004 Branch /
 * FR-3.DSC.003). Non-blocking degradations produce a completed-doable-part result carrying its gaps.
 */
export async function degrade<T>(
  output: T,
  degradations: Degradation[],
  sink: OptEventSink,
  taskId: string | null = null,
): Promise<DegradableResult<T>> {
  const gaps: ResultGap[] = [];
  let paused = false;

  for (const d of degradations) {
    // Every missing tool is LOGGED (#3 — never silent). The event carries the structured detail so C7
    // can surface it and an operator can act (FR-3.OPT.004 Observability).
    const ev: OptEvent = {
      event_type: 'tool_unavailable',
      summary: `Tool '${d.missing_tool}' unavailable (${d.reason}); ${d.blocking ? 'task paused (recoverable)' : 'gap flagged, doable part completed'}`,
      payload: { missing_tool: d.missing_tool, reason: d.reason, skipped: d.skipped, blocking: d.blocking },
      task_id: taskId,
    };
    await sink.append(ev);

    // The structured, mandatory-to-read gap channel. `acknowledged:false` at creation — a consumer must
    // read + acknowledge it before presenting the result (AC-3.OPT.004.2). NOT free-text.
    gaps.push({
      missing_tool: d.missing_tool,
      reason: d.reason,
      skipped: d.skipped,
      acknowledged: false,
    });

    if (d.blocking) paused = true;
  }

  return { output, gaps, paused };
}

/**
 * The #3 guarantee, made mechanical (AC-3.OPT.004.1/.2). A result is COMPLETE only if it has no gaps.
 * A result with any gap is a PARTIAL and can never be treated as complete — this is the derived-not-
 * asserted completeness that forbids a silent partial. A consumer that wants to proceed on a partial
 * must first acknowledge every gap (acknowledgeGap), which is the mandatory-to-read handshake.
 */
export function isComplete(result: DegradableResult<unknown>): boolean {
  return result.gaps.length === 0 && !result.paused;
}

/** Are there any gaps a consumer has NOT yet read/acknowledged? If so, presenting the result as done is
 *  forbidden — the consumer MUST read the gap first (mandatory-to-read). */
export function hasUnacknowledgedGap(result: DegradableResult<unknown>): boolean {
  return result.gaps.some((g) => !g.acknowledged);
}

export class UnreadGapError extends Error {}

/**
 * The consumer-side read of the mandatory gap field (AC-3.OPT.004.2 is asserted by a CONSUMER-side
 * read). A downstream consumer (C2 ingestion / a C5/C6 task graph) calls this to READ a gap and record
 * that it did — flipping `acknowledged`. A consumer that tries to consume the result as complete WITHOUT
 * acknowledging its gaps hits `assertConsumable`, which throws — the partial cannot be presented as
 * whole (#3). C3 guarantees the field is present + structured; this is the hook a compliant consumer
 * uses; a non-compliant consumer is caught by assertConsumable, never silently.
 */
export function acknowledgeGap(gap: ResultGap): ResultGap {
  gap.acknowledged = true;
  return gap;
}

/**
 * Fail-closed consumer guard: a result may only be presented/consumed as a finished answer when it is
 * complete OR every gap has been explicitly acknowledged. Otherwise THROW — never let a partial pass as
 * complete (AC-3.OPT.004.1 "no silent partial").
 */
export function assertConsumable(result: DegradableResult<unknown>): void {
  if (result.paused) {
    throw new UnreadGapError(
      'result is paused on a blocking dependency (recoverable) — it is not a finished answer (FR-3.OPT.004 / DSC)',
    );
  }
  if (hasUnacknowledgedGap(result)) {
    const unread = result.gaps.filter((g) => !g.acknowledged).map((g) => g.missing_tool);
    throw new UnreadGapError(
      `result carries un-acknowledged gap(s) for tool(s) [${unread.join(', ')}] — cannot be presented as complete; a consumer MUST read the gap field first (AC-3.OPT.004.2 / #3)`,
    );
  }
}
