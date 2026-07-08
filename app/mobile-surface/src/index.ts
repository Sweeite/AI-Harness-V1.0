// ISSUE-079 — @harness/mobile-surface public surface + the `check` command. `check` is a no-DB, CI-safe
// non-drift guard: the mobile chrome hard-codes three things that MUST equal live silo constants, and a silent
// drift in any of them is a #3 failure the mobile surface exists to prevent:
//   1. the two Realtime surfaces (Approvals=task_queue, Alerts=notifications) MUST equal EXACTLY the tables in
//      the 0023 supabase_realtime publication — if a third table were published (a third socket) or one of
//      these were dropped, the two-Realtime cap (FR-7.RTP.001 / AC-7.RTP.001.3) would be silently violated.
//   2. the answer-mode pill values MUST equal the live `answer_mode` enum (0001 baseline) — a drift would make
//      the pill render a value the DB never stores, or miss one it does (AC-7.VIEW.002.2).
//   3. the non-suppressible alert types MUST be a subset of the live `alert_type` enum — a typo'd
//      'hard_limit_hit' would silently make the "non-suppressible" guarantee unreachable (AC-7.ALR.002.2).
// Plus internal-consistency guards on the push classes, the degraded-capability catalog, and the a11y tokens.
// Run: `tsx src/index.ts check`.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { REALTIME_SURFACES } from "./connection.ts";
import { ANSWER_MODE_VALUES } from "./pill.ts";
import { NON_SUPPRESSIBLE_ALERT_TYPES } from "./alerts.ts";
import { PUSH_CLASSES, NON_SUPPRESSIBLE_CLASSES } from "./push.ts";
import { DEGRADED_CAPABILITIES } from "./degradation.ts";
import { allStatusesLabelled } from "./a11y.ts";

// ── Public exports ──────────────────────────────────────────────────────────────────────────────
export * from "./store.ts";
export * from "./push.ts";
export * from "./connection.ts";
export * from "./freshness.ts";
export * from "./pill.ts";
export * from "./commands.ts";
export * from "./approvals.ts";
export * from "./suggestions.ts";
export * from "./degradation.ts";
export * from "./alerts.ts";
export * from "./a11y.ts";
export { SupabaseMobileSurfaceStore } from "./supabase-store.ts";

// ── check ─────────────────────────────────────────────────────────────────────────────────────
const BASELINE = "0001_baseline.sql";
const PUBLICATION_MIGRATION = "0023_realtime_publication.sql";

function migrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "silo", "migrations");
}

/** Extract a `create type <name> as enum ( 'a','b',... )` value set from the baseline. */
function baselineEnum(name: string): Set<string> {
  const sql = readFileSync(join(migrationsDir(), BASELINE), "utf8");
  const re = new RegExp(`create\\s+type\\s+${name}\\s+as\\s+enum\\s*\\(([\\s\\S]*?)\\)\\s*;`, "i");
  const m = sql.match(re);
  if (!m) throw new Error(`${BASELINE}: could not locate the ${name} enum`);
  return new Set([...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!));
}

/** Extract the tables added to the supabase_realtime publication in 0023. */
function publicationTables(): Set<string> {
  const sql = readFileSync(join(migrationsDir(), PUBLICATION_MIGRATION), "utf8");
  const tables = [...sql.matchAll(/add\s+table\s+public\.(\w+)/gi)].map((x) => x[1]!);
  if (tables.length === 0) throw new Error(`${PUBLICATION_MIGRATION}: found no 'add table public.<t>' statements`);
  return new Set(tables);
}

function fail(msg: string): never {
  console.error(`✗ mobile-surface check: ${msg}`);
  process.exit(1);
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((x) => b.has(x));
}

export function check(): void {
  // 1. the two Realtime surfaces ≡ EXACTLY the 0023 publication tables (two-socket cap, AC-7.RTP.001.3).
  const declaredRealtime = new Set(REALTIME_SURFACES.map((r) => r.table));
  const publication = publicationTables();
  if (!sameSet(declaredRealtime, publication)) {
    fail(
      `the two Realtime surfaces drifted from the 0023 supabase_realtime publication.\n` +
        `  declared: ${JSON.stringify([...declaredRealtime])}\n` +
        `  0023:     ${JSON.stringify([...publication])}\n` +
        `A mismatch means either a third Realtime socket (cap breach, AC-7.RTP.001.3) or a mobile surface that ` +
        `subscribes to a table not in the publication (a silent freeze reported as 'live' — the 0023 bug, #3).`,
    );
  }

  // 2. the pill values ≡ the live answer_mode enum (AC-7.VIEW.002.2).
  const pillValues = new Set<string>(ANSWER_MODE_VALUES);
  const answerModeEnum = baselineEnum("answer_mode");
  if (!sameSet(pillValues, answerModeEnum)) {
    fail(
      `ANSWER_MODE_VALUES drifted from the live answer_mode enum.\n` +
        `  pill: ${JSON.stringify([...pillValues])}\n  enum: ${JSON.stringify([...answerModeEnum])}`,
    );
  }

  // 3. the non-suppressible alert types ⊆ the live alert_type enum (AC-7.ALR.002.2).
  const alertTypeEnum = baselineEnum("alert_type");
  for (const t of NON_SUPPRESSIBLE_ALERT_TYPES) {
    if (!alertTypeEnum.has(t)) {
      fail(`non-suppressible alert type '${t}' is absent from the live alert_type enum — the non-suppressible guarantee (AC-7.ALR.002.2) is unreachable (#3).`);
    }
  }

  // 4. push classes: duplicate-free, and the non-suppressible set ⊆ the class set.
  if (new Set(PUSH_CLASSES).size !== PUSH_CLASSES.length) fail("PUSH_CLASSES has duplicates");
  for (const c of NON_SUPPRESSIBLE_CLASSES) {
    if (!(PUSH_CLASSES as readonly string[]).includes(c)) fail(`non-suppressible push class '${c}' is not a declared PUSH_CLASS`);
  }

  // 5. degraded-capability catalog: unique capabilities, each names a non-empty desktop surface (OD-152).
  const caps = DEGRADED_CAPABILITIES.map((d) => d.capability);
  if (new Set(caps).size !== caps.length) fail("DEGRADED_CAPABILITIES has duplicate capabilities");
  for (const d of DEGRADED_CAPABILITIES) {
    if (d.surface.trim().length === 0) fail(`degraded capability '${d.capability}' has no desktop surface — a notice would point nowhere (#3)`);
  }

  // 6. a11y: every status carries a non-colour label + shape (AC-NFR-A11Y.001.2).
  if (!allStatusesLabelled()) fail("an a11y status token is missing its label/shape — a status would be colour-only");

  console.log(
    `✓ mobile-surface check: two Realtime surfaces ≡ 0023 publication (${[...publication].sort().join(", ")}); ` +
      `pill ≡ answer_mode enum (${ANSWER_MODE_VALUES.length}); non-suppressible alerts ⊆ alert_type enum; ` +
      `${PUSH_CLASSES.length} push classes (${NON_SUPPRESSIBLE_CLASSES.length} non-suppressible); ` +
      `${DEGRADED_CAPABILITIES.length} degraded capabilities; a11y statuses all labelled (no colour-only state).`,
  );
}

if (process.argv[2] === "check") check();
