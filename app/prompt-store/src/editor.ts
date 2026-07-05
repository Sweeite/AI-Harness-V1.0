// ISSUE-042 §8 step 9 — editor-side helpers for the prompt-layer editor (content + version + mandatory
// change_reason + word-count advisory) and the version-history + rollback view. These are the
// content-AGNOSTIC editor validations this slice owns; the principles-editor and the dynamic-Layer-2
// value editor are OUT (ISSUE-043/044). No React/DOM here — pure functions the surface consumes so they
// stay unit-testable (the house discipline: the UI is a thin shell over tested logic).
//
// Rule 0 sources: FR-4.STO.003 (mandatory change_reason — rejected empty at save), FR-4.CID.002 / OD-051
// (Layer-1 length bound is an ADVISORY warning, save permitted above it), FR-4.OPT.003 (the word-count
// supports the compression discipline — enabled, not gated).

/** The advisory Layer-1 word-count band (design 300–500; ~500 target) — FR-4.CID.002 / OD-051. */
export const LAYER1_WORD_TARGET_MAX = 500;

/** Count words in prompt content (whitespace-delimited runs). */
export function wordCount(content: string): number {
  const trimmed = content.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

export interface SaveValidation {
  /** Whether the save may proceed. Only a missing/empty change_reason blocks (FR-4.STO.003). */
  canSave: boolean;
  /** A blocking reason (empty change_reason) — canSave=false when set. */
  blockingError: string | null;
  /** A NON-blocking advisory (over the ~500-word band) — surfaced but never blocks (OD-051). */
  advisory: string | null;
  words: number;
}

/**
 * Validate a pending prompt-layer save. The ONLY hard block is a missing/empty change_reason
 * (FR-4.STO.003 / AC-4.STO.003.2). Exceeding the Layer-1 word band produces a NON-blocking advisory only
 * (OD-051 / AC-4.CID.002.1) — the save still succeeds. `isCore` gates whether the word advisory applies
 * (the band is a Layer-1 target).
 */
export function validateSave(params: { content: string; change_reason: string; isCore: boolean }): SaveValidation {
  const words = wordCount(params.content);
  const reasonEmpty = params.change_reason == null || params.change_reason.trim() === '';
  const advisory =
    params.isCore && words > LAYER1_WORD_TARGET_MAX
      ? `Layer 1 is ${words} words (advisory band ≤ ${LAYER1_WORD_TARGET_MAX}). Save permitted; consider compressing (OD-051 / FR-4.OPT.003).`
      : null;
  return {
    canSave: !reasonEmpty,
    blockingError: reasonEmpty ? 'A change_reason is required to save (FR-4.STO.003 / AC-4.STO.003.2).' : null,
    advisory,
    words,
  };
}

/** A version-history row shaped for the history + rollback view (FR-4.STO.004). */
export interface HistoryEntry {
  version_id: string;
  version: number;
  change_reason: string;
  created_at: string;
  created_by: string | null;
  is_current: boolean;
}

/** Shape a version chain (oldest→newest, as `PromptStore.history` returns) into the history view rows. */
export function toHistoryView(
  chain: { id: string; version: number; change_reason: string; created_at: string; created_by: string | null }[],
): HistoryEntry[] {
  const maxV = chain.reduce((m, r) => Math.max(m, r.version), 0);
  return chain.map((r) => ({
    version_id: r.id,
    version: r.version,
    change_reason: r.change_reason,
    created_at: r.created_at,
    created_by: r.created_by,
    is_current: r.version === maxV,
  }));
}
