// ISSUE-024 (C2 WRT) — FR-2.WRT.005 source-typed confidence assignment.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignConfidence, inBand, CONFIDENCE_BANDS, SOURCE_TYPES } from './confidence.ts';

test('AC-2.WRT.005.1 — human_verified confidence is 0.95–1.0', () => {
  const { confidence, storedSource } = assignConfidence('human_verified');
  assert.ok(confidence !== null && confidence >= 0.95 && confidence <= 1.0, `got ${confidence}`);
  assert.equal(storedSource, 'human_verified');
  assert.ok(inBand('human_verified', confidence));
});

test('AC-2.WRT.005.1 — ai_inferred_weak confidence is 0.60–0.75', () => {
  const { confidence, storedSource } = assignConfidence('ai_inferred_weak');
  assert.ok(confidence !== null && confidence >= 0.6 && confidence <= 0.75, `got ${confidence}`);
  assert.equal(storedSource, 'ai_inferred'); // the coarse stored enum
  assert.ok(inBand('ai_inferred_weak', confidence));
});

test('every scored source type assigns a confidence inside its band (whole FR-2.WRT.005 table)', () => {
  for (const st of SOURCE_TYPES) {
    const band = CONFIDENCE_BANDS[st];
    const { confidence } = assignConfidence(st);
    if (band.scored) {
      assert.ok(inBand(st, confidence), `${st}: ${confidence} not in [${band.min},${band.max}]`);
    } else {
      assert.equal(confidence, null, `${st} must be unscored`);
    }
  }
});

test('system_pointer is unscored (confidence null) even if the writer proposes a value — golden rule', () => {
  const { confidence, storedSource } = assignConfidence('system_pointer', 0.9);
  assert.equal(confidence, null);
  assert.equal(storedSource, 'system_pointer');
});

test('a proposed confidence is CLAMPED into the band (a model over/under-claim is corrected, not trusted)', () => {
  // over-claim above the band ceiling → clamped to the max
  assert.equal(assignConfidence('ai_inferred_weak', 0.99).confidence, 0.75);
  // under-claim below the band floor → clamped to the min
  assert.equal(assignConfidence('ai_inferred_weak', 0.1).confidence, 0.6);
  // in-band proposal is kept (rounded to numeric(4,3))
  assert.equal(assignConfidence('system_of_record', 0.9).confidence, 0.9);
});

test('a NaN/undefined proposal falls back to the band midpoint', () => {
  assert.equal(assignConfidence('human_verified', NaN).confidence, 0.975);
  assert.equal(assignConfidence('ai_inferred_strong').confidence, 0.8);
});
