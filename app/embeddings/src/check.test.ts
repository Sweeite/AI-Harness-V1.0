// ISSUE-023 (C2 VEC) — the offline non-drift `check` gate runs clean against the REAL repo (baseline + 0001b + config
// registry + 0038). This is the regression that catches schema/config/enum drift the live adapter + contract rely on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCheck } from './index.ts';

test('runCheck reports zero findings against the current repo (verify-present)', () => {
  const findings = runCheck();
  assert.deepEqual(findings, [], `embeddings check drift: ${findings.map((f) => `[${f.gate}] ${f.message}`).join('; ')}`);
});
