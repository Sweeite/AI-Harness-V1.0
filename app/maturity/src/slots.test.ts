// ISSUE-030 (C2 MAT) — FR-2.MAT.001 / AC-2.MAT.001.1: an entity TYPE carries 5–8 operator-editable expected slots
// (the Maturity denominator), and the empty-slot list is exposed for onboarding gap-question seeding.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateExpectedSlots,
  emptySlots,
  expectedSlotsForType,
  normaliseSlot,
  SLOTS_MIN,
  SLOTS_MAX,
  MaturityError,
  ERR_SLOT_COUNT,
  ERR_SLOT_BLANK,
  ERR_SLOT_DUP,
} from './slots.ts';

const CLIENT_SLOTS = ['primary contact', 'contract value', 'renewal date', 'key stakeholders', 'cadence', 'known risks'];

// ── AC-2.MAT.001.1 — an entity type carries 5–8 editable slots ──────────────────────────────────────────────
test('AC-2.MAT.001.1: a 5–8-slot type validates; the bounds are ADR-002 §1 (5,8)', () => {
  assert.equal(SLOTS_MIN, 5);
  assert.equal(SLOTS_MAX, 8);
  assert.doesNotThrow(() => validateExpectedSlots({ Client: CLIENT_SLOTS })); // 6 slots
  assert.doesNotThrow(() => validateExpectedSlots({ Client: CLIENT_SLOTS.slice(0, 5) })); // lower bound 5
  assert.doesNotThrow(() => validateExpectedSlots({ Client: [...CLIENT_SLOTS, 'goals', 'channel'] })); // upper bound 8
});

/** assert.throws validator asserting a MaturityError with the given machine reason (+ optional message match). */
function isMaturityError(reason: string, msgMatch?: RegExp) {
  return (e: unknown): true => {
    assert.ok(e instanceof MaturityError, `expected a MaturityError, got ${e}`);
    assert.equal(e.reason, reason);
    if (msgMatch) assert.match(e.message, msgMatch);
    return true;
  };
}

test('AC-2.MAT.001.1: an entity type with <5 or >8 slots is rejected LOUD (denominator would be garbage-in)', () => {
  const tooFew = CLIENT_SLOTS.slice(0, 4);
  const tooMany = [...CLIENT_SLOTS, 'goals', 'channel', 'budget']; // 9
  assert.throws(() => validateExpectedSlots({ Client: tooFew }), isMaturityError(ERR_SLOT_COUNT));
  assert.throws(() => validateExpectedSlots({ Client: tooMany }), isMaturityError(ERR_SLOT_COUNT));
});

test('validateExpectedSlots: a blank slot name is rejected', () => {
  assert.throws(() => validateExpectedSlots({ Client: [...CLIENT_SLOTS.slice(0, 4), '   '] }), isMaturityError(ERR_SLOT_BLANK));
});

test('validateExpectedSlots: a duplicate slot (case/space-insensitive) is rejected — it would deflate the denominator', () => {
  const dup = ['primary contact', 'Primary Contact', 'renewal date', 'cadence', 'known risks']; // dup#1 by normalise
  assert.throws(() => validateExpectedSlots({ Client: dup }), isMaturityError(ERR_SLOT_DUP));
});

test('validateExpectedSlots validates EVERY declared type (a per-deployment map)', () => {
  const map = { Client: CLIENT_SLOTS, Contact: ['role', 'email', 'phone'] }; // Contact has only 3
  assert.throws(() => validateExpectedSlots(map), isMaturityError(ERR_SLOT_COUNT, /Contact/));
});

// ── emptySlots — the onboarding gap-question seed (FR-2.MAT.001 → FR-2.ING.008) ─────────────────────────────
test('emptySlots: returns expected MINUS filled, order-preserved, normalised comparison', () => {
  const filled = new Set(['primary contact', 'cadence']); // already normalised keys
  const empty = emptySlots(CLIENT_SLOTS, filled);
  assert.deepEqual(empty, ['contract value', 'renewal date', 'key stakeholders', 'known risks']);
});

test('emptySlots: a fully-filled entity yields no gap questions; a fresh entity yields all', () => {
  const all = new Set(CLIENT_SLOTS.map(normaliseSlot));
  assert.deepEqual(emptySlots(CLIENT_SLOTS, all), []);
  assert.deepEqual(emptySlots(CLIENT_SLOTS, new Set()), CLIENT_SLOTS);
});

test('expectedSlotsForType: a declared type returns its slots; an undeclared type returns [] (undefined denominator)', () => {
  const map = { Client: CLIENT_SLOTS };
  assert.deepEqual(expectedSlotsForType(map, 'Client'), CLIENT_SLOTS);
  assert.deepEqual(expectedSlotsForType(map, 'Meeting'), []);
});
