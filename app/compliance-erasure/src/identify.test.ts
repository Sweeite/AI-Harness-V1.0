// ISSUE-082 — Step-1 identification (FR-10.DEL.002 / AC-10.DEL.002.*).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandSearchTerms, identifyAffectedRecords } from './identify.ts';
import { InMemoryDeletionWorkflowStore } from './store.ts';

test('expandSearchTerms yields recall-oriented name variants + identifiers (AC-10.DEL.002.3)', () => {
  const terms = expandSearchTerms({ name: 'John Smith', identifiers: ['john@acme.com', '+1-555-0100'] });
  // full name, each part, and the "initial+family" / "given+family-initial" variants
  for (const expected of ['John Smith', 'John', 'Smith', 'JSmith', 'J Smith', 'John S', 'john@acme.com', '+1-555-0100']) {
    assert.ok(terms.includes(expected), `expected term "${expected}" in ${JSON.stringify(terms)}`);
  }
});

test('expandSearchTerms drops sub-2-char tokens (a 1-char term would match everything → #1 over-surfacing)', () => {
  const terms = expandSearchTerms({ name: 'A Bo', identifiers: ['x'] });
  assert.ok(!terms.includes('A'));
  assert.ok(!terms.includes('x'));
  assert.ok(terms.includes('Bo'));
});

test('deterministic set = entity_ids[] matches; probabilistic = content-only, excluded from the deterministic set (AC-10.DEL.002.1/.2)', async () => {
  const store = new InMemoryDeletionWorkflowStore();
  store.putEntity('target');
  store.putMemory({ id: 'm1', content: 'about the person', entity_ids: ['target'], sensitivity: 'personal' });
  store.putMemory({ id: 'm2', content: 'Contract with John Smith and Acme', entity_ids: ['acme'], sensitivity: 'confidential' });
  store.putMemory({ id: 'm3', content: 'unrelated note', entity_ids: ['other'], sensitivity: 'standard' });

  const res = await identifyAffectedRecords(store, 'target', { name: 'John Smith' });
  assert.deepEqual(res.deterministicMemoryIds, ['m1']);
  assert.equal(res.entityExists, true);
  // m2 matches by content only (not entity_id) → surfaced for confirmation; m1 excluded (already deterministic)
  assert.deepEqual(res.probabilisticCandidates.map((r) => r.id), ['m2']);
  assert.deepEqual(res.counts, { deterministic: 1, probabilistic: 1 });
});

test('a subject with no name/identifier sweeps nothing (never matches everything — #1)', async () => {
  const store = new InMemoryDeletionWorkflowStore();
  store.putMemory({ id: 'm1', content: 'x', entity_ids: ['other'], sensitivity: 'standard' });
  const res = await identifyAffectedRecords(store, 'target', {});
  assert.deepEqual(res.probabilisticCandidates, []);
  assert.deepEqual(res.searchTerms, []);
});
