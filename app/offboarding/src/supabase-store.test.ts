// ISSUE-083 (C10 OFF) — the LIVE mgmt-plane adapter's SQL-shaping + gate-reuse, against a fake QueryExec (no DB).
// Proves the adapter reuses the SAME fail-closed kernels as the reference model (a gate can't be skipped live), the
// SQL targets the 0004 columns, and internal_token is revoked before the deprovision writes. The real mgmt round-trip
// is the R10 live smoke.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseOffboardingStore, type QueryExec } from './supabase-store.ts';
import { InMemoryEscalations, type RegistrySeam, type FreezeWriter } from './store.ts';
import { DEPROVISION_SEQUENCE, type SubStepResult, type TableReconciliation } from './offboarding.ts';

const T0 = 1_780_000_000_000;
const secs = (ms: number) => String(ms / 1000);

const rawRow = (over: Partial<Record<string, unknown>> = {}) => ({
  client_slug: 'acme', workflow_state: 'initiated',
  offboarding_initiated_secs: secs(T0), export_verified_secs: null, export_delivered_secs: null, export_acknowledged_secs: null,
  retention_window_end_secs: null, deletion_authorized_by: null, deletion_second_authoriser: null, deletion_executed_by: null,
  deletion_executed_secs: null, systems_deprovisioned: [], tokens_revoked: [], backup_purge_flagged_secs: null,
  freeze_pending_since_secs: null, created_secs: secs(T0), updated_secs: secs(T0), ...over,
});

function deps(freezeConfirmed = true) {
  const revokes: string[] = [];
  const transitions: string[] = [];
  const registry: RegistrySeam = { async transitionStatus(_s, to) { transitions.push(to); }, async revokeToken(s) { revokes.push(s); } };
  const freezeWriter: FreezeWriter = async () => ({ confirmed: freezeConfirmed });
  const escalations = new InMemoryEscalations();
  return { registry, freezeWriter, escalations, revokes, transitions };
}

test('initiate: Super-Admin only; inserts offboarding_records + drives client_registry→offboarding', async () => {
  const d = deps();
  const calls: string[] = [];
  const exec: QueryExec = async (text) => {
    calls.push(text);
    if (/select[\s\S]*from offboarding_records/.test(text)) return { rows: [] as never[] }; // no existing
    if (/insert into offboarding_records/.test(text)) return { rows: [rawRow()] as never[] };
    return { rows: [] as never[] };
  };
  const store = new SupabaseOffboardingStore('postgres://mgmt', { ...d, queryExec: exec });
  await assert.rejects(store.initiate('acme', 'Admin', T0), /only a Super Admin/);
  const r = await store.initiate('acme', 'Super Admin', T0);
  assert.equal(r.workflowState, 'initiated');
  assert.deepEqual(d.transitions, ['offboarding']);
  assert.ok(calls.some((c) => /insert into offboarding_records/.test(c)));
});

test('verifyExportComplete reuses the fail-closed kernel: a count-short reconcile blocks + escalates (no UPDATE)', async () => {
  const d = deps();
  let updated = false;
  const exec: QueryExec = async (text) => {
    if (/select[\s\S]*from offboarding_records/.test(text)) return { rows: [rawRow()] as never[] };
    if (/update offboarding_records/.test(text)) { updated = true; return { rows: [rawRow({ workflow_state: 'export_verified', export_verified_secs: secs(T0) })] as never[] }; }
    return { rows: [] as never[] };
  };
  const store = new SupabaseOffboardingStore('postgres://mgmt', { ...d, queryExec: exec });
  const short: TableReconciliation[] = [{ table: 'memories', liveCount: 100, exportedCount: 99, liveChecksum: 'a', exportedChecksum: 'a', bothFormats: true }];
  await assert.rejects(store.verifyExportComplete('acme', short, T0 + 1000), /verification FAILED/);
  assert.equal(updated, false, 'a failed verify never writes export_verified');
  assert.ok(d.escalations.rows.some((e) => e.kind === 'export_unverified'));
});

