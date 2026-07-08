// ISSUE-079 — FR-4.CID.006 / AC-7.VIEW.002.2 the answer-mode pill, on every AI-output item in Activity + Chat.
//
// The pill's stored values are the live `answer_mode` enum (0001 baseline: cited/inferred/unknown/building).
// The #3 rule: an UNRESOLVED pill (the mode was never computed / is null) reads "mode unknown" — NEVER a silent
// "Cited". A guessed-optimistic pill is the exact false-confidence this forbids. Note the two distinct cases:
//   • answer_mode = 'unknown'  → the system DETERMINED the mode is unknown        → "Unknown"
//   • answer_mode = null/absent → the pill was never resolved (a gap)             → "mode unknown"

/** The live answer_mode enum values (0001 baseline) — kept in lockstep by index.ts `check`. */
export const ANSWER_MODE_VALUES = ["cited", "inferred", "unknown", "building"] as const;
export type AnswerMode = (typeof ANSWER_MODE_VALUES)[number];

export const PILL_UNRESOLVED = "mode unknown";

const LABELS: Record<AnswerMode, string> = {
  cited: "Cited",
  inferred: "Inferred",
  unknown: "Unknown",
  building: "Building",
};

/**
 * Resolve the pill label for an AI-output row. null/undefined/unrecognised → "mode unknown" (#3), never a
 * silent "Cited". Returns { resolved:false } for the unresolved case so callers can style it distinctly and so
 * a test can prove the fallback never masquerades as a real mode.
 */
export function resolvePill(mode: string | null | undefined): { label: string; resolved: boolean } {
  if (mode != null && (ANSWER_MODE_VALUES as readonly string[]).includes(mode)) {
    return { label: LABELS[mode as AnswerMode], resolved: true };
  }
  return { label: PILL_UNRESOLVED, resolved: false };
}
