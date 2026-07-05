// ISSUE-032 — FR-3.REG.002: the plain-English DESCRIPTION drives tool selection, and description
// quality is a TESTABLE registry property. The live selector is the LLM (an EVAL property, named in
// the FR's feasibility note); here we model the deterministic contract the registry must satisfy:
//   * only ENABLED tools are candidates (a disabled/superseded tool is never offered — AC-3.REG.001.2);
//   * a clearly-described tool matching a task is picked (AC-3.REG.002.1);
//   * when two descriptions are ambiguous and the best-fit confidence is below the configured
//     threshold, the selector ASKS instead of calling (AC-3.REG.002.2 / FR-3.OPT.001 seam).
// The score is a simple, order-independent token-overlap — a stand-in for the LLM's match score whose
// ONLY job here is to exercise the "below threshold → ask" gate deterministically. It is NOT the
// production selector; CFG-tool_selection_confidence_threshold is owned by ISSUE-036.

import type { ToolRow } from './store.js';

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2),
  );
}

/** Jaccard-ish overlap of task tokens against a tool's description tokens, in [0,1]. */
export function descriptionScore(taskDescription: string, tool: ToolRow): number {
  const task = tokens(taskDescription);
  const desc = tokens(tool.description);
  if (task.size === 0 || desc.size === 0) return 0;
  let inter = 0;
  for (const t of task) if (desc.has(t)) inter += 1;
  return inter / task.size; // fraction of the task's need covered by this description
}

export type SelectionResult =
  | { kind: 'selected'; tool: ToolRow; score: number }
  | { kind: 'ask'; reason: string; topScore: number };

/**
 * Select the best-fit ENABLED tool for a task by description (FR-3.REG.002). Returns `ask` when the
 * best score is below `confidenceThreshold` OR when the top two are within `ambiguityMargin` of each
 * other (two ambiguous descriptions → ask, don't guess — AC-3.REG.002.2).
 */
export function selectTool(
  taskDescription: string,
  candidates: ToolRow[],
  confidenceThreshold: number,
  ambiguityMargin = 0.15,
): SelectionResult {
  const enabled = candidates.filter((t) => t.enabled); // disabled tools are never offered
  const scored = enabled
    .map((tool) => ({ tool, score: descriptionScore(taskDescription, tool) }))
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return { kind: 'ask', reason: 'no enabled candidate tools', topScore: 0 };

  const best = scored[0]!;
  if (best.score < confidenceThreshold) {
    return { kind: 'ask', reason: `best match ${best.score.toFixed(2)} below threshold ${confidenceThreshold}`, topScore: best.score };
  }
  const second = scored[1];
  if (second && best.score - second.score < ambiguityMargin) {
    return {
      kind: 'ask',
      reason: `ambiguous: top two within ${ambiguityMargin} (${best.tool.name} ${best.score.toFixed(2)} vs ${second.tool.name} ${second.score.toFixed(2)})`,
      topScore: best.score,
    };
  }
  return { kind: 'selected', tool: best.tool, score: best.score };
}
