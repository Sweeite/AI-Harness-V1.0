// @harness/maturity — ISSUE-030 (C2 MAT), the ADR-002 metrics spine. Public surface: the expected-slots config +
// gap-seed (slots.ts), per-entity + aggregate Maturity (maturity.ts), the recompute orchestration over the port
// (recompute.ts), the one-time cold-start ONE-WAY LATCH (coldstart.ts), query-time Retrieval Sufficiency → the
// [Building] flag (sufficiency.ts), the MaturityStore port + in-memory reference fake (store.ts), and the live pg
// adapter (supabase-store.ts). Consumed by ISSUE-071 (cold-start ladder reads the mode/threshold signal) + C8
// (renders the Sufficiency verdict / [Building] pill) + ingestion (reads emptySlots for gap-questions).
//
// The default export path also exposes a `check` CLI (offline build-time gate, no DB) — see runCheck().

export * from './slots.ts';
export * from './maturity.ts';
export * from './coldstart.ts';
export * from './sufficiency.ts';
export * from './recompute.ts';
export * from './store.ts';
export {
  SupabaseMaturityStore,
  EVT_MATURITY_RECOMPUTED,
  MATURITY_EVENT_TYPES,
  COLD_START_LATCH_KEY,
} from './supabase-store.ts';

// ── `check` — offline build-time non-drift gate (no DB, no network) ─────────────────────────────────────────
// entities.maturity + maturity_updated_at already ship in the 0001 baseline (this slice is VERIFY-PRESENT for the
// columns — it POPULATES them, cf. ISSUE-022/023). The check asserts — against the repo (Rule 0) — that the shape
// THIS slice's adapter relies on is true:
//   1. entities carries `maturity numeric(4,3)` + `maturity_updated_at timestamptz` (the stored Maturity + stamp).
//   2. the five CFG rows this slice reads are LIVE-class in config-registry.md: expected_slots, the three
//      cold_start_{basic,proactive,full}_threshold gates, and retrieval_sufficiency_threshold — the knobs
//      loadConfig() reads; a drift (missing row / wrong edit class) means the live loadConfig would read a
//      different contract than the one the fake tested against.
//   3. the additive `maturity_recomputed` event_type value exists somewhere in the migration corpus — else the live
//      emitRecomputed() INSERT throws '22P02 invalid input value for enum event_type'. This is the ONE row this
//      slice cannot self-register (the orchestrator owns the migration + the baseline enum) — so until that
//      additive migration lands this gate reports exactly one finding (gate 'event_type-value'), the expected
//      residual carried in the manifest. That fake-passes-offline / live-throws class is precisely what R10 + this
//      gate catch; it does not block the offline AC suite (which uses the in-memory fake).
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { EVT_MATURITY_RECOMPUTED } from './supabase-store.ts';
import { SLOTS_MIN, SLOTS_MAX } from './slots.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SILO_MIGRATIONS = join(HERE, '..', '..', 'silo', 'migrations');
const CONFIG_REGISTRY = join(HERE, '..', '..', '..', 'spec', '02-config', 'config-registry.md');

export interface Finding {
  gate: string;
  message: string;
}

/** The five CFG rows loadConfig() reads — all LIVE-class per config-registry.md §E/§L + Appendix A #2. */
export const REQUIRED_CFG_KEYS: readonly string[] = [
  'expected_slots',
  'cold_start_basic_threshold',
  'cold_start_proactive_threshold',
  'cold_start_full_threshold',
  'retrieval_sufficiency_threshold',
];

function readOr(path: string, findings: Finding[], gate: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    findings.push({ gate, message: `${path} not found` });
    return null;
  }
}

