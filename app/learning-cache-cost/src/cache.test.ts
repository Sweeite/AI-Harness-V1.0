// ISSUE-066 (C8 LRN.003 / NFR-PERF.012) — the scope-aware result cache, end-to-end on the in-memory reference model.
// One test per AC in the issue §4 Definition of done that this file owns:
//   AC-8.LRN.003.1     — cached output reused within window when no in-scope entity changed.
//   AC-8.LRN.003.2     — a write to an in-scope entity invalidates the entry (write-triggered) — never a stale hit.
//   AC-8.LRN.003.3     — uncertainty (low confidence / class-write / unknown version) → miss-and-recompute.
//   AC-NFR-PERF.012.1  — invalidate-on-write drops the entry BEFORE the window expires.
//   AC-NFR-PERF.012.2  — scope/version unconfirmable → miss (recompute), never a possibly-stale hit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryCacheStore, InMemoryEventSink, EVT_CACHE_HIT, EVT_CACHE_MISS, EVT_CACHE_INVALIDATED } from './store.ts';
import { lookupCache, writeCache, invalidateOnWrite, scopeIsConfirmed, type CacheLookupRequest } from './cache.ts';

const T0 = Date.parse('2026-07-10T12:00:00.000Z');
const MIN = 60_000;

function confirmedReq(over: Partial<CacheLookupRequest> = {}): CacheLookupRequest {
  return {
    agentId: 'agent_research',
    agentType: 'research',
    scopeEntityIds: ['11111111-1111-1111-1111-111111111111'],
    memoryVersion: 'v1',
    scopeConfidence: 0.95,
    ...over,
  };
}

test('AC-8.LRN.003.1: a cached Research output is reused when the same input recurs within the window', async () => {
  const store = new InMemoryCacheStore();
  const sink = new InMemoryEventSink();
  // Cache a Research result (30-min window) for one in-scope entity at version v1.
  await writeCache(store, { agentId: 'agent_research', agentType: 'research', scopeEntityIds: ['11111111-1111-1111-1111-111111111111'], memoryVersion: 'v1', output: { summary: 'cached' } }, T0);

  // Same input 10 minutes later, no in-scope change → HIT, reuse the cached output.
  const res = await lookupCache(store, sink, sink, confirmedReq(), T0 + 10 * MIN);
  assert.equal(res.outcome, 'hit');
  assert.deepEqual(res.outcome === 'hit' ? res.entry.output : null, { summary: 'cached' });
  assert.equal(sink.ofType(EVT_CACHE_HIT).length, 1);
});

test('AC-8.LRN.003.1 (window edge): past expires_at is a MISS, not a stale reuse', async () => {
  const store = new InMemoryCacheStore();
  const sink = new InMemoryEventSink();
  await writeCache(store, { agentId: 'agent_research', agentType: 'research', scopeEntityIds: ['11111111-1111-1111-1111-111111111111'], memoryVersion: 'v1', output: { summary: 'cached' } }, T0);

  // 31 minutes later (window is 30) → expired MISS.
  const res = await lookupCache(store, sink, sink, confirmedReq(), T0 + 31 * MIN);
  assert.equal(res.outcome, 'miss');
  assert.equal(res.outcome === 'miss' ? res.reason : null, 'expired');
});

test('AC-8.LRN.003.2 / AC-NFR-PERF.012.1: a write to an in-scope entity invalidates the entry BEFORE the window expires — never a stale hit', async () => {
  const store = new InMemoryCacheStore();
  const sink = new InMemoryEventSink();
  const entity = '11111111-1111-1111-1111-111111111111';
  await writeCache(store, { agentId: 'agent_research', agentType: 'research', scopeEntityIds: [entity], memoryVersion: 'v1', output: { summary: 'cached' } }, T0);

  // The Memory Agent commits a write to the in-scope entity 5 minutes in (well within the 30-min window).
  const dropped = await invalidateOnWrite(store, sink, sink, [entity], { ms: T0 + 5 * MIN });
  assert.equal(dropped.length, 1); // the entry was invalidated
  assert.equal(sink.ofType(EVT_CACHE_INVALIDATED).length, 1);

  // A subsequent lookup at the SAME version key must now MISS (the stale entry is gone) — recompute, never a stale hit.
  const res = await lookupCache(store, sink, sink, confirmedReq({ scopeEntityIds: [entity] }), T0 + 6 * MIN);
  assert.equal(res.outcome, 'miss');
  assert.equal(res.outcome === 'miss' ? res.reason : null, 'cold');
});

