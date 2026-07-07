// Build-time tests for the boot-readiness gate (no live infra).
// Proves: required-secret detection stays in lockstep with provisioning; a missing secret ⇒ NOT ok
// (503 posture, no DB probe); all-present + reachable DB ⇒ ok; unreachable DB ⇒ NOT ok.

import assert from "node:assert/strict";
import { test } from "node:test";
import { REQUIRED_SECRETS as PROVISIONING_SECRETS } from "../../provisioning/src/types.ts";
import { REQUIRED_SECRETS, checkHealth, missingSecrets, probeSupabase } from "./health.ts";

const fullEnv = (): NodeJS.ProcessEnv => ({
  SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "srk_live",
  ANTHROPIC_API_KEY: "sk-ant",
  OPENAI_API_KEY: "sk-oai",
  INTERNAL_TOKEN: "tok",
  LOGIN_OAUTH_CLIENT_ID: "id",
  LOGIN_OAUTH_CLIENT_SECRET: "secret",
});

test("vendored required-secret list is exactly provisioning's REQUIRED_SECRETS (no drift)", () => {
  // The health gate must check precisely the secrets provisioning promises to set — Rule 0. This
  // test crosses the package boundary (it runs locally, never on Railway) to catch vendored drift.
  assert.deepEqual([...REQUIRED_SECRETS], [...PROVISIONING_SECRETS], "vendored manifest drifted from provisioning");
  assert.deepEqual(missingSecrets(fullEnv()), [], "a full env has no missing secrets");
});

test("a missing secret ⇒ NOT ok, names the gap, skips the DB probe", async () => {
  const env = fullEnv();
  delete env.OPENAI_API_KEY;
  env.ANTHROPIC_API_KEY = "  "; // whitespace counts as missing
  const h = await checkHealth(env);
  assert.equal(h.ok, false);
  assert.deepEqual(h.missingSecrets.sort(), ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"]);
  assert.equal(h.supabaseReachable, null, "DB not probed while secrets are missing");
});

test("all secrets present + reachable Supabase ⇒ ok", async () => {
  const fakeFetch = (async () => ({ status: 200 })) as unknown as typeof fetch;
  assert.equal(await probeSupabase(fullEnv(), fakeFetch), true);

  const h = await checkHealth(fullEnv(), fakeFetch);
  assert.equal(h.ok, true);
  assert.equal(h.detail, "ready");
});

test("all secrets present but Supabase unreachable ⇒ NOT ok (503 posture)", async () => {
  const throwingFetch = (async () => {
    throw new Error("ECONNREFUSED");
  }) as unknown as typeof fetch;
  const h = await checkHealth(fullEnv(), throwingFetch);
  assert.equal(h.ok, false);
  assert.equal(h.supabaseReachable, false);
});

test("a 5xx from Supabase counts as unreachable", async () => {
  const fiveHundred = (async () => ({ status: 503 })) as unknown as typeof fetch;
  assert.equal(await probeSupabase(fullEnv(), fiveHundred), false);
});

// OD-195: a present-but-INVALID service_role key (rotated/typo/wrong project) makes PostgREST answer 401/403.
// That must FAIL the health gate — otherwise a half-configured silo deploys green and takes production traffic
// against a DB layer it cannot read/write (#2/#3). A 404 (wrong URL path) likewise fails.
test("a 401/403 (invalid service_role key) ⇒ probeSupabase false ⇒ checkHealth NOT ok (OD-195)", async () => {
  for (const status of [401, 403, 404]) {
    const badKey = (async () => ({ status })) as unknown as typeof fetch;
    assert.equal(await probeSupabase(fullEnv(), badKey), false, `status ${status} must be unreachable`);
    const h = await checkHealth(fullEnv(), badKey);
    assert.equal(h.ok, false, `status ${status} must make checkHealth not ok`);
    assert.equal(h.supabaseReachable, false, `status ${status} must report supabaseReachable false`);
  }
});

// A 3xx (e.g. a redirect on the PostgREST root) still counts as reachable — the host answered below the auth wall.
test("a 2xx/3xx from Supabase counts as reachable (OD-195 boundary)", async () => {
  for (const status of [200, 204, 301, 302]) {
    const ok = (async () => ({ status })) as unknown as typeof fetch;
    assert.equal(await probeSupabase(fullEnv(), ok), true, `status ${status} must be reachable`);
  }
});