export function runCheck(migrationsDir: string = SILO_MIGRATIONS, configRegistry: string = CONFIG_REGISTRY): Finding[] {
  const findings: Finding[] = [];

  // 1. the entities Maturity columns (baseline; verify-present).
  const baseline = readOr(join(migrationsDir, '0001_baseline.sql'), findings, 'baseline-present');
  if (baseline) {
    // Slice to the statement terminator `);` at line-start — NOT the first inline `);`, which a column comment
    // can contain (e.g. `maturity … (ADR-002); stored …`) and would truncate the table body before the last column.
    const start = baseline.indexOf('create table entities');
    const end = start < 0 ? -1 : baseline.indexOf('\n);', start);
    const entities = start < 0 || end < 0 ? '' : baseline.slice(start, end + 3);
    if (!entities) {
      findings.push({ gate: 'entities-present', message: 'create table entities not found in 0001_baseline.sql (verify-present)' });
    } else {
      const need: [RegExp, string][] = [
        [/maturity\s+numeric\(4,\s*3\)/, 'entities.maturity numeric(4,3) — the stored per-entity Maturity (setMaturity target)'],
        [/maturity_updated_at\s+timestamptz/, 'entities.maturity_updated_at timestamptz — the recompute stamp'],
      ];
      for (const [re, label] of need) if (!re.test(entities)) findings.push({ gate: 'entities-maturity-cols', message: `expected ${label} — not found` });
    }
  }

  // 2. the five CFG rows this slice reads are present + LIVE-class in the config registry (Rule 0 source of truth).
  const cfg = readOr(configRegistry, findings, 'config-registry-present');
  if (cfg) {
    const lines = cfg.split('\n');
    for (const key of REQUIRED_CFG_KEYS) {
      const row = lines.find((l) => new RegExp('`' + key + '`').test(l)) ?? '';
      if (!row) {
        findings.push({ gate: 'cfg-key', message: `CFG-${key} row not found in config-registry.md — loadConfig() reads it` });
      } else if (!/\bLIVE\b/.test(row)) {
        findings.push({ gate: 'cfg-key-class', message: `CFG-${key} must be LIVE-class (a runtime-tunable Maturity/gating knob)` });
      }
    }
    // The ADR-002 §1 slot-count bound the validator enforces must match what the registry documents (5–8 per type).
    const slotsRow = lines.find((l) => /`expected_slots`/.test(l)) ?? '';
    const appA = cfg.slice(cfg.indexOf('`expected_slots`', cfg.indexOf('Appendix A')));
    const boundText = `${slotsRow}\n${appA.slice(0, 200)}`;
    if (!new RegExp(`${SLOTS_MIN}\\s*[–\\-≤].*?${SLOTS_MAX}|${SLOTS_MIN}[–-]${SLOTS_MAX}`).test(boundText)) {
      findings.push({ gate: 'cfg-expected_slots-bound', message: `expected_slots must document the ${SLOTS_MIN}–${SLOTS_MAX}-per-type bound the slot validator enforces (ADR-002 §1)` });
    }
  }

  // 3. the additive maturity_recomputed event_type value exists in the migration corpus (any file — the orchestrator
  //    assigns the migration tag). Scans every .sql so a rename of the additive file does not falsely trip this.
  let corpus = baseline ?? '';
  try {
    for (const f of readdirSync(migrationsDir)) {
      if (f.endsWith('.sql') && f !== '0001_baseline.sql') corpus += '\n' + readFileSync(join(migrationsDir, f), 'utf8');
    }
  } catch {
    /* migrationsDir already reported absent above */
  }
  const inBaselineEnum = new RegExp(`create type event_type[\\s\\S]*?'${EVT_MATURITY_RECOMPUTED}'[\\s\\S]*?\\);`).test(baseline ?? '');
  const addedAdditively = new RegExp(`add value if not exists '${EVT_MATURITY_RECOMPUTED}'`).test(corpus);
  if (!inBaselineEnum && !addedAdditively) {
    findings.push({
      gate: 'event_type-value',
      message: `event_type '${EVT_MATURITY_RECOMPUTED}' is not in the baseline enum nor added by any migration — the live emitRecomputed() INSERT would throw 22P02 (author the additive ALTER TYPE — see the manifest)`,
    });
  }

  report(findings);
  return findings;
}

function report(findings: Finding[]): void {
  if (findings.length === 0) {
    console.log(
      `✓ maturity check: entities.maturity numeric(4,3)+maturity_updated_at present · ${REQUIRED_CFG_KEYS.length} CFG rows LIVE ` +
        `(expected_slots ${SLOTS_MIN}–${SLOTS_MAX}/type, cold_start basic/proactive/full, retrieval_sufficiency_threshold) · ` +
        `event_type '${EVT_MATURITY_RECOMPUTED}' present.`,
    );
  } else {
    console.error(`✗ maturity check: ${findings.length} finding(s):`);
    for (const f of findings) console.error(`  [${f.gate}] ${f.message}`);
  }
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
