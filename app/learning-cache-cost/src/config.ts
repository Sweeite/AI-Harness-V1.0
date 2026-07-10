// ISSUE-066 (C8 LRN/COST) — the config contract this slice reads. Rule 0: config-registry.md §K is the source of
// truth; these defaults MIRROR it (App. A) and the offline check gate asserts the rows exist + are LIVE-class so a
// drift between what the fake tests against and what the live loadConfig() reads is caught offline, not in prod (#3).

// ── cache_time_window (config-registry §K / App. A #5) — per-agent-type reuse window, minutes ───────────────────
/** The agent TYPES a result may be cached for, each with its own window (App. A #5). These are the specialist roster
 *  domains (FR-8.SPC.001) plus `research`/`insight`. */
export const CACHEABLE_AGENT_TYPES = ['research', 'client', 'campaign', 'comms', 'ops', 'finance', 'insight'] as const;
export type CacheableAgentType = (typeof CACHEABLE_AGENT_TYPES)[number];

/** cache_time_window defaults (minutes) — research 30 · client 60 · campaign 60 · comms 15 · ops 120 · finance 120 ·
 *  insight 1440 (config-registry §K / App. A #5, L952–960). LIVE-class: an operator edit re-bases the window without a
 *  deploy. Research is short (fast-moving external facts); insight is a day (slow-loop synthesis). */
export const CACHE_TIME_WINDOW_DEFAULTS: Record<CacheableAgentType, number> = {
  research: 30,
  client: 60,
  campaign: 60,
  comms: 15,
  ops: 120,
  finance: 120,
  insight: 1440,
};

export function isCacheableAgentType(v: string): v is CacheableAgentType {
  return (CACHEABLE_AGENT_TYPES as readonly string[]).includes(v);
}

/** Validate a live cache_time_window object — every known type present + a positive integer minute count. A window ≤ 0
 *  would mean an entry that never expires (stale-forever risk, #1); reject LOUD rather than silently cache forever. */
export function validateCacheWindow(w: Partial<Record<CacheableAgentType, number>>): Record<CacheableAgentType, number> {
  const out = {} as Record<CacheableAgentType, number>;
  for (const t of CACHEABLE_AGENT_TYPES) {
    const m = w[t] ?? CACHE_TIME_WINDOW_DEFAULTS[t];
    if (!Number.isFinite(m) || m <= 0) {
      throw new Error(`cache_time_window['${t}'] must be a positive number of minutes, got ${m} (a non-positive window never expires — #1)`);
    }
    out[t] = m;
  }
  return out;
}

// ── The cost-routing knobs this slice reads (config-registry §K) ─────────────────────────────────────────────────
/** The cost-routing config. `confidenceThreshold` + `chainDepthLimit` + `routingWeights` are the SAME live CFG rows
 *  ISSUE-061 reads (orchestrator_confidence_threshold / chain_depth_limit / routing_weights) — this slice TUNES cost
 *  behaviour on them, it does not redefine them (integration note, §2). `rerankEnabled`/`hydeEnabled` are the
 *  NFR-COST.010.2 posture flags — OFF by default, enabled only after an AF-002 eval (not live CFG rows). */
export interface CostRoutingConfig {
  confidenceThreshold: number; // CFG-orchestrator_confidence_threshold (default 0.75)
  chainDepthLimit: number; // CFG-chain_depth_limit (default 6)
  cacheWindow: Record<CacheableAgentType, number>; // CFG-cache_time_window
  rerankEnabled: boolean; // NFR-COST.010.2 — default OFF (AF-002 gates on)
  hydeEnabled: boolean; // NFR-COST.010.2 — default OFF (AF-002 gates on)
}

export const DEFAULT_COST_ROUTING_CONFIG: CostRoutingConfig = {
  confidenceThreshold: 0.75,
  chainDepthLimit: 6,
  cacheWindow: CACHE_TIME_WINDOW_DEFAULTS,
  rerankEnabled: false, // NFR-COST.010.2 — never on by default
  hydeEnabled: false, // NFR-COST.010.2 — never on by default
};

/** The CFG rows the offline check gate asserts present + LIVE-class (config-registry §K). */
export const REQUIRED_CFG_KEYS: readonly string[] = [
  'cache_time_window',
  'orchestrator_confidence_threshold',
  'chain_depth_limit',
  'routing_weights',
];
