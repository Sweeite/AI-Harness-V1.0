// ISSUE-020 — @harness/rls-enforcement public surface + the `check` command. `check` is a no-DB, CI-safe
// non-drift guard: the two event_type constants the harness WRITES (authz_revoked_midtask,
// rls_harness_divergence) must exist in the live silo's event_type enum (0001 baseline, added per OD-170).
// If a constant were renamed/typo'd, the harness would emit an enum value the DB rejects — a mid-task stop
// or a divergence signal that throws instead of logging = a silent-failure of the very signal meant to make
// a failure loud (#3). Run: `tsx src/index.ts check`.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { EVT_AUTHZ_REVOKED_MIDTASK, EVT_RLS_HARNESS_DIVERGENCE } from "./store.ts";

// ── Public exports ──────────────────────────────────────────────────────────────────────────────
export * from "./store.ts";
export * from "./recheck.ts";
export * from "./divergence.ts";
export { SupabaseRlsEnforcementStore } from "./supabase-store.ts";

// ── check ─────────────────────────────────────────────────────────────────────────────────────
const BASELINE = "0001_baseline.sql";

/** Extract the event_type enum's value set from the 0001 baseline `create type event_type as enum (...)`. */
function baselineEventTypes(): Set<string> {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(here, "..", "..", "silo", "migrations", BASELINE);
  const sql = readFileSync(path, "utf8");
  const m = sql.match(/create\s+type\s+event_type\s+as\s+enum\s*\(([\s\S]*?)\)\s*;/i);
  if (!m) throw new Error(`${BASELINE}: could not locate the event_type enum`);
  return new Set([...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!));
}

function fail(msg: string): never {
  console.error(`✗ rls-enforcement check: ${msg}`);
  process.exit(1);
}

export function check(): void {
  const enumValues = baselineEventTypes();
  for (const c of [EVT_AUTHZ_REVOKED_MIDTASK, EVT_RLS_HARNESS_DIVERGENCE]) {
    if (!enumValues.has(c)) {
      fail(`event_type constant '${c}' is absent from the ${BASELINE} event_type enum (OD-170) — the harness would write a value the DB rejects (#3). Add it via an ALTER TYPE migration or fix the constant.`);
    }
  }
  console.log(
    `✓ rls-enforcement check: both mid-task/divergence event_type constants ('${EVT_AUTHZ_REVOKED_MIDTASK}', '${EVT_RLS_HARNESS_DIVERGENCE}') are present in the live event_type enum (no drift).`,
  );
}

if (process.argv[2] === "check") check();
