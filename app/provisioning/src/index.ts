// CLI entry for the provisioning script (FR-10.PRV.001).
// `--dry-run` prints the plan against DryRunInfra (no live calls). The live `--execute` path is
// guarded until RailwayInfra (the AF-004 two-party adapter) is implemented.

import { DryRunInfra } from "./infra.ts";
import { provision } from "./provision.ts";
import { type Connector, type DeploymentConfig, requiredSecretKeys } from "./types.ts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const slug = arg("client");
  if (!slug) {
    console.error("usage: provision --client <slug> [--dry-run] [--connectors ghl,google,slack]");
    process.exit(2);
  }
  const connectors = (arg("connectors")?.split(",").filter(Boolean) ?? []) as Connector[];
  const cfg: DeploymentConfig = {
    clientSlug: slug,
    clientName: arg("name") ?? slug,
    region: arg("region") ?? "ap-southeast-2",
    railwayUrl: arg("url") ?? `https://${slug}.up.railway.app`,
    coreVersion: arg("version") ?? "0.1.0",
    connectors,
  };

  if (!has("execute")) {
    // Dry run: show the plan + the exact secret set the operator must supply.
    console.log(`DRY RUN — provisioning plan for "${slug}"`);
    console.log(JSON.stringify(cfg, null, 2));
    console.log("\nrequired env secrets (from the onboarding runbook / secure channel):");
    for (const k of requiredSecretKeys(cfg)) {
      console.log(`  - ${k}${k === "INTERNAL_TOKEN" ? "  (minted by this script)" : ""}`);
    }
    // Exercise the orchestrator against the fake so the printed step sequence is real.
    const infra = new DryRunInfra();
    const supplied = Object.fromEntries(
      requiredSecretKeys(cfg)
        .filter((k) => k !== "INTERNAL_TOKEN")
        .map((k) => [k, `<${k}>`]),
    );
    const r = await provision(cfg, supplied, infra);
    console.log("\nplanned steps:", r.applied.join(" → "));
    console.log("final status:", r.status);
    return;
  }

  // TODO(AF-004): const infra = new RailwayInfra(...) — the live two-party adapter.
  console.error(
    "--execute is not available yet: the live RailwayInfra adapter is the AF-004 two-party step " +
      "(needs Supabase/Railway access + ISSUE-012 client_registry DDL). Run with --dry-run.",
  );
  process.exit(1);
}

main().catch((e) => {
  console.error(String(e instanceof Error ? e.stack ?? e.message : e));
  process.exit(1);
});
