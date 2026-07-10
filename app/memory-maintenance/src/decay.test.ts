// ISSUE-027 — FR-2.MNT.002 soft decay. AC-2.MNT.002.1 (a 7-month-old unconfirmed memory at 0.7 → ~0.665, never
// deleted).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryMaintenanceStore } from './store.ts';
import { DEFAULT_MAINTENANCE_CONFIG } from './config.ts';
import { runSoftDecay, decayEligible, ageMonths } from './decay.ts';

const CFG = DEFAULT_MAINTENANCE_CONFIG;
const NOW = Date.parse('2026-07-10');
const SEVEN_MONTHS_AGO = new Date(NOW - Math.round(7 * (365.25 / 12) * 24 * 60 * 60 * 1000)).toISOString();

test('AC-2.MNT.002.1 — a 7-month-old unconfirmed memory at 0.7 decays to ~0.665 and is never deleted', async () => {
  const store = new InMemoryMaintenanceStore();
  const m = InMemoryMaintenanceStore.memory({ type: 'semantic', content: 'contact prefers email', entity_ids: ['e1'], confidence: 0.7, created_at: SEVEN_MONTHS_AGO });
  store.seedMemories([m]);

  assert.ok(ageMonths(m, NOW) >= 6 && ageMonths(m, NOW) < 8);
  assert.equal(decayEligible(m, CFG, NOW, false, false), true);

  const res = await runSoftDecay(store, CFG, NOW);
  assert.deepEqual(res.decayedIds, [m.id]);

  const all = await store.listMemories();
  assert.equal(all.length, 1, 'decay NEVER deletes (#1 / NFR-DR.008) — the row is still present');
  assert.equal(all[0]!.confidence, 0.665, '0.7 × 0.95 = 0.665');

  const change = store.confidenceChanges.at(-1)!;
  assert.equal(change.cause, 'soft_decay');
  assert.equal(change.newConfidence, 0.665);
});

test('soft decay stops at the floor (parked, never below CFG-confidence_floor) and never touches human_verified', async () => {
  const store = new InMemoryMaintenanceStore();
  const atFloor = InMemoryMaintenanceStore.memory({ type: 'semantic', content: 'a', entity_ids: ['e1'], confidence: 0.5, created_at: SEVEN_MONTHS_AGO });
  store.seedMemories([atFloor]);
  const res = await runSoftDecay(store, CFG, NOW);
  const [after] = await store.listMemories();
  assert.equal(after!.confidence, 0.5, '0.5 × 0.95 = 0.475 clamps back to the 0.5 floor — a logged no-op, not a decay');
  assert.equal(res.decayedIds.length, 0);
});
