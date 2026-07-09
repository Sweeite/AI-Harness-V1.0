// ISSUE-024 (C2 WRT) — FR-2.WRT.002 contradiction classification (no/soft/hard).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyConflict, decisionStale, sameEntitySet, type Candidate } from './contradiction.ts';
import { contentHash } from '../../memory/src/memory.ts';
import type { MemoryRow } from '../../memory/src/store.ts';

function mem(partial: Partial<MemoryRow> & Pick<MemoryRow, 'id' | 'type' | 'content' | 'entity_ids'>): MemoryRow {
  return {
    embedding: [],
    embedding_model: 'text-embedding-3-small',
    source: 'ai_inferred',
    source_ref: null,
    confidence: 0.8,
    visibility: 'team',
    sensitivity: 'standard',
    superseded_by: null,
    content_hash: contentHash(partial.content),
    idempotency_key: `k:${partial.id}`,
    expires_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

test('sameEntitySet is order-independent', () => {
  assert.ok(sameEntitySet(['a', 'b'], ['b', 'a']));
  assert.ok(!sameEntitySet(['a', 'b'], ['a']));
  assert.ok(!sameEntitySet(['a'], ['a', 'b']));
});

test('no conflict when there is no same-slot live memory', () => {
  const cand: Candidate = { type: 'semantic', content: 'Acme HQ is in Boston', entity_ids: ['e1'] };
  const res = classifyConflict(cand, [mem({ id: 'm1', type: 'episodic', content: 'meeting', entity_ids: ['e1'] })]);
  assert.equal(res.kind, 'none');
});

test('AC-2.WRT.002.1 — a same-slot refinement is SOFT (supersede the prior, chain preserved)', () => {
  const cand: Candidate = { type: 'semantic', content: 'Acme HQ is in Cambridge', entity_ids: ['e1'] };
  const existing = mem({ id: 'm1', type: 'semantic', content: 'Acme HQ is in Boston', entity_ids: ['e1'] });
  const res = classifyConflict(cand, [existing]);
  assert.equal(res.kind, 'soft');
  assert.deepEqual(res.targetIds, ['m1']);
});

test('AC-2.WRT.002.2 — a writer-flagged contradiction is HARD (quarantine, never auto-overwrite)', () => {
  const cand: Candidate = { type: 'semantic', content: 'Acme is bankrupt', entity_ids: ['e1'], contradicts: true };
  const existing = mem({ id: 'm1', type: 'semantic', content: 'Acme is thriving', entity_ids: ['e1'] });
  const res = classifyConflict(cand, [existing]);
  assert.equal(res.kind, 'hard');
  assert.deepEqual(res.targetIds, ['m1']);
});

test('an exact-duplicate live memory is a no-op (none) — the idempotency key already dedups it', () => {
  const cand: Candidate = { type: 'semantic', content: 'Acme HQ is in Boston', entity_ids: ['e1'] };
  const existing = mem({ id: 'm1', type: 'semantic', content: 'Acme HQ is in Boston', entity_ids: ['e1'] });
  assert.equal(classifyConflict(cand, [existing]).kind, 'none');
});

test('a superseded memory is not a conflict target (already off the live set)', () => {
  const cand: Candidate = { type: 'semantic', content: 'Acme HQ is in Cambridge', entity_ids: ['e1'] };
  const dead = mem({ id: 'm1', type: 'semantic', content: 'Acme HQ is in Boston', entity_ids: ['e1'], superseded_by: 'm0' });
  assert.equal(classifyConflict(cand, [dead]).kind, 'none');
});

test('cross-entity-set similarity is NOT a conflict (a different fact, never a supersede target — #1)', () => {
  const cand: Candidate = { type: 'semantic', content: 'HQ is in Cambridge', entity_ids: ['e1'] };
  const other = mem({ id: 'm1', type: 'semantic', content: 'HQ is in Boston', entity_ids: ['e2'] });
  assert.equal(classifyConflict(cand, [other]).kind, 'none');
});

test('decisionStale flags a newly-arrived same-slot memory not previously known (on-race re-decide)', () => {
  const cand: Candidate = { type: 'semantic', content: 'Acme HQ is in Cambridge', entity_ids: ['e1'] };
  const known = mem({ id: 'm1', type: 'semantic', content: 'Acme HQ is in Boston', entity_ids: ['e1'] });
  const raced = mem({ id: 'm2', type: 'semantic', content: 'Acme HQ is in Denver', entity_ids: ['e1'] });
  assert.equal(decisionStale(cand, [known], ['m1']), false); // known target only → not stale
  assert.equal(decisionStale(cand, [known, raced], ['m1']), true); // m2 arrived → stale
});
