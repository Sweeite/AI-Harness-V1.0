// ISSUE-025 — supabase-store.ts OFFLINE tests: drive the live adapter against a fake pg exec seam to assert the SQL
// shape + row mapping + the retrieval-session contract is applied before the vector query. The REAL proof that the
// adapter agrees with the live schema is the R10 live-adapter smoke (results/live-smoke.sql), not this test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseRetrievalStore, EVT_MEMORY_READ, AUDIT_SENSITIVE_VIEW } from './supabase-store.ts';

interface Call {
  text: string;
  params: unknown[];
}

/** A fake QueryExec that records calls + returns canned rows by matching the SQL. */
function fakeExec(rowsFor: (text: string) => any[]) {
  const calls: Call[] = [];
  const exec = async (text: string, params: unknown[] = []) => {
    calls.push({ text, params });
    return { rows: rowsFor(text) as any[], rowCount: null };
  };
  return { exec: exec as any, calls };
}

const NOW = new Date().toISOString();
function dbMemory(over: Record<string, unknown> = {}) {
  return {
    id: 'm1', type: 'semantic', content: 'c', embedding: '[1,0,0]', embedding_model: 'text-embedding-3-small',
    entity_ids: ['e1'], source: 'ai_inferred', source_ref: null, confidence: '0.9', visibility: 'global',
    sensitivity: 'standard', superseded_by: null, content_hash: 'h', idempotency_key: 'k',
    expires_at: null, created_at: new Date(NOW), updated_at: new Date(NOW), ...over,
  };
}

test('keywordArm — empty entityIds short-circuits (no query)', async () => {
  const { exec, calls } = fakeExec(() => []);
  const store = new SupabaseRetrievalStore('postgres://x?sslmode=disable', exec);
  const rows = await store.keywordArm({ entityIds: [], queryEmbedding: [1, 0], vectorTopK: 20, efSearch: 40 });
  assert.deepEqual(rows, []);
  assert.equal(calls.length, 0, 'no SQL issued for an empty keyword scope');
});

test('keywordArm — array-overlap predicate; maps the row (numeric confidence + pgvector)', async () => {
  const { exec, calls } = fakeExec((t) => (/from memories/.test(t) ? [dbMemory()] : []));
  const store = new SupabaseRetrievalStore('postgres://x?sslmode=disable', exec);
  const rows = await store.keywordArm({ entityIds: ['e1'], queryEmbedding: [1, 0], vectorTopK: 20, efSearch: 40 });
  assert.match(calls[0]!.text, /entity_ids && \$1/);
  assert.equal(rows[0]!.confidence, 0.9, 'numeric confidence parsed');
  assert.deepEqual(rows[0]!.embedding, [1, 0, 0], 'pgvector string parsed');
});

test('vectorArm — applies the retrieval-session contract (set local …) BEFORE the ordered vector query', async () => {
  const { exec, calls } = fakeExec((t) => (/order by embedding/.test(t) ? [dbMemory({ similarity: '0.87' })] : []));
  const store = new SupabaseRetrievalStore('postgres://x?sslmode=disable', exec);
  const out = await store.vectorArm({ entityIds: ['e1'], queryEmbedding: [1, 0, 0], vectorTopK: 20, efSearch: 40 });
  const texts = calls.map((c) => c.text);
  // the three set-local GUCs precede the vector query, in order.
  const efIdx = texts.findIndex((t) => /set local hnsw\.ef_search/.test(t));
  const scanIdx = texts.findIndex((t) => /set local enable_seqscan = off/.test(t));
  const queryIdx = texts.findIndex((t) => /order by embedding <=>/.test(t));
  assert.ok(efIdx >= 0 && scanIdx >= 0 && queryIdx >= 0, 'all three statements issued');
  assert.ok(efIdx < queryIdx && scanIdx < queryIdx, 'the session contract is applied before the vector query');
  assert.equal(out[0]!.similarity, 0.87, 'similarity parsed');
});

test('appendReadEvent — writes event_type memory_read to event_log', async () => {
  const { exec, calls } = fakeExec(() => []);
  const store = new SupabaseRetrievalStore('postgres://x?sslmode=disable', exec);
  await store.appendReadEvent({ entityIds: ['e1'], summary: 's', payload: { a: 1 } });
  assert.match(calls[0]!.text, /insert into public\.event_log/);
  assert.equal(calls[0]!.params[0], EVT_MEMORY_READ);
});

test('appendSensitiveAudit — writes audit_type sensitive_view + the actor_type through (not a blanket system)', async () => {
  const { exec, calls } = fakeExec(() => []);
  const store = new SupabaseRetrievalStore('postgres://x?sslmode=disable', exec);
  await store.appendSensitiveAudit({ actorType: 'user', actorIdentity: 'human:austin', originatingUserId: 'u1', memoryId: 'm1', entityIds: ['e1'], sensitivity: 'restricted', pathContext: null });
  assert.match(calls[0]!.text, /insert into public\.access_audit/);
  assert.equal(calls[0]!.params[0], AUDIT_SENSITIVE_VIEW);
  assert.equal(calls[0]!.params[2], 'user', 'actor_type reflects the human path (not hardcoded system)');
  assert.equal(calls[0]!.params[3], 'u1', 'originating_user_id attributed');
});

test('keywordArm SQL is RAW (no candidate/expiry push-down) — single-clock, fake==live at the arm boundary', async () => {
  const { exec, calls } = fakeExec((t) => (/from memories/.test(t) ? [dbMemory()] : []));
  const store = new SupabaseRetrievalStore('postgres://x?sslmode=disable', exec);
  await store.keywordArm({ entityIds: ['e1'], queryEmbedding: [1, 0], vectorTopK: 20, efSearch: 40 });
  assert.match(calls[0]!.text, /where entity_ids && \$1/);
  // no WHERE-clause candidate predicates (the SELECT list naturally contains the column NAMES; assert against predicates).
  assert.doesNotMatch(calls[0]!.text, /superseded_by is null|expires_at >|expires_at is null|confidence >=/, 'no candidate/expiry/floor push-down (pipeline owns it)');
  assert.equal(calls[0]!.params.length, 1, 'only the entityIds param — no wall-clock, no floor');
});
