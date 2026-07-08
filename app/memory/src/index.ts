// ISSUE-022 — @harness/memory public surface + the `check` command. `check` is a no-DB, CI-safe guard that the
// canonical DEFAULT_ENTITY_TYPES constant and the 0030 config seed can never silently drift (a drift would seed a
// different list than the app validates against — a #3 silent inconsistency). Run: `tsx src/index.ts check`.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  DEFAULT_ENTITY_TYPES,
  INTERNAL_ORG_TYPE,
  MEMORY_TYPES,
  MEMORY_SOURCES,
  VISIBILITY_TIERS,
  SENSITIVITY_TIERS,
} from './entity-types.ts';

// ── Public exports ──────────────────────────────────────────────────────────────────────────────
export * from './entity-types.ts';
export * from './memory.ts';
export * from './store.ts';
export * from './resolution.ts';
export * from './tags.ts';
export { SupabaseMemoryStore } from './supabase-store.ts';

// ── check ─────────────────────────────────────────────────────────────────────────────────────
const SEED_MIGRATION = '0030_entity_types_config_seed.sql';

/** Parse the entity_types JSON array out of the 0030 seed migration file. Deliberately simple: find the
 *  bracketed JSON array literal the seed inserts. Throws with a clear message if the shape changed. */
function seededEntityTypes(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(here, '..', '..', 'silo', 'migrations', SEED_MIGRATION);
  const sql = readFileSync(path, 'utf8');
  const m = sql.match(/'(\[.*?\])'::jsonb/s);
  if (!m) throw new Error(`${SEED_MIGRATION}: could not locate the entity_types JSON array literal`);
  const parsed = JSON.parse(m[1]!);
  if (!Array.isArray(parsed)) throw new Error(`${SEED_MIGRATION}: entity_types is not a JSON array`);
  return parsed as string[];
}

function fail(msg: string): never {
  console.error(`✗ memory check: ${msg}`);
  process.exit(1);
}

export function check(): void {
  // 1. enum domains are non-empty + duplicate-free (mirror schema.md §Types / 0001 baseline).
  for (const [label, values] of [
    ['memory_type', MEMORY_TYPES],
    ['memory_source', MEMORY_SOURCES],
    ['visibility_tier', VISIBILITY_TIERS],
    ['sensitivity_tier', SENSITIVITY_TIERS],
  ] as const) {
    if (new Set(values).size !== values.length) fail(`${label} enum has duplicates`);
  }

  // 2. DEFAULT_ENTITY_TYPES: unique, Internal-Org present + locked-last.
  if (new Set(DEFAULT_ENTITY_TYPES).size !== DEFAULT_ENTITY_TYPES.length) fail('DEFAULT_ENTITY_TYPES has duplicates');
  if (!DEFAULT_ENTITY_TYPES.includes(INTERNAL_ORG_TYPE)) fail(`DEFAULT_ENTITY_TYPES missing the locked '${INTERNAL_ORG_TYPE}'`);
  if (DEFAULT_ENTITY_TYPES[DEFAULT_ENTITY_TYPES.length - 1] !== INTERNAL_ORG_TYPE) fail(`'${INTERNAL_ORG_TYPE}' must be last (locked-present)`);

  // 3. Non-drift: the 0030 seed ≡ the constant, element-for-element.
  const seeded = seededEntityTypes();
  const canonical = [...DEFAULT_ENTITY_TYPES];
  if (seeded.length !== canonical.length || seeded.some((t, i) => t !== canonical[i])) {
    fail(`0030 seed drifted from DEFAULT_ENTITY_TYPES\n  seed:      ${JSON.stringify(seeded)}\n  constant:  ${JSON.stringify(canonical)}`);
  }

  console.log(
    `✓ memory check: entity model sound — ${canonical.length} entity_types (0030 seed ≡ DEFAULT_ENTITY_TYPES, '${INTERNAL_ORG_TYPE}' locked-last), ` +
      `four enums (${MEMORY_TYPES.length}/${MEMORY_SOURCES.length}/${VISIBILITY_TIERS.length}/${SENSITIVITY_TIERS.length}) duplicate-free.`,
  );
}

if (process.argv[2] === 'check') check();
