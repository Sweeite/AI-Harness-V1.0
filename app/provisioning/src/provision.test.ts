// Build-time smoke tests for the provisioning orchestrator (per ISSUE-007 §9).
// Proves, WITHOUT live infra, the two launch-gating posture ACs:
//   • AC-NFR-INF.006.1 — a re-run converges idempotently
//   • AC-10.PRV.001.3 / AC-NFR-INF.006.2 — a partial provision fails loud, no half-silo
// (The end-to-end live proof is AF-004, the two-party spike — not this file.)

import assert from "node:assert/strict";
import { test } from "node:test";
import { DryRunInfra } from "./infra.ts";
import { ProvisioningError, provision } from "./provision.ts";
import type { DeploymentConfig } from "./types.ts";

const cfg: DeploymentConfig = {
  clientSlug: "acme",
  clientName: "Acme Co",
  region: "ap-southeast-2",
  railwayUrl: "https://acme.up.railway.app",
  coreVersion: "0.1.0",
  connectors: ["slack"],
};

/** every client-supplied secret (INTERNAL_TOKEN is minted, not supplied). */
const fullSecrets = (): Record<string, string> => ({
  SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "srk_live",
  ANTHROPIC_API_KEY: "sk-ant",
  OPENAI_API_KEY: "sk-oai",
  LOGIN_OAUTH_CLIENT_ID: "login_id",
  LOGIN_OAUTH_CLIENT_SECRET: "login_secret",
  SLACK_CLIENT_ID: "slack_id",
  SLACK_CLIENT_SECRET: "slack_secret",
});

test("happy path — full provision reaches `initialising` with the token dual-stored", async () => {
  const infra = new DryRunInfra();
  const r = await provision(cfg, fullSecrets(), infra);

  assert.equal(r.status, "initialising");
  assert.deepEqual(r.skipped, [], "nothing should be skipped on a fresh provision");
  assert.ok(r.applied.includes("mint-token"));
  assert.ok(r.applied.includes("registry-row"));
  assert.ok(r.applied.includes("first-deploy"));

  // dual-store: token in the Railway env AND in the management-DB row.
  const env = await infra.getPresentSecretKeys("acme");
  assert.ok(env.has("INTERNAL_TOKEN"), "token in Railway env");
  const row = await infra.getRegistryRow("acme");
  assert.ok(row && row.internalTokenEncrypted.startsWith("itk_"), "token in management DB");
});

test("AC-NFR-INF.006.1 — a re-run converges idempotently (no work, same token, no dup row)", async () => {
  const infra = new DryRunInfra();
  await provision(cfg, fullSecrets(), infra);
  const tokenAfter1 = (await infra.getRegistryRow("acme"))!.internalTokenEncrypted;
  const insertsAfter1 = infra.calls.filter((c) => c.startsWith("insertRegistryRow")).length;

  const r2 = await provision(cfg, fullSecrets(), infra);

  assert.deepEqual(r2.applied, [], "second run must apply nothing");
  assert.equal(r2.status, "initialising");
  const tokenAfter2 = (await infra.getRegistryRow("acme"))!.internalTokenEncrypted;
  assert.equal(tokenAfter2, tokenAfter1, "token must NOT be re-minted on re-run");
  const insertsAfter2 = infra.calls.filter((c) => c.startsWith("insertRegistryRow")).length;
  assert.equal(insertsAfter2, insertsAfter1, "no duplicate registry insert");
});

test("AC-10.PRV.001.3 — a missing secret fails loud, and NO half-silo is left behind", async () => {
  const infra = new DryRunInfra();
  const secrets = fullSecrets();
  delete secrets.SLACK_CLIENT_SECRET; // required for the in-scope slack connector

  await assert.rejects(
    () => provision(cfg, secrets, infra),
    (e: unknown) =>
      e instanceof ProvisioningError &&
      e.step === "secrets" &&
      /SLACK_CLIENT_SECRET/.test(e.message),
  );

  // fail-loud BEFORE any registry row / deploy — never a silent partial provision.
  assert.equal(await infra.getRegistryRow("acme"), null, "no registry row on failure");
  assert.equal(await infra.getDeploymentStatus("acme"), "none", "no deploy on failure");
});

test("partial failure then re-run converges (deploy step dies once, next run finishes)", async () => {
  const infra = new DryRunInfra();
  infra.failOnce = "triggerFirstDeploy";

  await assert.rejects(
    () => provision(cfg, fullSecrets(), infra),
    (e: unknown) => e instanceof ProvisioningError && e.step === "first-deploy",
  );
  // partial state: row written, token stored, but deploy did not land → status still `none`.
  assert.ok(await infra.getRegistryRow("acme"), "registry row persisted from the partial run");
  assert.equal(await infra.getDeploymentStatus("acme"), "none", "not yet deployed");

  const r = await provision(cfg, fullSecrets(), infra);
  assert.equal(r.status, "initialising", "re-run completes the deploy");
  assert.deepEqual(
    r.applied,
    ["first-deploy"],
    "only the previously-failed step does work on resume",
  );
});
