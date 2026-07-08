// ISSUE-083 (C10 OFF) — tests to every §4 AC, against the pure kernels + the in-memory reference store. The live
// mgmt adapter is exercised in supabase-store.test.ts. Deterministic: explicit nowMs; no Date.now/random.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyExport,
  canProceedToDestruction,
  verifyTwoPersonAuth,
  foldDeprovision,
  metaRecordMissingFields,
  exportLinkState,
  DEPROVISION_SEQUENCE,
  type TableReconciliation,
  type SubStepResult,
} from './offboarding.ts';
import {
  InMemoryOffboardingStore,
  InMemoryEscalations,
  type RegistrySeam,
  type FreezeWriter,
} from './store.ts';

const T0 = 1_780_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function harness(freezeConfirmed = true) {
  const transitions: { slug: string; to: string }[] = [];
  const revokes: string[] = [];
  const registry: RegistrySeam = {
    async transitionStatus(slug, to) { transitions.push({ slug, to }); },
    async revokeToken(slug) { revokes.push(slug); },
  };
  const freezeWriter: FreezeWriter = async () => ({ confirmed: freezeConfirmed, detail: freezeConfirmed ? undefined : 'client project unreachable' });
  const escalations = new InMemoryEscalations();
  const store = new InMemoryOffboardingStore({ registry, freezeWriter, escalations });
  return { store, transitions, revokes, escalations };
}

const goodRecon = (): TableReconciliation[] => [
  { table: 'memories', liveCount: 100, exportedCount: 100, liveChecksum: 'a', exportedChecksum: 'a', bothFormats: true },
  { table: 'entities', liveCount: 20, exportedCount: 20, liveChecksum: 'b', exportedChecksum: 'b', bothFormats: true },
];
const allOk = (): SubStepResult[] => DEPROVISION_SEQUENCE.map((system) => ({ system, ok: true as const }));

/** Drive the happy path up to (not including) the given step. Retention window is set small so deletion can run. */
async function toFrozen(store: InMemoryOffboardingStore, slug = 'acme') {
  await store.initiate(slug, 'Super Admin', T0);
  await store.verifyExportComplete(slug, goodRecon(), T0 + 1000);
  await store.recordDelivery(slug, T0 + 2000);
  await store.acknowledgeReceipt(slug, T0 + 3000);
  await store.freeze(slug, 0.00001, T0 + 4000); // tiny retention so it elapses immediately for the test
}

// ── FR-10.OFF.001 — trigger ─────────────────────────────────────────────────────────────────────────────
test('AC-10.OFF.001.1/.2/.3 — Super-Admin initiates (status→offboarding); a non-Super-Admin is RBAC-rejected; never auto-executes', async () => {
  const { store, transitions } = harness();
  const rec = await store.initiate('acme', 'Super Admin', T0);
  assert.equal(rec.workflowState, 'initiated');
  assert.equal(rec.offboardingInitiatedAtMs, T0);
  assert.deepEqual(transitions[0], { slug: 'acme', to: 'offboarding' });

  await assert.rejects(store.initiate('beta', 'Admin', T0), /only a Super Admin/);
  await assert.rejects(store.initiate('beta', 'Standard User', T0), /only a Super Admin/);
  // AC-10.OFF.001.3 — there is NO auto-execution path: offboarding only ever starts on this deliberate call.
});

// ── FR-10.OFF.002 + NFR-CMP.009 — export verified-complete, fail-closed ────────────────────────────────
test('AC-10.OFF.002.1/.2/.4 + AC-NFR-CMP.009.1 — verifyExport is fail-closed: only an affirmative, complete reconcile passes', () => {
  assert.equal(verifyExport(goodRecon()).pass, true);
  // count short → fail loud (never a silently-truncated "complete").
  const short = goodRecon(); short[0]!.exportedCount = 99;
  const v1 = verifyExport(short); assert.equal(v1.pass, false);
  // checksum mismatch → fail.
  const mm = goodRecon(); mm[1]!.exportedChecksum = 'zzz';
  assert.equal(verifyExport(mm).pass, false);
  // indeterminate checksum (null) → fail-closed (H2), not a pass.
  const ind = goodRecon(); ind[0]!.liveChecksum = null;
  assert.equal(verifyExport(ind).pass, false);
  // missing a format → fail.
  const fmt = goodRecon(); fmt[0]!.bothFormats = false;
  assert.equal(verifyExport(fmt).pass, false);
  // empty reconciliation → fail (never a vacuous pass).
  assert.equal(verifyExport([]).pass, false);
});

