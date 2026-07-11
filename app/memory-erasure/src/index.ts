// @harness/memory-erasure — ISSUE-029 (C2). The compliance erasure walk — the ONE sanctioned destructive path.
// Public surface: the erasure gate (gate.ts), the transitive walk + classification (walk.ts), the orchestrator +
// verified-complete-or-fails-loud contract (erase.ts), the ErasureStore + fan-out ports + in-memory fakes (store.ts),
// and the live pg adapter + loud event sink (supabase-store.ts). Consumed by ISSUE-082 (C10 individual
// right-to-erasure workflow) which resolves the target + two-person auth and CALLS eraseTarget, verifying its
// completeness return (done) before writing its own audit-done record (AC-10.DEL.003.4).
//
// The default export path also exposes a `check` CLI (offline build-time gate, no DB) — see runCheck().

export * from './store.ts';
export * from './gate.ts';
export * from './walk.ts';
export * from './erase.ts';
export {
  SupabaseErasureStore,
  SupabaseErasureEventSink,
  MEMORY_ERASURE_EVENT_TYPES,
  EVT_MEMORY_ERASED,
  EVT_MEMORY_ERASURE_INCOMPLETE,
  type QueryExec,
} from './supabase-store.ts';

// ── `check` — offline build-time non-drift gate (no DB, no network) ─────────────────────────────────────────
// ISSUE-029 adds NO table. It reads the memories graph + memories.derived_from (migration 0045, OD-204), hard-deletes
// memories rows, writes an access_audit tombstone, and triggers C7 redaction (event_log/guardrail_log.redacted_at)
// + a backup-purge flag (management-plane off_platform_purge_flag, owned by app/backup-dr). So the gates are
// VERIFY-PRESENT against the repo (Rule 0):
//   1. memories present + carries superseded_by (chain), sensitivity (Personal remit), embedding; derived_from is
//      added in the corpus (0045) — the erasure walk queries it.
//   2. access_audit present + carries target_entity_id + after_value (the tombstone shape) + redacted_at.
//   3. event_log + guardrail_log carry redacted_at (the C7 redaction-tombstone target this slice triggers).
//   4. PERM-memory.delete declared in the PERMISSION_NODES.md source of truth (default-deny; Super-Admin + gate).
//   5. the management-plane off_platform_purge_flag ledger (the backup-purge flag this slice raises into) exists.
// The ONE thing this slice cannot self-register is the TWO additive event_type values — reported as `pending`
// (migration 0046). They do NOT fail the gate; check.test asserts the pending set is EXACTLY those two.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { MEMORY_ERASURE_EVENT_TYPES } from './supabase-store.ts';
import { PERM_MEMORY_DELETE } from './store.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SILO_MIGRATIONS = join(HERE, '..', '..', 'silo', 'migrations');
const MGMT_MIGRATIONS = join(HERE, '..', '..', 'management', 'migrations');
const PERMISSION_NODES = join(HERE, '..', '..', '..', 'PERMISSION_NODES.md');

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
    /* reported by the caller when the specific file is missing */
  }
  return text;
}

