// ISSUE-024 (C2 WRT) — the offline non-drift `check` gate runs clean against the REAL repo (baseline memories
// constraints + 0001b watermark index + 0039 write event_types + the CFG rows). Catches the schema/config/enum
// drift the writer + commit adapter rely on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCheck } from './index.ts';

test('runCheck reports zero findings against the current repo (verify-present)', () => {
  const findings = runCheck();
  assert.deepEqual(findings, [], `memory-write check drift: ${findings.map((f) => `[${f.gate}] ${f.message}`).join('; ')}`);
});
