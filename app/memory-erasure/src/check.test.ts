// ISSUE-029 — the offline non-drift check gate: zero hard findings against the repo, and the pending additive
// event_type set is EXACTLY the two 0046 values (a forgotten registration surfaces loud).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCheck } from './index.ts';
import { MEMORY_ERASURE_EVENT_TYPES } from './supabase-store.ts';

test('runCheck reports zero hard findings against the current repo', () => {
  const { findings } = runCheck();
  assert.deepEqual(findings, [], JSON.stringify(findings));
});

test('the pending additive event_type set is a subset of exactly the two erasure values (0046)', () => {
  const { pending } = runCheck();
  for (const p of pending) assert.ok(MEMORY_ERASURE_EVENT_TYPES.includes(p), `unexpected pending value: ${p}`);
  // once 0046 is applied to the corpus, pending is empty; before that it is exactly the two values.
  assert.ok(pending.length === 0 || pending.length === 2, `pending should be 0 or 2, got ${pending.length}`);
});
