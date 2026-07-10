// ISSUE-025 — inject.ts unit tests (FR-2.RET.006 / AC-2.RET.006.1): type-tagged Business Context, provenance, and the
// Restricted-never-auto-injected hard guard.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { injectBusinessContext, typeTag } from './inject.ts';
import type { RankedMemory } from './rank.ts';
import { mkMemory } from './testkit.ts';

function ranked(m: Parameters<typeof mkMemory>[0], score = 0.5): RankedMemory {
  return { candidate: { memory: mkMemory(m), via: 'vector', similarity: 1 }, recency: 1, confidence: 0.9, entityMatch: 1, vectorSimilarity: 1, score };
}

test('type tags — [Semantic]/[Episodic]/[Procedural]', () => {
  assert.equal(typeTag('semantic'), '[Semantic]');
  assert.equal(typeTag('episodic'), '[Episodic]');
  assert.equal(typeTag('procedural'), '[Procedural]');
});

test('AC-2.RET.006.1 — each injected memory is type-tagged; provenance ids retained; text rendered', () => {
  const ctx = injectBusinessContext([
    ranked({ id: 'a', type: 'semantic', entity_ids: ['e1'], content: 'Acme prefers email' }),
    ranked({ id: 'b', type: 'procedural', entity_ids: ['e1'], content: 'Send invoices on the 1st' }),
  ]);
  assert.deepEqual(ctx.memories.map((m) => m.tag), ['[Semantic]', '[Procedural]']);
  assert.deepEqual(ctx.provenanceIds, ['a', 'b']);
  assert.match(ctx.text, /Business Context:/);
  assert.match(ctx.text, /\[Semantic\] Acme prefers email/);
  assert.equal(ctx.droppedRestricted, 0);
});

test('AC-2.RET.006.1 — a Restricted memory is NEVER auto-injected (hard guard), and the drop is surfaced', () => {
  const ctx = injectBusinessContext([
    ranked({ id: 'ok', type: 'semantic', entity_ids: ['e1'], sensitivity: 'standard' }),
    ranked({ id: 'secret', type: 'semantic', entity_ids: ['e1'], sensitivity: 'restricted' }),
  ]);
  assert.deepEqual(ctx.provenanceIds, ['ok'], 'restricted excluded from provenance');
  assert.equal(ctx.memories.find((m) => m.id === 'secret'), undefined, 'restricted not injected');
  assert.equal(ctx.droppedRestricted, 1, 'the safety-net trip is surfaced, never silent (#3)');
});

test('empty ranked set → empty context, no text', () => {
  const ctx = injectBusinessContext([]);
  assert.deepEqual(ctx.memories, []);
  assert.equal(ctx.text, '');
});
