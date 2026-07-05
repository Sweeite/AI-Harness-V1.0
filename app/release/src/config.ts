// ISSUE-080 §5 CFG — the release/deploy tunables the model consults. Values + validation ranges are
// transcribed VERBATIM from spec/02-config/config-registry.md L294-296 (Rule 0 — the registry is the
// source of truth). These are DEFAULTS; at runtime a deployment's config store (ISSUE-010) supplies the
// live values. None is a secret. Realise OD-094 (soak) + OD-095 (skew thresholds 3 versions / 14 days).

export interface ReleaseConfig {
  /** How long a new release is watched on the canary before promotion is allowed.
   *  registry: int minutes ≥ 1, default 60. (FR-10.DEP.002 / AC-NFR-INF.001.2 soak gate) */
  canary_soak_minutes: number;
  /** How many versions behind the fleet a deployment can fall before the drift alert fires.
   *  registry: int ≥ 1, default 3. (FR-10.DEP.004 / OD-095 / AC-NFR-INF.004.2) */
  deploy_max_version_skew: number;
  /** How many days stale a deployment's last push can be before the drift alert fires.
   *  registry: int days ≥ 1, default 14. (FR-10.DEP.004 / OD-095 / AC-NFR-INF.004.2) */
  deploy_max_skew_days: number;
}

// Registry defaults (config-registry.md L294-296).
export const DEFAULT_RELEASE_CONFIG: ReleaseConfig = {
  canary_soak_minutes: 60, // 60 min
  deploy_max_version_skew: 3, // 3 versions
  deploy_max_skew_days: 14, // 14 days
};

// Registry validation ranges — a deployment's config store MUST reject values outside these (config
// validation is ISSUE-010's job; this makes the contract explicit + guards the boot path). Returns the
// config unchanged, or throws loudly (#3 — never silently clamp).
export function validateReleaseConfig(c: ReleaseConfig): ReleaseConfig {
  const fail = (m: string): never => {
    throw new Error(`invalid CFG-deploy config: ${m}`);
  };
  if (!Number.isInteger(c.canary_soak_minutes) || c.canary_soak_minutes < 1)
    fail(`canary_soak_minutes must be an int ≥ 1 (got ${c.canary_soak_minutes})`);
  if (!Number.isInteger(c.deploy_max_version_skew) || c.deploy_max_version_skew < 1)
    fail(`deploy_max_version_skew must be an int ≥ 1 (got ${c.deploy_max_version_skew})`);
  if (!Number.isInteger(c.deploy_max_skew_days) || c.deploy_max_skew_days < 1)
    fail(`deploy_max_skew_days must be an int ≥ 1 (got ${c.deploy_max_skew_days})`);
  return c;
}
