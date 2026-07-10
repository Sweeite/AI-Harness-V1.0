// ISSUE-027 — FR-2.MNT.004 hard expiry. AC-2.MNT.004.1 (a memory whose expires_at has passed is EXCLUDED at
// retrieval — but not deleted).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryMaintenanceStore } from './store.ts';
import { isExpired, retrievableByExpiry, excludeExpired } from './expiry.ts';

const NOW = Date.parse('2026-07-10');

test('AC-2.MNT.004.1 — a memory whose expires_at has passed is excluded from retrieval (not deleted)', async () => {
  const expired = InMemoryMaintenanceStore.memory({ type: 'semantic', content: 'promo ends June', entity_ids: ['e1'], expires_at: new Date(NOW - 24 * 60 * 60 * 1000).toISOString() });
  const live = InMemoryMaintenanceStore.memory({ type: 'semantic', content: 'ongoing fact', entity_ids: ['e1'], expires_at: null });
  const future = InMemoryMaintenanceStore.memory({ type: 'semantic', content: 'promo ends August', entity_ids: ['e1'], expires_at: new Date(NOW + 24 * 60 * 60 * 1000).toISOString() });

  assert.equal(isExpired(expired, NOW), true);
  assert.equal(retrievableByExpiry(expired, NOW), false, 'the expired memory is excluded from retrieval');
  assert.equal(retrievableByExpiry(live, NOW), true, 'a null-expiry memory never expires');
  assert.equal(retrievableByExpiry(future, NOW), true, 'a future-expiry memory is still retrievable');

  const { retrievable, excluded } = excludeExpired([expired, live, future], NOW);
  assert.deepEqual(excluded.map((m) => m.id), [expired.id]);
  assert.deepEqual(retrievable.map((m) => m.id).sort(), [live.id, future.id].sort());

  // decay-never-deletes consistency: the excluded row is still in the store, recoverable (a future expires_at bump
  // would restore it). Exclusion is a retrieval filter, not a delete.
  const store = new InMemoryMaintenanceStore([expired, live, future]);
  const all = await store.listMemories();
  assert.equal(all.length, 3, 'the expired memory is EXCLUDED, not removed');
});
