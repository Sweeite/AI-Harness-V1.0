// @harness/retrieval — ISSUE-025 (C2 RET). Public surface: the retrieval orchestrator (retrieve.ts), the
// clearance-before-ranking #2 gate (clearance.ts), the candidate filters (candidate-filters.ts), the OD-169 ranking
// (rank.ts), the Business-Context injection (inject.ts), the entity extraction (extract.ts), the config contract
// (config.ts), the RetrievalStore port + in-memory reference fake (store.ts), and the live pg adapter (supabase-store.ts).
// Consumed by ISSUE-045 (Layer-3 injection calls retrieve), ISSUE-053 (the run pipeline), ISSUE-063 (agent memory_scope
// narrows this read path), ISSUE-069 (proactive generators), and ISSUE-031 (the memory-nav surface renders RET output).
//
// The default export path also exposes a `check` CLI (offline build-time gate, no DB) — see runCheck().

export * from './config.ts';
export * from './clearance.ts';
export * from './candidate-filters.ts';
export * from './extract.ts';
export * from './rank.ts';
export * from './inject.ts';
export * from './store.ts';
export * from './retrieve.ts';
export { SupabaseRetrievalStore, EVT_MEMORY_READ, AUDIT_SENSITIVE_VIEW } from './supabase-store.ts';

// ── `check` — offline build-time non-drift gate (no DB, no network) ─────────────────────────────────────────
// ISSUE-025 is READ-PATH ONLY: it writes NO new table + adds NO migration (the memories/entities tables, the HNSW index,
// the event_log/access_audit sinks, the 'memory_read' event_type, and the answer_mode enum ALL pre-exist in the 0001
// baseline). So the check is VERIFY-PRESENT against the repo (Rule 0) — it asserts the shape THIS slice's contract relies
// on is true, so a drift is caught offline (a #3 silent divergence), never only live:
//   1. every CFG row this slice reads (config.ts REQUIRED_CFG_KEYS) is present + LIVE-class in config-registry.md — the
//      loadConfig() contract; a missing/mis-classed row means the live adapter reads a different contract than the fake.
//   2. the answer_mode enum in the 0001 baseline carries all four verdict values (cited/inferred/unknown/building) — the
//      FR-2.RET.007 pill vocabulary C8 renders from this slice's verdict.
//   3. the 'memory_read' event_type + the clearance-tier vocabularies (visibility/sensitivity/clearance) in the baseline
//      match the constants clearance.ts realises the 0031 policy against — a drift here would make the in-code #2 filter
//      and the live RLS policy disagree (exactly what R10 + this gate exist to forbid).

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { REQUIRED_CFG_KEYS } from './config.ts';
import { EVT_MEMORY_READ } from './supabase-store.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SILO_MIGRATIONS = join(HERE, '..', '..', 'silo', 'migrations');
const CONFIG_REGISTRY = join(HERE, '..', '..', '..', 'spec', '02-config', 'config-registry.md');

/** The answer_mode enum values this slice's verdict maps to (FR-2.RET.007 / ADR-002 three pills + the [Building] flag). */
const ANSWER_MODE_VALUES = ['cited', 'inferred', 'unknown', 'building'] as const;
/** The tier vocabularies clearance.ts realises the 0031 predicate against (must match the baseline enums). */
const VISIBILITY_VALUES = ['global', 'team', 'private'] as const;
const SENSITIVITY_VALUES = ['standard', 'confidential', 'personal', 'restricted'] as const;
const CLEARANCE_VALUES = ['confidential', 'personal'] as const;

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

/** Extract an `create type <name> as enum (...)` value set from a SQL corpus. */
function enumValues(sql: string, typeName: string): Set<string> | null {
  const m = sql.match(new RegExp(`create\\s+type\\s+${typeName}\\s+as\\s+enum\\s*\\(([\\s\\S]*?)\\)\\s*;`, 'i'));
  if (!m) return null;
  return new Set([...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!));
}

export function runCheck(migrationsDir: string = SILO_MIGRATIONS, configRegistry: string = CONFIG_REGISTRY): Finding[] {
  const findings: Finding[] = [];

  // 1. every CFG row is present + LIVE-class.
  const cfg = readOr(configRegistry, findings, 'config-registry-present');
  if (cfg) {
    const lines = cfg.split('\n');
    for (const key of REQUIRED_CFG_KEYS) {
      // Match the registry TABLE ROW (`| \`key\` | … |`), not a prose mention of the key elsewhere in the doc.
      const row = lines.find((l) => new RegExp('^\\|\\s*`' + key + '`\\s*\\|').test(l));
      if (!row) {
        findings.push({ gate: 'cfg-present', message: `CFG row \`${key}\` not found in config-registry.md` });
      } else if (!/LIVE/.test(row)) {
        findings.push({ gate: 'cfg-class', message: `CFG \`${key}\` must be LIVE-class (retrieval reads it at query time)` });
      }
    }
  }

  // 2 + 3. the baseline enums + the memory_read event_type.
  const baseline = readOr(join(migrationsDir, '0001_baseline.sql'), findings, 'baseline-present');
  if (baseline) {
    const checkEnum = (typeName: string, expected: readonly string[], gate: string) => {
      const vals = enumValues(baseline, typeName);
      if (!vals) {
        findings.push({ gate, message: `enum ${typeName} not found in 0001_baseline.sql` });
        return;
      }
      for (const e of expected) if (!vals.has(e)) findings.push({ gate, message: `enum ${typeName} is missing '${e}' (clearance/answer-mode vocabulary drift)` });
    };
    checkEnum('answer_mode', ANSWER_MODE_VALUES, 'answer-mode-enum');
    checkEnum('visibility_tier', VISIBILITY_VALUES, 'visibility-enum');
    checkEnum('sensitivity_tier', SENSITIVITY_VALUES, 'sensitivity-enum');
    checkEnum('clearance_tier', CLEARANCE_VALUES, 'clearance-enum');

    const eventTypes = enumValues(baseline, 'event_type');
    if (!eventTypes) findings.push({ gate: 'event_type-enum', message: 'event_type enum not found in 0001_baseline.sql' });
    else if (!eventTypes.has(EVT_MEMORY_READ)) {
      findings.push({ gate: 'event_type-value', message: `event_type '${EVT_MEMORY_READ}' not in the baseline enum — a live memory_read insert would throw 22P02` });
    }
  }

  report(findings);
  return findings;
}

function report(findings: Finding[]): void {
  if (findings.length === 0) {
    console.log(
      `✓ retrieval check: ${REQUIRED_CFG_KEYS.length} CFG rows LIVE-present · answer_mode enum carries ` +
        `${ANSWER_MODE_VALUES.join('/')} · visibility/sensitivity/clearance tier vocabularies match clearance.ts · ` +
        `event_type '${EVT_MEMORY_READ}' present (read-path only — no migration).`,
    );
  } else {
    console.error(`✗ retrieval check: ${findings.length} finding(s):`);
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
