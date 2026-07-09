// ISSUE-030 (C2 MAT) — FR-2.MAT.002 / AC-2.MAT.002.1: the one-time cold-start MODE state machine is a ONE-WAY LATCH.
// Once aggregate Maturity crosses cold_start_full_threshold (80%) the mode deactivates PERMANENTLY and NEVER re-arms
// on a later dip. Pure-reducer level proof; recompute.test.ts proves it end-to-end over the store.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceColdStart,
  phaseFor,
  coldStartModeActive,
  INITIAL_COLD_START_STATE,
  type ColdStartState,
} from './coldstart.ts';
import type { MaturityConfig } from './store.ts';

const CFG: MaturityConfig = {
  expectedSlots: { Client: ['a', 'b', 'c', 'd', 'e'] },
  coldStartBasicThreshold: 20,
  coldStartProactiveThreshold: 50,
  coldStartFullThreshold: 80,
  retrievalSufficiencyThreshold: 0.6,
};

// ── phase mapping against the 20/50/80 thresholds ────────────────────────────────────────────────────────────
test('phaseFor: maps aggregate% to none/basic/proactive/full against the 20/50/80 gates', () => {
  assert.equal(phaseFor(0, CFG), 'none');
  assert.equal(phaseFor(19, CFG), 'none');
  assert.equal(phaseFor(20, CFG), 'basic'); // boundary inclusive
  assert.equal(phaseFor(49, CFG), 'basic');
  assert.equal(phaseFor(50, CFG), 'proactive');
  assert.equal(phaseFor(79, CFG), 'proactive');
  assert.equal(phaseFor(80, CFG), 'full'); // boundary inclusive — the trip point
});

// ── AC-2.MAT.002.1 — the ONE-WAY LATCH ──────────────────────────────────────────────────────────────────────
test('AC-2.MAT.002.1: reaching 80% deactivates the mode; the mode was active before', () => {
  assert.equal(coldStartModeActive(INITIAL_COLD_START_STATE), true);
  const at79 = advanceColdStart(INITIAL_COLD_START_STATE, 0.79, CFG);
  assert.equal(at79.deactivated, false);
  assert.equal(coldStartModeActive(at79), true);
  const at80 = advanceColdStart(at79, 0.8, CFG);
  assert.equal(at80.deactivated, true); // tripped
  assert.equal(at80.phase, 'full');
  assert.equal(coldStartModeActive(at80), false);
});

test('AC-2.MAT.002.1: the latch does NOT re-arm on a later dip — deactivated stays true through every drop', () => {
  let s: ColdStartState = advanceColdStart(INITIAL_COLD_START_STATE, 0.85, CFG); // trip
  assert.equal(s.deactivated, true);
  // A cascade of dips below every threshold — a client offboards, a bulk decay, back to near-zero.
  for (const dip of [0.6, 0.49, 0.19, 0.05, 0]) {
    s = advanceColdStart(s, dip, CFG);
    assert.equal(s.deactivated, true, `latch re-armed at aggregate ${dip} — MUST stay deactivated (AC-2.MAT.002.1)`);
    assert.equal(coldStartModeActive(s), false);
  }
  // phase still tracks the live aggregate for ISSUE-071's ladder, even while the mode is permanently off.
  assert.equal(s.phase, 'none');
});

test('AC-2.MAT.002.1: a null aggregate (nothing computed) is treated as 0% — never trips the latch', () => {
  const s = advanceColdStart(INITIAL_COLD_START_STATE, null, CFG);
  assert.equal(s.deactivated, false);
  assert.equal(s.phase, 'none');
});

test('advanceColdStart honours an operator-raised full threshold (config-driven, not hard-coded 80)', () => {
  const strict: MaturityConfig = { ...CFG, coldStartFullThreshold: 95 };
  assert.equal(advanceColdStart(INITIAL_COLD_START_STATE, 0.9, strict).deactivated, false); // 90% < 95%
  assert.equal(advanceColdStart(INITIAL_COLD_START_STATE, 0.95, strict).deactivated, true);
});