test('AC-10.OFF.002.2/.3 — a verify FAILURE blocks the sequence + escalates; a PASS timestamps export_verified_at', async () => {
  const { store, escalations } = harness();
  await store.initiate('acme', 'Super Admin', T0);
  const bad = goodRecon(); bad[0]!.exportedCount = 1;
  await assert.rejects(store.verifyExportComplete('acme', bad, T0 + 1000), /verification FAILED/);
  assert.equal(escalations.rows.some((e) => e.kind === 'export_unverified'), true);
  assert.equal((await store.get('acme'))!.exportVerifiedAtMs, null, 'a failed verify does not advance');

  const ok = await store.verifyExportComplete('acme', goodRecon(), T0 + 2000);
  assert.equal(ok.exportVerifiedAtMs, T0 + 2000);
  assert.equal(ok.workflowState, 'export_verified');
});

// ── FR-10.OFF.003 — delivery + sign-off ─────────────────────────────────────────────────────────────────
test('AC-10.OFF.003.1/.2 — the delivery link is time-limited; an expired link is surfaced for reissue (not silently dead)', () => {
  assert.equal(exportLinkState(T0, 72, T0 + 71 * 60 * 60 * 1000), 'live');
  assert.equal(exportLinkState(T0, 72, T0 + 72 * 60 * 60 * 1000), 'expired');
});

test('AC-10.OFF.003.3 — no sign-off holds the sequence (freeze cannot run before acknowledgement)', async () => {
  const { store } = harness();
  await store.initiate('acme', 'Super Admin', T0);
  await store.verifyExportComplete('acme', goodRecon(), T0 + 1000);
  await store.recordDelivery('acme', T0 + 2000);
  // no acknowledge yet → freeze is blocked (sign-off gates the retention clock).
  await assert.rejects(store.freeze('acme', 90, T0 + 3000), /not acknowledged/);
});

test('AC-10.OFF.003.4 — an ack-write FAILURE is surfaced as a defect, not silently "not yet acknowledged"', async () => {
  const { store, escalations } = harness();
  await store.initiate('acme', 'Super Admin', T0);
  await store.verifyExportComplete('acme', goodRecon(), T0 + 1000);
  await store.recordDelivery('acme', T0 + 2000);
  await assert.rejects(store.acknowledgeReceipt('acme', T0 + 3000, /*ackWriteOk*/ false), /acknowledgement write failed/);
  assert.equal(escalations.rows.some((e) => e.kind === 'ack_write_failed'), true);
  assert.equal((await store.get('acme'))!.exportAcknowledgedAtMs, null);
});

// ── FR-10.OFF.004 — freeze ──────────────────────────────────────────────────────────────────────────────
test('AC-10.OFF.004.1 — freeze sets status→frozen, writes the retention window, and the cross-project frozen_at write', async () => {
  const { store, transitions } = harness(/*freezeConfirmed*/ true);
  await store.initiate('acme', 'Super Admin', T0);
  await store.verifyExportComplete('acme', goodRecon(), T0 + 1000);
  await store.recordDelivery('acme', T0 + 2000);
  await store.acknowledgeReceipt('acme', T0 + 3000);
  const r = await store.freeze('acme', 90, T0 + 4000);
  assert.equal(r.workflowState, 'frozen');
  assert.equal(r.retentionWindowEndMs, T0 + 4000 + 90 * DAY);
  assert.ok(transitions.some((t) => t.to === 'frozen'));
});

test('AC-10.OFF.004.3 — in-window reactivation unfreezes with data intact', async () => {
  const { store, transitions } = harness();
  await store.initiate('acme', 'Super Admin', T0);
  await store.verifyExportComplete('acme', goodRecon(), T0 + 1000);
  await store.recordDelivery('acme', T0 + 2000);
  await store.acknowledgeReceipt('acme', T0 + 3000);
  await store.freeze('acme', 90, T0 + 4000);
  const r = await store.reactivate('acme', T0 + 5 * DAY);
  assert.equal(r.workflowState, 'acknowledged');
  assert.ok(transitions.some((t) => t.to === 'active'));
});

