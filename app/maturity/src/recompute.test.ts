// ISSUE-030 (C2 MAT) — FR-2.MAT.002: the recompute orchestration over the MaturityStore port, end-to-end on the
// in-memory fake. Proves both clocks (daily recomputeAll + on-write recomputeOnWrite) store Maturity + stamp
// maturity_updated_at + re-roll the aggregate + advance the persisted latch + emit the loud event — AND the strongest
// form of AC-2.MAT.002.1: the latch, persisted through the store, does not re-arm on a later dip.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryMemoryStore, type EntityRow, type MemoryRow } from '../../memory/src/store.ts';
import { InMemoryMaturityStore, type MaturityConfig } from './store.ts';
import { recomputeAll, recomputeOnWrite } from './recompute.ts';

const SLOTS = ['primary contact', 'contract value', 'renewal date', 'key stakeholders', 'cadence'];
const CFG: MaturityConfig = {
  expectedSlots: { Client: SLOTS },
  coldStartBasicThreshold: 20,
  coldStartProactiveThreshold: 50,
  coldStartFullThreshold: 80,
  retrievalSufficiencyThreshold: 0.6,
};
const T0 = Date.parse('2026-03-01T12:00:00.000Z');
const mem = new InMemoryMemoryStore();

function entity(id: string, over: Partial<EntityRow> = {}): EntityRow {
  return { id, type: 'Client', name: id, external_refs: {}, is_internal_org: false, maturity: null, maturity_updated_at: null, created_at: new Date(T0).toISOString(), ...over };
}
function memAbout(entityId: string, content: string, over: Partial<MemoryRow> = {}): MemoryRow {
  return mem._memoryRow({ type: 'semantic', content, entity_ids: [entityId], source: 'ai_inferred', visibility: 'global', sensitivity: 'standard', ...over });
}
/** Four of the five Client slots filled → per-entity Maturity 0.8. */
function fourFilled(entityId: string): MemoryRow[] {
  return [
    memAbout(entityId, 'primary contact is Dana'),
    memAbout(entityId, 'contract value is $50k'),
    memAbout(entityId, 'renewal date is March'),
    memAbout(entityId, 'key stakeholders are the founders'),
  ];
}

test('FR-2.MAT.002: recomputeOnWrite stores Maturity + stamps maturity_updated_at + emits the loud event', async () => {
  const store = new InMemoryMaturityStore({ config: CFG, entities: [entity('e1')], memories: fourFilled('e1') });
  const out = await recomputeOnWrite(store, 'e1', { nowMs: T0 });
  assert.equal(out.maturity, 0.8);
  assert.equal(out.filledCount, 4);
  assert.deepEqual(out.emptySlots, ['cadence']);

  const e = await store.getEntity('e1');
  assert.equal(e?.maturity, 0.8);
  assert.equal(e?.maturity_updated_at, new Date(T0).toISOString()); // stamped

  assert.equal(store.events.length, 1);
  assert.equal(store.events[0]?.trigger, 'on_write');
  assert.equal(store.events[0]?.maturity, 0.8);
});

test('FR-2.MAT.002: recomputeAll runs the daily slow loop over every entity + rolls up the avg aggregate', async () => {
  const store = new InMemoryMaturityStore({
    config: CFG,
    entities: [entity('e1'), entity('e2')],
    memories: [...fourFilled('e1'), memAbout('e2', 'primary contact is Sam')], // e1=0.8, e2=0.2
  });
  const outs = await recomputeAll(store, { nowMs: T0 });
  assert.equal(outs.length, 2);
  assert.equal((await store.getEntity('e1'))?.maturity, 0.8);
  assert.equal((await store.getEntity('e2'))?.maturity, 0.2);
  assert.equal(outs.at(-1)?.aggregate, 0.5); // avg(0.8, 0.2)
  assert.ok(store.events.every((ev) => ev.trigger === 'daily'));
});

// ── AC-2.MAT.002.1 — the persisted latch, end-to-end, does not re-arm on a later dip ────────────────────────
test('AC-2.MAT.002.1: aggregate reaching 80% deactivates cold-start; a later dip through the store does NOT re-arm', async () => {
  const store = new InMemoryMaturityStore({ config: CFG, entities: [entity('e1')], memories: fourFilled('e1') });

  // Day 1 — 4/5 slots → aggregate 0.8 → latch trips.
  await recomputeAll(store, { nowMs: T0 });
  assert.equal((await store.readColdStartState()).deactivated, true);
  assert.equal((await store.readColdStartState()).phase, 'full');

  // Day 2 — three of the four filler memories get superseded (a bulk decay); only 1 slot remains live → 0.2.
  const survivors = [memAbout('e1', 'primary contact is Dana')];
  const dead = fourFilled('e1').slice(1).map((m) => ({ ...m, superseded_by: 'newer' }));
  store._setMemories([...survivors, ...dead]);
  await recomputeAll(store, { nowMs: T0 + 86_400_000 });

  const after = await store.readColdStartState();
  assert.equal((await store.getEntity('e1'))?.maturity, 0.2); // Maturity really dropped (0.8 → 0.2)
  assert.equal(after.deactivated, true, 'latch re-armed on a dip — MUST stay permanently off (AC-2.MAT.002.1)');
  assert.equal(after.phase, 'basic'); // phase tracks the live aggregate (20% = basic) for ISSUE-071; mode stays off
});

test('AC-2.MAT.002.1: the persisted latch survives a restart — a store seeded deactivated stays deactivated on a dip', async () => {
  // Simulate a reboot: a fresh store hydrated from the persisted latch (deactivated:true) + a now-thin brain.
  const store = new InMemoryMaturityStore({
    config: CFG,
    entities: [entity('e1', { maturity: 0.2 })],
    memories: [memAbout('e1', 'primary contact is Dana')],
    coldStart: { deactivated: true, phase: 'full' },
  });
  await recomputeAll(store, { nowMs: T0 + 172_800_000 });
  assert.equal((await store.readColdStartState()).deactivated, true); // never un-latches after a restart
});
