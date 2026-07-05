// ISSUE-059 — Step 1b: the embedding semantic-similarity scan (FR-6.INJ.003). OFF by default (ADR-007 §3).
// When enabled it embeds content, compares to a library of known-injection embeddings, and returns a
// similarity SCORE that FLAGS above injection_semantic_threshold — an ADDITIVE SIGNAL FOR HUMAN REVIEW,
// NEVER AN AUTONOMOUS GATE (AC-6.INJ.003.2). The threshold is a signal knob, not a safety dial.
//
// ⚠️ FEASIBILITY: AF-117 — the real embedding library's coverage/quality is a fast-follow EVAL gate; it is
// NOT launch-blocking precisely because this scan ships OFF (AC-6.INJ.003.1). The pipeline injects a
// SemanticScorer so a deployment can wire the real embedder later; the reference model uses a deterministic
// stand-in so the OFF/ON contract is provable offline without an embedding service.

/**
 * A pluggable scorer: given content, return a similarity-to-known-injection score in [0,1].
 * The pipeline NEVER calls this unless injection_semantic_detection_enabled is true (the OFF-by-default
 * guarantee lives in the pipeline, not here) — so a deployment that leaves the scorer unset is still safe.
 */
export type SemanticScorer = (content: string) => number;

/**
 * A deterministic offline stand-in for the AF-117 embedding library. It is NOT a real classifier — it
 * scores by fraction of "known-injection" marker phrases present, so tests can drive a known score without
 * an embedding service. A real deployment injects an embedding-backed scorer in its place.
 */
const KNOWN_INJECTION_MARKERS: readonly string[] = [
  'ignore', 'previous', 'instructions', 'disregard', 'system prompt',
  'you are now', 'pretend', 'override', 'exfiltrate', 'send all',
];

export function stubSemanticScorer(content: string): number {
  const lc = content.toLowerCase();
  let hits = 0;
  for (const m of KNOWN_INJECTION_MARKERS) if (lc.includes(m)) hits += 1;
  return Math.min(1, hits / 4); // saturates once several markers co-occur; deterministic
}