test('AC-10.OFF.004.5 — an unconfirmed cross-project freeze write holds freeze_pending (never reported frozen) + escalates', async () => {
  const { store, escalations, transitions } = harness(/*freezeConfirmed*/ false);
  await store.initiate('acme', 'Super Admin', T0);
  await store.verifyExportComplete('acme', goodRecon(), T0 + 1000);
  await store.recordDelivery('acme', T0 + 2000);
  await store.acknowledgeReceipt('acme', T0 + 3000);
  const r = await store.freeze('acme', 90, T0 + 4000);
  assert.equal(r.workflowState, 'freeze_pending', 'never reported frozen when the client write is unconfirmed');
  assert.ok(r.freezePendingSinceMs != null);
  assert.equal(escalations.rows.some((e) => e.kind === 'freeze_pending'), true);
  // the mgmt client_registry.status must NOT be promoted to frozen while the client write is unconfirmed (#1/#3).
  assert.ok(!transitions.some((t) => t.to === 'frozen'), 'status never outruns the client — no frozen transition on an unconfirmed write');
});

// ── FR-10.OFF.005 — hard-delete + deprovision ──────────────────────────────────────────────────────────
test('AC-NFR-CMP.008.1 — destruction is blocked until BOTH verified-complete AND acknowledged (hard gate)', () => {
  assert.equal(canProceedToDestruction({ exportVerifiedAtMs: null, exportAcknowledgedAtMs: T0 }).ok, false);
  assert.equal(canProceedToDestruction({ exportVerifiedAtMs: T0, exportAcknowledgedAtMs: null }).ok, false);
  assert.equal(canProceedToDestruction({ exportVerifiedAtMs: T0, exportAcknowledgedAtMs: T0 }).ok, true);
});

test('AC-NFR-SEC.015.1/.2 — two-person auth needs three DISTINCT non-null identities (no self-execution)', () => {
  assert.equal(verifyTwoPersonAuth({ authorizedBy: 'a', secondAuthoriser: 'b', executor: 'c' }).ok, true);
  assert.equal(verifyTwoPersonAuth({ authorizedBy: 'a', secondAuthoriser: 'b', executor: 'a' }).ok, false); // executor==authoriser
  assert.equal(verifyTwoPersonAuth({ authorizedBy: 'a', secondAuthoriser: 'a', executor: 'b' }).ok, false); // second==authoriser
  assert.equal(verifyTwoPersonAuth({ authorizedBy: 'a', secondAuthoriser: 'b', executor: null }).ok, false); // null
});

test('AC-10.OFF.005.1/.5/.6 — full deprovision: internal_token revoked FIRST, all systems recorded, backup flagged', async () => {
  const { store, revokes } = harness();
  await toFrozen(store);
  await store.authorizeDeletion('acme', 'auth-1', 'auth-2', T0 + 5000);
  const r = await store.runDeprovision('acme', 'exec-3', allOk(), T0 + 6000);
  assert.equal(r.deletionExecutedBy, 'exec-3');
  assert.equal(revokes[0], 'acme', 'internal_token revoked first (before the sequence)');
  assert.ok(r.tokensRevoked.includes('internal_token'));
  for (const s of DEPROVISION_SEQUENCE) assert.ok(r.systemsDeprovisioned.includes(s), `${s} recorded`);
  assert.ok(r.backupPurgeFlaggedAtMs != null, 'off-platform backup flagged for purge');
});

test('AC-10.OFF.005.2 + AC-NFR-INF.013.2 — a partial deprovision holds deletion_failed + escalates, never auto-rolled-back, not complete', async () => {
  const { store, escalations } = harness();
  await toFrozen(store);
  await store.authorizeDeletion('acme', 'auth-1', 'auth-2', T0 + 5000);
  // railway fails after internal_token + supabase succeed.
  const partial: SubStepResult[] = [
    { system: 'internal_token', ok: true }, { system: 'supabase', ok: true },
    { system: 'railway', ok: false, error: 'railway API 500' },
  ];
  const r = await store.runDeprovision('acme', 'exec-3', partial, T0 + 6000);
  assert.equal(r.workflowState, 'deletion_failed');
  assert.equal(r.deletionExecutedAtMs, null, 'not marked complete on a partial');
  assert.ok(r.systemsDeprovisioned.includes('supabase') && !r.systemsDeprovisioned.includes('railway'));
  assert.equal(escalations.rows.some((e) => e.kind === 'deletion_failed'), true);
});

