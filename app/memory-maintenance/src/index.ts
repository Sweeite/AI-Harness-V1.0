// @harness/memory-maintenance — ISSUE-027 (C2 MNT). Public surface: the config contract (config.ts), the confidence
// lifecycle engine (confidence-lifecycle.ts) + its governed apply path (apply.ts), the amber/bulk alert detectors
// (alerts.ts), the daily soft-decay job (decay.ts), the hard-expiry exclusion contract (expiry.ts), the daily
// supersede safety-net (supersede.ts), the weekly merge (merge.ts) + summarise (summarise.ts) jobs, the daily
// coverage (coverage.ts) / weekly structural (structural.ts) / monthly+on-use relevance (relevance.ts) erosion
// scans, the embedding-cache validation (embedding-cache.ts), the feedback loop (feedback.ts), the cadence
// scheduler + run log + producer liveness (scheduler.ts), the MaintenanceStore port + in-memory reference fake
// (store.ts), and the live pg adapter (supabase-store.ts). Consumed by ISSUE-031 (surface-11 renders the job-run
// log, completion-rate, and the amber/coverage/structural flags this slice produces).
//
// The default export path also exposes a `check` CLI (offline build-time gate, no DB) — see runCheck().

export * from './config.ts';
export * from './confidence-lifecycle.ts';
export * from './apply.ts';
export * from './alerts.ts';
export * from './decay.ts';
export * from './expiry.ts';
export * from './supersede.ts';
export * from './merge.ts';
export * from './summarise.ts';
export * from './coverage.ts';
export * from './structural.ts';
export * from './relevance.ts';
export * from './embedding-cache.ts';
export * from './feedback.ts';
export * from './scheduler.ts';
export * from './store.ts';
export { SupabaseMaintenanceStore, MAINTENANCE_EVENT_TYPES, EVT_MAINTENANCE_RUN, EVT_CONFIDENCE_CHANGED, EVT_MAINTENANCE_TASK, EVT_MAINTENANCE_MUTATION, EVT_CONFIDENCE_DROP } from './supabase-store.ts';

// ── `check` — offline build-time non-drift gate (no DB, no network) ─────────────────────────────────────────
// ISSUE-027 runs OVER the existing memory graph — it adds NO table + NO column (the memories/entities/
// ingestion_queue tables + the confidence/superseded_by/expires_at/content_hash/embedding columns these jobs
// mutate/read ALL pre-exist in the 0001 baseline). So the schema + config gates are VERIFY-PRESENT against the repo
// (Rule 0): a drift in the shape THIS slice relies on is caught offline (a #3 silent divergence), never only live:
//   1. memories carries the columns these jobs touch (confidence numeric, superseded_by, expires_at, content_hash,
//      embedding vector) + entities + ingestion_queue + the ingestion_state enum the structural scan reads.
//   2. every CFG row this slice reads (config.ts REQUIRED_CFG_KEYS) is present + LIVE-class — the loadConfig
//      contract; a missing/mis-classed row means the live adapter reads a different contract than the fake.
//   3. the reused BASELINE alert value 'memory_confidence_drop' is present (amber/bulk reuse it — no migration).
// The ONE thing this slice cannot self-register is the FOUR ADDITIVE maintenance event_type values (the orchestrator
// owns the baseline enum + the migration). Those are reported SEPARATELY as `pending` — they do NOT fail the gate
// (they are a known forward-dependency the orchestrator applies serially, exactly like the 0039/0040 siblings), but
// the check.test asserts the pending set is EXACTLY those four, so a forgotten registration is surfaced loud.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { REQUIRED_CFG_KEYS } from './config.ts';
import { MAINTENANCE_EVENT_TYPES, EVT_CONFIDENCE_DROP } from './supabase-store.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SILO_MIGRATIONS = join(HERE, '..', '..', 'silo', 'migrations');
const CONFIG_REGISTRY = join(HERE, '..', '..', '..', 'spec', '02-config', 'config-registry.md');

export interface Finding {
  gate: string;
  message: string;
}

