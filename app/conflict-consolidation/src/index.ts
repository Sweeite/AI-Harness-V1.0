// @harness/conflict-consolidation — ISSUE-028 (C2). Public surface: the FR-2.MNT.008 priority resolver (priority.ts),
// the hard-conflict review path (conflicts.ts), the Personal-tier consolidation gate + approve/reject (consolidation.ts),
// the two-queue escalation sweep (escalation.ts), the config contract (config.ts), the ConflictConsolidationStore +
// SoleWriter ports + in-memory fakes (store.ts), and the live pg adapters (supabase-store.ts). Consumed by ISSUE-024
// (write-time hard-conflict branch attaches the suggested resolution), ISSUE-027 (merge/summarise jobs call the
// Personal gate), and surface-03 (Conflicts + Consolidation tabs render these queues).
//
// The default export path also exposes a `check` CLI (offline build-time gate, no DB) — see runCheck().

export * from './config.ts';
export * from './priority.ts';
export * from './store.ts';
export * from './conflicts.ts';
export * from './consolidation.ts';
export * from './escalation.ts';
export {
  SupabaseConflictConsolidationStore,
  SupabaseSoleWriter,
  CONFLICT_CONSOLIDATION_EVENT_TYPES,
  EVT_CONFLICT_RESOLVED,
  EVT_CONSOLIDATION_QUEUED,
  EVT_CONSOLIDATION_RESOLVED,
  EVT_APPROVAL_STALE,
  type QueryExec,
  type GovernedMemoryWriter,
  type Embedder,
  type Consolidator,
} from './supabase-store.ts';

// ── `check` — offline build-time non-drift gate (no DB, no network) ─────────────────────────────────────────
// ISSUE-028 adds NO table + NO column: memory_conflicts + consolidation_approvals + the mem_review_state /
// consolidation_op enums + the memories columns it reads (superseded_by / source / confidence / sensitivity) ALL
// pre-exist in the 0001 baseline. So the schema + config + perm gates are VERIFY-PRESENT against the repo (Rule 0):
//   1. both queue tables + both enums (with the exact values) are present in the baseline.
//   2. memories carries the columns the resolver + side-by-side read (superseded_by, source, confidence, sensitivity).
//   3. every CFG row this slice reads (config.ts REQUIRED_CFG_KEYS) is present + LIVE-class.
//   4. both PERM nodes (OD-115) are declared in the PERMISSION_NODES.md source of truth (default-deny).
//   5. the reused BASELINE event value 'approval_queue_stale' is present (escalation reuses it — no migration).
// The ONE thing this slice cannot self-register is the THREE additive event_type values (the orchestrator owns the
// baseline enum + the migration 0044). Those are reported SEPARATELY as `pending` — they do NOT fail the gate, but
// check.test asserts the pending set is EXACTLY those three so a forgotten registration is surfaced loud.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { REQUIRED_CFG_KEYS } from './config.ts';
import { CONFLICT_CONSOLIDATION_EVENT_TYPES, EVT_APPROVAL_STALE } from './supabase-store.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SILO_MIGRATIONS = join(HERE, '..', '..', 'silo', 'migrations');
const CONFIG_REGISTRY = join(HERE, '..', '..', '..', 'spec', '02-config', 'config-registry.md');
const PERMISSION_NODES = join(HERE, '..', '..', '..', 'PERMISSION_NODES.md');

const REQUIRED_PERM_NODES: readonly string[] = ['PERM-memory.review_conflict', 'PERM-memory.approve_consolidation'];

