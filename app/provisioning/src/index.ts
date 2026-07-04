// CLI entry for the provisioning script (FR-10.PRV.001).
// `--dry-run` prints the plan against DryRunInfra (no live calls). The live `--execute` path is
// guarded until RailwayInfra (the AF-004 two-party adapter) is implemented.

import { DryRunInfra, RailwayInfra } from "./infra.ts";
import { provision } from "./provision.ts";
import { type Connector, type DeploymentConfig, requiredSecretKeys } from "./types.ts";

/** Read a required env var or exit loud (never provision with a silent gap — #3). */
function requireEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined || v.trim() === "") {
    console.error(`FATAL: missing required env ${name} (source ~/.ai-harness-secrets.env / operator secret store).`);
    process.exit(1);
  }
  return v;
}

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

  // Live provisioning (RailwayInfra). Requires a Railway Workspace/Account token (AF-142) + the
  // management-plane Supabase PAT/ref + the Railway topology IDs — all from the operator secret store.
  const infra = new RailwayInfra({
    railwayApiToken: requireEnv("RAILWAY_API_TOKEN"), // Workspace/Account token — project tokens can't (AF-142)
    projectId: requireEnv("RW_PROJECT"),
    serviceId: requireEnv("RW_SERVICE"),
    environmentId: requireEnv("RW_ENV"),
    mgmtProjectRef: requireEnv("MGMT_REF"),
    supabaseAccessToken: requireEnv("SUPABASE_ACCESS_TOKEN"),
  });

  // Secret VALUES come from the operator's environment (the secure channel), never the repo.
  // INTERNAL_TOKEN is minted by provision(), not supplied here.
  const supplied: Record<string, string> = {};
  for (const k of requiredSecretKeys(cfg)) {
    if (k === "INTERNAL_TOKEN") continue;
    const v = process.env[k];
    if (v !== undefined && v !== "") supplied[k] = v;
  }

  try {
    const r = await provision(cfg, supplied, infra);
    console.log(`\n✅ provisioned "${r.slug}" → status ${r.status}`);
    console.log(`   applied: ${r.applied.join(" → ") || "(nothing — fully converged)"}`);
    console.log(`   skipped: ${r.skipped.join(", ") || "(none)"}`);
  } catch (e) {
    console.error(`\n❌ provisioning failed: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(String(e instanceof Error ? e.stack ?? e.message : e));
  process.exit(1);
});
