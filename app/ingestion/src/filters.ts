// ISSUE-026 (C2 ING) — the two ingestion filters, as DETERMINISTIC reference classifiers behind injectable ports.
//
// Reconciliation #1 (component-02-memory.md L60): these are NOT new models — Filter 1 = ADR-003's single
// self-funding selective-writing Haiku gate, Filter 2 = the Haiku sensitivity-classify. LIVE wiring injects the
// Haiku-backed classifiers; the DEFAULT implementations here are the deterministic reference the offline suite
// tests against (house pattern — the fake is BOTH the test double AND the contract the live path must agree with).
//
// The order is fixed (FR-2.ING.010 standard write flow): Filter 1 (relevance) → Filter 2 (sensitivity) →
// queue-or-writer. Filter 1 discards immediately so a dropped item NEVER reaches Filter 2 or the writer (and never
// costs a Sonnet call — the gate's whole purpose, AC-2.ING.001.1).

import type { SensitivityTier } from '../../memory/src/entity-types.ts';

/** A candidate event entering ingestion (a task result, a message, a document chunk, an extracted record). */
export interface CandidateEvent {
  content: string;
  /** Possible entity links (entity ids or external refs). EMPTY = no possible entity link → Filter 1 drops it: there
   *  is no entity-less memory (FR-2.ING.001, design L1583). */
  entityRefs: string[];
  /** Pointer to the system-of-record (golden rule) — carried through to the writer as source_ref, never a copy. */
  sourceRef: string | null;
  /** The resolved target entity this event pertains to (queue row target_entity_id / the writer's context entity). */
  targetEntityId?: string | null;
  /** The source explicitly marked the content confidential (e.g. a doc labelled "Confidential") — always flags. */
  sourceMarkedConfidential?: boolean;
}

// ── Filter 1 (relevance) ──────────────────────────────────────────────────────────────────────────────────────
export type RelevanceVerdict = { decision: 'save'; reason: string } | { decision: 'drop'; reason: string };

/** The relevance gate port (ADR-003 selective-writing). LIVE = the Haiku call; the default is deterministic. */
export interface RelevanceClassifier {
  classify(event: CandidateEvent): RelevanceVerdict;
}

