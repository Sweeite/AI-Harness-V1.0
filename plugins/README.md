# `/plugins` — out of the core release train (FR-10.DEP.005 / NFR-INF.009)

Plugins are **per-deployment, manually updated, and never touched by a core push.** A core promotion to
the fleet (the `release`→`main` fast-forward) must leave this folder **untouched** — a core change that
edited a deployment's plugins would clobber that client's per-client customisation (forbidden, ADR-005 §7).

- **Not in the auto-deploy fan-out.** The release train ships `app/` core; `/plugins` is updated
  separately, per deployment, by a deliberate operator action.
- **Version-reported.** Each deployment reports its `plugin_version` on the health push
  (`DATA-deployment_health.plugin_version`) so plugin drift across the fleet is **observable**, never
  silent (AC-10.DEP.005.2 / AC-NFR-INF.009.2).
- **Enforced.** `app/release/src/plugins.ts` (`assertPluginsUntouched`) is the build-time guard that a
  core changeset does not modify `plugins/` (AC-10.DEP.005.1 / AC-NFR-INF.009.1); it runs in the merge
  gate.
- **Automated plugin distribution is deferred** → **OOS-033** (v-future).

This file establishes the convention and the directory; deployment-specific plugin content lives here
per deployment and is not carried by the core train.
