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

test('runCheck: the four additive maintenance event_type values are now REGISTERED (migration 0042 authored) → pending empty', () => {
  const { pending } = runCheck();
  // Migration 0042_memory_maintenance_event_types.sql (Session 85) registers all four values, so none is pending; the
  // constant is still the single source of truth the check reads them from (a forgotten one would resurface here).
  assert.deepEqual([...pending].sort(), [], 'all four values are in the migration corpus (0042) — none pending');
  assert.equal(MAINTENANCE_EVENT_TYPES.length, 4, 'the constant still declares exactly the four values');
});
