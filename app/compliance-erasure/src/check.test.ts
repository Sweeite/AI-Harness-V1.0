// ISSUE-082 — the offline non-drift check gate: zero hard findings against the current repo (deletion_requests +
// two-person CHECKs, connector_deletion_flags, deployment_settings.frozen_at, access_audit, PERM-memory.delete, the
// CFG rows). This slice adds no migration → pending is always empty.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCheck } from './index.ts';

test('runCheck reports zero hard findings against the current repo', () => {
  const { findings, pending } = runCheck();
  assert.deepEqual(findings, [], JSON.stringify(findings, null, 2));
  assert.deepEqual(pending, []);
});
