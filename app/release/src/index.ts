// CLI for the release model. Commands:
//   check  — run the offline build-time gates (no DB, no network). AC-10.DEP.001.2 / .003.2 / .005.1.
//            (1) CFG valid · (2) no down-migration reverse path in app/silo/migrations ·
//            (3) the CI workflow gates merges but never deploys.
//   skew   — evaluate fleet version skew from the mgmt-plane deployment_health rows and print alerts.
//            LIVE: reads $MGMT_DATABASE_URL + $RELEASE_ORDER (comma-separated, oldest→newest).
//
// `check` needs no infra and runs in CI on every change; `skew` is the mgmt-plane monitor.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { DEFAULT_RELEASE_CONFIG, validateReleaseConfig } from "./config.ts";
import { assertNoDownMigration } from "./rollback.ts";
import { assertActionsGatesNeverDeploys } from "./deployment-config.ts";
import { deriveJobKindsFromWorkflow } from "./ci-scan.ts";
import { evaluateAndEmit } from "./skew.ts";
import { InMemoryAlertSink } from "./store.ts";
import { SupabaseDeploymentHealthStore } from "./supabase-store.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const SILO_MIGRATIONS = join(HERE, "..", "..", "silo", "migrations");
const CI_WORKFLOW = join(HERE, "..", "..", "..", ".github", "workflows", "ci.yml");

interface Finding {
  gate: string;
  message: string;
}

function runCheck(): Finding[] {
  const findings: Finding[] = [];

  // (1) CFG valid.
  try {
    validateReleaseConfig(DEFAULT_RELEASE_CONFIG);
  } catch (e) {
    findings.push({ gate: "config", message: (e as Error).message });
  }

  // (2) No down-migration reverse path (schema forward-only — AC-NFR-INF.003.2).
  const down = assertNoDownMigration(SILO_MIGRATIONS);
  if (!down.ok) findings.push({ gate: "no-down-migration", message: down.reason });

  // (3) CI gates merges, never deploys (AC-10.DEP.001.2).
  let raw: string | null = null;
  try {
    raw = readFileSync(CI_WORKFLOW, "utf8");
  } catch {
    findings.push({ gate: "ci-merge-gate", message: `CI workflow not found at ${CI_WORKFLOW} — no merge gate` });
  }
  if (raw !== null) {
    const verdict = assertActionsGatesNeverDeploys(deriveJobKindsFromWorkflow(raw));
    if (!verdict.ok) findings.push({ gate: "ci-merge-gate", message: verdict.reason });
  }

  if (findings.length === 0) {
    console.log("✓ release check: CFG valid · no down-migration reverse path · CI gates merges (never deploys).");
  } else {
    console.error(`✗ release check: ${findings.length} finding(s):`);
    for (const f of findings) console.error(`  [${f.gate}] ${f.message}`);
  }
  return findings;
}

async function runSkew(): Promise<void> {
  const url = process.env.MGMT_DATABASE_URL;
  const order = (process.env.RELEASE_ORDER ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!url) {
    console.error("MGMT_DATABASE_URL is required (the management-plane Postgres connection string).");
    process.exit(2);
  }
  if (order.length === 0) {
    console.error("RELEASE_ORDER is required (comma-separated release versions, oldest→newest).");
    process.exit(2);
  }
  const store = new SupabaseDeploymentHealthStore(url);
  const sink = new InMemoryAlertSink();
  try {
    const rows = await store.list();
    const evalResult = await evaluateAndEmit(
      { rows, releaseOrder: order, config: DEFAULT_RELEASE_CONFIG, now: Date.now() },
      sink,
    );
    console.log(`fleet head: ${evalResult.fleetHeadVersion ?? "(none placeable)"} · ${rows.length} deployment(s)`);
    if (sink.emitted.length === 0) {
      console.log("✓ no skew alerts — every deployment within bound.");
    } else {
      console.error(`⚠ ${sink.emitted.length} skew alert(s):`);
      for (const a of sink.emitted) console.error(`  [${a.kind}] ${a.client_slug}: ${a.detail}`);
    }
  } finally {
    await store.end();
  }
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? "check";
  if (cmd === "check") {
    process.exit(runCheck().length === 0 ? 0 : 1);
  }
  if (cmd === "skew") {
    await runSkew();
    return;
  }
  console.error(`unknown command '${cmd}' — use: check | skew`);
  process.exit(2);
}

await main();
