// ISSUE-087 §2 — the answer-mode pill primitive (NFR-OBS.012 seam).
//
// This substrate ships the SEAM (the typed primitive + honest defaults); the per-surface wiring of a
// concrete answer's mode is each surface's render job. The pill tells a human, at a glance, how much to
// trust an AI-produced answer — and, per the three non-negotiables (#3), an UNSTATED mode is never shown
// as if it were grounded: an unknown mode falls back to the most cautious label, never to "grounded".

export type AnswerMode = 'grounded' | 'assumed' | 'uncertain' | 'unavailable';

export interface AnswerModeDescriptor {
  mode: AnswerMode;
  /** Human label rendered in the pill (never colour-only — the text carries the meaning). */
  label: string;
  /** Longer explanation for a tooltip / aria-label. */
  detail: string;
  /** The semantic status tone the pill borrows (defined in tokens.css; paired with text, never colour-only). */
  tone: 'ok' | 'info' | 'stale' | 'unknown';
}

const DESCRIPTORS: Record<AnswerMode, AnswerModeDescriptor> = {
  grounded: {
    mode: 'grounded',
    label: 'Grounded',
    detail: 'Answered from stored knowledge / verified sources.',
    tone: 'ok',
  },
  assumed: {
    mode: 'assumed',
    label: 'Assumed',
    detail: 'Includes reasonable assumptions not directly grounded in stored knowledge.',
    tone: 'info',
  },
  uncertain: {
    mode: 'uncertain',
    label: 'Uncertain',
    detail: 'Low confidence — treat as a starting point, not a settled answer.',
    tone: 'stale',
  },
  unavailable: {
    mode: 'unavailable',
    label: 'Mode unavailable',
    detail: "The answer's grounding mode could not be determined — do not assume it is grounded.",
    tone: 'unknown',
  },
};

/**
 * Resolve a pill descriptor. An unrecognised/absent mode resolves to `unavailable` (the cautious floor),
 * NEVER silently to `grounded` — an unstated mode must not read as trustworthy (#3).
 */
export function answerModeDescriptor(mode: AnswerMode | null | undefined): AnswerModeDescriptor {
  if (mode && mode in DESCRIPTORS) return DESCRIPTORS[mode];
  return DESCRIPTORS.unavailable;
}
