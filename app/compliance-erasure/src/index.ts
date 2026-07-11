// @harness/compliance-erasure — ISSUE-082 (C10). The individual right-to-erasure WORKFLOW that wraps the ISSUE-029
// (C2) memory-side transitive delete. Public surface: the queue (queue.ts), Step-1 identification (identify.ts), the
// authorisation gate (authorize.ts), the frozen-deployment guard (freeze.ts), the content scrub (scrub.ts), the
// connector-deletion flags (connectors.ts), the orchestrator + verify-before-done gate (execute.ts), the store port +
// injected mechanism ports + InMemory fakes (store.ts), the live pg adapter (supabase-store.ts), and the LIVE config
// contract (config.ts).
//
// The default export path also exposes a `check` CLI (offline build-time gate, no DB) — see runCheck().

export * from './store.ts';
export * from './config.ts';
export * from './queue.ts';
export * from './identify.ts';
export * from './authorize.ts';
export * from './freeze.ts';
export * from './scrub.ts';
export * from './connectors.ts';
export * from './execute.ts';
export { SupabaseDeletionWorkflowStore, type QueryExec } from './supabase-store.ts';

// ── `check` — offline build-time non-drift gate (no DB, no network) ──────────────────────────────────────────────
// ISSUE-082 adds NO table + NO migration (schema §14 deletion_requests / connector_deletion_flags / deployment_settings
// are Phase-4 consolidated in 0001_baseline; the erasure mechanism + its event_types are ISSUE-029's). So the gates are
// VERIFY-PRESENT against the repo (Rule 0):
//   1. deletion_requests present + the two-person distinctness CHECKs + the status='executed' all-three-non-null CHECK.
//   2. connector_deletion_flags present.
//   3. deployment_settings present + frozen_at (the local freeze read, FR-10.DEL.007 / OD-162).
//   4. access_audit present (the immutable deletion-audit sink, FR-10.DEL.005).
//   5. PERM-memory.delete declared in PERMISSION_NODES.md (default-deny; Admin/Super-Admin).
//   6. every CFG row this slice reads (config.ts REQUIRED_CFG) is present + correct-class in config-registry.md.
// There is nothing this slice cannot self-register, so `pending` is always empty.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { PERM_MEMORY_DELETE } from './store.ts';
import { REQUIRED_CFG } from './config.ts';
import { DELETION_WORKFLOW_EVENT_TYPES } from './supabase-store.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SILO_MIGRATIONS = join(HERE, '..', '..', 'silo', 'migrations');
const PERMISSION_NODES = join(HERE, '..', '..', '..', 'PERMISSION_NODES.md');
const CONFIG_REGISTRY = join(HERE, '..', '..', '..', 'spec', '02-config', 'config-registry.md');

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

function readDirText(dir: string): string {
  let text = '';
  try {
    for (const f of readdirSync(dir)) if (f.endsWith('.sql')) text += '\n' + readFileSync(join(dir, f), 'utf8');
  } catch {
    /* reported by the baseline-present gate when the dir is missing */
  }
  return text;
}

