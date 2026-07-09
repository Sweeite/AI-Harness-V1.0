// ISSUE-030 (C2 MAT) — the offline non-drift `check` gate, run against the REAL repo. The schema (entities.maturity
// columns) + config (the five LIVE CFG rows) gates run CLEAN today; the ONLY expected residual is the additive
// `maturity_recomputed` event_type, which the orchestrator registers in a migration (this slice cannot — it does not
// own the baseline enum). So the honest, restart-robust assertion is: runCheck() reports NOTHING outside the single
// allowed 'event_type-value' gate — it passes now (1 pending finding) AND after the migration lands (0 findings).
// This is a real tripwire, not a faked green: any schema/config drift the adapter relies on would add a finding on
// another gate and fail this test loudly (#3).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCheck } from './index.ts';

const PENDING_GATE = 'event_type-value'; // the maturity_recomputed additive migration the orchestrator owns

test('runCheck: no drift outside the single pending event_type registration (schema + config gates are clean)', () => {
  const findings = runCheck();
  const unexpected = findings.filter((f) => f.gate !== PENDING_GATE);
  assert.deepEqual(unexpected, [], `unexpected maturity check drift: ${unexpected.map((f) => `[${f.gate}] ${f.message}`).join('; ')}`);
});

test('runCheck: the entities.maturity columns + the five LIVE CFG rows verify-present (no finding on those gates)', () => {
  const findings = runCheck();
  const schemaOrConfig = findings.filter((f) => f.gate.startsWith('entities') || f.gate.startsWith('cfg') || f.gate.endsWith('-present'));
  assert.deepEqual(schemaOrConfig, [], `schema/config drift: ${schemaOrConfig.map((f) => `[${f.gate}] ${f.message}`).join('; ')}`);
});
