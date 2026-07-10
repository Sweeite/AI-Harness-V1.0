// ISSUE-025 (C2 RET) — the LIVE config this slice reads. Canonical values live in spec/02-config/config-registry.md
// (Rule 0 — read there, not here); these are the shipped DEFAULTS the fake + tests use and loadConfig() overrides from
// config_values at runtime. The `check` gate (index.ts) asserts every one of these rows is present + LIVE-class in the
// registry, so a drift between this contract and the registry is caught offline (a #3 silent config divergence).

/** The compound ranking weights (config-registry Appendix A #1). Sum = 1.0 — the canonical form superseding the earlier
 *  CFG-rank_weight_* shorthand (FR-2.RET.005). */
export interface RankingWeights {
  recency: number;
  confidence: number;
  entityMatch: number;
  vectorSimilarity: number;
}

export interface RetrievalConfig {
  /** CFG-retrieval_confidence_threshold (LIVE, 0.7) — the FR-2.RET.003 candidate floor. */
  retrievalConfidenceThreshold: number;
  /** CFG-ranking_weights (LIVE, Appendix A #1) — recency 0.3 · confidence 0.3 · entity_match 0.2 · vector_similarity 0.2. */
  rankingWeights: RankingWeights;
  /** CFG-rank_recency_half_life_days (LIVE, 90 — OD-169) — the recency-decay half-life. */
  rankRecencyHalfLifeDays: number;
  /** CFG-procedural_boost (LIVE, 1.2) — the multiplier applied to procedural memories in ranking. */
  proceduralBoost: number;
  /** CFG-memories_injected_per_task (LIVE, 7, int 1–50) — the top-N injection cap (NFR-PERF.006). */
  memoriesInjectedPerTask: number;
  /** CFG-retrieval_sufficiency_threshold (LIVE, 0.6) — the numeric "thin" bar FR-2.RET.007 gates on. */
  retrievalSufficiencyThreshold: number;
  /** CFG-cold_start_proactive_threshold (LIVE, 50 — ADR-002 proactive_threshold, int 0–100) — the [Building] vs
   *  [Unknown] Maturity cut. */
  coldStartProactiveThreshold: number;
  /** CFG-ef_search (LIVE, 40; owned by ISSUE-023) — the vector-arm recall/latency dial. */
  efSearch: number;
}

/** The shipped defaults (config-registry.md). loadConfig() replaces these from config_values at runtime. */
export const DEFAULT_RETRIEVAL_CONFIG: RetrievalConfig = {
  retrievalConfidenceThreshold: 0.7,
  rankingWeights: { recency: 0.3, confidence: 0.3, entityMatch: 0.2, vectorSimilarity: 0.2 },
  rankRecencyHalfLifeDays: 90,
  proceduralBoost: 1.2,
  memoriesInjectedPerTask: 7,
  retrievalSufficiencyThreshold: 0.6,
  coldStartProactiveThreshold: 50,
  efSearch: 40,
};

/** The CFG keys the `check` gate asserts are LIVE-class in the registry (the loadConfig contract). */
export const REQUIRED_CFG_KEYS: readonly string[] = [
  'retrieval_confidence_threshold',
  'ranking_weights',
  'rank_recency_half_life_days',
  'procedural_boost',
  'memories_injected_per_task',
  'retrieval_sufficiency_threshold',
  'cold_start_proactive_threshold',
  'ef_search',
];
