// ISSUE-025 — rank.ts unit tests (FR-2.RET.005 / OD-169): the four normalisation shapes + procedural boost + top-N.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RETRIEVAL_CONFIG } from './config.ts';
import { entityMatchScore, rankAndTrim, recencyScore, scoreCandidates, vectorSimilarityScore } from './rank.ts';
import type { RetrievalCandidate } from './store.ts';
import { mkMemory } from './testkit.ts';

test('recency — 0.5^(age/half_life): ~1 fresh, 0.5 at one half-life, ~0.25 at two', () => {
  const now = '2026-07-10T00:00:00.000Z';
  assert.ok(Math.abs(recencyScore(now, now, 90) - 1) < 1e-9, 'fresh ≈ 1');
  const oneHalfLife = '2026-04-11T00:00:00.000Z'; // 90 days before
  assert.ok(Math.abs(recencyScore(oneHalfLife, now, 90) - 0.5) < 0.02, 'one half-life ≈ 0.5');
  // future-dated (clock skew) clamps age to 0 → recency 1, never > 1.
  assert.equal(recencyScore('2027-01-01T00:00:00.000Z', now, 90), 1);
});

test('entity-match — Jaccard overlap of task entities vs candidate entity_ids', () => {
  assert.equal(entityMatchScore(new Set(['a', 'b']), ['a', 'b']), 1, 'identical sets');
  assert.equal(entityMatchScore(new Set(['a', 'b']), ['b', 'c']), 1 / 3, '|∩|=1 |∪|=3');
  assert.equal(entityMatchScore(new Set(), ['a']), 0, 'empty task side → 0');
  assert.equal(entityMatchScore(new Set(['a']), []), 0, 'empty candidate side → 0');
});

test('vector-similarity — (cosine+1)/2 clamped to [0,1]', () => {
  assert.equal(vectorSimilarityScore(1), 1);
  assert.equal(vectorSimilarityScore(0), 0.5);
  assert.equal(vectorSimilarityScore(-1), 0);
  assert.equal(vectorSimilarityScore(2), 1, 'clamp above');
  assert.equal(vectorSimilarityScore(-2), 0, 'clamp below');
});

function cand(m: Parameters<typeof mkMemory>[0], similarity: number): RetrievalCandidate {
  return { memory: mkMemory(m), via: 'vector', similarity };
}

test('procedural boost — a procedural memory is multiplied by CFG-procedural_boost (1.2)', () => {
  const now = '2026-07-10T00:00:00.000Z';
  const ctx = { taskEntityIds: new Set<string>(['e1']), nowIso: now, config: DEFAULT_RETRIEVAL_CONFIG };
  const semantic = cand({ id: 'sem', type: 'semantic', entity_ids: ['e1'], confidence: 0.8, created_at: now }, 1);
  const procedural = cand({ id: 'proc', type: 'procedural', entity_ids: ['e1'], confidence: 0.8, created_at: now }, 1);
  const scored = scoreCandidates([semantic, procedural], ctx);
  const sem = scored.find((s) => s.candidate.memory.id === 'sem')!;
  const proc = scored.find((s) => s.candidate.memory.id === 'proc')!;
  assert.ok(Math.abs(proc.score - sem.score * 1.2) < 1e-9, 'procedural score = semantic × 1.2 (same signals)');
});

test('system_pointer — confidence term is excluded + weights renormalised (score stays comparable in [0,1])', () => {
  const now = '2026-07-10T00:00:00.000Z';
  const ctx = { taskEntityIds: new Set<string>(['e1']), nowIso: now, config: DEFAULT_RETRIEVAL_CONFIG };
  const ptr = cand({ id: 'ptr', source: 'system_pointer', confidence: null, entity_ids: ['e1'], created_at: now }, 1);
  const [scored] = scoreCandidates([ptr], ctx);
  assert.equal(scored!.confidence, null, 'confidence sub-signal is null (unscored)');
  assert.ok(scored!.score >= 0 && scored!.score <= 1, 'renormalised score in [0,1]');
  // fresh (recency 1) + full entity-match (1) + cosine 1 (vs sim 1) with confidence dropped → renormalised to 1.0.
  assert.ok(Math.abs(scored!.score - 1) < 1e-9, 'all applicable sub-signals maxed → 1.0 after renormalisation');
});

test('top-N trim — at most CFG-memories_injected_per_task, highest score first (NFR-PERF.006)', () => {
  const now = '2026-07-10T00:00:00.000Z';
  const ctx = { taskEntityIds: new Set<string>(['e1']), nowIso: now, config: { ...DEFAULT_RETRIEVAL_CONFIG, memoriesInjectedPerTask: 3 } };
  const cands = Array.from({ length: 10 }, (_, i) => cand({ id: `m${i}`, entity_ids: ['e1'], confidence: 0.8, created_at: now }, i / 10));
  const ranked = rankAndTrim(cands, ctx);
  assert.equal(ranked.length, 3, 'trimmed to N');
  assert.ok(ranked[0]!.score >= ranked[1]!.score && ranked[1]!.score >= ranked[2]!.score, 'descending by score');
});
