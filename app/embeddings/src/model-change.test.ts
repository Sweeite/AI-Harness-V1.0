// ISSUE-023 (C2 VEC) — expand-contract model-change tests. FR-2.VEC.003 + the 100%-reconcile gate. AC-2.VEC.003.1/.2.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MODEL_CHANGE_ORDER,
  ReconcileShortfallError,
  reconcileGate,
  runModelChange,
  type ModelChangeObserver,
  type ModelChangeOps,
  type ModelChangePhase,
  type ReconcileStatus,
} from './model-change.ts';
import { InMemoryVectorAdmin, newVectorBacking, seedRows } from './store.ts';

function recordingObserver() {
  const phases: ModelChangePhase[] = [];
  const reconciles: ReconcileStatus[] = [];
  const blocked: ReconcileStatus[] = [];
  const observer: ModelChangeObserver = {
    onPhase: (p) => phases.push(p),
    onReconcile: (s) => reconciles.push(s),
    onBlocked: (s) => blocked.push(s),
  };
  return { observer, phases, reconciles, blocked };
}

test('reconcileGate: an empty corpus is 100% complete (nothing to orphan)', async () => {
  const backing = newVectorBacking();
  const status = await reconcileGate(new InMemoryVectorAdmin(backing));
  assert.equal(status.complete, true);
  assert.equal(status.completePct, 100);
});

test('reconcileGate: a partial backfill reports the shortfall and is NOT complete', async () => {
  const backing = newVectorBacking();
  seedRows(backing, { live: 10 });
  const admin = new InMemoryVectorAdmin(backing);
  // backfill only half by marking 4 rows valid
  backing.rows.slice(0, 4).forEach((r) => (r.hasValidV2 = true));
  const status = await reconcileGate(admin);
  assert.equal(status.liveRows, 10);
  assert.equal(status.validV2Rows, 4);
  assert.equal(status.shortfall, 6);
  assert.equal(status.complete, false);
  assert.equal(Math.round(status.completePct), 40);
});

test('reconcileGate: superseded/expired rows do NOT gate — only live rows must carry a valid v2', async () => {
  const backing = newVectorBacking();
  seedRows(backing, { live: 3, superseded: 5 });
  const admin = new InMemoryVectorAdmin(backing);
  backing.rows.filter((r) => r.live).forEach((r) => (r.hasValidV2 = true)); // all 3 live rows done
  const status = await reconcileGate(admin);
  assert.equal(status.liveRows, 3);
  assert.equal(status.complete, true); // the 5 superseded rows are irrelevant
});

test('AC-2.VEC.003.1 — a full model change runs expand→…→contract in order and completes', async () => {
  const backing = newVectorBacking();
  seedRows(backing, { live: 25 });
  const admin = new InMemoryVectorAdmin(backing);
  const { observer, phases } = recordingObserver();
  const status = await runModelChange('text-embedding-3-large-1536', admin, observer);
  assert.equal(status.complete, true);
  assert.deepEqual(phases, [...MODEL_CHANGE_ORDER]); // expand, backfill, reconcile_gate, switch_reads, contract, done
});

test('AC-2.VEC.003.2 — a partial backfill BLOCKS the contract step, halts loud, never drops-old', async () => {
  const backing = newVectorBacking();
  seedRows(backing, { live: 10 });
  // an ops whose backfill only embeds SOME rows (the FR-2.WRT.007 provider-fragility case) + records contract calls.
  let contractCalled = false;
  const ops: ModelChangeOps = {
    async expand() {},
    async backfill() {
      backing.rows.slice(0, 7).forEach((r) => (r.hasValidV2 = true)); // 7/10 — a shortfall
      return { embedded: 7 };
    },
    async liveRowCount() { return backing.rows.filter((r) => r.live).length; },
    async validV2Count() { return backing.rows.filter((r) => r.live && r.hasValidV2).length; },
    async switchReads() {},
    async contract() { contractCalled = true; },
  };
  const { observer, phases, blocked } = recordingObserver();

  await assert.rejects(() => runModelChange('m2', ops, observer), ReconcileShortfallError);
  assert.equal(contractCalled, false, 'contract/drop-old must NOT run on a shortfall');
  assert.equal(blocked.length, 1, 'onBlocked must fire a loud alert');
  assert.equal(blocked[0]!.shortfall, 3);
  assert.ok(!phases.includes('contract'), 'the contract phase is never entered');
  assert.ok(!phases.includes('done'));
});

test('the reconcile gate re-reads LIVE counts at gate time (a row inserted during backfill still gates)', async () => {
  const backing = newVectorBacking();
  seedRows(backing, { live: 5 });
  const ops: ModelChangeOps = {
    async expand() {},
    async backfill() {
      backing.rows.forEach((r) => (r.hasValidV2 = true)); // embeds the 5 it saw
      // a concurrent insert AFTER backfill snapshotted — a new live row with no valid v2
      seedRows(backing, { live: 1 });
      return { embedded: 5 };
    },
    async liveRowCount() { return backing.rows.filter((r) => r.live).length; },
    async validV2Count() { return backing.rows.filter((r) => r.live && r.hasValidV2).length; },
    async switchReads() {},
    async contract() {},
  };
  // the fresh live re-check catches the racing row → gate blocks (never trusts backfill's own return count).
  await assert.rejects(() => runModelChange('m2', ops), ReconcileShortfallError);
});

test('runModelChange rejects an empty target model name', async () => {
  const admin = new InMemoryVectorAdmin(newVectorBacking());
  await assert.rejects(() => runModelChange('   ', admin), /non-empty target model/);
});
