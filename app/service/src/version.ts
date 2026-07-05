// The deployment's self-reported version signal — the source of the `core_version` / `plugin_version`
// the health push carries to the management plane (FR-10.DEP.004 / FR-10.DEP.005, produced here per
// ISSUE-080 §5; the push DELIVERY into deployment_health is C7's). Railway injects the deployed commit
// SHA as RAILWAY_GIT_COMMIT_SHA — that IS the core version. Plugins are per-deployment + out of the core
// train (FR-10.DEP.005), so their version is reported from the deployment's own env, never a core push.

export interface ServiceVersionReport {
  core_version: string;
  last_migrated_at: string | null;
  plugin_version: string | null;
}

/** Build the service's version report from its own env (deployment-local — no cross-deployment read). */
export function buildServiceVersionReport(env: NodeJS.ProcessEnv = process.env): ServiceVersionReport {
  const core =
    env.RAILWAY_GIT_COMMIT_SHA?.trim() || env.CORE_VERSION?.trim() || "unknown";
  return {
    core_version: core,
    last_migrated_at: env.LAST_MIGRATED_AT?.trim() || null,
    plugin_version: env.PLUGIN_VERSION?.trim() || null,
  };
}
