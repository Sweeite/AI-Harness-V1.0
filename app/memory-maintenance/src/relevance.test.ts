// ISSUE-027 — FR-2.MNT.011 relevance erosion (on-use + monthly). AC-2.MNT.011.1 (a used memory contradicted by live
// tool data → an immediate soft-conflict flag).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryMaintenanceStore } from './store.ts';
import { DEFAULT_MAINTENANCE_CONFIG } from './config.ts';
import { crossCheckOnUse, runRelevanceSweep, type LiveDataCrossCheck } from './relevance.ts';

const CFG = DEFAULT_MAINTENANCE_CONFIG;
const NOW = Date.parse('2026-07-10');

const checker = (verdict: 'confirms' | 'contradicts' | 'unknown'): LiveDataCrossCheck => ({ async check() { return verdict; } });

test('AC-2.MNT.011.1 — a used memory contradicted by live tool data raises an immediate soft-conflict flag', async () => {
  const store = new InMemoryMaintenanceStore();
  const m = InMemoryMaintenanceStore.memory({ type: 'semantic', content: 'phone is 555-1000', entity_ids: ['e1'], confidence: 0.8 });
  store.seedMemories([m]);
  const [row] = await store.listMemories();

  const res = await crossCheckOnUse(store, row!, checker('contradicts'), CFG, 'run-42', NOW);
  assert.equal(res.softConflictRaised, true);
  assert.ok(store.tasks.some((t) => t.kind === 'soft_conflict' && t.targetId === m.id), 'immediate soft-conflict flag via the WRT.002 path');
});

test('a used memory confirmed by live tool data affirms confidence (+corroboration)', async () => {
  const store = new InMemoryMaintenanceStore();
  const m = InMemoryMaintenanceStore.memory({ type: 'semantic', content: 'phone is 555-1000', entity_ids: ['e1'], confidence: 0.8 });
  store.seedMemories([m]);
  const [row] = await store.listMemories();
  const res = await crossCheckOnUse(store, row!, checker('confirms'), CFG, 'run-42', NOW);
  assert.equal(res.affirmed, true);
  const [after] = await store.listMemories();
  assert.equal(after!.confidence, 0.85, '0.80 + 0.05 corroboration');
});

test('the monthly sweep flags a memory neither retrieved nor confirmed within the window', async () => {
  const store = new InMemoryMaintenanceStore();
  const old = new Date(NOW - 40 * 24 * 60 * 60 * 1000).toISOString();
  const m = InMemoryMaintenanceStore.memory({ type: 'semantic', content: 'stale', entity_ids: ['e1'], created_at: old, updated_at: old });
  store.seedMemories([m]);
  const res = await runRelevanceSweep(store, CFG, NOW);
  assert.deepEqual(res.flaggedIds, [m.id]);
  assert.ok(store.tasks.some((t) => t.kind === 'relevance_review'));
});