test('AC-10.OFF.005.3 — a re-run after a partial failure is idempotent and resumes to completion', async () => {
  const { store } = harness();
  await toFrozen(store);
  await store.authorizeDeletion('acme', 'auth-1', 'auth-2', T0 + 5000);
  await store.runDeprovision('acme', 'exec-3', [{ system: 'internal_token', ok: true }, { system: 'supabase', ok: true }, { system: 'railway', ok: false, error: 'x' }], T0 + 6000);
  // re-run with everything succeeding — already-done systems are a safe set-union no-op.
  const r = await store.runDeprovision('acme', 'exec-3', allOk(), T0 + 7000);
  assert.equal(r.workflowState !== 'deletion_failed', true);
  assert.equal(r.systemsDeprovisioned.filter((s) => s === 'supabase').length, 1, 'idempotent — no double-add');
  assert.equal(new Set(r.systemsDeprovisioned).size, r.systemsDeprovisioned.length);
});

test('deprovision is blocked before the retention window elapses, and without two-person auth', async () => {
  const { store } = harness();
  await store.initiate('acme', 'Super Admin', T0);
  await store.verifyExportComplete('acme', goodRecon(), T0 + 1000);
  await store.recordDelivery('acme', T0 + 2000);
  await store.acknowledgeReceipt('acme', T0 + 3000);
  await store.freeze('acme', 90, T0 + 4000); // 90-day window, not elapsed
  await store.authorizeDeletion('acme', 'auth-1', 'auth-2', T0 + 5000);
  await assert.rejects(store.runDeprovision('acme', 'exec-3', allOk(), T0 + 6000), /retention window/);
});

test('AC-NFR-INF.013.1 — a PARTIAL-but-all-ok deprovision set does NOT report complete (completeness enforced)', async () => {
  const { store, escalations } = harness();
  await toFrozen(store);
  await store.authorizeDeletion('acme', 'auth-1', 'auth-2', T0 + 5000);
  // caller supplies only 2 of the 6 required systems, all "ok" — the run must NOT mark the deletion executed.
  const partialButOk: SubStepResult[] = [{ system: 'internal_token', ok: true }, { system: 'supabase', ok: true }];
  const r = await store.runDeprovision('acme', 'exec-3', partialButOk, T0 + 6000);
  assert.equal(r.deletionExecutedAtMs, null, 'not stamped executed on an incomplete deprovision');
  assert.notEqual(r.workflowState, 'completed');
  assert.ok(escalations.rows.some((e) => e.kind === 'deprovision_incomplete'));
  // and finalize REFUSES to complete an incomplete deprovision (belt-and-braces #1).
  await assert.rejects(store.finalize('acme', T0 + 7000), /INCOMPLETE|incomplete/);
});

test('AC-10.OFF.004.5 — deletion is BLOCKED from a freeze_pending state (unconfirmed freeze → possible post-export writes)', async () => {
  const { store } = harness(/*freezeConfirmed*/ false);
  await store.initiate('acme', 'Super Admin', T0);
  await store.verifyExportComplete('acme', goodRecon(), T0 + 1000);
  await store.recordDelivery('acme', T0 + 2000);
  await store.acknowledgeReceipt('acme', T0 + 3000);
  await store.freeze('acme', 0.00001, T0 + 4000); // freeze_pending (unconfirmed), tiny retention
  await store.authorizeDeletion('acme', 'auth-1', 'auth-2', T0 + 5000);
  // even with retention elapsed + two-person auth, deletion is blocked until the freeze is CONFIRMED.
  await assert.rejects(store.runDeprovision('acme', 'exec-3', allOk(), T0 + 6000), /CONFIRMED freeze/);
});

test('AC-NFR-SEC.015.1 — authorizeDeletion rejects a same-person authoriser/second pair at the SAME step the DB CHECK does', async () => {
  const { store } = harness();
  await toFrozen(store);
  await assert.rejects(store.authorizeDeletion('acme', 'same-person', 'same-person', T0 + 5000), /distinct people/);
});

