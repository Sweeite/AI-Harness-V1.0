// ISSUE-067 (surface-09 · UI-AGENT-BUILDER) — the offline non-drift `check` gate runs clean against the REAL repo
// (0001_baseline.sql + 0001d_seed.sql). This is the regression that catches schema/seed drift the Builder save-guard
// + its fail-closed live composition rely on — including FINDING-4: the seeded '{}' scope stays guard-accepted.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCheck } from './check.ts';

test('runCheck reports zero findings against the current repo (verify-present)', () => {
  const findings = runCheck();
  assert.deepEqual(findings, [], `agent-bridge check drift: ${findings.map((f) => `[${f.gate}] ${f.message}`).join('; ')}`);
});
