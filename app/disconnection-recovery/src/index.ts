// @harness/disconnection-recovery — ISSUE-038 (C3 DSC). Public surface: the pure lifecycle kernels (classify.ts),
// the durable-state port + in-memory reference model + resume/escalation orchestration (store.ts), and the live pg
// adapter (supabase-store.ts). Consumers: C7/ISSUE-078 (ops dashboard renders the health panel + surfacing), C7/
// ISSUE-075 (alerting + notification centre delivers the alerts this slice emits), C5/ISSUE-048/052 (the durable
// task substrate the paused-set relies on), C1/ISSUE-020 (the FR-1.RLS.007 re-check wired into the resume seam).
//
// The default export path also exposes a `check` CLI (offline build-time gate, no DB) — see runCheck().

export * from './classify.ts';
export * from './store.ts';
export { SupabaseDisconnectionStore } from './supabase-store.ts';

// ── `check` — offline build-time non-drift gate (no DB, no network) ─────────────────────────────────
// Asserts the DDL shapes THIS slice's adapter depends on are true in the migration corpus (Rule 0: the migrations
// are the built reality). If a column the live adapter reads/writes drifts, the adapter would throw or misread
// against the real schema (the fake-passes-offline / live-diverges class R10 exists to catch) — so the build fails
// LOUD here rather than shipping an adapter that assumes a shape the DB does not have (#3). Mirrors the specialists
// / rls-enforcement / orchestrator `check` gates.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { CONNECTOR_EVENT_TYPES } from './store.ts';

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
    report(findings);
    return findings;
  }
  const dsc = read('0034_connector_disconnection_state.sql');
  const dscIdx = read('0035_connector_disconnection_open_index.sql');

  const blockOf = (sql: string, table: string): string => {
    const start = sql.indexOf(`create table ${table}`);
    if (start < 0) return '';
    return sql.slice(start, sql.indexOf(');', start) + 2);
  };

  // (1) connector_credentials — detection marks state='degraded'; health reads state/expires_at/scopes. NEVER a token.
  const creds = blockOf(baseline, 'connector_credentials');
  if (creds === '') {
    findings.push({ gate: 'connector_credentials-present', message: 'create table connector_credentials not found in 0001_baseline.sql' });
  } else {
    const need: [RegExp, string][] = [
      [/state\s+credential_state not null/, "connector_credentials.state credential_state (detection sets 'degraded')"],
      [/expires_at\s+timestamptz/, 'connector_credentials.expires_at (health token-expiry countdown + expiry alert)'],
      [/connector\s+text not null/, 'connector_credentials.connector text (the degraded-mark + health key)'],
    ];
    for (const [re, label] of need) if (!re.test(creds)) findings.push({ gate: 'connector_credentials-shape', message: `expected ${label} — not found` });
  }

  // (2) rate_limit_tracker — the health-panel rate-headroom source. Column is call_limit (NOT limit) + calls_made.
  const rate = blockOf(baseline, 'rate_limit_tracker');
  if (rate === '') {
    findings.push({ gate: 'rate_limit_tracker-present', message: 'create table rate_limit_tracker not found in 0001_baseline.sql' });
  } else {
    const need: [RegExp, string][] = [
      [/call_limit\s+int not null/, 'rate_limit_tracker.call_limit int (headroom = call_limit - calls_made)'],
      [/calls_made\s+int not null/, 'rate_limit_tracker.calls_made int'],
    ];
    for (const [re, label] of need) if (!re.test(rate)) findings.push({ gate: 'rate_limit_tracker-shape', message: `expected ${label} — not found` });
  }

  // (3) credential_state enum carries 'degraded' — the value detection writes.
  if (!/create type credential_state\s+as enum \([^)]*'degraded'[^)]*\)/.test(baseline)) {
    findings.push({ gate: 'credential_state-enum', message: "credential_state enum expected to include 'degraded' (the detection target)" });
  }

  // (4) task_queue exists — the pause/resume target the paused-set FKs to.
  if (blockOf(baseline, 'task_queue') === '') {
    findings.push({ gate: 'task_queue-present', message: 'create table task_queue not found in 0001_baseline.sql (paused-set FK target)' });
  }

  // (5) event_log / access_audit sinks — the #3 never-silent targets.
  if (blockOf(baseline, 'event_log') === '') findings.push({ gate: 'event_log-present', message: 'create table event_log not found in 0001_baseline.sql' });
  if (blockOf(baseline, 'access_audit') === '') findings.push({ gate: 'access_audit-present', message: 'create table access_audit not found in 0001_baseline.sql' });

  // (6) the 0034 durable substrate this slice authored — the columns the adapter reads/writes.
  if (dsc === null) {
    findings.push({ gate: '0034-present', message: '0034_connector_disconnection_state.sql not found (the durable DSC substrate this slice authors)' });
  } else {
    const state = blockOf(dsc, 'connector_disconnection_state');
    const paused = blockOf(dsc, 'connector_disconnection_paused_tasks');
    const stateNeed: [RegExp, string][] = [
      [/detected_at\s+timestamptz not null/, 'connector_disconnection_state.detected_at (the persisted escalation-clock origin, AC-3.DSC.004.2)'],
      [/escalation_window\s+interval not null/, 'connector_disconnection_state.escalation_window interval (persisted CFG snapshot)'],
      [/status\s+disconnection_status not null/, 'connector_disconnection_state.status disconnection_status'],
      [/scope\s+disconnection_scope not null/, 'connector_disconnection_state.scope disconnection_scope'],
      [/deferred_at\s+timestamptz/, 'connector_disconnection_state.deferred_at (defer records; clock ignores it)'],
      [/escalated_at\s+timestamptz/, 'connector_disconnection_state.escalated_at'],
    ];
    for (const [re, label] of stateNeed) if (!re.test(state)) findings.push({ gate: '0034-state-shape', message: `expected ${label} — not found` });
    const pausedNeed: [RegExp, string][] = [
      [/task_id\s+uuid not null references task_queue\(id\)/, 'connector_disconnection_paused_tasks.task_id FK → task_queue(id)'],
      [/resumed_at\s+timestamptz/, 'connector_disconnection_paused_tasks.resumed_at (null while paused; survives restart)'],
      [/resume_halted\s+boolean not null/, 'connector_disconnection_paused_tasks.resume_halted (DSC.003.2 halt)'],
      [/unique \(disconnection_id, task_id\)/, 'connector_disconnection_paused_tasks UNIQUE (disconnection_id, task_id) (idempotent pause)'],
    ];
    for (const [re, label] of pausedNeed) if (!re.test(paused)) findings.push({ gate: '0034-paused-shape', message: `expected ${label} — not found` });
    if (!/create type disconnection_scope\s+as enum \('system_wide','individual'\)/.test(dsc)) findings.push({ gate: '0034-scope-enum', message: "disconnection_scope enum expected ('system_wide','individual')" });
    if (!/create type disconnection_status\s+as enum \('open','resolved','escalated'\)/.test(dsc)) findings.push({ gate: '0034-status-enum', message: "disconnection_status enum expected ('open','resolved','escalated')" });
  }

  // (7) the 0035 partial-unique open-disconnection guard (the #1 no-double-open race backstop).
  if (dscIdx === null) {
    findings.push({ gate: '0035-present', message: '0035_connector_disconnection_open_index.sql not found (the open-disconnection partial-unique guard)' });
  } else if (!/create unique index concurrently[\s\S]*connector_disconnection_open_uniq[\s\S]*where status = 'open'/.test(dscIdx)) {
    findings.push({ gate: '0035-open-index', message: "expected the partial-unique index connector_disconnection_open_uniq WHERE status='open'" });
  }

  // (8) the four CANONICAL event_type values the live sink writes MUST exist in the event_type enum (baseline +
  //     0036 additive). A missing value = a live event_log insert throws '22P02 invalid enum value' — the exact
  //     fake-passes-offline / live-throws class (the in-memory sink accepts any string). Mirrors rls-enforcement's check.
  const corpus = [baseline, dsc ?? '', read('0036_connector_disconnection_event_types.sql') ?? ''].join('\n');
  for (const evt of CONNECTOR_EVENT_TYPES) {
    const inBaselineEnum = new RegExp(`create type event_type[\\s\\S]*'${evt}'[\\s\\S]*\\);`).test(baseline);
    const addedByAlter = new RegExp(`add value if not exists '${evt}'`).test(corpus);
    if (!inBaselineEnum && !addedByAlter) {
      findings.push({ gate: 'event_type-value', message: `event_type '${evt}' is not in the baseline enum nor added by an ALTER TYPE — a live event_log write would throw (add it in 0036)` });
    }
  }

  report(findings);
  return findings;
}

function report(findings: Finding[]): void {
  if (findings.length === 0) {
    console.log(
      '✓ disconnection-recovery check: connector_credentials (state/expires_at, no token read) · rate_limit_tracker (call_limit/calls_made) · credential_state has degraded · task_queue + event_log + access_audit present · 0034 connector_disconnection_state/paused_tasks (persisted clock + paused-set) + enums · 0035 open partial-unique guard — all present in the corpus.',
    );
  } else {
    console.error(`✗ disconnection-recovery check: ${findings.length} finding(s):`);
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
