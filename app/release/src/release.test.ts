// ISSUE-080 §4 Definition of done — one test per AC (text read in the FR, Rule 0). 18 of the 20 ACs are
// fully offline-provable here; the two live ACs are marked and proven at the two-party capstone:
//   • AC-10.DEP.001.1 (real push → fleet auto-deploy + independent migrate) — LIVE (§9 integration).
//   • OD-173 / AF-064 Wait-for-CI scope — LIVE spike owed before FR-10.DEP.002 is treated as a proven
//     live mechanism (the gate LOGIC, AC-10.DEP.002.1/.2, IS proven offline below).
// Everything else is build-time logic + static gates, proven with the house port+fake pattern.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { DEFAULT_RELEASE_CONFIG, validateReleaseConfig } from "./config.ts";
import {
  DEPLOYMENT_CONFIG,
  branchFor,
  assertActionsGatesNeverDeploys,
} from "./deployment-config.ts";
import { deriveJobKindsFromWorkflow } from "./ci-scan.ts";
import { evaluatePromotion, type CanaryState } from "./promotion-gate.ts";
import { summarizeBattery, REQUIRED_BATTERY_CHECKS, type CheckResult } from "./smoke-battery.ts";
import { planRollback, assertNoDownMigration, isDownMigrationName } from "./rollback.ts";
import { buildVersionReport } from "./version.ts";
import { evaluateSkew, evaluateAndEmit } from "./skew.ts";
import { InMemoryDeploymentHealthStore, InMemoryAlertSink, type DeploymentHealthRow } from "./store.ts";
import { assertPluginsUntouched, pluginsTouched } from "./plugins.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const SILO_MIGRATIONS = join(HERE, "..", "..", "silo", "migrations");
const CI_WORKFLOW = join(HERE, "..", "..", "..", ".github", "workflows", "ci.yml");

// A fully-green canary at a fixed clock (soak satisfied): baseline for the "any red gate" mutations.
const NOW = 1_800_000_000_000; // fixed epoch ms (deterministic; no Date.now in tests)
const greenCanary: CanaryState = {
  testsGreen: true,
  canaryMigrationClean: true,
  smokeBatteryGreen: true,
  canaryDeployedAt: NOW - 61 * 60_000, // 61 min ago ≥ 60-min soak
};
const promoteGreen = () =>
  evaluatePromotion({ canary: greenCanary, config: DEFAULT_RELEASE_CONFIG, now: NOW, trigger: "operator" });

// ─────────────────────────────────────────────────────────────────────────────
// FR-10.DEP.001 — Railway per-project auto-deploy; Actions is a test gate only
// ─────────────────────────────────────────────────────────────────────────────

test("AC-10.DEP.001.1 (contract; LIVE proof = capstone) — canary tracks `release`, every fleet deployment tracks `main`, each migrates its own Supabase", () => {
  // The branch→environment mapping the live push→auto-deploy+migrate proof rests on. The actual
  // push→auto-deploy+independent-migrate is the two-party capstone (§9 integration).
  assert.equal(branchFor("canary"), "release");
  assert.equal(branchFor("fleet"), "main");
  assert.equal(DEPLOYMENT_CONFIG.fleet.tracksBranch, "main");
  // Independence is structural: N Railway projects, each its own Supabase (ADR-001 §6) — asserted at the
  // capstone; here we pin the contract that no shared/fan-out CI deploys (see AC-10.DEP.001.2).
});

test("AC-10.DEP.001.2 — the real CI workflow gates merges via the test suite and does NOT deploy", () => {
  const raw = readFileSync(CI_WORKFLOW, "utf8");
  const kinds = deriveJobKindsFromWorkflow(raw);
  assert.ok(kinds.includes("test"), "CI must run the test suite as a merge gate");
  assert.ok(!kinds.includes("deploy"), "CI must not contain a deploy step");
  assert.equal(assertActionsGatesNeverDeploys(kinds).ok, true);
  // And a workflow that DID deploy is rejected (guards the invariant against a future edit).
  const withDeploy = assertActionsGatesNeverDeploys(["test", "deploy"]);
  assert.equal(withDeploy.ok, false);
  assert.match(withDeploy.reason, /never deploy/);
});