test('AC-8.LRN.003.2: a write to an UNRELATED entity does NOT invalidate the entry (scope-aware, not a blanket purge)', async () => {
  const store = new InMemoryCacheStore();
  const sink = new InMemoryEventSink();
  const inScope = '11111111-1111-1111-1111-111111111111';
  const unrelated = '22222222-2222-2222-2222-222222222222';
  await writeCache(store, { agentId: 'agent_research', agentType: 'research', scopeEntityIds: [inScope], memoryVersion: 'v1', output: { summary: 'cached' } }, T0);

  const dropped = await invalidateOnWrite(store, sink, sink, [unrelated], { ms: T0 + 5 * MIN });
  assert.equal(dropped.length, 0); // scope did not intersect — entry survives

  const res = await lookupCache(store, sink, sink, confirmedReq({ scopeEntityIds: [inScope] }), T0 + 6 * MIN);
  assert.equal(res.outcome, 'hit'); // still reusable
});

test('AC-8.LRN.003.3 / AC-NFR-PERF.012.2: low entity-extraction confidence → MISS even when a fresh matching entry exists', async () => {
  const store = new InMemoryCacheStore();
  const sink = new InMemoryEventSink();
  const entity = '11111111-1111-1111-1111-111111111111';
  await writeCache(store, { agentId: 'agent_research', agentType: 'research', scopeEntityIds: [entity], memoryVersion: 'v1', output: { summary: 'cached' } }, T0);

  // A fresh entry EXISTS, but the scope confidence is below the floor → we cannot confirm scope → miss-and-recompute.
  const res = await lookupCache(store, sink, sink, confirmedReq({ scopeEntityIds: [entity], scopeConfidence: 0.4 }), T0 + 5 * MIN);
  assert.equal(res.outcome, 'miss');
  assert.equal(res.outcome === 'miss' ? res.reason : null, 'uncertain_scope');
  assert.equal(sink.ofType(EVT_CACHE_HIT).length, 0); // never served the possibly-stale entry
});

test('AC-8.LRN.003.3: an out-of-band write to a read-CLASS with no resolvable id → blind-spot-fails-safe MISS', async () => {
  const store = new InMemoryCacheStore();
  const sink = new InMemoryEventSink();
  const entity = '11111111-1111-1111-1111-111111111111';
  await writeCache(store, { agentId: 'agent_research', agentType: 'research', scopeEntityIds: [entity], memoryVersion: 'v1', output: { summary: 'cached' } }, T0);

  const res = await lookupCache(store, sink, sink, confirmedReq({ scopeEntityIds: [entity], classWriteUnresolved: true }), T0 + 5 * MIN);
  assert.equal(res.outcome, 'miss');
  assert.equal(res.outcome === 'miss' ? res.reason : null, 'uncertain_scope');
});

test('AC-NFR-PERF.012.2: an unconfirmed memory version (null) → MISS (version cannot be confirmed)', async () => {
  const store = new InMemoryCacheStore();
  const sink = new InMemoryEventSink();
  const entity = '11111111-1111-1111-1111-111111111111';
  await writeCache(store, { agentId: 'agent_research', agentType: 'research', scopeEntityIds: [entity], memoryVersion: 'v1', output: { summary: 'cached' } }, T0);

  const res = await lookupCache(store, sink, sink, confirmedReq({ scopeEntityIds: [entity], memoryVersion: null }), T0 + 5 * MIN);
  assert.equal(res.outcome, 'miss');
  assert.equal(res.outcome === 'miss' ? res.reason : null, 'uncertain_version');
});

test('scopeIsConfirmed: the miss-on-uncertainty guard is pure + independently correct', () => {
  assert.equal(scopeIsConfirmed(confirmedReq()), true);
  assert.equal(scopeIsConfirmed(confirmedReq({ scopeConfidence: 0.4 })), false);
  assert.equal(scopeIsConfirmed(confirmedReq({ scopeEntityIds: [] })), false);
  assert.equal(scopeIsConfirmed(confirmedReq({ classWriteUnresolved: true })), false);
});

test('#1: writeCache refuses a non-positive window (an entry that never expires is a stale-forever risk)', async () => {
  const store = new InMemoryCacheStore();
  await assert.rejects(
    () => writeCache(store, { agentId: 'a', agentType: 'research', scopeEntityIds: ['e'], memoryVersion: 'v1', output: {} }, T0, { research: 0, client: 60, campaign: 60, comms: 15, ops: 120, finance: 120, insight: 1440 }),
    /positive number of minutes/,
  );
});

test('#3: a primary event_log write failure is surfaced via the secondary sink, never swallowed', async () => {
  const store = new InMemoryCacheStore();
  const sink = new InMemoryEventSink();
  await writeCache(store, { agentId: 'agent_research', agentType: 'research', scopeEntityIds: ['11111111-1111-1111-1111-111111111111'], memoryVersion: 'v1', output: { summary: 'cached' } }, T0);
  sink.failNext = true; // the HIT event's primary write will throw
  const res = await lookupCache(store, sink, sink, confirmedReq(), T0 + 5 * MIN);
  assert.equal(res.outcome, 'hit'); // the lookup still succeeds
  assert.equal(sink.secondary.length, 1); // the failed observability write was surfaced, not lost
});