/** Casual banter / filler / auto-reply / system-notification patterns the design says to discard (L1569–1583). */
const BANTER = /\b(lol|haha+|thanks!?|thank you|no problem|you'?re welcome|good morning|good night|see you|brb|ok|okay|got it|sounds good|cool|nice|great|awesome|cheers)\b/i;
const AUTO_REPLY = /\b(out of office|automatic reply|do not reply|unsubscribe|delivery status notification|this is an automated)\b/i;

/** Deterministic reference relevance gate. DROP when there is no possible entity link (no entity-less memory), or the
 *  content is pure banter / an auto-reply / a system notification with no save-worthy signal. SAVE otherwise. */
export class DefaultRelevanceClassifier implements RelevanceClassifier {
  classify(event: CandidateEvent): RelevanceVerdict {
    const content = event.content.trim();
    if (content.length === 0) return { decision: 'drop', reason: 'empty content' };
    // No possible entity link → never written (design L1583). This is the crisp, load-bearing rule.
    if (event.entityRefs.length === 0 && (event.targetEntityId ?? null) === null) {
      return { decision: 'drop', reason: 'no possible entity link' };
    }
    if (AUTO_REPLY.test(content)) return { decision: 'drop', reason: 'auto-reply / system notification' };
    // Short, purely-social content with no other signal is banter.
    if (BANTER.test(content) && content.length < 40 && !/[.?!].+[.?!]/.test(content)) {
      return { decision: 'drop', reason: 'casual banter / filler' };
    }
    return { decision: 'save', reason: 'save-worthy (has an entity link and substantive content)' };
  }
}

// ── Filter 2 (sensitivity) ──────────────────────────────────────────────────────────────────────────────────────
/** Why an item was flagged. 'hr' is distinguished so the FR-2.ING.005 HR default-Exclude gate can apply. */
export type FlagReason = 'financial' | 'personal' | 'legal' | 'hr' | 'founder_private' | 'source_confidential';

export type SensitivityVerdict =
  | { verdict: 'clean'; tier: SensitivityTier } // proceeds to the writer with an auto-assigned tier
  | { verdict: 'flag'; flagReason: FlagReason; suggestedTier: SensitivityTier }; // HELD in the queue, never auto-written

/** The sensitivity gate port (ADR-003 sensitivity-classify). LIVE = the Haiku call; the default is deterministic. */
export interface SensitivityClassifier {
  classify(event: CandidateEvent): SensitivityVerdict;
}

// Category lexicons (the deterministic reference of the Haiku classify). Order matters: HR is checked before the
// generic financial/personal signals so a compensation/termination item flags as 'hr' (its own default-Exclude gate).
const HR = /\b(performance review|termination|fired|laid off|disciplinary|hr complaint|grievance|compensation|salary review|promotion decision|hiring decision|onboarding paperwork|misconduct)\b/i;
const FINANCIAL = /(\$\s?\d|\b(revenue|profit|margin|invoice|budget|payroll|bank account|wire transfer|financials?|pricing|cost of goods|p&l)\b)/i;
const PERSONAL = /\b(ssn|social security|home address|personal (phone|email|cell)|date of birth|medical|health condition|diagnosis|passport|driver'?s license)\b/i;
const LEGAL = /\b(lawsuit|litigation|nda|non-disclosure|legal dispute|settlement|regulatory|subpoena|breach of contract|liability)\b/i;
const FOUNDER_PRIVATE = /\b(founder'?s? private|strictly confidential|do not share|internal only|board confidential)\b/i;

/** Deterministic reference sensitivity gate. Clean standard content → 'clean' with tier 'standard'. Content matching a
 *  sensitive category → 'flag' with a reason + a suggested tier (held in the queue, never auto-written — AC-2.ING.002.1).
 *  A false-negative is mitigated downstream by the writer's own tier assignment + the monthly clearance review; a
 *  FLAGGED item must never auto-store (FR-2.ING.004). */
export class DefaultSensitivityClassifier implements SensitivityClassifier {
  classify(event: CandidateEvent): SensitivityVerdict {
    const c = event.content;
    if (event.sourceMarkedConfidential) return { verdict: 'flag', flagReason: 'source_confidential', suggestedTier: 'confidential' };
    if (HR.test(c)) return { verdict: 'flag', flagReason: 'hr', suggestedTier: 'personal' };
    if (PERSONAL.test(c)) return { verdict: 'flag', flagReason: 'personal', suggestedTier: 'personal' };
    if (LEGAL.test(c)) return { verdict: 'flag', flagReason: 'legal', suggestedTier: 'confidential' };
    if (FINANCIAL.test(c)) return { verdict: 'flag', flagReason: 'financial', suggestedTier: 'confidential' };
    if (FOUNDER_PRIVATE.test(c)) return { verdict: 'flag', flagReason: 'founder_private', suggestedTier: 'confidential' };
    return { verdict: 'clean', tier: 'standard' };
  }
}

// ── The two-filter front (the ordered gate) ─────────────────────────────────────────────────────────────────────
export type FilterOutcome =
  | { kind: 'dropped'; reason: string } // Filter 1 discarded it (or shadow-retained — see queue.ts trust window)
  | { kind: 'clean'; tier: SensitivityTier } // passed both filters → route straight to the writer
  | { kind: 'flagged'; flagReason: FlagReason; suggestedTier: SensitivityTier }; // held in the queue for a human

export interface Filters {
  relevance: RelevanceClassifier;
  sensitivity: SensitivityClassifier;
}

/** Optional call-count meter — the COMPOSED-pipeline Haiku ceiling (writer.ts ModelCallMeter, AC-NFR-COST.008.1).
 *  Each filter that runs is one Haiku pre-check; the writer's ≤3-Haiku arm is enforced when composed. */
export interface FilterMeter {
  countHaiku(): void;
}

/** Run the two filters in the fixed order. A Filter-1 drop short-circuits — Filter 2 (and the writer) never see it,
 *  so a dropped item costs no Sonnet call (AC-2.ING.001.1). Returns the routing outcome the caller acts on. */
export function runFilters(event: CandidateEvent, filters: Filters, meter?: FilterMeter): FilterOutcome {
  meter?.countHaiku();
  const rel = filters.relevance.classify(event);
  if (rel.decision === 'drop') return { kind: 'dropped', reason: rel.reason };
  meter?.countHaiku();
  const sen = filters.sensitivity.classify(event);
  if (sen.verdict === 'flag') return { kind: 'flagged', flagReason: sen.flagReason, suggestedTier: sen.suggestedTier };
  return { kind: 'clean', tier: sen.tier };
}

/** The default deterministic filter pair (used by the fake + tests; LIVE injects Haiku-backed classifiers). */
export function defaultFilters(): Filters {
  return { relevance: new DefaultRelevanceClassifier(), sensitivity: new DefaultSensitivityClassifier() };
}
