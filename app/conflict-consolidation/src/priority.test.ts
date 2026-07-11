import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareAuthority, suggestResolution, type MemoryFacts } from './priority.ts';

const m = (p: Partial<MemoryFacts> & { id: string }): MemoryFacts => ({ source: 'ai_inferred', createdAt: '2026-01-01T00:00:00Z', confidence: 0.7, ...p });

// ── FR-2.MNT.008 the five rules ──────────────────────────────────────────────────────────────────────────────
test('rule 1 — human_verified always wins over ai_inferred (either side)', () => {
  assert.equal(compareAuthority(m({ id: 'a', source: 'human_verified' }), m({ id: 'b', source: 'ai_inferred' })).winner, 1);
  assert.equal(compareAuthority(m({ id: 'a', source: 'ai_inferred' }), m({ id: 'b', source: 'human_verified' })).winner, -1);
  assert.equal(compareAuthority(m({ id: 'a', source: 'human_verified' }), m({ id: 'b', source: 'system_pointer', confidence: null }))?.rule, 1);
});

test('rule 2 — system_of_record (system_pointer) beats ai_inferred', () => {
  const r = compareAuthority(m({ id: 'a', source: 'system_pointer', confidence: null }), m({ id: 'b', source: 'ai_inferred' }));
  assert.equal(r.winner, 1);
  assert.equal(r.rule, 2);
});

test('rule 2 (Finding-2) — a held system_of_record candidate beats an ai_inferred existing (even at lower confidence)', () => {
  // system_of_record is preserved for the held (unwritten) candidate; it outranks ai_inferred by rule 2 regardless
  // of the ai_inferred row's higher confidence / newer age.
  const r = compareAuthority(m({ id: 'held', source: 'system_of_record', confidence: 0.5, createdAt: '2026-01-01T00:00:00Z' }), m({ id: 'old', source: 'ai_inferred', confidence: 0.95, createdAt: '2026-06-01T00:00:00Z' }));
  assert.equal(r.winner, 1);
  assert.equal(r.rule, 2);
});

test('rule 2 (Finding-2) via suggestResolution — held system_of_record vs ai_inferred existing → keep_new', () => {
  const res = suggestResolution(m({ id: 'held', source: 'system_of_record', confidence: 0.5 }), [m({ id: 'old', source: 'ai_inferred', confidence: 0.95 })]);
  assert.equal(res.kind, 'keep_new');
  assert.equal(res.ruleApplied, 2);
});

test('different authority classes not ranked by 1–2 (system_of_record vs system_pointer) → genuine ambiguity (rule 5)', () => {
  const r = compareAuthority(m({ id: 'a', source: 'system_of_record', confidence: 0.6, createdAt: '2026-06-01T00:00:00Z' }), m({ id: 'b', source: 'system_pointer', confidence: null, createdAt: '2026-01-01T00:00:00Z' }));
  assert.equal(r.winner, 0);
  assert.equal(r.rule, 5);
});

test('rule 3 — more recent beats older (same source type)', () => {
  const r = compareAuthority(m({ id: 'a', createdAt: '2026-06-01T00:00:00Z' }), m({ id: 'b', createdAt: '2026-01-01T00:00:00Z' }));
  assert.equal(r.winner, 1);
  assert.equal(r.rule, 3);
});

test('rule 4 — higher confidence beats lower (same age, same source)', () => {
  const r = compareAuthority(m({ id: 'a', confidence: 0.9 }), m({ id: 'b', confidence: 0.6 }));
  assert.equal(r.winner, 1);
  assert.equal(r.rule, 4);
});

test('rule 5 — same source, same age, same confidence → genuinely ambiguous (tie)', () => {
  const r = compareAuthority(m({ id: 'a' }), m({ id: 'b' }));
  assert.equal(r.winner, 0);
  assert.equal(r.rule, 5);
});

test('compareAuthority is antisymmetric', () => {
  const a = m({ id: 'a', source: 'human_verified' });
  const b = m({ id: 'b', confidence: 0.9 });
  assert.equal(compareAuthority(a, b).winner, -compareAuthority(b, a).winner);
});

// ── AC-2.MNT.008.1 ───────────────────────────────────────────────────────────────────────────────────────────
test('AC-2.MNT.008.1 — human_verified new memory conflicting with an ai_inferred existing → suggest keep_new (human wins)', () => {
  const res = suggestResolution(m({ id: 'new', source: 'human_verified' }), [m({ id: 'old', source: 'ai_inferred' })]);
  assert.equal(res.kind, 'keep_new');
  assert.equal(res.winnerId, 'new');
  assert.equal(res.ruleApplied, 1);
  assert.equal(res.humanFlagged, false);
});

test('AC-2.MNT.008.1 (mirror) — ai_inferred new vs human_verified existing → suggest keep_existing (human wins)', () => {
  const res = suggestResolution(m({ id: 'new', source: 'ai_inferred' }), [m({ id: 'old', source: 'human_verified' })]);
  assert.equal(res.kind, 'keep_existing');
  assert.equal(res.winnerId, 'old');
});

// ── AC-2.MNT.008.2 ───────────────────────────────────────────────────────────────────────────────────────────
test('AC-2.MNT.008.2 — genuinely ambiguous conflict → keep_both_with_note + human flagged', () => {
  const res = suggestResolution(m({ id: 'new' }), [m({ id: 'old' })]); // identical authority
  assert.equal(res.kind, 'keep_both_with_note');
  assert.equal(res.winnerId, null);
  assert.equal(res.humanFlagged, true);
  assert.equal(res.ruleApplied, 5);
});

test('#1 safety — new beats one existing but ties another → NOT keep_new; keep_both_with_note (never auto-drop on a guess)', () => {
  const res = suggestResolution(m({ id: 'new', confidence: 0.9 }), [m({ id: 'weak', confidence: 0.5 }), m({ id: 'peer', confidence: 0.9 })]);
  assert.equal(res.kind, 'keep_both_with_note');
  assert.equal(res.humanFlagged, true);
});

test('keep_new only when new strictly beats EVERY conflicting memory', () => {
  const res = suggestResolution(m({ id: 'new', source: 'human_verified' }), [m({ id: 'a', source: 'ai_inferred' }), m({ id: 'b', source: 'ai_inferred' })]);
  assert.equal(res.kind, 'keep_new');
});

test('empty live conflicting set → keep_new (nothing left to contradict)', () => {
  const res = suggestResolution(m({ id: 'new' }), []);
  assert.equal(res.kind, 'keep_new');
});
