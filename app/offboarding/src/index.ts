// @harness/offboarding — ISSUE-083 (C10 OFF). Public surface: the pure five-step fail-closed state machine +
// gates (offboarding.ts), the OffboardingStore port + in-memory reference model (store.ts), and the live
// MANAGEMENT-plane pg adapter (supabase-store.ts). Consumes ISSUE-012's ManagementStore (client_registry +
// internal_token) via the RegistrySeam; the live export/freeze/deprovision are injected seams (AF-132/133/135,
// onboarding). Consumed by the Phase-3 UI-offboarding-wizard (renders this machine; not built here).
//
// The default export path also exposes a `check` CLI (offline build-time gate, no DB) — see runCheck().

export * from './offboarding.ts';
export * from './store.ts';
export { SupabaseOffboardingStore } from './supabase-store.ts';

// ── `check` — offline build-time non-drift gate (no DB, no network), over the MANAGEMENT-plane migrations ─────
// (app/management/migrations/, hand-applied, no journal). Asserts the shapes THIS slice's adapter depends on are
// true: client_registry (the FK target + the status this workflow drives), the client_status enum (the four
// server-authoritative values), and the 0004 offboarding_records this slice authors — its workflow_state enum, the
// nine meta-record fields, and the NFR-SEC.015 two-person CHECK. If any drifts, the live mgmt adapter would throw
// against the real DB (the fake-passes-offline / live-diverges class). Mirrors the silo `check` gates.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { WORKFLOW_STATES } from './offboarding.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const MGMT_MIGRATIONS = join(HERE, '..', '..', 'management', 'migrations');

interface Finding {
  gate: string;
  message: string;
}

export function runCheck(migrationsDir: string = MGMT_MIGRATIONS): Finding[] {
  const findings: Finding[] = [];
  const read = (f: string): string | null => {
    try {
      return readFileSync(join(migrationsDir, f), 'utf8');
    } catch {
      return null;
    }
  };

  const reg = read('0001_client_registry.sql');
  if (reg === null) {
    findings.push({ gate: 'client_registry-present', message: `0001_client_registry.sql not found in ${migrationsDir}` });
  } else {
    if (!/create table client_registry/.test(reg)) findings.push({ gate: 'client_registry', message: 'create table client_registry not found (the FK target + status this workflow drives)' });
    if (!/create type client_status as enum \('initialising', 'active', 'offboarding', 'frozen'\)/.test(reg)) {
      findings.push({ gate: 'client_status-enum', message: "client_status enum expected ('initialising','active','offboarding','frozen') — the four server-authoritative values" });
    }
    if (!/internal_token\s+text not null/.test(reg)) findings.push({ gate: 'internal_token', message: 'client_registry.internal_token not found (revoked-first at Step 4, MGT.004.3)' });
  }

  const off = read('0004_offboarding_records.sql');
  if (off === null) {
    findings.push({ gate: '0004-present', message: '0004_offboarding_records.sql not found (the mgmt-plane meta-record store this slice authors)' });
  } else {
    // the workflow_state enum must carry EVERY WorkflowState the code writes (incl. the freeze_pending / deletion_failed
    // fail-safe sub-states) — a value not in the enum = a live update throws. Strip line comments first so a `)` inside
    // a comment doesn't truncate the capture.
    const offNoComments = off.replace(/--[^\n]*/g, '');
    const enumMatch = offNoComments.match(/create type offboarding_workflow_state as enum \(([\s\S]*?)\)/);
    const values = enumMatch ? (enumMatch[1]!.match(/'([^']+)'/g)?.map((s) => s.replace(/'/g, '')) ?? []) : [];
    for (const st of WORKFLOW_STATES) {
      if (!values.includes(st)) findings.push({ gate: 'workflow_state-value', message: `offboarding_workflow_state enum missing '${st}' — a live workflow_state update would throw` });
    }
    const need: [RegExp, string][] = [
      [/create table offboarding_records/, 'create table offboarding_records'],
      [/client_slug\s+text not null references client_registry\(client_slug\)/, 'offboarding_records.client_slug FK → client_registry(client_slug)'],
      [/systems_deprovisioned\s+text\[\]/, 'offboarding_records.systems_deprovisioned text[] (meta-record field)'],
      [/tokens_revoked\s+text\[\]/, 'offboarding_records.tokens_revoked text[] (meta-record field)'],
      [/export_acknowledged_at\s+timestamptz/, 'offboarding_records.export_acknowledged_at (the sign-off gate)'],
      [/deletion_second_authoriser/, 'offboarding_records.deletion_second_authoriser (NFR-SEC.015 two-person auth)'],
      // the three-distinct-identity CHECKs (NULL-permissive `<>`) — the DB-layer enforcement of NFR-SEC.015.
      [/check \(deletion_executed_by <> deletion_authorized_by\)/, 'the two-person-auth distinct-identity CHECK (executor ≠ authoriser)'],
      [/check \(deletion_executed_by <> deletion_second_authoriser\)/, 'the two-person-auth distinct-identity CHECK (executor ≠ second)'],
      [/check \(deletion_executed_at is null/, 'the at-executed all-non-null CHECK (three identities present before executed)'],
    ];
    for (const [re, label] of need) if (!re.test(off)) findings.push({ gate: '0004-shape', message: `expected ${label} — not found` });
  }

  report(findings);
  return findings;
}

function report(findings: Finding[]): void {
  if (findings.length === 0) {
    console.log(
      '✓ offboarding check: client_registry + client_status (4 values) + internal_token present · 0004 offboarding_records (workflow_state enum covers every state incl. freeze_pending/deletion_failed · client_slug FK · systems_deprovisioned/tokens_revoked · export_acknowledged_at gate · the NFR-SEC.015 two-person distinct-identity CHECKs) — all present in the mgmt migration corpus.',
    );
  } else {
    console.error(`✗ offboarding check: ${findings.length} finding(s):`);
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
