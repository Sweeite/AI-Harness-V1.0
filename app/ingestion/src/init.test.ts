// ISSUE-026 (C2 ING) — the ordered init sequence + mandatory verification pass: AC-2.ING.009.1 (incomplete-verification
// warning) + AC-2.ING.009.2 (a verified memory reaches confidence 1.0 / source human_verified). Plus order enforcement.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryVerificationSink } from './store.ts';
import { InitSequence, InitSequenceError, INIT_STEPS, INCOMPLETE_VERIFICATION_WARNING } from './init.ts';

function seq() {
  return new InitSequence(new InMemoryVerificationSink());
}

function completeThrough(s: InitSequence, upto: (typeof INIT_STEPS)[number]): void {
  for (const step of INIT_STEPS) {
    s.complete(step);
    if (step === upto) return;
  }
}

// ── AC-2.ING.009.1 — incomplete verification shows a persistent dashboard warning ──────────────────────────────
test('AC-2.ING.009.1: while verification is incomplete, a warning is shown', () => {
  const s = seq();
  completeThrough(s, 'interviews'); // steps 1–6 done, verification not yet
  assert.equal(s.verificationComplete(), false);
  assert.deepEqual(s.warnings(), [INCOMPLETE_VERIFICATION_WARNING]);
});

test('AC-2.ING.009.1: the warning clears once the verification pass completes', () => {
  const s = seq();
  for (const step of INIT_STEPS) s.complete(step);
  assert.equal(s.verificationComplete(), true);
  assert.deepEqual(s.warnings(), []);
});

// ── AC-2.ING.009.2 — a human-verified memory reaches confidence 1.0 / source human_verified ────────────────────
test('AC-2.ING.009.2: verifying a memory bumps it to confidence 1.0 / source human_verified', async () => {
  const s = seq();
  const result = await s.verifyMemory('mem-1', 'founder-1');
  assert.equal(result.confidence, 1.0);
  assert.equal(result.source, 'human_verified');
});

// ── order enforcement — the sequence cannot be skipped (FR-2.ING.009) ──────────────────────────────────────────
test('the init sequence enforces order — a later step cannot complete before an earlier one', () => {
  const s = seq();
  assert.throws(() => s.complete('verification'), InitSequenceError); // cannot verify before steps 1–6
  s.complete('define_entities');
  assert.throws(() => s.complete('structured_pass'), InitSequenceError); // skipped internal_org/connect_sor
});

test('the seven documented steps are in the design order', () => {
  assert.deepEqual([...INIT_STEPS], ['define_entities', 'internal_org_founder', 'connect_sor', 'structured_pass', 'priority_documents', 'interviews', 'verification']);
});