test("AC-10.DEP.001.2 (logic-sweep) — a NON-Railway deployer in raw workflow text is caught by the scanner, not waved through", () => {
  // Regression for the DEPLOYER_INDICATORS whitelist blind spot: a workflow that genuinely deploys via a
  // mechanism the six Railway/npm patterns don't name (flyctl / vercel / netlify / a deploy-action / a raw
  // `deploy` verb) must still derive a "deploy" kind and fail the invariant — else Actions could deploy
  // undetected (#2 "do something it shouldn't").
  for (const raw of [
    "steps:\n  - run: flyctl deploy --app x\n  - run: npm test",
    "steps:\n  - run: vercel --prod\n  - run: npm test",
    "steps:\n  - run: netlify deploy --prod\n  - run: npm test",
    "steps:\n  - uses: some-org/deploy-action@v1\n  - run: npm test",
  ]) {
    const kinds = deriveJobKindsFromWorkflow(raw);
    assert.ok(kinds.includes("deploy"), `scanner must flag a deploy step in: ${raw}`);
    assert.equal(assertActionsGatesNeverDeploys(kinds).ok, false, `a deploying workflow must fail: ${raw}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// FR-10.DEP.002 — the four-gate canary→fleet promotion
// ─────────────────────────────────────────────────────────────────────────────

test("AC-10.DEP.002.1 — promotion requires all four gates green; any red gate blocks + is surfaced", () => {
  assert.equal(promoteGreen().promoted, true);

  const gates: (keyof CanaryState)[] = ["testsGreen", "canaryMigrationClean", "smokeBatteryGreen"];
  for (const g of gates) {
    const d = evaluatePromotion({
      canary: { ...greenCanary, [g]: false },
      config: DEFAULT_RELEASE_CONFIG,
      now: NOW,
      trigger: "operator",
    });
    assert.equal(d.promoted, false, `${g} red must block promotion`);
    assert.ok(d.reason.length > 0 && /refused/.test(d.reason), `${g} failure must be surfaced`);
  }
});

test("AC-NFR-INF.001.2 — an incomplete soak refuses promotion and surfaces the incomplete gate", () => {
  const d = evaluatePromotion({
    canary: { ...greenCanary, canaryDeployedAt: NOW - 10 * 60_000 }, // only 10 of 60 min
    config: DEFAULT_RELEASE_CONFIG,
    now: NOW,
    trigger: "operator",
  });
  assert.equal(d.promoted, false);
  assert.ok(d.failing.includes("soak"));
  assert.match(d.reason, /soak INCOMPLETE \(10\/60 min/);
});

test("AC-10.DEP.002.2 — promotion is a deliberate operator action in v1; an automatic trigger is refused (OD-094)", () => {
  const auto = evaluatePromotion({ canary: greenCanary, config: DEFAULT_RELEASE_CONFIG, now: NOW, trigger: "automatic" });
  assert.equal(auto.promoted, false, "automated promotion is deferred even with all gates green");
  assert.match(auto.reason, /operator|OD-094/);
});

test("AC-NFR-INF.001.1 — canary-first: a build reaches the fleet only via an operator-gated promotion", () => {
  // canary tracks `release` (not `main`) → a new build lands on the canary, never a client silo, until
  // the operator promotes (fast-forward release→main). Proven by the mapping + the operator-gate above.
  assert.equal(branchFor("canary"), "release");
  assert.notEqual(branchFor("canary"), branchFor("fleet"));
  assert.equal(promoteGreen().promoted, true); // an operator, all-green, promotes
});

// ─────────────────────────────────────────────────────────────────────────────
// FR-10.PRV.003 / NFR-INF.008 — the smoke battery as promotion gate
// ─────────────────────────────────────────────────────────────────────────────

test("AC-NFR-INF.008.1 — the battery exercises boot + migration + connector wiring + retrieval/contradiction/routing", () => {
  assert.deepEqual([...REQUIRED_BATTERY_CHECKS], ["boot", "migration", "connector_wiring", "retrieval", "contradiction", "routing"]);
  const allPass: CheckResult[] = REQUIRED_BATTERY_CHECKS.map((c) => ({ check: c, passed: true, detail: "ok" }));
  assert.equal(summarizeBattery(allPass).green, true);
  // A battery missing a required category is NOT green (an incomplete gate, never a silent pass — #3).
  const missingRouting = allPass.filter((r) => r.check !== "routing");
  const res = summarizeBattery(missingRouting);
  assert.equal(res.green, false);
  assert.deepEqual(res.missing, ["routing"]);
});

test("AC-NFR-INF.008.2 — a red battery blocks promotion", () => {
  const d = evaluatePromotion({
    canary: { ...greenCanary, smokeBatteryGreen: false },
    config: DEFAULT_RELEASE_CONFIG,
    now: NOW,
    trigger: "operator",
  });
  assert.equal(d.promoted, false);
  assert.ok(d.failing.includes("smoke_battery"));
});

// ─────────────────────────────────────────────────────────────────────────────
// FR-10.DEP.003 — rollback = redeploy prior build; schema rolls forward only
// ─────────────────────────────────────────────────────────────────────────────

test("AC-10.DEP.003.1 / AC-NFR-INF.003.1 — rollback redeploys the prior build; the schema is not un-migrated", () => {
  const plan = planRollback("build_abc123");
  assert.equal(plan.action, "redeploy_prior_build");
  assert.equal(plan.priorBuildId, "build_abc123");
  assert.equal(plan.schemaTouched, false);
  // No prior build to redeploy → fail loud, never guess a target (#3).
  assert.throws(() => planRollback(null), /no prior Railway build/);
  assert.throws(() => planRollback("  "), /no prior Railway build/);
});

test("AC-10.DEP.003.2 / AC-NFR-INF.003.2 — no down-migration reverse path exists in the real migrations dir", () => {
  const verdict = assertNoDownMigration(SILO_MIGRATIONS);
  assert.equal(verdict.ok, true, `unexpected down-migration artifact(s): ${verdict.offenders.join(", ")}`);
  // The predicate catches reverse-path SQL and ignores forward migrations + source files (guards the invariant).
  assert.equal(isDownMigrationName("0002_rollback.sql"), true);
  assert.equal(isDownMigrationName("0002_users.down.sql"), true);
  assert.equal(isDownMigrationName("0001_baseline.sql"), false, "a forward migration is not a down-migration");
  assert.equal(isDownMigrationName("rollback.ts"), false, "a source module is not a migration (scoped to .sql)");
});

// ─────────────────────────────────────────────────────────────────────────────
// FR-10.DEP.004 / NFR-INF.004 — version reporting + max-skew alert
// ─────────────────────────────────────────────────────────────────────────────

test("AC-10.DEP.004.1 / AC-NFR-INF.004.1 — the version report carries core_version + last-migrated + plugin_version; fleet spread is visible", () => {
  const report = buildVersionReport({ core_version: "v3", last_migrated_at: "2026-07-01T00:00:00.000Z", plugin_version: "p1" });
  assert.equal(report.core_version, "v3");
  assert.equal(report.last_migrated_at, "2026-07-01T00:00:00.000Z");
  assert.equal(report.plugin_version, "p1");
  // A blind version signal is refused loud (#3).
  assert.throws(() => buildVersionReport({ core_version: "" }), /core_version is required/);
  // Fleet spread is visible: evaluation names the fleet head across reported rows.
  const rows: DeploymentHealthRow[] = [
    { client_slug: "a", core_version: "v3", last_migrated_at: null, plugin_version: null, last_push_at: "2026-07-05T00:00:00.000Z" },
    { client_slug: "b", core_version: "v1", last_migrated_at: null, plugin_version: null, last_push_at: "2026-07-05T00:00:00.000Z" },
  ];
  const e = evaluateSkew({ rows, releaseOrder: ["v1", "v2", "v3"], config: DEFAULT_RELEASE_CONFIG, now: Date.parse("2026-07-05T00:00:00.000Z"), });
  assert.equal(e.fleetHeadVersion, "v3");
});

test("AC-10.DEP.004.2 / AC-NFR-INF.004.2 — an over-skew silo (>3 versions behind) OR a stale one (>14 days) raises a drift alert", async () => {
  const order = ["v1", "v2", "v3", "v4", "v5"]; // v5 is head
  const now = Date.parse("2026-07-05T00:00:00.000Z");
  const rows: DeploymentHealthRow[] = [
    { client_slug: "head", core_version: "v5", last_migrated_at: null, plugin_version: null, last_push_at: "2026-07-05T00:00:00.000Z" },
    { client_slug: "laggard", core_version: "v1", last_migrated_at: null, plugin_version: null, last_push_at: "2026-07-05T00:00:00.000Z" }, // 4 behind > 3
    { client_slug: "within", core_version: "v3", last_migrated_at: null, plugin_version: null, last_push_at: "2026-07-05T00:00:00.000Z" }, // 2 behind ≤ 3
    { client_slug: "stale", core_version: "v5", last_migrated_at: null, plugin_version: null, last_push_at: "2026-06-01T00:00:00.000Z" }, // >14 days
  ];
  const sink = new InMemoryAlertSink();
  await evaluateAndEmit({ rows, releaseOrder: order, config: DEFAULT_RELEASE_CONFIG, now, }, sink);
  const byKind = (slug: string, kind: string) => sink.emitted.some((a) => a.client_slug === slug && a.kind === kind);
  assert.ok(byKind("laggard", "version_skew"), "4-versions-behind laggard must alert");
  assert.ok(byKind("stale", "stale_skew"), ">14-days-stale silo must alert");
  assert.ok(!sink.emitted.some((a) => a.client_slug === "within"), "a within-bound silo must NOT alert");
  assert.ok(!sink.emitted.some((a) => a.client_slug === "head" && a.kind === "version_skew"), "the head must not version-skew-alert");
});

test("NFR-INF.004 note — frozen ≠ stale: a frozen deployment is excluded from the staleness alert", () => {
  const now = Date.parse("2026-07-05T00:00:00.000Z");
  const rows: DeploymentHealthRow[] = [
    { client_slug: "frozen", core_version: "v1", last_migrated_at: null, plugin_version: null, last_push_at: "2026-01-01T00:00:00.000Z" },
  ];
  const e = evaluateSkew({ rows, releaseOrder: ["v1"], config: DEFAULT_RELEASE_CONFIG, now, frozenSlugs: new Set(["frozen"]) });
  assert.ok(!e.alerts.some((a) => a.kind === "stale_skew"), "a frozen deployment must not fire a stale alert");
});

test("#3 — a deployment reporting a version absent from the release order is surfaced as drift, never dropped", () => {
  const rows: DeploymentHealthRow[] = [
    { client_slug: "unknown", core_version: "vX", last_migrated_at: null, plugin_version: null, last_push_at: "2026-07-05T00:00:00.000Z" },
  ];
  const e = evaluateSkew({ rows, releaseOrder: ["v1", "v2"], config: DEFAULT_RELEASE_CONFIG, now: Date.parse("2026-07-05T00:00:00.000Z") });
  assert.deepEqual(e.unplaceable, ["unknown"]);
  assert.ok(e.alerts.some((a) => a.client_slug === "unknown" && a.kind === "version_skew"));
});

// ─────────────────────────────────────────────────────────────────────────────
// FR-10.DEP.005 / NFR-INF.009 — plugins out of the release train
// ─────────────────────────────────────────────────────────────────────────────

test("AC-10.DEP.005.1 / AC-NFR-INF.009.1 — a core push that touches /plugins is rejected; one that doesn't passes", () => {
  const clean = assertPluginsUntouched(["app/service/src/index.ts", "spec/06-issues/ISSUE-080.md"]);
  assert.equal(clean.ok, true);
  const dirty = assertPluginsUntouched(["app/service/src/index.ts", "plugins/acme/custom.ts"]);
  assert.equal(dirty.ok, false);
  assert.deepEqual(dirty.touched, ["plugins/acme/custom.ts"]);
  // Path normalisation: a leading ./ or / still matches.
  assert.deepEqual(pluginsTouched(["./plugins/x.ts", "/plugins/y.ts", "plugins"]), ["./plugins/x.ts", "/plugins/y.ts", "plugins"]);
});

test("AC-10.DEP.005.2 / AC-NFR-INF.009.2 — plugin version is reported per deployment so drift is observable", () => {
  const report = buildVersionReport({ core_version: "v3", plugin_version: "acme-2.1.0" });
  assert.equal(report.plugin_version, "acme-2.1.0");
  // A deployment with no plugin still reports a defined (null) slot — drift is observable, not undefined.
  assert.equal(buildVersionReport({ core_version: "v3" }).plugin_version, null);
});

// ─────────────────────────────────────────────────────────────────────────────
// CFG guards (config-registry.md L294-296)
// ─────────────────────────────────────────────────────────────────────────────

test("CFG — defaults are verbatim from the registry and validate; out-of-range values fail loud (never clamp)", () => {
  assert.equal(DEFAULT_RELEASE_CONFIG.canary_soak_minutes, 60);
  assert.equal(DEFAULT_RELEASE_CONFIG.deploy_max_version_skew, 3);
  assert.equal(DEFAULT_RELEASE_CONFIG.deploy_max_skew_days, 14);
  assert.doesNotThrow(() => validateReleaseConfig(DEFAULT_RELEASE_CONFIG));
  assert.throws(() => validateReleaseConfig({ ...DEFAULT_RELEASE_CONFIG, canary_soak_minutes: 0 }), /canary_soak_minutes/);
  assert.throws(() => validateReleaseConfig({ ...DEFAULT_RELEASE_CONFIG, deploy_max_version_skew: 0 }), /deploy_max_version_skew/);
  assert.throws(() => validateReleaseConfig({ ...DEFAULT_RELEASE_CONFIG, deploy_max_skew_days: -1 }), /deploy_max_skew_days/);
  assert.throws(() => validateReleaseConfig({ ...DEFAULT_RELEASE_CONFIG, canary_soak_minutes: 1.5 }), /canary_soak_minutes/);
});

// Store fake sanity — the reference model behaves like the DDL (upsert-by-slug).
test("InMemoryDeploymentHealthStore — upserts by client_slug (models the C7 push ingest)", async () => {
  const store = new InMemoryDeploymentHealthStore();
  store.put({ client_slug: "a", core_version: "v1", last_migrated_at: null, plugin_version: null, last_push_at: "2026-07-05T00:00:00.000Z" });
  store.put({ client_slug: "a", core_version: "v2", last_migrated_at: null, plugin_version: null, last_push_at: "2026-07-05T00:00:00.000Z" });
  const rows = await store.list();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.core_version, "v2");
});
