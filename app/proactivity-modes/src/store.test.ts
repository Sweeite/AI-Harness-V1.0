// ISSUE-068 (C9 MODE) — the store/enactment suite: the Super-Admin PERM gate + denied-edit audit
// (AC-9.MODE.004.4), the write-time floor/ceiling on the persisted matrix (AC-9.MODE.004.1/.2), mode
// persistence (MODE.001/002), and the read-time Act/unknown fail-safe.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  InMemoryProactivityStore,
  StoredAutonomyMatrix,
  planMatrixWrite,
  AUDIT_ACTION_MATRIX_EDIT,
  AUDIT_ACTION_MATRIX_EDIT_DENIED,
  type AutonomyMatrixWriteRequest,
} from './store.ts';

function req(over: Partial<AutonomyMatrixWriteRequest>): AutonomyMatrixWriteRequest {
  return { subType: 'low_risk_external_nonclient', ceiling: 'prepare', actorIdentity: 'sa1', isSuperAdmin: true, ...over };
}

// ── AC-9.MODE.004.4 — a non-Super-Admin matrix edit is denied AND logged. ───────────────────────────────
test('AC-9.MODE.004.4 — non-Super-Admin matrix edit is denied + audited', async () => {
  const store = new InMemoryProactivityStore();
  const out = await store.writeMatrix(req({ isSuperAdmin: false, actorIdentity: 'analyst9' }));
  assert.equal(out.committed, false);
  assert.equal(out.denied, true);
  // the denial was logged (never silent — #3):
  assert.equal(store.audits.length, 1);
  assert.equal(store.audits[0]!.action, AUDIT_ACTION_MATRIX_EDIT_DENIED);
  assert.match(store.audits[0]!.reason, /Super-Admin only/);
  // and nothing was committed:
  const m = await store.loadMatrix();
  assert.equal(m.ceilingFor('low_risk_external_nonclient'), undefined);
});

// ── AC-9.MODE.004.1 — a Super-Admin edit to Act is rejected at write (and audited). ─────────────────────
test('AC-9.MODE.004.1 — Super-Admin cannot set any sub-type to Act (rejected + audited)', async () => {
  const store = new InMemoryProactivityStore();
  const out = await store.writeMatrix(req({ ceiling: 'act' }));
  assert.equal(out.committed, false);
  assert.equal(out.denied, true);
  assert.equal(store.audits[0]!.action, AUDIT_ACTION_MATRIX_EDIT_DENIED);
});

// ── AC-9.MODE.004.2 — a Super-Admin edit lowering a floored sub-type is rejected at write. ──────────────
test('AC-9.MODE.004.2 — floored-sub-type edit is rejected at write even for a Super-Admin', async () => {
  const store = new InMemoryProactivityStore();
  const out = await store.writeMatrix(req({ subType: 'financial_operation', ceiling: 'prepare' }));
  assert.equal(out.committed, false);
  assert.equal(out.denied, true);
});

// ── A valid Super-Admin edit commits + audits + is read back. ───────────────────────────────────────────
test('valid Super-Admin edit (low-risk-external → suggest) commits, audits, and is read back', async () => {
  const store = new InMemoryProactivityStore();
  const out = await store.writeMatrix(req({ subType: 'low_risk_external_nonclient', ceiling: 'suggest' }));
  assert.equal(out.committed, true);
  assert.equal(out.denied, false);
  assert.equal(store.audits[0]!.action, AUDIT_ACTION_MATRIX_EDIT);
  const m = await store.loadMatrix();
  assert.equal(m.ceilingFor('low_risk_external_nonclient'), 'suggest');
});

// ── planMatrixWrite always emits an audit entry (committed OR denied) — #3 never silent. ─────────────────
test('planMatrixWrite emits an audit entry for both commit and denial', () => {
  const committed = planMatrixWrite(req({}), {});
  assert.ok(committed.audit.reason.length > 0);
  assert.ok(committed.commit);
  const denied = planMatrixWrite(req({ isSuperAdmin: false }), {});
  assert.ok(denied.audit.reason.length > 0);
  assert.equal(denied.commit, undefined);
});

// ── MODE.001/002 — persistMode stamps the mode; an out-of-enum mode fails loud. ─────────────────────────
test('persistMode stamps a valid mode; rejects an out-of-enum mode (fail loud, #3)', async () => {
  const store = new InMemoryProactivityStore();
  await store.persistMode('sug-1', 'prepare');
  assert.equal(store.modeOf('sug-1'), 'prepare');
  await assert.rejects(() => store.persistMode('sug-2', 'autonomous' as never), /not a valid proactive_mode/);
});

// ── Read-time fail-safe — a poisoned Act ceiling / unknown key is dropped from a stored matrix (OD-161). ─
test('StoredAutonomyMatrix.fromValue drops Act values and unknown keys (read fail-safe)', () => {
  const m = StoredAutonomyMatrix.fromValue({
    low_risk_external_nonclient: 'act', //   Act → dropped (OD-161)
    financial_operation: 'suggest', //       floored key present → allowed into the object but never lowers assignMode's floor
    bogus_subtype: 'prepare', //             unknown key → dropped
  });
  assert.equal(m.ceilingFor('low_risk_external_nonclient'), undefined, 'Act ceiling must not survive the read');
  assert.equal(m.ceilingFor('financial_operation'), 'suggest'); // present but assignMode ignores matrix for floored
});

// ── #3 never silent — a dropped poisoned/unknown stored entry emits telemetry (not swallowed). ───────────
test('StoredAutonomyMatrix.fromValue surfaces every dropped entry via the onDrop sink (#3, not silent)', () => {
  const dropped: Array<{ key: string; value: unknown; reason: string }> = [];
  const m = StoredAutonomyMatrix.fromValue(
    {
      low_risk_external_nonclient: 'act', // Act → dropped + surfaced (OD-161)
      bogus_subtype: 'prepare', //          unknown key → dropped + surfaced
      financial_operation: 'garbage', //    invalid mode → dropped + surfaced
      system_of_record_comms: 'suggest', // valid → kept, NOT surfaced
    },
    (key, value, reason) => dropped.push({ key, value, reason }),
  );
  // exactly the three poisoned entries were surfaced, none silently swallowed:
  const keys = dropped.map((d) => d.key).sort();
  assert.deepEqual(keys, ['bogus_subtype', 'financial_operation', 'low_risk_external_nonclient']);
  for (const d of dropped) assert.ok(d.reason.length > 0, 'a drop reason is never empty (#3)');
  // the valid entry survived and was not reported as dropped:
  assert.equal(m.ceilingFor('system_of_record_comms'), 'suggest');
});
