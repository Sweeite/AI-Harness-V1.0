// ISSUE-027 — NFR-DR.008 (append-only / decay-never-deletes durability). AC-NFR-DR.008.1: decay/merge/supersede are
// NON-DESTRUCTIVE — a low-confidence or superseded memory remains recoverable via the chain; no single-layer loss is
// total. This is enforced STRUCTURALLY: the MaintenanceStore port exposes no delete at all.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryMaintenanceStore } from './store.ts';
import { DEFAULT_MAINTENANCE_CONFIG } from './config.ts';
import { runSoftDecay } from './decay.ts';
import { runMerge } from './merge.ts';
import { runSupersedeSafetyNet } from './supersede.ts';

const CFG = DEFAULT_MAINTENANCE_CONFIG;
const NOW = Date.parse('2026-07-10');
const OLD = new Date(NOW - Math.round(8 * (365.25 / 12) * 24 * 60 * 60 * 1000)).toISOString();
const T = (daysAgo: number) => new Date(NOW - daysAgo * 24 * 60 * 60 * 1000).toISOString();

test('AC-NFR-DR.008.1 — decay, merge, and supersede never delete: every original memory stays recoverable', async () => {
  const store = new InMemoryMaintenanceStore();
  const a = InMemoryMaintenanceStore.memory({ type: 'semantic', content: 'in Austin', entity_ids: ['e1'], sensitivity: 'standard', created_at: T(9) });
  const b = InMemoryMaintenanceStore.memory({ type: 'semantic', content: 'based in Austin', entity_ids: ['e1'], sensitivity: 'standard', created_at: T(3) });
  const c = InMemoryMaintenanceStore.memory({ type: 'semantic', content: 'budget 10k', entity_ids: ['e2'], content_hash: 'h-c', created_at: T(9) });
  const d = InMemoryMaintenanceStore.memory({ type: 'semantic', content: 'budget 25k', entity_ids: ['e2'], content_hash: 'h-d', created_at: T(2) });
  const e = InMemoryMaintenanceStore.memory({ type: 'semantic', content: 'stale note', entity_ids: ['e3'], confidence: 0.7, created_at: OLD });
  const original = [a, b, c, d, e];
  store.seedMemories(original);

  await runSoftDecay(store, CFG, NOW);
  await runMerge(store, CFG, NOW);
  await runSupersedeSafetyNet(store, NOW);

  const all = await store.listMemories();
  for (const o of original) {
    assert.ok(all.find((m) => m.id === o.id), `original memory ${o.id} is still present (never deleted)`);
  }
  assert.ok(all.length >= original.length, 'the graph only grows (merged rows added); nothing is lost');

  // a decayed memory is parked, not gone; a superseded/consolidated memory is chained, not gone.
  assert.equal(all.find((m) => m.id === e.id)!.confidence, 0.665, 'e was decayed, not deleted');
  assert.notEqual(all.find((m) => m.id === c.id)!.superseded_by, null, 'c was consolidated into a chain (recoverable), not deleted');

  // structural guarantee: there is no delete on the port.
  assert.equal((store as unknown as Record<string, unknown>)['deleteMemory'], undefined, 'the port exposes no delete (#1)');
});
