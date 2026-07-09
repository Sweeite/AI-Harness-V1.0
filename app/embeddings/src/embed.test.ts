// ISSUE-023 (C2 VEC) — embed-on-write step tests. FR-2.VEC.002 (stamp 1536-dim + model) + the FR-2.WRT.007 boundary
// (typed failure the writer halts on). AC-2.VEC.002.1.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMBED_DIM,
  DEFAULT_EMBEDDING_MODEL,
  EmbeddingError,
  validateEmbedding,
  embedForWrite,
  type EmbeddingProvider,
  type EmbeddingSpendMeter,
} from './embed.ts';

/** Capture the error a synchronous fn throws (assert.throws returns undefined, so we cannot read .kind off it). */
function caught(fn: () => unknown): EmbeddingError {
  try {
    fn();
  } catch (e) {
    return e as EmbeddingError;
  }
  throw new Error('expected the function to throw, but it did not');
}

function vec(fill: number, dim = EMBED_DIM): number[] {
  return new Array(dim).fill(fill);
}
function goodVec(dim = EMBED_DIM): number[] {
  // non-degenerate: at least one non-zero, all finite
  const v = new Array(dim).fill(0.01);
  v[0] = 0.5;
  return v;
}
const okProvider = (v: number[] = goodVec()): EmbeddingProvider => ({ async embed() { return v; } });

test('validateEmbedding accepts a well-formed 1536-dim vector', () => {
  const v = goodVec();
  assert.equal(validateEmbedding(v, DEFAULT_EMBEDDING_MODEL), v);
});

test('validateEmbedding rejects a wrong-dimension vector (wrong_dim)', () => {
  assert.equal(caught(() => validateEmbedding(goodVec(768), DEFAULT_EMBEDDING_MODEL)).kind, 'wrong_dim');
});

test('validateEmbedding rejects the zero vector (degenerate — undefined cosine distance)', () => {
  assert.equal(caught(() => validateEmbedding(vec(0), DEFAULT_EMBEDDING_MODEL)).kind, 'degenerate');
});

test('validateEmbedding rejects a NaN/Infinity component (degenerate)', () => {
  const withNaN = goodVec();
  withNaN[3] = Number.NaN;
  assert.equal(caught(() => validateEmbedding(withNaN, DEFAULT_EMBEDDING_MODEL)).kind, 'degenerate');
  const withInf = goodVec();
  withInf[3] = Number.POSITIVE_INFINITY;
  assert.equal(caught(() => validateEmbedding(withInf, DEFAULT_EMBEDDING_MODEL)).kind, 'degenerate');
});

test('AC-2.VEC.002.1 — embedForWrite stamps a 1536-dim embedding + the model name', async () => {
  const out = await embedForWrite('some content', okProvider());
  assert.equal(out.dim, 1536);
  assert.equal(out.embedding.length, 1536);
  assert.equal(out.embeddingModel, DEFAULT_EMBEDDING_MODEL);
});

test('embedForWrite records the model actually used when overridden', async () => {
  const out = await embedForWrite('x', okProvider(), { model: 'text-embedding-3-large-1536' });
  assert.equal(out.embeddingModel, 'text-embedding-3-large-1536');
});

test('FR-2.WRT.007 — a provider failure becomes a typed provider_failure (writer halts the commit)', async () => {
  const failing: EmbeddingProvider = { async embed() { throw new Error('429 rate limited'); } };
  let captured: EmbeddingError | null = null;
  try { await embedForWrite('x', failing); } catch (e) { captured = e as EmbeddingError; }
  assert.ok(captured instanceof EmbeddingError);
  assert.equal(captured!.kind, 'provider_failure');
  assert.match(captured!.message, /429 rate limited/);
});

test('embedForWrite rejects a degenerate provider vector without committing (never store a bad embedding)', async () => {
  let captured: EmbeddingError | null = null;
  try { await embedForWrite('x', okProvider(vec(0))); } catch (e) { captured = e as EmbeddingError; }
  assert.ok(captured instanceof EmbeddingError);
  assert.equal(captured!.kind, 'degenerate');
});

test('embedForWrite counts spend on a successful produce (ADR-003) and NOT on failure', async () => {
  const calls: { model: string; chars: number }[] = [];
  const meter: EmbeddingSpendMeter = { countEmbedding: (model, chars) => calls.push({ model, chars }) };
  await embedForWrite('abcd', okProvider(), { meter });
  assert.deepEqual(calls, [{ model: DEFAULT_EMBEDDING_MODEL, chars: 4 }]);
  // failure path: no spend counted
  calls.length = 0;
  try { await embedForWrite('abcd', { async embed() { throw new Error('boom'); } }, { meter }); } catch { /* expected */ }
  assert.equal(calls.length, 0);
});