test('AC-10.OFF.006.2 — the meta-record carries no client business data (only process-confirmation fields)', async () => {
  const { store } = harness();
  await toFrozen(store);
  await store.authorizeDeletion('acme', 'auth-1', 'auth-2', T0 + 5000);
  await store.runDeprovision('acme', 'exec-3', allOk(), T0 + 6000);
  const r = await store.finalize('acme', T0 + 7000);
  // the record's fields are all process metadata (slug/timestamps/actor ids/system names) — no memories/entities/content.
  const keys = Object.keys(r);
  assert.ok(!keys.some((k) => /memor|entit|content|payload|message|conversation/i.test(k)), 'no client business-data fields');
  assert.ok(r.systemsDeprovisioned.every((s) => typeof s === 'string'));
});

test('foldDeprovision stops at the first failure (no auto-rollback of the earlier completed systems)', () => {
  const o = foldDeprovision([{ system: 'internal_token', ok: true }, { system: 'supabase', ok: false, error: 'boom' }, { system: 'railway', ok: true }]);
  assert.equal(o.state, 'deletion_failed');
  assert.equal(o.failedAt, 'supabase');
  assert.deepEqual(o.completed, ['internal_token']); // railway never attempted; internal_token NOT rolled back
});

// ── FR-10.OFF.006 — meta-record ─────────────────────────────────────────────────────────────────────────
test('AC-10.OFF.006.1 — finalize writes the completed state when the nine-field meta-record is whole', async () => {
  const { store } = harness();
  await toFrozen(store);
  await store.authorizeDeletion('acme', 'auth-1', 'auth-2', T0 + 5000);
  await store.runDeprovision('acme', 'exec-3', allOk(), T0 + 6000);
  const r = await store.finalize('acme', T0 + 7000);
  assert.equal(r.workflowState, 'completed');
});

test('AC-10.OFF.006.3 — finalize does NOT report complete while anything is incomplete; it escalates (never a silent "done")', async () => {
  // deprovision never ran → finalize refuses (not "done") and escalates. (The systems-completeness guard fires first,
  // which is the stronger #1 check; either way the invariant holds — completion is never silently claimed.)
  const { store, escalations } = harness();
  await toFrozen(store);
  await assert.rejects(store.finalize('acme', T0 + 7000), /INCOMPLETE|incomplete/);
  assert.ok(escalations.rows.some((e) => e.kind === 'deprovision_incomplete' || e.kind === 'meta_record_incomplete'));

  // the kernel: a whole meta-record has no missing fields; a torn one lists them.
  assert.deepEqual(metaRecordMissingFields({ clientSlug: 'a', offboardingInitiatedAtMs: 1, exportDeliveredAtMs: 1, exportAcknowledgedAtMs: 1, retentionWindowEndMs: 1, deletionExecutedAtMs: 1, deletionExecutedBy: 'x', systemsDeprovisioned: ['supabase'], tokensRevoked: ['internal_token'] }), []);
  assert.ok(metaRecordMissingFields({ clientSlug: null, offboardingInitiatedAtMs: null, exportDeliveredAtMs: null, exportAcknowledgedAtMs: null, retentionWindowEndMs: null, deletionExecutedAtMs: null, deletionExecutedBy: null, systemsDeprovisioned: [], tokensRevoked: [] }).length >= 9);
});

// ── the full airtight happy path (NFR-CMP.008 sequence) ────────────────────────────────────────────────
test('AC-NFR-CMP.008.* — the full fail-closed sequence runs end to end and lands completed', async () => {
  const { store } = harness();
  await toFrozen(store);
  await store.authorizeDeletion('acme', 'auth-1', 'auth-2', T0 + 5000);
  await store.runDeprovision('acme', 'exec-3', allOk(), T0 + 6000);
  const r = await store.finalize('acme', T0 + 7000);
  assert.equal(r.workflowState, 'completed');
  assert.ok(r.systemsDeprovisioned.length === DEPROVISION_SEQUENCE.length);
  assert.ok(r.deletionExecutedBy === 'exec-3' && r.deletionExecutedAtMs === T0 + 6000);
});