export function runCheck(migrationsDir: string = SILO_MIGRATIONS, permNodes: string = PERMISSION_NODES, configRegistry: string = CONFIG_REGISTRY): CheckReport {
  const findings: Finding[] = [];

  const baseline = readOr(join(migrationsDir, '0001_baseline.sql'), findings, 'baseline-present');
  const siloCorpus = baseline ? baseline + readDirText(migrationsDir) : '';
  if (baseline) {
    const table = (name: string): string => {
      const start = baseline.indexOf(`create table ${name}`);
      const end = start < 0 ? -1 : baseline.indexOf('\n);', start);
      return start < 0 || end < 0 ? '' : baseline.slice(start, end + 3);
    };

    // 1. deletion_requests + the two-person CHECKs (AC-10.DEL.006.2).
    const del = table('deletion_requests');
    if (!del) {
      findings.push({ gate: 'deletion_requests-present', message: 'create table deletion_requests not found (schema §14, verify-present)' });
    } else {
      const need: [RegExp, string][] = [
        [/second_authoriser_id[\s\S]*?references profiles\(id\)/, 'deletion_requests.second_authoriser_id references profiles(id) — the two-person second authoriser'],
        [/executor_id[\s\S]*?references profiles\(id\)/, 'deletion_requests.executor_id references profiles(id) — the executor'],
        [/check \(status <> 'executed'[\s\S]*?authorized_by is not null[\s\S]*?second_authoriser_id is not null[\s\S]*?executor_id is not null\)/, "CHECK status='executed' ⇒ all three authoriser roles non-null (the DB guarantee)"],
      ];
      for (const [re, label] of need) if (!re.test(del)) findings.push({ gate: 'deletion_requests-shape', message: `expected ${label} — not found` });
    }

    // the NULL-tolerant distinctness CHECKs (migration 0048, ISSUE-082) — reject a same-person collision but allow the
    // pre-fill nulls of intake. Scanned in the corpus (0048 replaces the buggy baseline IS-DISTINCT-FROM checks).
    if (!/add constraint deletion_requests_second_distinct/.test(siloCorpus)) {
      findings.push({ gate: 'deletion_requests-null-safe-check', message: 'the NULL-tolerant second-authoriser distinctness CHECK (migration 0048) not found in the corpus — the all-null intake insert would be rejected (AC-10.DEL.006.2 / AC-10.DEL.001.1)' });
    }
    if (!/add constraint deletion_requests_executor_distinct/.test(siloCorpus)) {
      findings.push({ gate: 'deletion_requests-null-safe-check', message: 'the NULL-tolerant executor distinctness CHECK (migration 0048) not found in the corpus' });
    }

    // 2. connector_deletion_flags (FR-10.DEL.006(a)).
    const flags = table('connector_deletion_flags');
    if (!flags) {
      findings.push({ gate: 'connector_deletion_flags-present', message: 'create table connector_deletion_flags not found (schema §14, verify-present)' });
    } else {
      for (const [re, label] of [
        [/deletion_request_id[\s\S]*?references deletion_requests\(id\)/, 'connector_deletion_flags.deletion_request_id references deletion_requests(id)'],
        [/state\s+connector_deletion_flag_state/, 'connector_deletion_flags.state connector_deletion_flag_state — the tracked-until-acknowledged lifecycle'],
        [/escalated_at\s+timestamptz/, 'connector_deletion_flags.escalated_at — the un-acknowledged escalation stamp (AC-10.DEL.006.3)'],
      ] as [RegExp, string][]) {
        if (!re.test(flags)) findings.push({ gate: 'connector_deletion_flags-shape', message: `expected ${label} — not found` });
      }
    }

    // 3. deployment_settings.frozen_at (FR-10.DEL.007 / OD-162 — the local freeze read).
    const dep = table('deployment_settings');
    if (!dep) {
      findings.push({ gate: 'deployment_settings-present', message: 'create table deployment_settings not found (schema §14, verify-present)' });
    } else if (!/frozen_at\s+timestamptz/.test(dep)) {
      findings.push({ gate: 'deployment_settings-frozen_at', message: 'deployment_settings.frozen_at timestamptz not found — the local freeze read (FR-10.DEL.007)' });
    }

    // 4. access_audit present (the immutable deletion-audit sink, FR-10.DEL.005).
    if (!table('access_audit')) {
      findings.push({ gate: 'access_audit-present', message: 'create table access_audit not found — the immutable deletion-audit sink (FR-10.DEL.005)' });
    }
  }

  // 5. PERM-memory.delete declared (default-deny; Admin/Super-Admin).
  const perms = readOr(permNodes, findings, 'permission-nodes-present');
  if (perms && !perms.includes(PERM_MEMORY_DELETE)) {
    findings.push({ gate: 'perm-node-present', message: `${PERM_MEMORY_DELETE} not found in PERMISSION_NODES.md (C1-homed; default-deny)` });
  }

  // 6. every required CFG row present + correct-class in config-registry.md.
  const cfg = readOr(configRegistry, findings, 'config-registry-present');
  if (cfg) {
    const lines = cfg.split('\n');
    for (const { key, cls } of REQUIRED_CFG) {
      const row = lines.find((l) => l.includes(`\`${key}\``));
      if (!row) findings.push({ gate: 'cfg-present', message: `CFG row \`${key}\` not found in config-registry.md` });
      else if (!new RegExp(`\\b${cls}\\b`).test(row)) findings.push({ gate: 'cfg-class', message: `CFG \`${key}\` must be ${cls}-class` });
    }
  }

  // the 7 additive event_type values (migration 0047) — scanned across the silo corpus; absent → PENDING (they are
  // shipped WITH this slice, so a green tree has pending empty; a missing/removed 0047 surfaces here, not silently).
  const pending: string[] = [];
  for (const evt of DELETION_WORKFLOW_EVENT_TYPES) {
    if (!new RegExp(`add value if not exists '${evt}'`).test(siloCorpus)) pending.push(evt);
  }

  reportFindings(findings, pending);
  return { findings, pending };
}

function reportFindings(findings: Finding[], pending: string[]): void {
  if (findings.length === 0) {
    console.log(
      `✓ compliance-erasure check: deletion_requests(+two-person CHECKs) + connector_deletion_flags + ` +
        `deployment_settings.frozen_at + access_audit present · ${PERM_MEMORY_DELETE} declared · ${REQUIRED_CFG.length} CFG rows present + correct-class · ${DELETION_WORKFLOW_EVENT_TYPES.length} event_type values (0047) present.`,
    );
    if (pending.length > 0) console.log(`  ⧗ pending additive event_type (migration 0047 not in corpus): ${pending.join(', ')}`);
  } else {
    console.error(`✗ compliance-erasure check: ${findings.length} finding(s):`);
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
