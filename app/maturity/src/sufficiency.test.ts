// ISSUE-030 (C2 MAT) — FR-2.MAT.003 / AC-2.MAT.003.1: query-time Retrieval Sufficiency → the [Building] flag.
// Thin sufficiency on a LOW-Maturity entity ⇒ [Building]; on a MATURE entity the same thin retrieval is a plain
// [Unknown] WITHOUT [Building]. Gated by CFG-retrieval_sufficiency_threshold + the Maturity proactive_threshold cut.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSufficiency, type SufficiencyInput } from './sufficiency.ts';
import type { MaturityConfig } from './store.ts';

const CFG: MaturityConfig = {
  expectedSlots: { Client: ['a', 'b', 'c', 'd', 'e'] },
  coldStartBasicThreshold: 20,
  coldStartProactiveThreshold: 50, // the [Building] Maturity cut = 0.50
  coldStartFullThreshold: 80,
  retrievalSufficiencyThreshold: 0.6, // the thin bar
};

const THIN = [{ relevance: 0.5, confidence: 0.5 }]; // score 0.25 < 0.6 → thin
const STRONG = [{ relevance: 0.9, confidence: 0.9 }]; // score 0.81 ≥ 0.6 → sufficient

// ── AC-2.MAT.003.1 — the [Building] vs [Unknown] split ──────────────────────────────────────────────────────
test('AC-2.MAT.003.1: thin retrieval on a LOW-Maturity entity ⇒ [Building]', () => {
  const input: SufficiencyInput = { surfaced: THIN, primaryEntityMaturity: 0.2 }; // 0.2 < 0.5
  const r = computeSufficiency(input, CFG);
  assert.equal(r.sufficient, false);
  assert.equal(r.thin, true);
  assert.equal(r.building, true);
  assert.equal(r.verdict, 'building');
});

test('AC-2.MAT.003.1: the SAME thin retrieval on a MATURE entity ⇒ plain [Unknown], no [Building]', () => {
  const input: SufficiencyInput = { surfaced: THIN, primaryEntityMaturity: 0.9 }; // 0.9 ≥ 0.5 → mature
  const r = computeSufficiency(input, CFG);
  assert.equal(r.thin, true);
  assert.equal(r.building, false); // the honest message is [Unknown], not "still building"
  assert.equal(r.verdict, 'unknown');
});

test('AC-2.MAT.003.1: strong retrieval ⇒ sufficient (no [Building]/[Unknown]) regardless of Maturity', () => {
  const r = computeSufficiency({ surfaced: STRONG, primaryEntityMaturity: 0.1 }, CFG);
  assert.equal(r.sufficient, true);
  assert.equal(r.building, false);
  assert.equal(r.verdict, 'sufficient');
});

// ── the proactive-threshold boundary (< is strict; == is mature) ────────────────────────────────────────────
test('the [Building] cut is strict: Maturity exactly at proactive_threshold is MATURE (unknown, not building)', () => {
  const atCut = computeSufficiency({ surfaced: THIN, primaryEntityMaturity: 0.5 }, CFG);
  assert.equal(atCut.building, false);
  assert.equal(atCut.verdict, 'unknown');
  const justUnder = computeSufficiency({ surfaced: THIN, primaryEntityMaturity: 0.499 }, CFG);
  assert.equal(justUnder.building, true);
});

test('null primary Maturity is treated as 0 → a thin retrieval on a never-computed entity ⇒ [Building]', () => {
  const r = computeSufficiency({ surfaced: THIN, primaryEntityMaturity: null }, CFG);
  assert.equal(r.building, true);
});

// ── the slot arm (ADR-002 §3) ───────────────────────────────────────────────────────────────────────────────
test('an explicitly-EMPTY touched slot is never sufficient even with strong retrieval (we have no live memory for it)', () => {
  const r = computeSufficiency({ surfaced: STRONG, touchedSlotsFilled: false, primaryEntityMaturity: 0.2 }, CFG);
  assert.equal(r.sufficient, false); // slot arm fails despite score 0.81 ≥ 0.6
  assert.equal(r.building, true); // thin + immature
});

test('a query mapping to NO slot (undefined) falls back to pure retrieval quality — strong ⇒ sufficient', () => {
  const r = computeSufficiency({ surfaced: STRONG, touchedSlotsFilled: undefined, primaryEntityMaturity: 0.2 }, CFG);
  assert.equal(r.sufficient, true);
});

test('filled touched slots + strong retrieval ⇒ sufficient; the score is max(relevance×confidence) over surfaced', () => {
  const r = computeSufficiency({ surfaced: [...THIN, ...STRONG], touchedSlotsFilled: true, primaryEntityMaturity: 0.2 }, CFG);
  assert.equal(r.score, 0.81); // max over the surfaced set, not the sum/avg
  assert.equal(r.sufficient, true);
});

test('no surfaced memory ⇒ score 0 ⇒ thin; on a low-Maturity entity that is [Building]', () => {
  const r = computeSufficiency({ surfaced: [], primaryEntityMaturity: 0.1 }, CFG);
  assert.equal(r.score, 0);
  assert.equal(r.verdict, 'building');
});
