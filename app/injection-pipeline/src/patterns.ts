// ISSUE-059 — Step 1a: the deterministic regex tripwire library (FR-6.INJ.002, always-on). The literal
// pattern set is taken verbatim from FR-6.INJ.002 (design L2947–2957). It is VERSIONED and TESTABLE
// (AC-6.INJ.002.2): the library carries an explicit version; a pattern change bumps it; the test asserts
// the version + the exact set, so a silent prod change to the list cannot happen (AF-117-tracked).
//
// Detection is a SIGNAL, not the security boundary (ADR-007 §1). A high-confidence literal match MAY
// quarantine on the regex layer alone (OD-066) even with the semantic scan off — flagged below via
// `highConfidence`. "High-confidence" here = the unambiguous instruction-override / role-injection /
// fake-control-token literals that a benign business message effectively never contains.

export interface InjectionPattern {
  /** stable id (used in the guardrail_log matched-pattern field + tests). */
  id: string;
  /** the compiled matcher (case-insensitive; anchored where the spec says "at start"). */
  re: RegExp;
  /** OD-066: a high-confidence literal can quarantine on the regex layer ALONE (semantic off). */
  highConfidence: boolean;
  /** human-readable source literal (for the log + review surface). */
  literal: string;
}

/** Bump this on ANY change to PATTERNS — the test pins it, so a silent list edit fails CI (AC-6.INJ.002.2). */
export const PATTERN_LIBRARY_VERSION = '1.0.0';

// The literal set from FR-6.INJ.002. `\b`/anchors chosen to match the intent while missing benign
// lookalikes (AC-6.INJ.002.1). Patterns that name a control token or an instruction-override are
// high-confidence; a bare role label (`you are now`) is high-confidence too (classic role-injection).
export const PATTERNS: readonly InjectionPattern[] = Object.freeze([
  { id: 'ignore-previous-instructions', literal: 'ignore previous instructions', highConfidence: true, re: /\bignore\s+previous\s+instructions\b/i },
  { id: 'ignore-all-previous', literal: 'ignore all previous', highConfidence: true, re: /\bignore\s+all\s+previous\b/i },
  { id: 'disregard-your', literal: 'disregard your', highConfidence: true, re: /\bdisregard\s+your\b/i },
  { id: 'you-are-now', literal: 'you are now', highConfidence: true, re: /\byou\s+are\s+now\b/i },
  { id: 'new-system-prompt', literal: 'new system prompt', highConfidence: true, re: /\bnew\s+system\s+prompt\b/i },
  { id: 'as-an-ai-you-must', literal: 'as an AI you must', highConfidence: true, re: /\bas\s+an\s+ai\s+you\s+must\b/i },
  { id: 'system-tag', literal: '[SYSTEM]', highConfidence: true, re: /\[SYSTEM\]/i },
  { id: 'inst-tag', literal: '[INST]', highConfidence: true, re: /\[INST\]/i },
  // "Assistant:" / "Human:" only at the START of the content (fake-turn injection) — L2947–2957.
  { id: 'assistant-turn-start', literal: 'Assistant: (at start)', highConfidence: true, re: /^\s*Assistant:/i },
  { id: 'human-turn-start', literal: 'Human: (at start)', highConfidence: true, re: /^\s*Human:/i },
]);

export interface RegexMatch {
  patternId: string;
  literal: string;
  highConfidence: boolean;
}

/** Scan content against the always-on literal library. Returns every distinct pattern that matched. */
export function regexScan(content: string): RegexMatch[] {
  const out: RegexMatch[] = [];
  for (const p of PATTERNS) {
    if (p.re.test(content)) {
      out.push({ patternId: p.id, literal: p.literal, highConfidence: p.highConfidence });
    }
  }
  return out;
}