export interface Finding {
  gate: string;
  message: string;
}
export interface CheckReport {
  findings: Finding[];
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

export function runCheck(migrationsDir: string = SILO_MIGRATIONS, configRegistry: string = CONFIG_REGISTRY, permNodes: string = PERMISSION_NODES): CheckReport {
  const findings: Finding[] = [];

  // 1 + 2. schema shape (baseline; verify-present).
  const baseline = readOr(join(migrationsDir, '0001_baseline.sql'), findings, 'baseline-present');
  if (baseline) {
    const table = (name: string): string => {
      const start = baseline.indexOf(`create table ${name}`);
      const end = start < 0 ? -1 : baseline.indexOf('\n);', start);
      return start < 0 || end < 0 ? '' : baseline.slice(start, end + 3);
    };
    if (!table('memory_conflicts')) findings.push({ gate: 'memory_conflicts-present', message: 'create table memory_conflicts not found (the hard-conflict quarantine queue)' });
    if (!table('consolidation_approvals')) findings.push({ gate: 'consolidation_approvals-present', message: 'create table consolidation_approvals not found (the Personal-tier approval queue)' });

    const memories = table('memories');
    if (!memories) {
      findings.push({ gate: 'memories-present', message: 'create table memories not found (verify-present)' });
    } else {
      const need: [RegExp, string][] = [
        [/superseded_by\s+uuid\s+references\s+memories\(id\)/, 'memories.superseded_by uuid references memories(id) — the CAS supersede chain (Keep-new)'],
        [/source\s+memory_source/, 'memories.source memory_source — the resolver authority input'],
        [/confidence\s+numeric\(4,\s*3\)/, 'memories.confidence numeric(4,3) — the resolver tie-break'],
        [/sensitivity\s+sensitivity_tier/, 'memories.sensitivity sensitivity_tier — the Personal-tier gate + clearance-before-view'],
      ];
      for (const [re, label] of need) if (!re.test(memories)) findings.push({ gate: 'memories-cols', message: `expected ${label} — not found` });
    }

    const reviewStates = enumValues(baseline, 'mem_review_state');
    if (!reviewStates) findings.push({ gate: 'mem_review_state-enum', message: 'mem_review_state enum not found (the queue state machine)' });
    else for (const s of ['pending', 'escalated', 'resolved']) if (!reviewStates.has(s)) findings.push({ gate: 'mem_review_state-value', message: `mem_review_state missing '${s}'` });

    const ops = enumValues(baseline, 'consolidation_op');
    if (!ops) findings.push({ gate: 'consolidation_op-enum', message: 'consolidation_op enum not found (merge/summarise)' });
    else for (const s of ['merge', 'summarise']) if (!ops.has(s)) findings.push({ gate: 'consolidation_op-value', message: `consolidation_op missing '${s}'` });

    // 5. the reused baseline escalation value must be present.
    const eventTypes = enumValues(baseline, 'event_type');
    if (!eventTypes) findings.push({ gate: 'event_type-enum', message: 'event_type enum not found in 0001_baseline.sql' });
    else if (!eventTypes.has(EVT_APPROVAL_STALE)) findings.push({ gate: 'event_type-baseline-value', message: `baseline event_type '${EVT_APPROVAL_STALE}' not found — the escalation sweep reuses it` });
  }

  // 3. CFG rows present + LIVE-class.
  const cfg = readOr(configRegistry, findings, 'config-registry-present');
  if (cfg) {
    const lines = cfg.split('\n');
    for (const key of REQUIRED_CFG_KEYS) {
      const row = lines.find((l) => new RegExp('^\\|\\s*`' + key + '`\\s*\\|').test(l));
      if (!row) findings.push({ gate: 'cfg-present', message: `CFG row \`${key}\` not found in config-registry.md` });
      else if (!/\bLIVE\b/.test(row)) findings.push({ gate: 'cfg-class', message: `CFG \`${key}\` must be LIVE-class (read at run time)` });
    }
  }

  // 4. both PERM nodes declared (OD-115) in the source of truth.
  const perms = readOr(permNodes, findings, 'permission-nodes-present');
  if (perms) {
    for (const node of REQUIRED_PERM_NODES) {
      if (!perms.includes(node)) findings.push({ gate: 'perm-node-present', message: `${node} not found in PERMISSION_NODES.md (OD-115; default-deny)` });
    }
  }

  // additive event_type values — scanned across the whole corpus; absent → PENDING (orchestrator migration 0044).
  let corpus = baseline ?? '';
  try {
    for (const f of readdirSync(migrationsDir)) {
      if (f.endsWith('.sql') && f !== '0001_baseline.sql') corpus += '\n' + readFileSync(join(migrationsDir, f), 'utf8');
    }
  } catch {
    /* already reported */
  }
  const pending: string[] = [];
  for (const evt of CONFLICT_CONSOLIDATION_EVENT_TYPES) {
    const inBaselineEnum = new RegExp(`create type event_type[\\s\\S]*?'${evt}'[\\s\\S]*?\\);`).test(baseline ?? '');
    const addedAdditively = new RegExp(`add value if not exists '${evt}'`).test(corpus);
    if (!inBaselineEnum && !addedAdditively) pending.push(evt);
  }

  report(findings, pending);
  return { findings, pending };
}

function report(findings: Finding[], pending: string[]): void {
  if (findings.length === 0) {
    console.log(
      `✓ conflict-consolidation check: memory_conflicts + consolidation_approvals + mem_review_state + consolidation_op ` +
        `present · memories(superseded_by/source/confidence/sensitivity) present · ${REQUIRED_CFG_KEYS.length} CFG rows LIVE · ` +
        `${REQUIRED_PERM_NODES.length} PERM nodes present · baseline '${EVT_APPROVAL_STALE}' present.`,
    );
    if (pending.length > 0) console.log(`  ⧗ pending additive event_type (orchestrator migration 0044): ${pending.join(', ')}`);
  } else {
    console.error(`✗ conflict-consolidation check: ${findings.length} finding(s):`);
    for (const f of findings) console.error(`  [${f.gate}] ${f.message}`);
  }
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? 'check';
  if (cmd === 'check') {
    process.exit(runCheck().findings.length === 0 ? 0 : 1);
  }
  console.error(`unknown command '${cmd}' — use: check`);
  process.exit(2);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
