// ISSUE-021 — @harness/user-mgmt public surface + the `check` command.
//
// `check` is a no-DB, CI-safe non-drift guard. The audit spine writes actor_type values and reasons about
// sensitivity tiers; both sets are constants here that MUST equal the live silo's enums (0001 baseline):
//   • ACTOR_TYPES      ≡ the live actor_type enum      — a drifted value would make appendAudit's
//                        `$3::actor_type` cast THROW, turning an audit write (the #3 loud-failure signal) into a
//                        silent crash of the very thing meant to make a failure loud.
//   • SENSITIVITY_TIERS ≡ the live sensitivity_tier enum — the audit choke point keys "which tiers must be
//                        audited" (Personal/Restricted) off this set; a drifted set would silently mis-classify.
// If either drifts from the baseline, `check` fails LOUD and non-zero. Run: `tsx src/index.ts check`.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ACTOR_TYPES, SENSITIVITY_TIERS } from './store.ts';

// ── public exports ──────────────────────────────────────────────────────────────────────────────────
export * from './store.ts';
export * from './lifecycle.ts';
export { SupabaseUserMgmtStore } from './supabase-store.ts';

// ── check ─────────────────────────────────────────────────────────────────────────────────────────
const BASELINE = '0001_baseline.sql';

/** Extract a named enum's value set from the 0001 baseline `create type <name> as enum (...)`. */
function baselineEnum(name: string): Set<string> {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(here, '..', '..', 'silo', 'migrations', BASELINE);
  const sql = readFileSync(path, 'utf8');
  const re = new RegExp(`create\\s+type\\s+${name}\\s+as\\s+enum\\s*\\(([\\s\\S]*?)\\)\\s*;`, 'i');
  const m = sql.match(re);
  if (!m) throw new Error(`${BASELINE}: could not locate the ${name} enum`);
  return new Set([...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!));
}

function fail(msg: string): never {
  console.error(`✗ user-mgmt check: ${msg}`);
  process.exit(1);
}

/** Assert the TS constant set equals the live enum set exactly (no missing, no extra). */
function assertEqual(label: string, constants: readonly string[], live: Set<string>): void {
  const missing = constants.filter((c) => !live.has(c));
  const extra = [...live].filter((v) => !(constants as readonly string[]).includes(v));
  if (missing.length > 0) {
    fail(`${label}: TS constant(s) [${missing.join(', ')}] absent from the live ${label} enum — the audit writer would emit a value the DB rejects (#3). Fix the constant or ALTER TYPE.`);
  }
  if (extra.length > 0) {
    fail(`${label}: live enum has value(s) [${extra.join(', ')}] the TS constant set omits — the drift must be reconciled so this slice's audit classification stays complete.`);
  }
}

export function check(): void {
  assertEqual('actor_type', ACTOR_TYPES, baselineEnum('actor_type'));
  assertEqual('sensitivity_tier', SENSITIVITY_TIERS, baselineEnum('sensitivity_tier'));
  console.log(
    `✓ user-mgmt check: actor_type {${ACTOR_TYPES.join(', ')}} and sensitivity_tier {${SENSITIVITY_TIERS.join(', ')}} both match the live ${BASELINE} enums (no drift).`,
  );
}

if (process.argv[2] === 'check') check();
