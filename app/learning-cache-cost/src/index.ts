// @harness/learning-cache-cost — ISSUE-066 (C8 LRN/COST). Public surface: the scope-aware result cache (cache.ts),
// cost-routing by complexity (cost.ts), the learning loop + routing-mismatch detector (learning.ts), the config
// contract (config.ts), the ports + in-memory reference fakes (store.ts), and the live pg adapters (supabase-store.ts).
// Consumes ISSUE-061's routing model (Classification) + execution_plans outcomes; feeds ISSUE-074 (C7 cost meter) the
// COST.003 cost shape and subscribes to ISSUE-024 (C2 Memory Agent commit) for LRN.003.2 write-triggered invalidation.
//
// The default export path also exposes a `check` CLI (offline build-time gate, no DB) — see runCheck().

export * from './config.ts';
export * from './store.ts';
export * from './cache.ts';
export * from './cost.ts';
export * from './learning.ts';
export {
  SupabaseCacheStore,
  SupabaseLearningStore,
  SupabaseEventSink,
  SupabaseSecondarySink,
  ORC_OUTCOME_EVENT_TYPE,
} from './supabase-store.ts';

// ── `check` — offline build-time non-drift gate (no DB, no network) ─────────────────────────────────────────────
// This slice sits on top of ISSUE-061's schema group: agent_result_cache, execution_plans, and
// agent_health_metrics.routing_mismatch_count ALL pre-exist in the 0001 baseline (verify-present — an absence is an
// ISSUE-061/064/065 gap, flagged, never silently added). The check asserts — against the repo (Rule 0) — the shape
// this slice's adapters rely on is true, so a drift is caught OFFLINE (a #3 silent divergence), never only live:
//   1. agent_result_cache carries the scope-aware-key columns (agent_id, scope_entity_ids uuid[], memory_version,
//      output jsonb, expires_at, created_at) — the CacheStore reads/writes them.
//   2. execution_plans is present (the LRN.001 outcome/plan-version source) + agent_health_metrics carries
//      routing_mismatch_count (the LRN.002 flag-only metric this slice bumps).
//   3. the four CFG rows this slice reads are present + LIVE-class in config-registry.md (cache_time_window,
//      orchestrator_confidence_threshold, chain_depth_limit, routing_weights) — a drift means the live loadConfig()
//      reads a different contract than the fake tested against.
//   4. the seven LRN/COST event_type values exist in the migration corpus. These are ADDITIVE — the ONE class this
//      slice cannot self-register (the orchestrator owns the baseline enum + the serial migration). Until that ALTER
//      TYPE lands they are reported as PENDING (loud, never silent — #3) but do NOT fail the gate, because a known,
//      deliberate serial-migration handoff is not schema DRIFT. Any real drift (a missing table/column/CFG) DOES fail.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { LRN_COST_EVENT_TYPES } from './store.ts';
import { REQUIRED_CFG_KEYS } from './config.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SILO_MIGRATIONS = join(HERE, '..', '..', 'silo', 'migrations');
const CONFIG_REGISTRY = join(HERE, '..', '..', '..', 'spec', '02-config', 'config-registry.md');

export interface Finding {
  gate: string;
  message: string;
  /** A PENDING finding is a known serial-migration handoff (the additive event_type values), not schema drift — it is
   *  printed loudly but does NOT fail the gate's exit code. Fatal (drift) findings have no `pending` flag. */
  pending?: boolean;
}

function readOr(path: string, findings: Finding[], gate: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    findings.push({ gate, message: `${path} not found` });
    return null;
  }
}

/** Extract a `create table <name> ( … );` body from a SQL corpus, slicing to the statement-terminating `\n);` (not the
 *  first inline `);`, which a column comment can contain). */
function tableBlock(sql: string, table: string): string {
  const start = sql.indexOf(`create table ${table}`);
  if (start < 0) return '';
  const end = sql.indexOf('\n);', start);
  return end < 0 ? '' : sql.slice(start, end + 3);
}

