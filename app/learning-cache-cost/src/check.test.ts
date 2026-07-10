// ISSUE-066 (C8 LRN/COST) — the offline check gate. Asserts it is GREEN on the real migration corpus (the tables +
// columns + CFG rows this slice depends on are present + LIVE), and that the seven additive LRN/COST event_type values
// are reported as PENDING (loud, but not a drift failure) until the serial ALTER TYPE migration lands.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCheck } from './index.ts';
import { LRN_COST_EVENT_TYPES } from './store.ts';

test('check: no DRIFT findings against the real repo (tables/columns/CFG all present + LIVE)', () => {
  const findings = runCheck();
  const fatal = findings.filter((f) => !f.pending);
  assert.deepEqual(
    fatal,
    [],
    `expected zero drift findings, got:\n${fatal.map((f) => `  [${f.gate}] ${f.message}`).join('\n')}`,
  );
});

test('check: the additive LRN/COST event_type values are surfaced (pending or present — never silently assumed)', () => {
  const findings = runCheck();
  const pending = findings.filter((f) => f.pending).map((f) => f.gate);
  // Either the migration has landed (0 pending) or every one of the seven is reported pending — never a silent subset.
  const pendingCount = pending.length;
  assert.ok(
    pendingCount === 0 || pendingCount === LRN_COST_EVENT_TYPES.length,
    `expected 0 or all ${LRN_COST_EVENT_TYPES.length} event_type values pending, got ${pendingCount}`,
  );
  for (const f of findings.filter((x) => x.pending)) assert.equal(f.gate, 'event_type-value');
});
