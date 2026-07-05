// ISSUE-046 §8 step 3 — the compression-discipline editor affordance (FR-4.OPT.003). Word-by-word
// compression is an ENABLED, MAINTAINED discipline, never a save-blocking gate: the editor surfaces a
// word-count + the OD-051 advisory (over the ~500-word Layer-1 band), but a save is NEVER blocked for
// length — compression is a token-cost + reliability lever (ADR-003), not enforcement.
//
// This composes on ISSUE-042's editor.ts (validateSave / wordCount): 042 owns the mandatory change_reason
// hard-block; this slice owns the *compression-discipline* framing of the advisory. No React/DOM — pure
// functions the surface consumes so they stay unit-testable (house discipline).
//
// Rule 0 sources: FR-4.OPT.003 / AC-4.OPT.003.1 (compression is enabled, not mandated by a gate),
// FR-4.CID.002 / OD-051 (Layer-1 length bound is an ADVISORY warning, save permitted above it).

/** The advisory Layer-1 word-count band (design 300–500; ~500 target) — FR-4.CID.002 / OD-051. */
export const LAYER1_WORD_TARGET_MAX = 500;

/** Count words in prompt content (whitespace-delimited runs). */
export function wordCount(content: string): number {
  const trimmed = content.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

/** The compression affordance surfaced on the editor for a pending edit (FR-4.OPT.003). */
export interface CompressionAffordance {
  /** the live word count (the word-by-word compression discipline's primary readout). */
  words: number;
  /** a NON-blocking advisory when over the band (null otherwise) — surfaced, never a gate (OD-051). */
  advisory: string | null;
  /** whether compression is *suggested* (over the band). Purely informational — it never blocks a save. */
  overBand: boolean;
  /** ALWAYS true: the save is permitted regardless of length — compression is discipline, not enforcement. */
  saveAllowedForLength: true;
}

/**
 * The compression-discipline affordance for a pending prompt edit. Returns a word-count + (when a core
 * layer exceeds the advisory band) a non-blocking advisory. `saveAllowedForLength` is ALWAYS true — there
 * is deliberately no length gate anywhere here (AC-4.OPT.003.1). `isCore` gates the band (it is a Layer-1
 * target; a non-core layer never triggers the advisory).
 */
export function compressionAffordance(params: { content: string; isCore: boolean }): CompressionAffordance {
  const words = wordCount(params.content);
  const overBand = params.isCore && words > LAYER1_WORD_TARGET_MAX;
  const advisory = overBand
    ? `Layer 1 is ${words} words (advisory band ≤ ${LAYER1_WORD_TARGET_MAX}). Save permitted; consider compressing word-by-word — compressed, audited prompts are preferred (OD-051 / FR-4.OPT.003).`
    : null;
  return { words, advisory, overBand, saveAllowedForLength: true };
}

/**
 * The single load-bearing OPT.003 assertion, surfaced as a helper so callers (and the AC test) can prove
 * it directly: a prompt edit is NEVER blocked on account of its length, no matter how far over the band.
 * Compression is enabled, not mandated by a gate. Returns true unconditionally with respect to length —
 * the only thing that can block a save is the ISSUE-042 mandatory change_reason (owned there, not here).
 */
export function saveBlockedForLength(_content: string, _isCore: boolean): false {
  // There is no length gate. This function exists so the contract is executable, not merely asserted.
  return false;
}