export function runCheck(migrationsDir: string = SILO_MIGRATIONS, configRegistry: string = CONFIG_REGISTRY): Finding[] {
  const findings: Finding[] = [];

  const baseline = readOr(join(migrationsDir, '0001_baseline.sql'), findings, 'baseline-present');
  if (baseline) {
    // 1. agent_result_cache scope-aware-key columns (verify-present).
    const cache = tableBlock(baseline, 'agent_result_cache');
    if (!cache) {
      findings.push({ gate: 'agent_result_cache-present', message: 'create table agent_result_cache not found in 0001_baseline.sql (verify-present — ISSUE-061 schema group)' });
    } else {
      const need: [RegExp, string][] = [
        [/agent_id\s+uuid\s+not null/, 'agent_result_cache.agent_id uuid NOT NULL (cache key)'],
        [/scope_entity_ids\s+uuid\[\]\s+not null/, 'agent_result_cache.scope_entity_ids uuid[] NOT NULL (scope key + the && invalidation)'],
        [/memory_version\s+text\s+not null/, 'agent_result_cache.memory_version text NOT NULL (version key)'],
        [/output\s+jsonb\s+not null/, 'agent_result_cache.output jsonb NOT NULL (the cached result)'],
        [/expires_at\s+timestamptz\s+not null/, 'agent_result_cache.expires_at timestamptz NOT NULL (per-agent-type window)'],
        [/created_at\s+timestamptz\s+not null/, 'agent_result_cache.created_at timestamptz NOT NULL'],
      ];
      for (const [re, label] of need) if (!re.test(cache)) findings.push({ gate: 'agent_result_cache-columns', message: `expected ${label} — not found` });
    }

    // 2. execution_plans present + agent_health_metrics.routing_mismatch_count present.
    if (tableBlock(baseline, 'execution_plans') === '') {
      findings.push({ gate: 'execution_plans-present', message: 'create table execution_plans not found in 0001_baseline.sql (LRN.001 outcome/plan-version source)' });
    }
    const ahm = tableBlock(baseline, 'agent_health_metrics');
    if (ahm === '') {
      findings.push({ gate: 'agent_health_metrics-present', message: 'create table agent_health_metrics not found in 0001_baseline.sql (LRN.002 mismatch metric)' });
    } else if (!/routing_mismatch_count\s+int\s+not null\s+default\s+0/.test(ahm)) {
      findings.push({ gate: 'agent_health_metrics-columns', message: 'expected agent_health_metrics.routing_mismatch_count int NOT NULL default 0 (LRN.002 bumps it) — not found' });
    }
  }

  // 3. the four CFG rows present + LIVE-class (Rule 0 source of truth).
  const cfg = readOr(configRegistry, findings, 'config-registry-present');
  if (cfg) {
    const lines = cfg.split('\n');
    for (const key of REQUIRED_CFG_KEYS) {
      // Match the registry TABLE ROW (`| \`key\` | … |`), not a prose mention elsewhere.
      const row = lines.find((l) => new RegExp('^\\|\\s*`' + key + '`\\s*\\|').test(l));
      if (!row) findings.push({ gate: 'cfg-present', message: `CFG row \`${key}\` not found in config-registry.md` });
      else if (!/\bLIVE\b/.test(row)) findings.push({ gate: 'cfg-class', message: `CFG \`${key}\` must be LIVE-class (read fresh at plan-build / cache-write time)` });
    }
  }

  // 4. the seven LRN/COST event_type values in the migration corpus (any .sql — the orchestrator assigns the tag).
  //    PENDING, not fatal: a known additive serial migration this slice cannot author.
  let corpus = baseline ?? '';
  try {
    for (const f of readdirSync(migrationsDir)) {
      if (f.endsWith('.sql') && f !== '0001_baseline.sql') corpus += '\n' + readFileSync(join(migrationsDir, f), 'utf8');
    }
  } catch {
    /* migrationsDir already reported absent above */
  }
  for (const e of LRN_COST_EVENT_TYPES) {
    const inBaselineEnum = new RegExp(`create type event_type[\\s\\S]*?'${e}'[\\s\\S]*?\\);`).test(baseline ?? '');
    const addedAdditively = new RegExp(`add value if not exists '${e}'`).test(corpus);
    if (!inBaselineEnum && !addedAdditively) {
      findings.push({
        gate: 'event_type-value',
        message: `event_type '${e}' is not in the baseline enum nor added by any migration — a live event_log insert would throw 22P02 until the additive ALTER TYPE lands (migrationNeeded).`,
        pending: true,
      });
    }
  }

  report(findings);
  return findings;
}

function report(findings: Finding[]): void {
  const fatal = findings.filter((f) => !f.pending);
  const pending = findings.filter((f) => f.pending);
  if (fatal.length === 0) {
    console.log(
      `✓ learning-cache-cost check: agent_result_cache scope-aware-key columns present · execution_plans + ` +
        `agent_health_metrics.routing_mismatch_count present · ${REQUIRED_CFG_KEYS.length} CFG rows LIVE ` +
        `(cache_time_window, orchestrator_confidence_threshold, chain_depth_limit, routing_weights).`,
    );
  } else {
    console.error(`✗ learning-cache-cost check: ${fatal.length} drift finding(s):`);
    for (const f of fatal) console.error(`  [${f.gate}] ${f.message}`);
  }
  if (pending.length > 0) {
    console.warn(`⚠ learning-cache-cost check: ${pending.length} PENDING serial migration(s) (loud, not silent — does not fail the gate):`);
    for (const f of pending) console.warn(`  [${f.gate}] ${f.message}`);
  }
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? 'check';
  if (cmd === 'check') {
    const fatal = runCheck().filter((f) => !f.pending);
    process.exit(fatal.length === 0 ? 0 : 1);
  }
  console.error(`unknown command '${cmd}' — use: check`);
  process.exit(2);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
