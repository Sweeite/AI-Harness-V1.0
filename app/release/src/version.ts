// ISSUE-080 §5 — the version-reporting CONTRACT: what each deployment must put on its health push so the
// management plane can see the fleet's version spread and catch a laggard (FR-10.DEP.004 / FR-10.DEP.005).
// This slice PRODUCES the signal; the health-push DELIVERY + the mgmt-plane grid/alert RENDERING are C7's
// (FR-7.MGM.003/004, ISSUE-012/077/078). The fields land in DATA-deployment_health (schema.md §13).

/** The version signal every deployment reports via its health push (FR-10.MGT.002 vehicle). */
export interface VersionReport {
  /** The core release this deployment is running (e.g. a git SHA or release tag). (AC-10.DEP.004.1) */
  core_version: string;
  /** When this deployment last applied a migration (ISO-8601). null = never migrated. (AC-NFR-INF.004.1) */
  last_migrated_at: string | null;
  /** The per-deployment plugin version — plugins are out of the core train (AC-10.DEP.005.2 / NFR-INF.009.2). */
  plugin_version: string | null;
}

/**
 * Build the version report from a deployment's own state. Every field is deployment-local — no
 * cross-deployment read here (that is the skew evaluation's job, on the mgmt plane).
 * `core_version` is required and must be non-empty: a deployment that cannot name its version would push
 * a blind signal, defeating the whole skew guard (#3) — so we fail loud rather than report "".
 */
export function buildVersionReport(input: {
  core_version: string;
  last_migrated_at?: string | null;
  plugin_version?: string | null;
}): VersionReport {
  if (!input.core_version || input.core_version.trim() === "") {
    throw new Error("core_version is required on the health push — a blind version signal defeats the skew guard (#3)");
  }
  return {
    core_version: input.core_version,
    last_migrated_at: input.last_migrated_at ?? null,
    plugin_version: input.plugin_version ?? null,
  };
}
