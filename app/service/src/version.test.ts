import { test } from "node:test";
import assert from "node:assert/strict";
import { buildServiceVersionReport } from "./version.ts";

test("buildServiceVersionReport — core_version comes from the Railway-injected commit SHA", () => {
  const r = buildServiceVersionReport({ RAILWAY_GIT_COMMIT_SHA: "abc123", PLUGIN_VERSION: "acme-1.0" } as NodeJS.ProcessEnv);
  assert.equal(r.core_version, "abc123");
  assert.equal(r.plugin_version, "acme-1.0");
  assert.equal(r.last_migrated_at, null);
});

test("buildServiceVersionReport — falls back to CORE_VERSION, then 'unknown'; never blank", () => {
  assert.equal(buildServiceVersionReport({ CORE_VERSION: "v9" } as NodeJS.ProcessEnv).core_version, "v9");
  assert.equal(buildServiceVersionReport({} as NodeJS.ProcessEnv).core_version, "unknown");
  assert.equal(buildServiceVersionReport({ RAILWAY_GIT_COMMIT_SHA: "  " } as NodeJS.ProcessEnv).core_version, "unknown");
});
