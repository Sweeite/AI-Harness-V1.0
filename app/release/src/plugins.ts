// ISSUE-080 §8 step 6 — plugins stay out of the release train (FR-10.DEP.005 / NFR-INF.009). A core push
// must NOT modify `/plugins`: plugins are per-deployment, manually updated, and version-reported so drift
// is observable (the version signal lives in version.ts / DATA-deployment_health.plugin_version).
// Automated plugin distribution is deferred (OOS-033). This guard is the build-time enforcement that a
// core changeset leaves `/plugins` untouched (AC-10.DEP.005.1 / AC-NFR-INF.009.1).

/** The path prefix (repo-root-relative) that is out of the core train. */
export const PLUGINS_PREFIX = "plugins/";

/** Which of the changed paths (repo-root-relative) touch `/plugins`. */
export function pluginsTouched(changedPaths: readonly string[]): string[] {
  return changedPaths.filter((p) => {
    const norm = p.replace(/^\.?\/+/, ""); // strip a leading ./ or /
    return norm === "plugins" || norm.startsWith(PLUGINS_PREFIX);
  });
}

export interface PluginsGuardVerdict {
  ok: boolean;
  touched: string[];
  reason: string;
}

/**
 * Assert a core push/promotion leaves `/plugins` untouched (AC-10.DEP.005.1 / AC-NFR-INF.009.1). Returns
 * a verdict (never throws) so CI can surface it as a blocking finding — a core change that edits a
 * deployment's plugins would clobber its per-client customisation (forbidden).
 */
export function assertPluginsUntouched(changedPaths: readonly string[]): PluginsGuardVerdict {
  const touched = pluginsTouched(changedPaths);
  return touched.length === 0
    ? { ok: true, touched, reason: "core push leaves /plugins untouched (AC-10.DEP.005.1)" }
    : {
        ok: false,
        touched,
        reason: `a core push must not modify /plugins — touched: ${touched.join(", ")} (plugins are per-deployment, out of the train — FR-10.DEP.005)`,
      };
}
