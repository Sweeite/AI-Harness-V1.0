// ISSUE-082 §8 step 7 — Step 4: content scrubbing (FR-10.DEL.004 / AC-10.DEL.004.*).
//
// For memories that REMAIN after the C2 delete (multi-entity primaries the walk retained, and content-only matches
// the admin confirmed), replace the target's confirmed personal mentions with `[REDACTED]`, PRESERVING the
// surrounding non-personal context (the memory still relates to other entities). Redaction is a JUDGEMENT CALL — it
// happens only on human confirmation (AC-10.DEL.004.1), never auto on a fuzzy match. Each redaction goes through the
// governed sole-writer path + is logged per memory (AC-10.DEL.004.2). Log-sink redaction (event_log / guardrail_log)
// is NOT done here — it is triggered inside the C2 mechanism (AC-2.MNT.017.4 / OD-074), surfaced as a C2 leg the
// workflow verifies (AC-10.DEL.004.3).
//
// #1 guard: over-redaction that destroys legitimate context is bounded by the human-confirm gate (we only touch rows
// the admin confirmed) + a token-boundary match (we never blunt-replace a substring inside a larger word).

export const REDACTION_TOKEN = '[REDACTED]';

/** Replace whole-token occurrences of each term with [REDACTED], case-insensitively, preserving all other text. Terms
 *  are matched at word boundaries so "Sam" does not redact "Samsung" (#1 over-redaction guard). Returns the redacted
 *  content + how many replacements were made (0 ⇒ the term was not literally present — the caller decides whether
 *  that is expected). */
export function redactContent(content: string, terms: string[]): { redacted: string; replacements: number } {
  let redacted = content;
  let replacements = 0;
  // longest terms first so "John Smith" is redacted as one unit before "John" / "Smith" would fragment it.
  const ordered = [...new Set(terms.filter((t) => t.trim().length >= 2))].sort((a, b) => b.length - a.length);
  for (const term of ordered) {
    const pattern = new RegExp(`(?<![\\w])${escapeRegExp(term)}(?![\\w])`, 'gi');
    redacted = redacted.replace(pattern, () => {
      replacements += 1;
      return REDACTION_TOKEN;
    });
  }
  return { redacted, replacements };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface ScrubOutcome {
  memoryId: string;
  /** whether the target's entity_id was removed from entity_ids[] (deterministic retained rows only). */
  entityIdRemoved: boolean;
  /** whether the content was redacted (only when the admin confirmed the mention). */
  contentRedacted: boolean;
  /** replacements made in the content (0 if not confirmed / not present). */
  replacements: number;
  /** entity_ids after the scrub — an emptied array is a #2 signal the caller escalates (should have been C2-deleted). */
  entityIdsAfter: string[];
}
