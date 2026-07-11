// ISSUE-029 — the transitive walk + classification (the #1/#2 crux). Proven on the InMemory graph.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryErasureStore } from './store.ts';
import { computeErasureWalk } from './walk.ts';

const T = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; // the erased target entity
const O = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'; // another entity (co-occurring)
const m = InMemoryErasureStore.memory;
const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

test('single-entity Personal rows go to the delete set (AC-2.MNT.017.1)', async () => {
  const store = new InMemoryErasureStore();
  store.put(m({ id: 's1', entity_ids: [T], type: 'semantic' }));
  store.put(m({ id: 'e1', entity_ids: [T], type: 'episodic' })); // episodic evidence — a memory_type, deleted with the rest
  const w = await computeErasureWalk(store, T);
  assert.deepEqual(ids(w.deleteSet), ['e1', 's1']);
  assert.deepEqual(w.retainForScrub, []);
});

test('the full superseded_by chain is pulled transitively — older AND newer versions (no chain residue)', async () => {
  const store = new InMemoryErasureStore();
  // chain: t ← w1 ← w2 (head). Resolve seeds only the live head w2 (all reference T); the walk pulls the whole chain.
  store.put(m({ id: 't', entity_ids: [T], superseded_by: 'w1' }));
  store.put(m({ id: 'w1', entity_ids: [T], superseded_by: 'w2' }));
  store.put(m({ id: 'w2', entity_ids: [T], superseded_by: null }));
  const w = await computeErasureWalk(store, T);
  assert.deepEqual(ids(w.deleteSet), ['t', 'w1', 'w2']);
});

test('a chain member reached via the supersede graph that does NOT reference the target is EXCLUDED, never deleted (#1 — could be another subject)', async () => {
  const store = new InMemoryErasureStore();
  store.put(m({ id: 'other', entity_ids: [O], superseded_by: 'live' })); // reached via backward-supersede; O's data
  store.put(m({ id: 'live', entity_ids: [T], superseded_by: null }));
  const w = await computeErasureWalk(store, T);
  assert.deepEqual(ids(w.deleteSet), ['live'], 'only the target row is deleted');
  assert.deepEqual(ids(w.excluded), ['other'], 'the non-target-referencing chain member is excluded (not deleted)');
});

test('THE BLOCKER regression: a consolidation shared-supersede does NOT delete the other subject\'s independent source', async () => {
  // conflict-consolidation applyConsolidation CAS-supersedes EVERY source into one merge:
  //   S_alice[alice], S_bob[bob] both superseded_by D[alice,bob] (derived_from = [S_alice, S_bob]).
  // Erasing alice must delete S_alice + D, but NEVER S_bob (that would destroy bob's independent memory).
  const ALICE = T;
  const BOB = O;
  const store = new InMemoryErasureStore();
  store.put(m({ id: 'S_alice', entity_ids: [ALICE], superseded_by: 'D' }));
  store.put(m({ id: 'S_bob', entity_ids: [BOB], superseded_by: 'D' }));
  store.put(m({ id: 'D', entity_ids: [ALICE, BOB], type: 'semantic', superseded_by: null }), ['S_alice', 'S_bob']);
  const w = await computeErasureWalk(store, ALICE);
  assert.ok(ids(w.deleteSet).includes('S_alice'), 'alice\'s source is deleted');
  assert.ok(ids(w.deleteSet).includes('D'), 'the merge folding alice is deleted (derived → recomputable)');
  assert.ok(!ids(w.deleteSet).includes('S_bob'), 'BOB\'S INDEPENDENT SOURCE IS NOT DELETED (the #1 over-erasure the BLOCKER fix prevents)');
  assert.deepEqual(ids(w.excluded), ['S_bob'], 'bob\'s source is excluded (it will be relinked live when D is deleted)');
});

test('a derived (merge/summary) row that folded a target source is deleted — recomputable, no residue (AC-2.MNT.017.3)', async () => {
  const store = new InMemoryErasureStore();
  store.put(m({ id: 'src', entity_ids: [T] }));
  store.put(m({ id: 'other', entity_ids: [O] }));
  store.put(m({ id: 'merged', entity_ids: [T, O], type: 'semantic' }), ['src', 'other']); // derived_from = [src, other]
  const w = await computeErasureWalk(store, T);
  // src + merged are erased; `other` (an independent primary of O) is NOT reached (it never references T and is not derived from a T row).
  assert.ok(ids(w.deleteSet).includes('merged'), 'the derived row is deleted even though it is multi-entity (it is recomputable)');
  assert.ok(ids(w.deleteSet).includes('src'));
  assert.ok(!ids(w.deleteSet).includes('other'), 'an independent primary of another entity is untouched (#1 — no collateral loss)');
});

test('THE residue case: a derived row re-tagged AWAY from the target (Standard, no target entity_id) is STILL reached via the derived_from edge and deleted (AC-2.MNT.017.3)', async () => {
  const store = new InMemoryErasureStore();
  store.put(m({ id: 'src', entity_ids: [T], sensitivity: 'personal' }));
  // a summary that folded the target's Personal content but is now tagged Standard + entity [O] — the exact way
  // Personal data could "survive re-tagged" that OD-204's provenance edge exists to catch.
  store.put(m({ id: 'summary', entity_ids: [O], sensitivity: 'standard', type: 'semantic' }), ['src']);
  const w = await computeErasureWalk(store, T);
  assert.ok(ids(w.deleteSet).includes('summary'), 'the re-tagged derived row is reached by derived_from and deleted — no residue');
  assert.ok(ids(w.deleteSet).includes('src'));
  assert.deepEqual(w.retainForScrub, [], 'the derived row is deleted (recomputable), not retained');
});

test('grand-derived rows are reached to a fixpoint (a derived row can itself be a source)', async () => {
  const store = new InMemoryErasureStore();
  store.put(m({ id: 'src', entity_ids: [T] }));
  store.put(m({ id: 'd1', entity_ids: [T] }), ['src']);
  store.put(m({ id: 'd2', entity_ids: [T] }), ['d1']); // derived from the derived row
  const w = await computeErasureWalk(store, T);
  assert.deepEqual(ids(w.deleteSet), ['d1', 'd2', 'src']);
});

test('a multi-entity PRIMARY (non-derived) row is RETAINED for scrub, never deleted (AC-NFR-CMP.005.2 / #1)', async () => {
  const store = new InMemoryErasureStore();
  store.put(m({ id: 'shared', entity_ids: [T, O], type: 'semantic' })); // no derived_from → a primary co-authored row
  const w = await computeErasureWalk(store, T);
  assert.deepEqual(w.deleteSet, [], 'not deleted — that would destroy O\'s original data');
  assert.deepEqual(ids(w.retainForScrub), ['shared'], 'retained + surfaced for C10 content-scrub');
});

test('only Personal-tier rows are in the erasure remit (a Standard row referencing the target is out of scope)', async () => {
  const store = new InMemoryErasureStore();
  store.put(m({ id: 'p', entity_ids: [T], sensitivity: 'personal' }));
  store.put(m({ id: 'std', entity_ids: [T], sensitivity: 'standard' }));
  const w = await computeErasureWalk(store, T);
  assert.deepEqual(ids(w.deleteSet), ['p']);
});
