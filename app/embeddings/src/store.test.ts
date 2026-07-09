// ISSUE-023 (C2 VEC) — VectorAdmin in-memory reference model tests + the HNSW param-match helper (AC-2.VEC.001.1 shape).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HNSW_PARAMS,
  hnswParamsMatch,
  defaultFakeIndex,
  InMemoryVectorAdmin,
  newVectorBacking,
  seedRows,
} from './store.ts';

test('hnswParamsMatch: the documented params match; drift or absence does not', () => {
  assert.equal(hnswParamsMatch(defaultFakeIndex()), true);
  assert.equal(hnswParamsMatch(null), false);
  assert.equal(hnswParamsMatch({ ...defaultFakeIndex(), m: 8 }), false); // m drift
  assert.equal(hnswParamsMatch({ ...defaultFakeIndex(), efConstruction: 32 }), false); // ef_construction drift
  assert.equal(hnswParamsMatch({ ...defaultFakeIndex(), method: 'ivfflat' }), false); // wrong method
});

test('HNSW_PARAMS are the documented values (FR-2.VEC.001 / indexes.md)', () => {
  assert.equal(HNSW_PARAMS.m, 16);
  assert.equal(HNSW_PARAMS.efConstruction, 64);
  assert.equal(HNSW_PARAMS.opclass, 'vector_cosine_ops');
});

test('InMemoryVectorAdmin reports the fake index + a no-seqscan retrieval plan', async () => {
  const admin = new InMemoryVectorAdmin(newVectorBacking());
  const info = await admin.hnswIndexInfo();
  assert.equal(info?.name, 'memories_embedding_hnsw');
  assert.equal(hnswParamsMatch(info), true);
  const probe = await admin.explainRetrieval();
  assert.equal(probe.usesSeqScan, false);
  assert.equal(probe.usesHnswIndex, true);
});

test('a corpus with no index reports null (the assertion would fail live)', async () => {
  const admin = new InMemoryVectorAdmin(newVectorBacking(null));
  assert.equal(await admin.hnswIndexInfo(), null);
});

test('backfill embeds only live rows lacking a valid v2, and stamps the new model', async () => {
  const backing = newVectorBacking();
  seedRows(backing, { live: 6, superseded: 4, model: 'text-embedding-3-small' });
  const admin = new InMemoryVectorAdmin(backing);
  const { embedded } = await admin.backfill('text-embedding-3-large-1536');
  assert.equal(embedded, 6); // the 4 superseded rows are not re-embedded
  assert.equal(await admin.validV2Count(), 6);
  assert.equal(await admin.liveRowCount(), 6);
  assert.ok(backing.rows.filter((r) => r.live).every((r) => r.embeddingModel === 'text-embedding-3-large-1536'));
});
