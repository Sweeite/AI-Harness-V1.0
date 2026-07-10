// ISSUE-027 — FR-2.MNT.001 confidence lifecycle. AC-2.MNT.001.1 (never decay human_verified) + AC-2.MNT.001.2
// (system-of-record contradiction drops 0.20 and flags).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryMaintenanceStore } from './store.ts';
import { DEFAULT_MAINTENANCE_CONFIG } from './config.ts';
import { nextConfidence, isFrozenAgainst } from './confidence-lifecycle.ts';
import { applyConfidenceChange } from './apply.ts';
import { runSoftDecay } from './decay.ts';

const CFG = DEFAULT_MAINTENANCE_CONFIG;
const OLD = new Date(Date.parse('2026-07-10') - 400 * 24 * 60 * 60 * 1000).toISOString(); // >1yr old

test('AC-2.MNT.001.1 — a human_verified memory does not decay when the daily decay job runs', async () => {
  const store = new InMemoryMaintenanceStore();
  const hv = InMemoryMaintenanceStore.memory({ type: 'semantic', content: 'ceo is alice', entity_ids: ['e1'], source: 'human_verified', confidence: 0.7, created_at: OLD });
  store.seedMemories([hv]);

  // the freeze rule holds against the decay signal directly …
  assert.equal(isFrozenAgainst(hv, 'soft_decay', false), true);
  assert.equal(nextConfidence(hv, 'soft_decay', CFG).confidence, 0.7); // unchanged

  // … and end-to-end through the daily job: no change, no confidence-change record.
  const res = await runSoftDecay(store, CFG, Date.parse('2026-07-10'));
  const [after] = await store.listMemories();
  assert.equal(after!.confidence, 0.7, 'human_verified confidence must not decay');
  assert.equal(res.decayedIds.length, 0);
  assert.equal(store.confidenceChanges.length, 0);
});

test('AC-2.MNT.001.2 — a system-of-record contradiction drops confidence 0.20 and flags the memory', async () => {
  const store = new InMemoryMaintenanceStore();
  const m = InMemoryMaintenanceStore.memory({ type: 'semantic', content: 'price is $50', entity_ids: ['e1'], confidence: 0.9, created_at: OLD });
  store.seedMemories([m]);

  const [row] = await store.listMemories();
  const res = await applyConfidenceChange(store, row!, 'sor_contradiction', 'service_role:relevance', 'live GHL record says $80', CFG);

  assert.equal(res.moved, true);
  assert.equal(res.newConfidence, 0.7, '0.9 − 0.20 = 0.70');
  assert.equal(res.flaggedForReview, true);

  const [after] = await store.listMemories();
  assert.equal(after!.confidence, 0.7, 'the drop is persisted through the sole-writer port');

  const change = store.confidenceChanges.at(-1)!;
  assert.equal(change.cause, 'sor_contradiction');
  assert.equal(change.oldConfidence, 0.9);
  assert.equal(change.newConfidence, 0.7);

  const flag = store.tasks.find((t) => t.kind === 'soft_conflict' && t.targetId === row!.id);
  assert.ok(flag, 'the contradiction raises a review flag (#1 — evidence the brain is wrong)');
});
