// ISSUE-030 (C2 MAT) — the MaturityStore in-memory reference fake + config validation. The fake is the DB's
// reference model; these invariants are what the live pg adapter must match 1:1 (R10).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryMemoryStore, type EntityRow, type MemoryRow } from '../../memory/src/store.ts';
import {
  InMemoryMaturityStore,
  validateMaturityConfig,
  MaturityConfigError,
  type MaturityConfig,
} from './store.ts';

const T0 = Date.parse('2026-04-01T00:00:00.000Z');
const mem = new InMemoryMemoryStore();
const GOOD: MaturityConfig = {
  expectedSlots: { Client: ['a', 'b', 'c', 'd', 'e'] },
  coldStartBasicThreshold: 20,
  coldStartProactiveThreshold: 50,
  coldStartFullThreshold: 80,
  retrievalSufficiencyThreshold: 0.6,
};

function entity(id: string, over: Partial<EntityRow> = {}): EntityRow {
  return { id, type: 'Client', name: id, external_refs: {}, is_internal_org: false, maturity: null, maturity_updated_at: null, created_at: new Date(T0).toISOString(), ...over };
}
function memFor(entityId: string, over: Partial<MemoryRow> = {}): MemoryRow {
  return mem._memoryRow({ type: 'semantic', content: 'x', entity_ids: [entityId], source: 'ai_inferred', visibility: 'global', sensitivity: 'standard', ...over });
}

// ── validateMaturityConfig — LOUD rejection of an ill-ordered / out-of-range edit ───────────────────────────
test('validateMaturityConfig: a well-formed config passes', () => {
  assert.doesNotThrow(() => validateMaturityConfig(GOOD));
});

test('validateMaturityConfig: thresholds must satisfy basic ≤ proactive ≤ full (ADR-002; else an unreachable phase)', () => {
  assert.throws(() => validateMaturityConfig({ ...GOOD, coldStartProactiveThreshold: 10 }), MaturityConfigError); // proactive < basic
  assert.throws(() => validateMaturityConfig({ ...GOOD, coldStartFullThreshold: 40 }), MaturityConfigError); // full < proactive
});

test('validateMaturityConfig: a threshold out of 0–100, or a sufficiency threshold out of 0–1, is rejected', () => {
  assert.throws(() => validateMaturityConfig({ ...GOOD, coldStartFullThreshold: 120 }), MaturityConfigError);
  assert.throws(() => validateMaturityConfig({ ...GOOD, retrievalSufficiencyThreshold: 1.5 }), MaturityConfigError);
});

test('validateMaturityConfig: an ill-formed slot set (a type with <5 slots) is rejected at config validation', () => {
  assert.throws(() => validateMaturityConfig({ ...GOOD, expectedSlots: { Client: ['a', 'b'] } }), Error);
});

test('the fake rejects an ill-formed config at construction (loud, never silently absorbed)', () => {
  assert.throws(() => new InMemoryMaturityStore({ config: { ...GOOD, coldStartFullThreshold: 10 } }), MaturityConfigError);
});

// ── the port surface ────────────────────────────────────────────────────────────────────────────────────────
test('setMaturity persists Maturity + stamp; a missing entity throws (never a silent no-op, #3)', async () => {
  const store = new InMemoryMaturityStore({ config: GOOD, entities: [entity('e1')] });
  await store.setMaturity('e1', 0.6, new Date(T0).toISOString());
  const e = await store.getEntity('e1');
  assert.equal(e?.maturity, 0.6);
  assert.equal(e?.maturity_updated_at, new Date(T0).toISOString());
  await assert.rejects(() => store.setMaturity('nope', 0.5, new Date(T0).toISOString()), /not found/);
});

test('liveMemoriesForEntity returns only this entity’s LIVE memories (scoped + liveness filtered)', async () => {
  const store = new InMemoryMaturityStore({
    config: GOOD,
    entities: [entity('e1'), entity('e2')],
    memories: [
      memFor('e1'),
      memFor('e1', { superseded_by: 'x' }), // dead
      memFor('e1', { expires_at: new Date(T0 - 1000).toISOString() }), // expired
      memFor('e2'), // other entity
    ],
  });
  const live = await store.liveMemoriesForEntity('e1', T0);
  assert.equal(live.length, 1);
  assert.ok(live.every((m) => m.entity_ids.includes('e1')));
});

test('AC-2.MAT.002.1: the STORE latch is monotonic — a write carrying deactivated:false can NEVER clear a set latch', async () => {
  // The reference-model expression of the live adapter's SQL OR-guard. Simulates the lost-update a concurrent
  // recompute would attempt: after the latch is set true, a write built off a stale/dipped read (false) must NOT
  // re-arm the mode. `phase` still tracks the incoming (dipped) aggregate for ISSUE-071.
  const store = new InMemoryMaturityStore({ config: GOOD });
  await store.writeColdStartState({ deactivated: true, phase: 'full' });
  await store.writeColdStartState({ deactivated: false, phase: 'basic' }); // a stale interleaved write
  const after = await store.readColdStartState();
  assert.equal(after.deactivated, true, 'the store un-latched — MUST stay permanently off (AC-2.MAT.002.1 / #1)');
  assert.equal(after.phase, 'basic'); // phase still advances
});

test('the cold-start latch round-trips through read/write; loadConfig returns a deep clone', async () => {
  const store = new InMemoryMaturityStore({ config: GOOD });
  await store.writeColdStartState({ deactivated: true, phase: 'full' });
  assert.deepEqual(await store.readColdStartState(), { deactivated: true, phase: 'full' });

  const cfg = await store.loadConfig();
  cfg.expectedSlots['Client']!.push('mutated'); // mutate the returned copy
  const fresh = await store.loadConfig();
  assert.equal(fresh.expectedSlots['Client']?.length, 5); // the store's config is untouched
});
