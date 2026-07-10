// @harness/ingestion — ISSUE-026 (C2 ING). Public surface: the two filters (filters.ts), the single-candidate
// ingestion core (ingest.ts), the human review queue (queue.ts), the three pipelines (pipelines.ts), the ordered init
// sequence + verification pass (init.ts), the config contract (config.ts), the IngestionStore port + in-memory
// reference fake + the no-backdoor sole-writer gate (store.ts), and the live pg adapter (supabase-store.ts).
// Consumed by the surface-03 Ingestion tab (ISSUE-031 renders it) and the onboarding surface; hands Includes + every
// pipeline store to the ISSUE-024 sole writer (never a direct insert — FR-2.ING.010).
//
// The default export path also exposes a `check` CLI (offline build-time non-drift gate, no DB) — see runCheck().

export * from './config.ts';
export * from './filters.ts';
export * from './store.ts';
export * from './queue.ts';
export * from './ingest.ts';
export * from './pipelines.ts';
export * from './init.ts';
export { SupabaseIngestionStore, EVT_INGESTION_FILTERED, EVT_QUEUE_STALE, AUDIT_INGESTION_DECISION } from './supabase-store.ts';

// ── `check` — offline build-time non-drift gate (no DB, no network) ─────────────────────────────────────────────
// The ingestion_queue table + the ingestion_state enum + the sensitivity_tier vocabulary all pre-exist in the 0001
// baseline, so the check is VERIFY-PRESENT against the repo (Rule 0): it asserts the shape THIS slice's contract
// relies on is true so a drift is caught offline (a #3 silent divergence), never only live:
//   1. every CFG row this slice reads is present + the right edit-class (4 LIVE + hr_content_enabled BOOT).
//   2. the ingestion_state enum carries {pending,deferred,included,excluded,shadow_dropped} (the queue state machine).
//   3. ingestion_queue carries the columns this slice reads/writes (verify-present; an absence is an ISSUE-008 gap).
//   4. the sensitivity_tier enum carries {standard,confidential,personal,restricted} (the suggested_tier vocabulary).
//   5. the escalation event_type 'approval_queue_stale' pre-exists (the live escalation write reuses it — no 22P02).
// NOTE (reported as a pending additive migration, NOT gated here so the check stays green): the live adapter also
// writes event_type 'ingestion_filtered' for Filter-1/2 decisions + the sampled-drop audit run — that value is NOT in
// the baseline enum yet; it is authored+applied serially by the orchestrator before the R10 smoke (the offline fake
// needs no enum, so the offline suite is unaffected).

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { REQUIRED_LIVE_CFG_KEYS, REQUIRED_BOOT_CFG_KEYS } from './config.ts';
import { EVT_QUEUE_STALE } from './supabase-store.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SILO_MIGRATIONS = join(HERE, '..', '..', 'silo', 'migrations');
const CONFIG_REGISTRY = join(HERE, '..', '..', '..', 'spec', '02-config', 'config-registry.md');

const INGESTION_STATE_VALUES = ['pending', 'deferred', 'included', 'excluded', 'shadow_dropped'] as const;
const SENSITIVITY_VALUES = ['standard', 'confidential', 'personal', 'restricted'] as const;
/** ingestion_queue columns this slice reads/writes (verify-present against the baseline DDL). */
const QUEUE_COLUMNS = [
  'content',
  'source_ref',
  'flag_reason',
  'suggested_tier',
  'target_entity_id',
  'state',
  'deferred_until',
  'reviewed_by',
  'reviewed_at',
  'decision_reason',
  'created_at',
] as const;

export interface Finding {
  gate: string;
  message: string;
}

function readOr(path: string, findings: Finding[], gate: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    findings.push({ gate, message: `${path} not found` });
    return null;
  }
}

function enumValues(sql: string, typeName: string): Set<string> | null {
  const m = sql.match(new RegExp(`create\\s+type\\s+${typeName}\\s+as\\s+enum\\s*\\(([\\s\\S]*?)\\)\\s*;`, 'i'));
  if (!m) return null;
  return new Set([...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!));
}

