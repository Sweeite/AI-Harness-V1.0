// ISSUE-054 (C5 OPT) — the three per-deployment optimisation flags + the chain-depth ceiling this slice CONSUMES.
// FR-5.OPT.001 (parallel_execution_enabled) · FR-5.OPT.002 (smart_scheduling_enabled) · FR-5.OPT.004
// (chained_task_prewarm_enabled) · NFR-PERF.007 (chain_depth_limit, owned by C8/ISSUE-064 — read here for the
// decomposition boundary). The registry (config-registry.md §H) is the SINGLE source of truth for these keys; this
// module does NOT define them — it mirrors their defaults so a fake predicts the live value, and the `check` gate
// (index.ts) asserts the registry rows agree. Two of the three flags already ship (parallel_execution_enabled,
// smart_scheduling_enabled, both BOOT/bool/default false); chained_task_prewarm_enabled is a proposed additive row
// (see results manifest) — until the orchestrator registers it the check reports one EXPECTED pending finding.
//
// The three non-negotiables land here as the DEFAULT posture: every optimisation is OFF by default (opt-in), so a
// deployment that never sets a flag runs the plain, already-proven sequential/on-cadence path (#2 — never do
// something it shouldn't; the optimisation layer is purely additive).

/** Per-deployment optimisation config. Every flag defaults OFF (safety default; the layer is additive). */
export interface OptConfig {
  /** parallel_execution_enabled (BOOT, bool, default false) — may independent DAG steps run concurrently. */
  parallelExecutionEnabled: boolean;
  /** smart_scheduling_enabled (BOOT, bool, default false) — do non-urgent scheduled tasks wait for a quiet window. */
  smartSchedulingEnabled: boolean;
  /** chained_task_prewarm_enabled (BOOT, bool, default false) — may a chained Task B's retrieval start while A runs. */
  chainedTaskPrewarmEnabled: boolean;
  /** chain_depth_limit (LIVE, int ≥ 1, default 6) — NFR-PERF.007; the ceiling decomposition binds the plan to. */
  chainDepthLimit: number;
}

export const CHAIN_DEPTH_MIN = 1; // registry constraint: int ≥ 1
export const CHAIN_DEPTH_DEFAULT = 6; // NFR-PERF.007 default (registry §H)

export const DEFAULT_OPT_CONFIG: OptConfig = {
  parallelExecutionEnabled: false,
  smartSchedulingEnabled: false,
  chainedTaskPrewarmEnabled: false,
  chainDepthLimit: CHAIN_DEPTH_DEFAULT,
};

export const ERR_BAD_CHAIN_DEPTH =
  `execution-optimisation: chain_depth_limit must be an integer ≥ ${CHAIN_DEPTH_MIN} (NFR-PERF.007 / registry §H)`;

/** Validate + normalise a partial config into a full OptConfig, filling registry defaults. Fails LOUD on a
 * malformed chain_depth_limit (a #3 signal — never silently coerce an out-of-range ceiling). */
export function resolveConfig(partial: Partial<OptConfig> = {}): OptConfig {
  const cfg: OptConfig = { ...DEFAULT_OPT_CONFIG, ...partial };
  if (!Number.isInteger(cfg.chainDepthLimit) || cfg.chainDepthLimit < CHAIN_DEPTH_MIN) {
    throw new Error(ERR_BAD_CHAIN_DEPTH);
  }
  return cfg;
}

/** The exact registry keys this slice reads — the `check` gate asserts each is present with the documented class. */
export const CFG_KEYS = {
  parallelExecution: 'parallel_execution_enabled',
  smartScheduling: 'smart_scheduling_enabled',
  prewarm: 'chained_task_prewarm_enabled',
  chainDepth: 'chain_depth_limit',
} as const;
