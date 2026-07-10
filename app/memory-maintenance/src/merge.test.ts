// ISSUE-027 — FR-2.MNT.005 weekly merge. AC-2.MNT.005.1 (two ≥0.92-similar Standard memories collapse into one
// richer memory) + AC-2.MNT.005.2 (two ≥0.92-similar Personal memories are NOT auto-merged — FR-2.MNT.014).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryMaintenanceStore } from './store.ts';
import { DEFAULT_MAINTENANCE_CONFIG } from './config.ts';
import { runMerge, mergeCandidate } from './merge.ts';

const CFG = DEFAULT_MAINTENANCE_CONFIG;
const NOW = Date.parse('2026-07-10');
const T = (daysAgo: number) => new Date(NOW - daysAgo * 24 * 60 * 60 * 1000).toISOString();

test('AC-2.MNT.005.1 — two ≥0.92-similar Standard memories collapse into one richer memory (evidence preserved via the chain)', async () => {
  const store = new InMemoryMaintenanceStore();
  const a = InMemoryMaintenanceStore.memory({ type: 'semantic', content: 'client is in Austin', entity_ids: ['e1'], sensitivity: 'standard', created_at: T(10) });
  const b = InMemoryMaintenanceStore.memory({ type: 'semantic', content: 'client based in Austin TX', entity_ids: ['e1'], sensitivity: 'standard', created_at: T(3) });
  store.seedMemories([a, b]);
  assert.equal(mergeCandidate(a, b, CFG), true, 'same entity + tier + type, cosine 1.0 ≥ 0.92');

  const res = await runMerge(store, CFG, NOW);
  assert.equal(res.merged.length, 1);
  const mergedId = res.merged[0]!.mergedId;

  const all = await store.listMemories();
  const merged = all.find((m) => m.id === mergedId)!;
  assert.ok(merged, 'a new richer merged memory exists');
  assert.deepEqual(store.derivedFrom.get(mergedId)!.sort(), [a.id, b.id].sort(), 'it references both sources (evidence)');

  const aAfter = all.find((m) => m.id === a.id)!;
  const bAfter = all.find((m) => m.id === b.id)!;
  assert.equal(aAfter.superseded_by, mergedId, 'source a collapsed into the merged row (chain intact, never deleted)');
  assert.equal(bAfter.superseded_by, mergedId, 'source b collapsed into the merged row');
});

test('AC-2.MNT.005.2 — two ≥0.92-similar Personal memories are NOT auto-merged (queued for human approval, FR-2.MNT.014)', async () => {
  const store = new InMemoryMaintenanceStore();
  const a = InMemoryMaintenanceStore.memory({ type: 'semantic', content: 'personal note one', entity_ids: ['e1'], sensitivity: 'personal', created_at: T(10) });
  const b = InMemoryMaintenanceStore.memory({ type: 'semantic', content: 'personal note two', entity_ids: ['e1'], sensitivity: 'personal', created_at: T(3) });
  store.seedMemories([a, b]);

  const res = await runMerge(store, CFG, NOW);
  assert.equal(res.merged.length, 0, 'Personal-tier is never auto-consolidated');
  assert.deepEqual(res.personalSkipped.sort(), [a.id, b.id].sort());

  const all = await store.listMemories();
  assert.equal(all.find((m) => m.id === a.id)!.superseded_by, null, 'both Personal memories stay live');
  assert.equal(all.find((m) => m.id === b.id)!.superseded_by, null);
  assert.ok(store.tasks.some((t) => t.kind === 'personal_consolidation'), 'routed to the ISSUE-028 approval queue, never folded');
});

test('merge never crosses entities or tiers (a #1/#2 scope-blend guard)', () => {
  const a = InMemoryMaintenanceStore.memory({ type: 'semantic', content: 'x', entity_ids: ['e1'], sensitivity: 'standard' });
  const diffEntity = InMemoryMaintenanceStore.memory({ type: 'semantic', content: 'x', entity_ids: ['e2'], sensitivity: 'standard' });
  const diffTier = InMemoryMaintenanceStore.memory({ type: 'semantic', content: 'x', entity_ids: ['e1'], sensitivity: 'confidential' });
  assert.equal(mergeCandidate(a, diffEntity, CFG), false, 'never merge across entities');
  assert.equal(mergeCandidate(a, diffTier, CFG), false, 'never merge across tiers');
});
