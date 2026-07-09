// ISSUE-030 (C2 MAT) — FR-2.MAT.002: per-entity Maturity = filled slots / expected slots (binary slot-fill at v1),
// the LIVE-memory countable set, and the avg() aggregate rollup.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryMemoryStore, type EntityRow, type MemoryRow } from '../../memory/src/store.ts';
import {
  computeMaturity,
  computeFilledSlots,
  aggregateMaturity,
  isLiveMemory,
  roundMaturity,
  keywordSlotClassifier,
} from './maturity.ts';

const SLOTS = ['primary contact', 'contract value', 'renewal date', 'key stakeholders', 'cadence'];
const mem = new InMemoryMemoryStore();
const T0 = Date.parse('2026-01-01T00:00:00.000Z');
const DAY = 86_400_000;

/** A well-formed live memory whose content mentions the given slot phrase (keyword classifier fills that slot). */
function memAbout(content: string, over: Partial<MemoryRow> = {}): MemoryRow {
  return mem._memoryRow({ type: 'semantic', content, entity_ids: ['e1'], source: 'ai_inferred', visibility: 'global', sensitivity: 'standard', ...over });
}

function entity(over: Partial<EntityRow> = {}): EntityRow {
  return { id: 'e1', type: 'Client', name: 'Acme', external_refs: {}, is_internal_org: false, maturity: null, maturity_updated_at: null, created_at: new Date(T0).toISOString(), ...over };
}

// ── isLiveMemory — the countable set (non-superseded AND non-expired) ───────────────────────────────────────
test('isLiveMemory: superseded or expired memories are NOT live; a future-expiry / null-expiry live one is', () => {
  assert.equal(isLiveMemory(memAbout('x'), T0), true);
  assert.equal(isLiveMemory(memAbout('x', { superseded_by: 'newer-id' }), T0), false);
  assert.equal(isLiveMemory(memAbout('x', { expires_at: new Date(T0 - DAY).toISOString() }), T0), false); // expired
  assert.equal(isLiveMemory(memAbout('x', { expires_at: new Date(T0 + DAY).toISOString() }), T0), true); // future
});

// ── computeMaturity — filled / expected, binary, over LIVE memories ─────────────────────────────────────────
test('FR-2.MAT.002: Maturity = distinct filled slots / expected slots (binary, one memory fills a slot once)', () => {
  const memories = [
    memAbout('the primary contact is Dana'),
    memAbout('primary contact confirmed again'), // same slot — still counts once (binary/distinct)
    memAbout('contract value is $50k'),
  ];
  const r = computeMaturity(memories, SLOTS, keywordSlotClassifier, T0);
  assert.equal(r.filledCount, 2); // primary contact + contract value
  assert.equal(r.expectedCount, 5);
  assert.equal(r.maturity, roundMaturity(2 / 5)); // 0.4
  assert.deepEqual(r.empty, ['renewal date', 'key stakeholders', 'cadence']);
});

test('FR-2.MAT.002: only LIVE memories count — a superseded/expired slot-filler does not raise Maturity', () => {
  const memories = [
    memAbout('primary contact is Dana', { superseded_by: 'x' }), // dead → does not fill
    memAbout('contract value is $50k', { expires_at: new Date(T0 - DAY).toISOString() }), // expired → does not fill
    memAbout('renewal date is March'), // live → fills 1
  ];
  const r = computeMaturity(memories, SLOTS, keywordSlotClassifier, T0);
  assert.equal(r.filledCount, 1);
  assert.equal(r.maturity, roundMaturity(1 / 5));
});

test('FR-2.MAT.002: a type with NO expected slots has null Maturity (undefined denominator, not 0/0)', () => {
  const r = computeMaturity([memAbout('anything')], [], keywordSlotClassifier, T0);
  assert.equal(r.maturity, null);
  assert.equal(r.expectedCount, 0);
});

test('computeFilledSlots: a memory can only fill a DECLARED slot; unknown matches are ignored', () => {
  const classifyEverything = () => ['not a real slot', 'primary contact'];
  const { filled } = computeFilledSlots([memAbout('x')], SLOTS, classifyEverything);
  assert.deepEqual([...filled], ['primary contact']); // 'not a real slot' dropped
});

test('roundMaturity: rounds to numeric(4,3) precision (3 decimals) so the fake == the DB column', () => {
  assert.equal(roundMaturity(1 / 3), 0.333);
  assert.equal(roundMaturity(2 / 3), 0.667);
  assert.equal(roundMaturity(1), 1);
});

// ── aggregateMaturity — avg(entities.maturity), null-aware ──────────────────────────────────────────────────
test('FR-2.MAT.002 §3: aggregate = avg over entities WITH a computed Maturity; null-Maturity entities excluded', () => {
  const entities = [entity({ id: 'a', maturity: 0.4 }), entity({ id: 'b', maturity: 0.8 }), entity({ id: 'c', maturity: null })];
  assert.equal(aggregateMaturity(entities), roundMaturity((0.4 + 0.8) / 2)); // 0.6 — 'c' excluded, not counted as 0
});

test('aggregateMaturity: a fresh deployment (no computed Maturity anywhere) is null', () => {
  assert.equal(aggregateMaturity([entity({ maturity: null })]), null);
  assert.equal(aggregateMaturity([]), null);
});
