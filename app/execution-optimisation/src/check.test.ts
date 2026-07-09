// ISSUE-054 (C5 OPT) — the offline non-drift `check` gate runs against the REAL repo. Two of the three optimisation
// flags already ship; chained_task_prewarm_enabled is a PROPOSED additive row the orchestrator registers. Per the
// build brief, that not-yet-registered row is an EXPECTED pending finding — it must be the ONLY finding, tagged with
// the pending gate. Once the orchestrator registers it, findings drops to zero (still a subset of the allowlist).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCheck, PENDING_REGISTRATION_GATE } from './index.ts';

test('runCheck reports no BLOCKING findings against the current repo (verify-present)', () => {
  const findings = runCheck();
  const blocking = findings.filter((f) => f.gate !== PENDING_REGISTRATION_GATE);
  assert.deepEqual(blocking, [], `execution-optimisation check drift: ${blocking.map((f) => `[${f.gate}] ${f.message}`).join('; ')}`);
});

test('the only permitted pending finding is the proposed prewarm flag registration', () => {
  const findings = runCheck();
  for (const f of findings) {
    assert.equal(f.gate, PENDING_REGISTRATION_GATE, `unexpected finding [${f.gate}] ${f.message}`);
  }
});
