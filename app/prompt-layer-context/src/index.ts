// @harness/prompt-layer-context — ISSUE-044 (C4 BIZ/TSK). Public surface: the Layer-2 business-context +
// Layer-4 task-instruction CONTENT contracts (context.ts), the operator-editable dynamic_field_values store
// + the version-disciplined content store ports + in-memory fakes (store.ts), the Layer-2 assembly facade
// (business-context.ts), and the live pg adapters (supabase-store.ts). ISSUE-053 (assembly) consumes this
// store; that is the seam this slice stops at.
//
// The default export path also exposes a `check` CLI (offline build-time gate, no DB) — see runCheck().

export {
  BUSINESS_FIELDS,
  Layer2Classification,
  instantiateTemplate,
  isBusinessField,
  resolveDynamicField,
  templateSlots,
  validateLayer4,
  type BusinessField,
  type DynamicFieldState,
  type DynamicFieldValue,
  type FieldClass,
  type Layer4Task,
  type Layer4Validation,
  type ResolvedDynamicField,
  type TaskTemplate,
} from './context.ts';

export {
  InMemoryContentStore,
  InMemoryDynamicFieldStore,
  isContentLayer,
  type ContentAssetKey,
  type ContentEditInput,
  type ContentLayer,
  type ContentLayerRow,
  type ContentStore,
  type DynamicFieldStore,
  type NewContentInput,
} from './store.ts';

export {
  BUSINESS_LAYER_NAME,
  BusinessContextService,
  type AssembledLayer2,
  type BusinessContextDeps,
} from './business-context.ts';

export {
  SupabaseContentStore,
  SupabaseDynamicFieldStore,
} from './supabase-store.ts';

// ── `check` — offline build-time gate (no DB, no network) ────────────────────────────────────────
// This slice ships NO migration: dynamic_field_values + prompt_layers are ISSUE-042's. The gate therefore
// VERIFIES-PRESENT the existing schema shapes this slice's adapters are authored to (Rule 0: the migrations
// are the built reality). If either drifts, the build fails LOUD rather than shipping an adapter that
// assumes a shape the DB does not have (#3). It also asserts this slice added NO migration of its own.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SILO_MIGRATIONS = join(HERE, '..', '..', 'silo', 'migrations');

interface Finding {
  gate: string;
  message: string;
}

export function runCheck(migrationsDir: string = SILO_MIGRATIONS): Finding[] {
  const findings: Finding[] = [];
  const read = (f: string): string | null => {
    try {
      return readFileSync(join(migrationsDir, f), 'utf8');
    } catch {
      return null;
    }
  };

  const baseline = read('0001_baseline.sql');
  if (baseline === null) {
    findings.push({ gate: 'baseline-present', message: `0001_baseline.sql not found in ${migrationsDir}` });
  } else {
    // (1) dynamic_field_values exists with the (field_name pk, field_value, last_updated) shape this slice
    //     reads/writes — schema §5. This slice OWNS the value semantics; ISSUE-042 owns the DDL.
    const dfvStart = baseline.indexOf('create table dynamic_field_values');
    if (dfvStart < 0) {
      findings.push({ gate: 'dfv-present', message: 'dynamic_field_values table not found in 0001_baseline.sql (owned by ISSUE-042 — this slice writes rows to it)' });
    } else {
      const dfvBlock = baseline.slice(dfvStart, baseline.indexOf(');', dfvStart) + 2);
      const dfvNeed: [RegExp, string][] = [
        [/field_name\s+text\s+primary key/i, 'dynamic_field_values.field_name text PRIMARY KEY'],
        [/field_value\s+text/i, 'dynamic_field_values.field_value text'],
        [/last_updated\s+timestamptz\s+not null/i, 'dynamic_field_values.last_updated timestamptz NOT NULL'],
      ];
      for (const [re, label] of dfvNeed) {
        if (!re.test(dfvBlock)) findings.push({ gate: 'dfv-shape', message: `expected ${label} — not found in dynamic_field_values` });
      }
    }

    // (2) prompt_layers carries the enum value 'task_template' this slice writes, and the change_reason
    //     NOT NULL discipline FR-4.TSK.003 inherits. (The full prompt_layers gate is ISSUE-042's.)
    if (!/create type prompt_layer_kind\s+as enum\s*\([^)]*'task_template'[^)]*\)/i.test(baseline)) {
      findings.push({ gate: 'enum-task-template', message: "prompt_layer_kind enum must include 'task_template' (FR-4.TSK.002) — not found" });
    }
    if (!/create type prompt_layer_kind\s+as enum\s*\([^)]*'business'[^)]*\)/i.test(baseline)) {
      findings.push({ gate: 'enum-business', message: "prompt_layer_kind enum must include 'business' (FR-4.BIZ.001) — not found" });
    }
    const plStart = baseline.indexOf('create table prompt_layers');
    if (plStart >= 0) {
      const plBlock = baseline.slice(plStart, baseline.indexOf(');', plStart) + 2);
      if (!/change_reason\s+text not null/i.test(plBlock)) {
        findings.push({ gate: 'change-reason', message: 'prompt_layers.change_reason text NOT NULL (FR-4.TSK.003 inherits) — not found' });
      }
    } else {
      findings.push({ gate: 'prompt-layers-present', message: 'prompt_layers table not found in 0001_baseline.sql (owned by ISSUE-042)' });
    }
  }

  // (3) This slice must NOT ship a migration of its own (HARD PROHIBITION — fan-out isolation). Assert no
  //     0044_* migration file exists (a stray one is corruption of the shared migration corpus).
  try {
    const stray = readdirSync(migrationsDir).filter((f) => /^0044[_-]/.test(f) || /prompt_layer_context/i.test(f));
    if (stray.length > 0) {
      findings.push({ gate: 'no-own-migration', message: `ISSUE-044 ships NO migration but found: ${stray.join(', ')}` });
    }
  } catch {
    /* migrations dir unreadable — the baseline gate above already reports the real problem */
  }

  if (findings.length === 0) {
    console.log('✓ prompt-layer-context check: dynamic_field_values + prompt_layers (business|task_template) baseline shapes present · no own migration shipped.');
  } else {
    console.error(`✗ prompt-layer-context check: ${findings.length} finding(s):`);
    for (const f of findings) console.error(`  [${f.gate}] ${f.message}`);
  }
  return findings;
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? 'check';
  if (cmd === 'check') {
    process.exit(runCheck().length === 0 ? 0 : 1);
  }
  console.error(`unknown command '${cmd}' — use: check`);
  process.exit(2);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
