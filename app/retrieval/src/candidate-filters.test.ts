// ISSUE-025 — candidate-filters.ts unit tests (FR-2.RET.003 / OD-035): confidence floor, expiry, supersession,
// applied uniformly + the system_pointer admission rule.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admitsCandidate, applyCandidateFilters, isSystemPointer } from './candidate-filters.ts';
import { mkMemory } from './testkit.ts';

const ctx = { confidenceFloor: 0.7, nowIso: '2026-07-10T00:00:00.000Z' };

test('confidence floor — below 0.7 is excluded, at/above admitted', () => {
  assert.equal(admitsCandidate(mkMemory({ entity_ids: ['e1'], confidence: 0.69 }), ctx), false);
  assert.equal(admitsCandidate(mkMemory({ entity_ids: ['e1'], confidence: 0.7 }), ctx), true);
});

test('superseded is excluded regardless of source (#1 — never resurface stale)', () => {
  assert.equal(admitsCandidate(mkMemory({ entity_ids: ['e1'], superseded_by: 'm-x', confidence: 0.99 }), ctx), false);
  assert.equal(
    admitsCandidate(mkMemory({ entity_ids: ['e1'], source: 'system_pointer', superseded_by: 'm-x' }), ctx),
    false,
    'even a system_pointer that is superseded is dropped',
  );
});

test('expiry — a past/equal expires_at is excluded, a future one admitted', () => {
  assert.equal(admitsCandidate(mkMemory({ entity_ids: ['e1'], expires_at: '2026-07-09T00:00:00.000Z' }), ctx), false, 'past');
  assert.equal(admitsCandidate(mkMemory({ entity_ids: ['e1'], expires_at: ctx.nowIso }), ctx), false, 'equal = expired');
  assert.equal(admitsCandidate(mkMemory({ entity_ids: ['e1'], expires_at: '2026-08-01T00:00:00.000Z' }), ctx), true, 'future');
  assert.equal(admitsCandidate(mkMemory({ entity_ids: ['e1'], expires_at: null }), ctx), true, 'null never expires');
});

test('system_pointer is UNSCORED — admitted on its own rule (no confidence floor), but still expiry/supersession gated', () => {
  const ptr = mkMemory({ entity_ids: ['e1'], source: 'system_pointer', confidence: null });
  assert.equal(isSystemPointer(ptr), true);
  assert.equal(admitsCandidate(ptr, ctx), true, 'null-confidence pointer admitted (OD-035)');
  assert.equal(
    admitsCandidate(mkMemory({ entity_ids: ['e1'], source: 'system_pointer', confidence: null, expires_at: '2020-01-01T00:00:00.000Z' }), ctx),
    false,
    'an expired pointer is still dropped',
  );
});

test('applyCandidateFilters is uniform over a list (AC-2.RET.003.1 — a superseded semantic match is dropped)', () => {
  const live = mkMemory({ id: 'live', entity_ids: ['e1'], confidence: 0.9 });
  const superseded = mkMemory({ id: 'stale', entity_ids: ['e1'], confidence: 0.99, superseded_by: 'live' });
  const kept = applyCandidateFilters([live, superseded], ctx);
  assert.deepEqual(kept.map((m) => m.id), ['live'], 'the superseded row is excluded from candidates');
});
