// ISSUE-036 §8 step 1 — FR-3.OPT.001: confidence-gated tool selection.
//
// At the runtime's tool-selection step, compare the selection confidence against
// CFG-tool_selection_confidence_threshold: at/above → CALL; below → ASK (a clarification signal, C8),
// never silently pick a possibly-wrong tool (FR-3.OPT.001 Edge: "a wrong external action is worse than
// a question"). A high-risk write DEFAULTS TO ASKING when ambiguous (FR-3.OPT.001 Branch). The
// below-threshold ask is LOGGED to event_log (issue §8 step 5 — never silent, #3).
//
// The confidence SCORE itself is the LLM's match score (an EVAL property, deliberately out of scope for
// tuning — issue §2). The ISSUE-032 selector (selectTool) already models the deterministic gate over a
// token-overlap stand-in; this slice OWNS the CFG knob + the ask-event emission the selector's seam
// left to OPT (connector-runtime/src/selection.ts L7-10: "CFG-… is owned by ISSUE-036").

import type { OptConfig, OptEventSink, ToolRow } from './store.js';

export type GateDecision =
  | { kind: 'call'; tool: ToolRow; confidence: number }
  | { kind: 'ask'; reason: string; confidence: number };

export interface GateInput {
  /** The best-fit candidate the selector proposed (or undefined when nothing matched). */
  candidate: ToolRow | undefined;
  /** The selector's confidence in that candidate, in [0,1] (the LLM match score at runtime). */
  confidence: number;
  /** True when the best candidate is a high-risk write AND selection was ambiguous. */
  highRiskWriteAmbiguous?: boolean;
}

/**
 * The confidence gate (FR-3.OPT.001 / AC-3.OPT.001.1). Pure decision — the caller performs the CALL or
 * raises the ASK; on ASK we emit the below-threshold event so the avoided-wrong-call is never silent.
 *
 * Fail-closed bias: if there is no candidate, or a high-risk write is ambiguous, we ASK even if a raw
 * score sneaks above threshold — asking is the safe default (#2: never do something it shouldn't).
 */
export async function confidenceGate(
  input: GateInput,
  config: OptConfig,
  sink: OptEventSink,
  taskId: string | null = null,
): Promise<GateDecision> {
  const threshold = config.tool_selection_confidence_threshold;
  const { candidate, confidence } = input;

  // No viable candidate → ask (nothing to call). Logged.
  if (!candidate) {
    const reason = 'no candidate tool met the selection bar';
    await emitAsk(sink, reason, confidence, taskId, null);
    return { kind: 'ask', reason, confidence };
  }

  // High-risk write + ambiguous → ask regardless of a borderline score (FR-3.OPT.001 Branch). A wrong
  // WRITE is the worst outcome (#2), so the write path is biased to ask.
  if (input.highRiskWriteAmbiguous) {
    const reason = `high-risk write '${candidate.name}' ambiguous — asking rather than acting`;
    await emitAsk(sink, reason, confidence, taskId, candidate.name);
    return { kind: 'ask', reason, confidence };
  }

  // Below threshold → ask, never call a possibly-wrong tool (FR-3.OPT.001 happy path). Logged (#3).
  if (confidence < threshold) {
    const reason = `confidence ${confidence.toFixed(2)} below threshold ${threshold}`;
    await emitAsk(sink, reason, confidence, taskId, candidate.name);
    return { kind: 'ask', reason, confidence };
  }

  // At/above threshold → call. (No event: a normal call is logged as tool_called by the runtime, not
  // here; OPT only owns the AVOIDED-call signal.)
  return { kind: 'call', tool: candidate, confidence };
}

async function emitAsk(
  sink: OptEventSink,
  reason: string,
  confidence: number,
  taskId: string | null,
  toolName: string | null,
): Promise<void> {
  await sink.append({
    event_type: 'tool_selection_ask',
    summary: `Tool selection asked instead of calling: ${reason}`,
    payload: { reason, confidence, candidate: toolName },
    task_id: taskId,
  });
}
