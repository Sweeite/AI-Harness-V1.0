// ISSUE-027 — FR-2.MNT.013 monthly embedding-cache validation. AC-2.MNT.013.1 (a memory whose content is unchanged
// is NOT re-embedded).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentHash } from '../../memory/src/memory.ts';
import { InMemoryMaintenanceStore } from './store.ts';
import { runEmbeddingCacheValidation, contentUnchanged, type Reembedder } from './embedding-cache.ts';
import type { MemoryRow } from '../../memory/src/store.ts';

const NOW = Date.parse('2026-07-10');

function spyReembedder() {
  const calls: string[] = [];
  const reembedder: Reembedder = { async reembed(m: MemoryRow) { calls.push(m.id); } };
  return { reembedder, calls };
}

test('AC-2.MNT.013.1 — a memory whose content is unchanged is not re-embedded (cache hit)', async () => {
  const store = new InMemoryMaintenanceStore();
  const unchanged = InMemoryMaintenanceStore.memory({ type: 'semantic', content: 'stable fact', entity_ids: ['e1'], content_hash: contentHash('stable fact') });
  store.seedMemories([unchanged]);
  assert.equal(contentUnchanged(unchanged), true);

  const { reembedder, calls } = spyReembedder();
  const res = await runEmbeddingCacheValidation(store, NOW, reembedder);
  assert.deepEqual(calls, [], 'unchanged content is NOT re-embedded (cost saving, ADR-003)');
  assert.deepEqual(res.skippedIds, [unchanged.id]);
  assert.equal(res.reembeddedIds.length, 0);
});

test('changed content (hash mismatch) is routed to re-embed', async () => {
  const store = new InMemoryMaintenanceStore();
  const changed = InMemoryMaintenanceStore.memory({ type: 'semantic', content: 'edited fact', entity_ids: ['e1'], content_hash: contentHash('old fact') });
  store.seedMemories([changed]);
  assert.equal(contentUnchanged(changed), false);

  const { reembedder, calls } = spyReembedder();
  const res = await runEmbeddingCacheValidation(store, NOW, reembedder);
  assert.deepEqual(calls, [changed.id], 'stale-hash content IS routed to re-embed');
  assert.deepEqual(res.reembeddedIds, [changed.id]);
});
