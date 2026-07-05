// ISSUE-074 §8 step 2 — the token→$ estimate-grade estimator (FR-7.COST.001 → NFR-COST.005). Pure functions
// over event_log cost rows + a live price_table. Three binding conditions from ADR-003 §3:
//   1. price_table is a LIVE config key — passed in per call, so an edit re-bases the NEXT estimate with no
//      deploy (AC-7.COST.001.1 / AC-NFR-COST.005.2). Nothing here hardcodes a price.
//   2. ALL vendors counted — Sonnet + Haiku + OpenAI text-embedding-3-small. The estimator prices any model
//      present in the table; it does not special-case a vendor.
//   3. FAIL-SAFE round-up — the per-event figure rounds UP, and when a model has both input/output rates the
//      estimator applies the HIGHER rate to the single cost_tokens count (event_log does not split the two).
//      An estimator guarding a kill switch must OVERCOUNT so the ceiling fires early, not late.
// The cost_unknown sentinel is NEVER a silent 0: an event with cost_unknown=true, or a positive cost with no
// resolvable price, contributes to `unknownCount`, and the caller learns the meter is partially blind (#3).

import type { EventLogCostRow, PriceTable, ModelPrice } from './types.ts';

/** The fail-safe per-1k-token rate for a model: the HIGHER of input/output (round-up bias, ADR-003 §3 pt3). */
export function failSafeRatePer1k(price: ModelPrice): number {
  const out = price.output ?? price.input;
  return Math.max(price.input, out);
}

export interface EstimateResult {
  /** Total estimate in whole cents (integer) — rounded UP per event, never down. Cents keep it exact and
   *  avoid float drift; callers divide by 100 for USD. */
  cents: number;
  /** Count of events whose cost could NOT be computed (sentinel OR unpriceable). Never folded into 0 (#3). */
  unknownCount: number;
  /** Count of events that were priced (a positive, resolvable cost). */
  pricedCount: number;
}

/** True iff the event cannot be priced: the DDL sentinel (cost_unknown) OR a null token count. */
export function isSentinel(row: EventLogCostRow): boolean {
  return row.cost_unknown === true || row.cost_tokens === null;
}

/** The estimate-grade cost of ONE event, in whole cents, rounded UP. Returns null when the event cannot be
 *  priced (sentinel, or a positive cost with no model / no price_table entry) — the caller must treat null as
 *  cost_unknown, NEVER as $0 (AC-7.LOG.004.1 rests under this). A genuinely free event (cost_tokens=0,
 *  cost_unknown=false) prices to 0 cents — that is a KNOWN zero, distinct from the unknown-null. */
export function estimateEventCents(row: EventLogCostRow, priceTable: PriceTable): number | null {
  if (isSentinel(row)) return null; // the sentinel is never a silent 0
  const tokens = row.cost_tokens as number; // non-null here (isSentinel guards null)
  if (tokens < 0 || !Number.isFinite(tokens)) return null; // a nonsense count is unknown, not free
  if (tokens === 0) return 0; // a genuine, KNOWN zero (e.g. a code-only event) — distinct from unknown
  const model = row.model ?? null;
  if (model === null) return null; // a positive cost with no model tag is a BLIND cost → unknown, not free
  const price = priceTable[model];
  if (price === undefined) return null; // priced against a table that lacks the model → unknown, not free
  const rate = failSafeRatePer1k(price); // $/1k tokens, fail-safe higher-of-input/output
  const usd = (tokens / 1000) * rate;
  // Round UP to the whole cent (fail-safe — never optimistic). 0.5 cents ⇒ 1 cent.
  return Math.ceil(usd * 100);
}

/** Estimate total spend over a set of events. All-vendor, round-up, sentinel-aware. */
export function estimate(rows: readonly EventLogCostRow[], priceTable: PriceTable): EstimateResult {
  let cents = 0;
  let unknownCount = 0;
  let pricedCount = 0;
  for (const row of rows) {
    const c = estimateEventCents(row, priceTable);
    if (c === null) {
      unknownCount += 1; // blind/dark meter reading — surfaced, never swallowed
    } else {
      cents += c;
      if (c > 0) pricedCount += 1;
    }
  }
  return { cents, unknownCount, pricedCount };
}

/** Convenience: USD (dollars) from a cents figure. */
export function centsToUsd(cents: number): number {
  return cents / 100;
}
