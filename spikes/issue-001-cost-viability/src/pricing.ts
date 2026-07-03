/**
 * price_table + the fail-safe round-up estimator.
 *
 * Source of truth for the RATES: spec/02-config/config-registry.md App. A item 10
 * (price_table, class LIVE — vendor×model → {input,output} $/1k tokens; embedding $/unit).
 * Cost DERIVATION basis: spec/04-data-model/schema.md §8 — there is NO separate cost table;
 * cost = event_log.cost_tokens × config_values['price_table']. This module is the runnable
 * expression of that formula for the spike.
 *
 * Estimator posture: spec/00-foundations/adr/ADR-003-cost-model.md §3 — the estimate rounds
 * UP: every attempt (incl. retries) is charged, standard (non-batch) rates only, no optimistic
 * prompt-cache or batch discount. The ceiling must fire early, not late (non-negotiable #3:
 * never fail silently — a costless-looking under-estimate is a silent failure).
 */

/** $/1k tokens. Embeddings bill input only (output is 0). */
export interface ModelRate {
  input: number;
  output: number;
}

export type PriceTable = Record<string, Record<string, ModelRate>>;

/**
 * price_table defaults, verbatim from config-registry.md App. A item 10.
 * - anthropic sonnet 0.003/0.015, haiku 0.0008/0.004 ($/1k tokens).
 * - openai text-embedding-3-small: registry carries the SHAPE only, not the number.
 *   Filled from OpenAI primary-source pricing: $0.02 / 1M tokens = 0.00002 $/1k (standard
 *   tier — NOT the $0.01/1M batch rate, per the round-up "no batch discount" rule).
 *   Verified against openai pricing, 2026-07-03 (re-verify if the vendor rate moves).
 */
export const PRICE_TABLE: PriceTable = {
  anthropic: {
    // Keyed by model FAMILY (sonnet/haiku), matching the price_table shape. The live API may
    // call a specific snapshot (e.g. claude-sonnet-5); the $ figure is always price_table-based
    // per ADR-001 (estimate, not invoice). See vendors.ts for the snapshot→family mapping.
    sonnet: { input: 0.003, output: 0.015 },
    haiku: { input: 0.0008, output: 0.004 },
  },
  openai: {
    'text-embedding-3-small': { input: 0.00002, output: 0 },
  },
};

/** A single accounted-for vendor call (the analog of one event_log row's cost_tokens). */
export interface CallCost {
  vendor: string;
  model: string; // price_table family key: 'sonnet' | 'haiku' | 'text-embedding-3-small'
  inputTokens: number;
  outputTokens: number;
  attempts: number; // total tries INCLUDING retries — all are charged (round-up)
  usd: number;
  costUnknown: boolean; // true = tokens could not be captured; never silently treated as $0
}

/**
 * Round-up cost for one logical call. `attempts` multiplies the per-attempt token cost:
 * a call that took 2 tries is charged twice (no "only the successful one counts" optimism).
 * If tokens are unavailable, we mark cost_unknown — the schema.md §7 sentinel — rather than
 * emit a silent 0 (non-negotiable #3).
 */
export function costOf(
  table: PriceTable,
  vendor: string,
  model: string,
  inputTokens: number | null,
  outputTokens: number | null,
  attempts = 1,
): CallCost {
  const rate = table[vendor]?.[model];
  if (!rate) {
    throw new Error(
      `price_table has no rate for ${vendor}/${model} — refusing to guess (Rule 0 / non-negotiable #3).`,
    );
  }
  if (inputTokens === null || outputTokens === null) {
    return { vendor, model, inputTokens: 0, outputTokens: 0, attempts, usd: 0, costUnknown: true };
  }
  const perAttempt = (inputTokens / 1000) * rate.input + (outputTokens / 1000) * rate.output;
  return {
    vendor,
    model,
    inputTokens,
    outputTokens,
    attempts,
    usd: perAttempt * attempts,
    costUnknown: false,
  };
}
