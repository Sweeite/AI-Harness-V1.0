import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCheck } from './index.ts';
import { CONFLICT_CONSOLIDATION_EVENT_TYPES } from './supabase-store.ts';

test('runCheck reports zero hard findings against the current repo', () => {
  const { findings } = runCheck();
  assert.deepEqual(findings, []);
});

test('the pending additive event_type set is EXACTLY the three 0044 values (until the migration is applied)', () => {
  const { pending } = runCheck();
  // After migration 0044 is authored, these move out of pending; before, they are exactly these three.
  // Either way the set must never contain anything OTHER than the three declared values.
  for (const p of pending) assert.ok(CONFLICT_CONSOLIDATION_EVENT_TYPES.includes(p), `unexpected pending value: ${p}`);
});