export function runCheck(migrationsDir: string = SILO_MIGRATIONS, configRegistry: string = CONFIG_REGISTRY): Finding[] {
  const findings: Finding[] = [];

  // 1. CFG rows present + edit-class (4 LIVE + hr_content_enabled BOOT).
  const cfg = readOr(configRegistry, findings, 'config-registry-present');
  if (cfg) {
    const lines = cfg.split('\n');
    const rowFor = (key: string) => lines.find((l) => new RegExp('^\\|\\s*`' + key + '`\\s*\\|').test(l));
    for (const key of REQUIRED_LIVE_CFG_KEYS) {
      const row = rowFor(key);
      if (!row) findings.push({ gate: 'cfg-present', message: `CFG row \`${key}\` not found in config-registry.md` });
      else if (!/\bLIVE\b/.test(row)) findings.push({ gate: 'cfg-class', message: `CFG \`${key}\` must be LIVE-class` });
    }
    for (const key of REQUIRED_BOOT_CFG_KEYS) {
      const row = rowFor(key);
      if (!row) findings.push({ gate: 'cfg-present', message: `CFG row \`${key}\` not found in config-registry.md` });
      else if (!/\bBOOT\b/.test(row)) findings.push({ gate: 'cfg-class', message: `CFG \`${key}\` must be BOOT-class (legal-review gate — NFR-CMP.010)` });
      else if (!/\bfalse\b/i.test(row)) findings.push({ gate: 'cfg-default', message: `CFG \`${key}\` default must be false (HR off at boot — AC-NFR-CMP.010.1)` });
    }
  }

  // 2 + 4 + 5. the baseline enums + the escalation event_type.
  const baseline = readOr(join(migrationsDir, '0001_baseline.sql'), findings, 'baseline-present');
  if (baseline) {
    const checkEnum = (typeName: string, expected: readonly string[], gate: string) => {
      const vals = enumValues(baseline, typeName);
      if (!vals) {
        findings.push({ gate, message: `enum ${typeName} not found in 0001_baseline.sql` });
        return;
      }
      for (const e of expected) if (!vals.has(e)) findings.push({ gate, message: `enum ${typeName} is missing '${e}'` });
    };
    checkEnum('ingestion_state', INGESTION_STATE_VALUES, 'ingestion-state-enum');
    checkEnum('sensitivity_tier', SENSITIVITY_VALUES, 'sensitivity-enum');

    const eventTypes = enumValues(baseline, 'event_type');
    if (!eventTypes) findings.push({ gate: 'event_type-enum', message: 'event_type enum not found in 0001_baseline.sql' });
    else if (!eventTypes.has(EVT_QUEUE_STALE)) {
      findings.push({ gate: 'event_type-value', message: `event_type '${EVT_QUEUE_STALE}' not in the baseline enum — the live escalation insert would throw 22P02` });
    }

    // 3. ingestion_queue columns (verify-present).
    const start = baseline.indexOf('create table ingestion_queue');
    const table = start < 0 ? '' : baseline.slice(start, baseline.indexOf(');', start) + 2);
    if (!table) {
      findings.push({ gate: 'ingestion_queue-present', message: 'create table ingestion_queue not found in 0001_baseline.sql (verify-present)' });
    } else {
      for (const col of QUEUE_COLUMNS) {
        if (!new RegExp('\\b' + col + '\\b').test(table)) {
          findings.push({ gate: 'ingestion_queue-columns', message: `ingestion_queue is missing column '${col}' (ISSUE-008 gap)` });
        }
      }
    }
  }

  report(findings);
  return findings;
}

function report(findings: Finding[]): void {
  if (findings.length === 0) {
    console.log(
      `✓ ingestion check: ${REQUIRED_LIVE_CFG_KEYS.length} LIVE + ${REQUIRED_BOOT_CFG_KEYS.length} BOOT CFG rows present · ` +
        `ingestion_state enum carries ${INGESTION_STATE_VALUES.join('/')} · ingestion_queue columns present · ` +
        `sensitivity_tier vocabulary matches Filter 2 · event_type '${EVT_QUEUE_STALE}' present ` +
        `(escalation reuse; 'ingestion_filtered' is a pending additive migration — offline fake unaffected).`,
    );
  } else {
    console.error(`✗ ingestion check: ${findings.length} finding(s):`);
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
