// ISSUE-030 (C2 MAT) — FR-2.MAT.003: query-time Retrieval Sufficiency → the [Building] flag.
//
// Computed INLINE per query, NEVER stored (ADR-002 §3). A THIN threshold over signals ALREADY produced by retrieval
// (ISSUE-025's relevance × confidence over surfaced memory) — explicitly NOT a new bespoke scoring engine (ADR-002
// guardrail #1). This slice only READS those signals; it produces the Sufficiency verdict for the FR-2.RET.007
// answer-mode seam. C8 renders the pill — this slice does not render.
//
// The rule (ADR-002 §3/§4, the honest-message split):
//   Sufficient(query) = the slots this query touches on the primary entity are filled AND retrieval surfaced them
//                       above a relevance×confidence bar; if the query maps to NO slot, fall back to pure retrieval
//                       quality (relevance×confidence of top-k). Either way: one rule.
//   A thin (not-sufficient) response is flagged [Building] IFF the primary entity's Maturity < proactive_threshold
//   (50%); otherwise the thin retrieval is a genuine [Unknown] ("as good as it'll get", not "still building").
//   [Building] is per-entity and STANDING — it recurs for any new/thin entity even after the deployment cold-start
//   mode has permanently ended (ADR-002 §4). So this verdict never reads the cold-start latch — only the entity's
//   own Maturity.

import type { MaturityConfig } from './store.ts';

/** One surfaced memory's retrieval signals (0–1 each), produced by ISSUE-025 retrieval. Read-only here. */
export interface RetrievalSignal {
  relevance: number;
  confidence: number;
}

export interface SufficiencyInput {
  /** The memories retrieval surfaced for this query, with their relevance×confidence signals (top-k). */
  surfaced: readonly RetrievalSignal[];
  /**
   * Whether the expected slots THIS query touches on the primary entity are filled:
   *   - true  → the touched slots are filled (slot arm satisfied; sufficiency then rests on the retrieval bar);
   *   - false → a touched slot is empty (the query is about something we have no live memory for → not sufficient);
   *   - undefined → the query maps to NO slot → fall back to pure retrieval quality (ADR-002 §3 fallback).
   */
  touchedSlotsFilled?: boolean;
  /** The primary/touched entity's stored Maturity (entities.maturity, 0–1) — null = never computed → treated as 0. */
  primaryEntityMaturity: number | null;
}

/** The three answer-mode outcomes this signal drives. [Building] is a FLAG on an otherwise-thin/[Unknown] response,
 *  not a fourth pill (ADR-002 §4 / OD-008): 'building' ⇒ render [Unknown] + the [Building] flag; 'unknown' ⇒ plain
 *  [Unknown]; 'sufficient' ⇒ the response is well-supported (Cited/Inferred decided downstream by C8). */
export type SufficiencyVerdict = 'sufficient' | 'building' | 'unknown';

export interface SufficiencyResult {
  /** max(relevance × confidence) over the surfaced memories (0 if none) — the retrieval-quality bar input. */
  score: number;
  /** score met the CFG-retrieval_sufficiency_threshold AND the touched slots are not empty. */
  sufficient: boolean;
  /** the response is thin (not sufficient). */
  thin: boolean;
  /** raise the [Building] flag: thin AND primary Maturity < proactive_threshold. */
  building: boolean;
  verdict: SufficiencyVerdict;
}

/**
 * Compute Retrieval Sufficiency + the [Building]/[Unknown] split for one query (FR-2.MAT.003 / FR-2.RET.007).
 * Pure — offline and live produce the identical verdict. Gated by CFG-retrieval_sufficiency_threshold (thin bar) and
 * the Maturity proactive_threshold (the [Building] vs [Unknown] cut).
 */
export function computeSufficiency(input: SufficiencyInput, cfg: MaturityConfig): SufficiencyResult {
  const score = input.surfaced.reduce((max, s) => Math.max(max, s.relevance * s.confidence), 0);
  // The slot arm: an explicitly-empty touched slot is never sufficient regardless of retrieval score (we have no
  // live memory for what the query asked). true or undefined (no slot mapped → fallback to the bar) both allow it.
  const slotArmOk = input.touchedSlotsFilled !== false;
  const sufficient = slotArmOk && score >= cfg.retrievalSufficiencyThreshold;
  const thin = !sufficient;

  const maturity01 = input.primaryEntityMaturity ?? 0;
  const proactiveFraction = cfg.coldStartProactiveThreshold / 100; // config int 0–100 → 0–1
  // [Building] iff thin AND the entity is still immature (< proactive). On a MATURE entity a thin retrieval is a
  // genuine [Unknown] without [Building] — the coverage is as good as it'll get (ADR-002 §4).
  const building = thin && maturity01 < proactiveFraction;

  const verdict: SufficiencyVerdict = sufficient ? 'sufficient' : building ? 'building' : 'unknown';
  return { score, sufficient, thin, building, verdict };
}
