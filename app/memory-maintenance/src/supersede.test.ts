// ISSUE-027 — FR-2.MNT.006 daily supersede safety-net. AC-2.MNT.006.1 (a contradiction missed at write time → the
// older memory is superseded, chain intact).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryMaintenanceStore } from './store.ts';
import { runSupersedeSafetyNet } from './supersede.ts';

const NOW = Date.parse('2026-07-10');
const T = (daysAgo: number) => new Date(NOW - daysAgo * 24 * 60 * 60 * 1000).toISOString();

test('freeze — a slot with a memory under active human review is NOT superseded (#2 gate bypass / #1 contested drift)', async () => {
  const store = new InMemoryMaintenanceStore();
  const older = InMemoryMaintenanceStore.memory({ type: 'semantic', content: 'budget is $10k', entity_ids: ['e1'], content_hash: 'h-old', created_at: T(5) });
  const newer = InMemoryMaintenanceStore.memory({ type: 'semantic', content: 'budget is $25k', entity_ids: ['e1'], content_hash: 'h-new', created_at: T(1) });
  store.seedMemories([older, newer]);
  store.seedUnderReview([older.id]); // a human is resolving a conflict touching this slot
  const res = await runSupersedeSafetyNet(store, NOW);
  assert.deepEqual(res.supersededIds, [], 'the contested slot is left untouched for the human');
  const all = await store.listMemories();
  assert.equal(all.find((m) => m.id === older.id)!.superseded_by, null, 'the under-review memory is NOT superseded');
});

test('AC-2.MNT.006.1 — a contradiction missed at write time is caught daily: the older memory is superseded, chain intact', async () => {
  const store = new InMemoryMaintenanceStore();
  const older = InMemoryMaintenanceStore.memory({ type: 'semantic', content: 'budget is $10k', entity_ids: ['e1'], content_hash: 'h-old', created_at: T(5) });
  const newer = InMemoryMaintenanceStore.memory({ type: 'semantic', content: 'budget is $25k', entity_ids: ['e1'], content_hash: 'h-new', created_at: T(1) });
  store.seedMemories([older, newer]);

  const res = await runSupersedeSafetyNet(store, NOW);
  assert.deepEqual(res.supersededIds, [older.id]);

  const all = await store.listMemories();
  assert.equal(all.find((m) => m.id === older.id)!.superseded_by, newer.id, 'older superseded BY the newer (CAS chain)');
  assert.equal(all.find((m) => m.id === newer.id)!.superseded_by, null, 'the survivor stays live');
  assert.equal(all.length, 2, 'nothing deleted — the chain is traceable');
});

test('a hard conflict the safety-net finds is routed to quarantine, never auto-resolved', async () => {
  const store = new InMemoryMaintenanceStore();
  const older = InMemoryMaintenanceStore.memory({ type: 'semantic', content: 'A', entity_ids: ['e1'], content_hash: 'h-a', created_at: T(5) });
  const newer = InMemoryMaintenanceStore.memory({ type: 'semantic', content: 'B', entity_ids: ['e1'], content_hash: 'h-b', created_at: T(1) });
  store.seedMemories([older, newer]);

  const res = await runSupersedeSafetyNet(store, NOW, () => 'hard');
  assert.equal(res.supersededIds.length, 0, 'a hard conflict is NOT auto-superseded');
  assert.equal(res.quarantinedPairs, 1);
  assert.ok(store.tasks.some((t) => t.kind === 'hard_conflict_quarantine' && t.targetId === older.id), 'routed to the ISSUE-028 quarantine (#1)');
  const all = await store.listMemories();
  assert.equal(all.find((m) => m.id === older.id)!.superseded_by, null, 'both stay live pending human review');
});
