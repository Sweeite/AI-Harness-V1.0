// ISSUE-065 — the CFG-drift guard, wired into the GATING AC suite (not just the standalone `check` script).
// A #3 protection (the three hard-coded CFG defaults MUST equal config-registry.md) that is not exercised by the
// suite which flips the issue `done` is not actually enforced. This test runs the same guard verifyCfgDefaults()
// uses, so a silent drift between the code constants and the register fails `npm test`, not merely `npm run check`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyCfgDefaults } from './index.ts';
import {
  DEFAULT_DRIFT_THRESHOLD,
  DEFAULT_DEAD_AGENT_THRESHOLD,
  DEFAULT_POLLING_INTERVAL_HEALTH_METRICS_S,
} from './store.ts';

test('CFG defaults match config-registry.md — the #3 drift guard runs inside the gating suite', () => {
  // Throws (failing the suite) if any code constant has drifted from the registered default.
  const matched = verifyCfgDefaults();
  assert.equal(matched.drift_threshold, DEFAULT_DRIFT_THRESHOLD);
  assert.equal(matched.dead_agent_threshold, DEFAULT_DEAD_AGENT_THRESHOLD);
  assert.equal(matched.polling_interval_health_metrics_s, DEFAULT_POLLING_INTERVAL_HEALTH_METRICS_S);
});