export interface CheckReport {
  /** hard drift — the gate FAILS on any of these (schema/config the slice relies on being true NOW). */
  findings: Finding[];
  /** the additive event_type values not yet in the migration corpus — a known forward-dependency, NOT a failure. */
  pending: string[];
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

export function runCheck(migrationsDir: string = SILO_MIGRATIONS, configRegistry: string = CONFIG_REGISTRY): CheckReport {
  const findings: Finding[] = [];

  // 1. the schema shape these jobs mutate/read (baseline; verify-present).
  const baseline = readOr(join(migrationsDir, '0001_baseline.sql'), findings, 'baseline-present');
  if (baseline) {
    const table = (name: string): string => {
      const start = baseline.indexOf(`create table ${name}`);
      const end = start < 0 ? -1 : baseline.indexOf('\n);', start);
      return start < 0 || end < 0 ? '' : baseline.slice(start, end + 3);
    };
    const memories = table('memories');
    if (!memories) {
      findings.push({ gate: 'memories-present', message: 'create table memories not found in 0001_baseline.sql (verify-present)' });
    } else {
      const need: [RegExp, string][] = [
        [/confidence\s+numeric\(4,\s*3\)/, 'memories.confidence numeric(4,3) — the decay/lifecycle target'],
        [/superseded_by\s+uuid/, 'memories.superseded_by uuid — the CAS supersede chain'],
        [/expires_at\s+timestamptz/, 'memories.expires_at timestamptz — the hard-expiry exclusion'],
        [/content_hash\s+text/, 'memories.content_hash text — the embedding-cache validation key'],
        [/embedding\s+vector\(1536\)/, 'memories.embedding vector(1536) — the merge/null-embedding scan input'],
      ];
      for (const [re, label] of need) if (!re.test(memories)) findings.push({ gate: 'memories-cols', message: `expected ${label} — not found` });
    }
    if (!table('entities')) findings.push({ gate: 'entities-present', message: 'create table entities not found (coverage/structural scan reads it)' });
    if (!table('ingestion_queue')) findings.push({ gate: 'ingestion_queue-present', message: 'create table ingestion_queue not found (structural scan reads stuck items)' });
    if (!table('memory_conflicts')) findings.push({ gate: 'memory_conflicts-present', message: 'create table memory_conflicts not found (the under-review freeze input)' });
    const ingestionStates = enumValues(baseline, 'ingestion_state');
    if (!ingestionStates) findings.push({ gate: 'ingestion_state-enum', message: 'ingestion_state enum not found (the structural stuck-queue scan reads pending/deferred)' });
    else for (const s of ['pending', 'deferred']) if (!ingestionStates.has(s)) findings.push({ gate: 'ingestion_state-value', message: `ingestion_state missing '${s}' (the stuck-queue scan keys on it)` });

    // 3. the reused BASELINE alert value must be present (amber/bulk reuse it — no migration for this one).
    const eventTypes = enumValues(baseline, 'event_type');
    if (!eventTypes) findings.push({ gate: 'event_type-enum', message: 'event_type enum not found in 0001_baseline.sql' });
    else if (!eventTypes.has(EVT_CONFIDENCE_DROP)) findings.push({ gate: 'event_type-baseline-value', message: `baseline event_type '${EVT_CONFIDENCE_DROP}' not found — the amber/bulk alert reuses it` });
  }

  // 2. every CFG row this slice reads is present + LIVE-class (Rule 0 source of truth).
  const cfg = readOr(configRegistry, findings, 'config-registry-present');
  if (cfg) {
    const lines = cfg.split('\n');
    for (const key of REQUIRED_CFG_KEYS) {
      const row = lines.find((l) => new RegExp('^\\|\\s*`' + key + '`\\s*\\|').test(l));
      if (!row) findings.push({ gate: 'cfg-present', message: `CFG row \`${key}\` not found in config-registry.md` });
      else if (!/\bLIVE\b/.test(row)) findings.push({ gate: 'cfg-class', message: `CFG \`${key}\` must be LIVE-class (a maintenance job reads it at run time)` });
    }
  }

  // 4. the ADDITIVE maintenance event_type values — scanned across the WHOLE migration corpus (the orchestrator may
  //    place the ALTER TYPE in any file). Absent → PENDING (a forward-dependency), not a hard finding.
  let corpus = baseline ?? '';
  try {
    for (const f of readdirSync(migrationsDir)) {
      if (f.endsWith('.sql') && f !== '0001_baseline.sql') corpus += '\n' + readFileSync(join(migrationsDir, f), 'utf8');
    }
  } catch {
    /* migrationsDir already reported absent above */
  }
  const pending: string[] = [];
  for (const evt of MAINTENANCE_EVENT_TYPES) {
    const inBaselineEnum = new RegExp(`create type event_type[\\s\\S]*?'${evt}'[\\s\\S]*?\\);`).test(baseline ?? '');
    const addedAdditively = new RegExp(`add value if not exists '${evt}'`).test(corpus);
    if (!inBaselineEnum && !addedAdditively) pending.push(evt);
  }

  // 5. OD-204: insertDerivedMemory now persists memories.derived_from (migration 0045) so ISSUE-029's compliance-erasure
  //    walk can reach a derived row from its source ids. It is added additively (not in baseline) → scan the whole
  //    corpus; a live insert of a column that doesn't exist would throw (the fake-passes / live-throws class).
  if (baseline && !/add column if not exists derived_from uuid\[\]/.test(corpus)) {
    findings.push({ gate: 'memories-derived_from', message: 'memories.derived_from uuid[] not found in the migration corpus — insertDerivedMemory writes it (OD-204 / migration 0045)' });
  }

  report(findings, pending);
  return { findings, pending };
}

function report(findings: Finding[], pending: string[]): void {
  if (findings.length === 0) {
    console.log(
      `✓ memory-maintenance check: memories(confidence/superseded_by/expires_at/content_hash/embedding) + entities + ` +
        `ingestion_queue + memory_conflicts + ingestion_state present · ${REQUIRED_CFG_KEYS.length} CFG rows LIVE · ` +
        `baseline alert '${EVT_CONFIDENCE_DROP}' present.`,
    );
    if (pending.length > 0) {
      console.log(`  ⧗ pending additive event_type (orchestrator migration — see migrationNeeded): ${pending.join(', ')}`);
    }
  } else {
    console.error(`✗ memory-maintenance check: ${findings.length} finding(s):`);
    for (const f of findings) console.error(`  [${f.gate}] ${f.message}`);
  }
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? 'check';
  if (cmd === 'check') {
    // GREEN iff there is no hard DRIFT. The pending additive event_type values do NOT fail the gate — they are the
    // orchestrator's serial migration (reported in migrationNeeded), and the check.test asserts the pending set is
    // exactly those four so a forgotten registration is surfaced.
    process.exit(runCheck().findings.length === 0 ? 0 : 1);
  }
  console.error(`unknown command '${cmd}' — use: check`);
  process.exit(2);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
