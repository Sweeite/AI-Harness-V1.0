// ISSUE-054 (C5 OPT) — AF-113 offline proof. Exhaustively interleaves the atomic ops of concurrent write-key-disjoint
// steps and asserts the guarded envelope is race-free (one distinct final state across EVERY interleaving, no lost
// output), while the deliberately-unguarded (naive length-based) append DOES lose an update — demonstrating the guard
// is load-bearing. This is the DAG-ordering + race-freedom half of AF-113; the approval-ordering half is proven in
// scheduler.test.ts (no irreversible step outruns a pending approval). Real-Inngest LOAD is a recorded residual.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proveRaceFreedom, interleavings, type SimStep } from './simulate.ts';

function wave(n: number): SimStep[] {
  return Array.from({ length: n }, (_, i) => ({
    step_id: `s${i}`,
    step_index: i,
    shared_key: `k${i}`, // DISJOINT keys — the ADR-004 per-key-concurrency guarantee the scheduler upholds
    shared_value: i,
    output: `out${i}`,
  }));
}

test('interleavings enumerates the full order-preserving merge space (2×2 ⇒ 6, 3×2 ⇒ 90)', () => {
  const two = [...interleavings([[1, 2], [3, 4]])];
  assert.equal(two.length, 6); // C(4,2)
  // every interleaving preserves within-stream order.
  for (const seq of two) {
    assert.ok(seq.indexOf(1) < seq.indexOf(2));
    assert.ok(seq.indexOf(3) < seq.indexOf(4));
  }
  const three = [...interleavings([[1, 2], [3, 4], [5, 6]])];
  assert.equal(three.length, 90); // 6! / (2! 2! 2!)
});

test('AF-113 — 2 concurrent disjoint-key steps: race-free across ALL interleavings; naive variant loses an update', () => {
  const proof = proveRaceFreedom(wave(2));
  assert.equal(proof.distinctGuardedStates, 1, 'guarded envelope must be identical under every interleaving');
  assert.equal(proof.guardedComplete, true, 'no output lost in any interleaving');
  assert.equal(proof.naiveLosesUpdate, true, 'the unguarded length-based append DOES lose an update — the guard matters');
  assert.ok(proof.interleavings >= 6);
});

test('AF-113 — 3 concurrent disjoint-key steps: still exactly one race-free final state over all 90 interleavings', () => {
  const proof = proveRaceFreedom(wave(3));
  assert.equal(proof.distinctGuardedStates, 1);
  assert.equal(proof.guardedComplete, true);
  assert.equal(proof.interleavings, 90);
});

test('AF-113 — a single step is trivially race-free', () => {
  const proof = proveRaceFreedom(wave(1));
  assert.equal(proof.distinctGuardedStates, 1);
  assert.equal(proof.guardedComplete, true);
});