test('runDeprovision revokes internal_token FIRST, then writes the sequence; a partial → deletion_failed UPDATE', async () => {
  const d = deps();
  const order: string[] = [];
  // a frozen, verified+acked record whose retention window already elapsed, with two-person auth filled.
  const ready = rawRow({
    workflow_state: 'frozen', export_verified_secs: secs(T0), export_acknowledged_secs: secs(T0),
    retention_window_end_secs: secs(T0 + 1000), deletion_authorized_by: 'auth-1', deletion_second_authoriser: 'auth-2',
  });
  const exec: QueryExec = async (text) => {
    if (/select[\s\S]*from offboarding_records/.test(text)) return { rows: [ready] as never[] };
    if (/update offboarding_records set workflow_state = 'deleting'/.test(text)) { order.push('mark-deleting'); return { rows: [] as never[], rowCount: 1 }; }
    if (/workflow_state = 'deletion_failed'/.test(text)) { order.push('deletion_failed'); return { rows: [rawRow({ workflow_state: 'deletion_failed' })] as never[] }; }
    if (/update offboarding_records/.test(text)) { order.push('update'); return { rows: [rawRow()] as never[] }; }
    return { rows: [] as never[] };
  };
  const store = new SupabaseOffboardingStore('postgres://mgmt', { ...d, queryExec: exec });
  const partial: SubStepResult[] = [{ system: 'internal_token', ok: true }, { system: 'supabase', ok: true }, { system: 'railway', ok: false, error: 'x' }];
  const r = await store.runDeprovision('acme', 'exec-3', partial, T0 + 5000);
  assert.equal(r.workflowState, 'deletion_failed');
  assert.deepEqual(d.revokes, ['acme'], 'internal_token revoked (before the deprovision writes)');
  assert.ok(order.indexOf('mark-deleting') < order.indexOf('deletion_failed'));
  assert.ok(d.escalations.rows.some((e) => e.kind === 'deletion_failed'));
});

test('runDeprovision is gated: it throws before the retention window elapses (never writes)', async () => {
  const d = deps();
  const notYet = rawRow({
    workflow_state: 'frozen', export_verified_secs: secs(T0), export_acknowledged_secs: secs(T0),
    retention_window_end_secs: secs(T0 + 10 * 86400_000), deletion_authorized_by: 'a', deletion_second_authoriser: 'b',
  });
  let wrote = false;
  const exec: QueryExec = async (text) => {
    if (/select[\s\S]*from offboarding_records/.test(text)) return { rows: [notYet] as never[] };
    if (/update/.test(text)) { wrote = true; return { rows: [] as never[], rowCount: 1 }; }
    return { rows: [] as never[] };
  };
  const store = new SupabaseOffboardingStore('postgres://mgmt', { ...d, queryExec: exec });
  await assert.rejects(store.runDeprovision('acme', 'exec-3', DEPROVISION_SEQUENCE.map((system) => ({ system, ok: true as const })), T0 + 5000), /retention window/);
  assert.equal(wrote, false);
  assert.deepEqual(d.revokes, [], 'no token revoked when the gate blocks');
});

test('SQL targets the real 0004 columns (workflow_state cast, extract(epoch), text[] arrays) — no unknown column', async () => {
  const d = deps();
  const seen: string[] = [];
  const exec: QueryExec = async (text) => { seen.push(text); if (/insert/.test(text)) return { rows: [rawRow()] as never[] }; return { rows: [] as never[] }; };
  const store = new SupabaseOffboardingStore('postgres://mgmt', { ...d, queryExec: exec });
  await store.initiate('acme', 'Super Admin', T0);
  const insert = seen.find((s) => /insert into offboarding_records/.test(s))!;
  assert.match(insert, /workflow_state/);
  assert.match(insert, /offboarding_initiated_at/);
  const select = seen.find((s) => /select[\s\S]*from offboarding_records/.test(s))!;
  assert.match(select, /workflow_state::text/);
  assert.match(select, /extract\(epoch from export_acknowledged_at\)/);
});
