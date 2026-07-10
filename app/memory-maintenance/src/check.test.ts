// ISSUE-027 — the offline non-drift `check` gate, run against the REAL repo. The schema (memories columns +
// entities/ingestion_queue/memory_conflicts + ingestion_state) and config (12 LIVE CFG rows + the baseline
// memory_confidence_drop alert value) gates run CLEAN today. The only forward-dependency is the four ADDITIVE
// maintenance event_type values, which the orchestrator registers in a migration (this slice cannot — it does not
// own the baseline enum). So the honest assertion is: runCheck() reports NO drift findings, and its `pending` set is
// EXACTLY those four values — a real tripwire (any schema/config drift the adapter relies on adds a finding and
// fails loudly, #3), and a surfacing of the migration the orchestrator must apply.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCheck } from './index.ts';
import { MAINTENANCE_EVENT_TYPES } from './supabase-store.ts';

test('runCheck: no schema/config drift — the gate is GREEN now (findings empty)', () => {
  const { findings } = runCheck();
  assert.deepEqual(findings, [], `unexpected memory-maintenance check drift: ${findings.map((f) => `[${f.gate}] ${f.message}`).join('; ')}`);
});

test('runCheck: the pending set is EXACTLY the four additive maintenance event_type values', () => {
  const { pending } = runCheck();
  assert.deepEqual([...pending].sort(), [...MAINTENANCE_EVENT_TYPES].sort(), 'a forgotten additive registration would surface here');
});