export function runCheck(migrationsDir: string = SILO_MIGRATIONS, mgmtDir: string = MGMT_MIGRATIONS, permNodes: string = PERMISSION_NODES): CheckReport {
  const findings: Finding[] = [];

  const baseline = readOr(join(migrationsDir, '0001_baseline.sql'), findings, 'baseline-present');
  const siloCorpus = baseline ? baseline + readDirText(migrationsDir) : '';

  if (baseline) {
    const table = (name: string): string => {
      const start = baseline.indexOf(`create table ${name}`);
      const end = start < 0 ? -1 : baseline.indexOf('\n);', start);
      return start < 0 || end < 0 ? '' : baseline.slice(start, end + 3);
    };

    // 1. memories present + the columns the walk depends on.
    const memories = table('memories');
    if (!memories) {
      findings.push({ gate: 'memories-present', message: 'create table memories not found (verify-present)' });
    } else {
      const need: [RegExp, string][] = [
        [/superseded_by\s+uuid\s+references\s+memories\(id\)/, 'memories.superseded_by uuid references memories(id) — the CAS chain the walk follows'],
        [/sensitivity\s+sensitivity_tier/, 'memories.sensitivity sensitivity_tier — the Personal remit filter'],
        [/embedding\s+vector\(1536\)/, 'memories.embedding vector(1536) — deleted with the row (no orphaned embedding)'],
      ];
      for (const [re, label] of need) if (!re.test(memories)) findings.push({ gate: 'memories-cols', message: `expected ${label} — not found` });
    }
    // memories.derived_from is ADDED additively (migration 0045, OD-204) — scan the whole silo corpus.
    if (!/add column if not exists derived_from uuid\[\]/.test(siloCorpus) && !/derived_from\s+uuid\[\]/.test(memories)) {
      findings.push({ gate: 'memories-derived_from', message: 'memories.derived_from uuid[] not found in the silo migration corpus (OD-204 / migration 0045) — the transitive walk queries it' });
    }

    // 2. access_audit present + the tombstone columns.
    const audit = table('access_audit');
    if (!audit) {
      findings.push({ gate: 'access_audit-present', message: 'create table access_audit not found (the erasure tombstone sink)' });
    } else {
      for (const [re, label] of [
        [/target_entity_id\s+uuid/, 'access_audit.target_entity_id uuid — links the tombstone to the erased subject'],
        [/after_value\s+jsonb/, 'access_audit.after_value jsonb — the per-leg outcome record (no PII)'],
      ] as [RegExp, string][]) {
        if (!re.test(audit)) findings.push({ gate: 'access_audit-cols', message: `expected ${label} — not found` });
      }
    }

    // 3. the C7 redaction-tombstone target — event_log carries redacted_at (baseline); guardrail_log gains it in 0015.
    const eventLog = table('event_log');
    if (eventLog && !/redacted_at\s+timestamptz/.test(eventLog)) {
      findings.push({ gate: 'event_log-redacted_at', message: 'event_log.redacted_at timestamptz not found — the C7 redaction-tombstone target this slice triggers' });
    }
    if (!/alter table guardrail_log add column if not exists redacted_at/.test(siloCorpus)) {
      findings.push({ gate: 'guardrail_log-redacted_at', message: 'guardrail_log.redacted_at not found in the corpus (migration 0015) — the C7 redaction target' });
    }
  }

  // 4. PERM-memory.delete declared (default-deny; Super-Admin + erasure gate).
  const perms = readOr(permNodes, findings, 'permission-nodes-present');
  if (perms && !perms.includes(PERM_MEMORY_DELETE)) {
    findings.push({ gate: 'perm-node-present', message: `${PERM_MEMORY_DELETE} not found in PERMISSION_NODES.md (C1-homed; default-deny)` });
  }

  // 5. the management-plane backup-purge receive-leg ledger exists (the flag this slice raises into, NFR-DR.009).
  const mgmtCorpus = readDirText(mgmtDir);
  if (!/create table off_platform_purge_flag/.test(mgmtCorpus)) {
    findings.push({ gate: 'purge-flag-ledger-present', message: 'create table off_platform_purge_flag not found in app/management/migrations (NFR-DR.009 receive-leg the backup-purge flag raises into)' });
  }

  // additive event_type values — scanned across the silo corpus; absent → PENDING (migration 0046).
  const pending: string[] = [];
  for (const evt of MEMORY_ERASURE_EVENT_TYPES) {
    const inBaselineEnum = new RegExp(`create type event_type[\\s\\S]*?'${evt}'[\\s\\S]*?\\);`).test(baseline ?? '');
    const addedAdditively = new RegExp(`add value if not exists '${evt}'`).test(siloCorpus);
    if (!inBaselineEnum && !addedAdditively) pending.push(evt);
  }

  report(findings, pending);
  return { findings, pending };
}

function report(findings: Finding[], pending: string[]): void {
  if (findings.length === 0) {
    console.log(
      `✓ memory-erasure check: memories(superseded_by/sensitivity/embedding/derived_from) + access_audit(target_entity_id/after_value) + ` +
        `event_log/guardrail_log redacted_at present · ${PERM_MEMORY_DELETE} declared · off_platform_purge_flag ledger present.`,
    );
    if (pending.length > 0) console.log(`  ⧗ pending additive event_type (orchestrator migration 0046): ${pending.join(', ')}`);
  } else {
    console.error(`✗ memory-erasure check: ${findings.length} finding(s):`);
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
