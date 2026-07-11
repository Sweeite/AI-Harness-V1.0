// ISSUE-028 (C2 — conflict quarantine + consolidation approval). The LIVE config this slice reads. Canonical values
// live in spec/02-config/config-registry.md (Rule 0 — read there, not here); these are the shipped DEFAULTS the fake
// + tests use. The `check` gate (index.ts) asserts each row is present + LIVE-class in the registry, so a drift
// between this contract and the registry is caught offline (a #3 silent config divergence — an escalation clock or a
// merge threshold silently keying on a stale value is exactly the kind of quiet drift this slice guards against).

export interface ConflictConsolidationConfig {
  /** CFG-review_escalation_days (7, LIVE) — how long a pending conflict / consolidation item may sit before the C2
   *  maintenance loop stamps escalated_at + raises the alert (AC-2.WRT.002.3 / AC-2.MNT.014.2). Server-owned. */
  reviewEscalationDays: number;
  /** CFG-merge_similarity_threshold (0.92, LIVE) — read-only context: the similarity that produced a consolidation
   *  candidate; shown on the Consolidation detail. This slice does not decide merges, only gates + queues them. */
  mergeSimilarityThreshold: number;
}

/** The shipped defaults (config-registry.md rows). A live loadConfig would override these from config_values. */
export const DEFAULT_CONFLICT_CONSOLIDATION_CONFIG: ConflictConsolidationConfig = {
  reviewEscalationDays: 7,
  mergeSimilarityThreshold: 0.92,
};

/** The CFG keys the `check` gate asserts are present + LIVE-class in the registry. */
export const REQUIRED_CFG_KEYS: readonly string[] = ['review_escalation_days', 'merge_similarity_threshold'];
