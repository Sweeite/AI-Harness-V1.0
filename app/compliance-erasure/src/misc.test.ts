// ISSUE-082 — freeze guard (FR-10.DEL.007), content scrub (FR-10.DEL.004), connector flags (FR-10.DEL.006(a)),
// and the queue escalation sweep (FR-10.DEL.001).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDeploymentFreeze } from './freeze.ts';
import { redactContent, REDACTION_TOKEN } from './scrub.ts';
import { detectAndRaiseConnectorFlags } from './connectors.ts';
import { runRequestEscalationSweep, intakeRequest, rejectRequest } from './queue.ts';
import { InMemoryDeletionWorkflowStore, type ConnectorPresencePort } from './store.ts';

// ── freeze ─────────────────────────────────────────────────────────────────────────────────────────────────────
test('checkDeploymentFreeze reports frozen iff frozen_at is set (AC-10.DEL.007.1)', async () => {
  const store = new InMemoryDeletionWorkflowStore();
  assert.deepEqual(await checkDeploymentFreeze(store), { frozen: false, frozenAt: null });
  store.frozenAt = '2026-07-01T00:00:00.000Z';
  assert.deepEqual(await checkDeploymentFreeze(store), { frozen: true, frozenAt: '2026-07-01T00:00:00.000Z' });
});

// ── scrub ──────────────────────────────────────────────────────────────────────────────────────────────────────
test('redactContent replaces whole-token mentions, preserving context (AC-10.DEL.004.1)', () => {
  const { redacted, replacements } = redactContent('John Smith signed the Acme contract with John', ['John Smith', 'John']);
  assert.equal(redacted, `${REDACTION_TOKEN} signed the Acme contract with ${REDACTION_TOKEN}`);
  assert.equal(replacements, 2);
});

test('redactContent never redacts a substring inside a larger word (#1 over-redaction guard)', () => {
  const { redacted, replacements } = redactContent('Samsung shipped to Sam', ['Sam']);
  assert.equal(redacted, `Samsung shipped to ${REDACTION_TOKEN}`);
  assert.equal(replacements, 1);
});

// ── connectors ─────────────────────────────────────────────────────────────────────────────────────────────────
test('detectAndRaiseConnectorFlags raises a tracked flag per detected connector (AC-10.DEL.006.1)', async () => {
  const store = new InMemoryDeletionWorkflowStore();
  const req = await store.createRequest({ requesterId: 'r', targetUserId: null, targetEntityId: 't', legalBasis: null });
  const presence: ConnectorPresencePort = { detect: async () => ['ghl', 'slack'] };
  const res = await detectAndRaiseConnectorFlags(store, presence, req.id, 't');
  assert.deepEqual(res.raised, ['ghl', 'slack']);
  assert.equal(res.detectionError, false);
  assert.equal((await store.listConnectorFlags(req.id)).length, 2);
});

test('a detection ERROR is caught + reported (never treated as "no connectors present") — fail-closed (AC-10.DEL.006.4)', async () => {
  const store = new InMemoryDeletionWorkflowStore();
  const req = await store.createRequest({ requesterId: 'r', targetUserId: null, targetEntityId: 't', legalBasis: null });
  const presence: ConnectorPresencePort = { detect: async () => { throw new Error('GHL API 503'); } };
  const res = await detectAndRaiseConnectorFlags(store, presence, req.id, 't');
  assert.equal(res.detectionError, true);
  assert.match(res.detectionErrorDetail!, /GHL API 503/);
  assert.deepEqual(res.raised, []);
});

// ── queue escalation ───────────────────────────────────────────────────────────────────────────────────────────
test('the escalation sweep surfaces overdue requests + stamps overdue connector flags (AC-10.DEL.001.2 / .006.3)', async () => {
  const store = new InMemoryDeletionWorkflowStore(() => '2026-01-01T00:00:00.000Z');
  const req = await intakeRequest(store, { requesterId: 'r', targetUserId: null, targetEntityId: 't', legalBasis: 'x' });
  await store.raiseConnectorFlag(req.id, 'ghl');
  const now = Date.parse('2026-01-20T00:00:00.000Z'); // 19d later
  const summary = await runRequestEscalationSweep(store, 7, now);
  assert.deepEqual(summary.escalatedRequests, [req.id]);
  assert.equal(summary.escalatedConnectorFlags.length, 1);
  // the connector flag stamp is at-most-once — a second sweep does not re-stamp it
  const second = await runRequestEscalationSweep(store, 7, now);
  assert.equal(second.escalatedConnectorFlags.length, 0);
  // the request is still surfaced (derived nag until actioned)
  assert.deepEqual(second.escalatedRequests, [req.id]);
});

test('rejectRequest records a rejection — never a silent drop', async () => {
  const store = new InMemoryDeletionWorkflowStore();
  const req = await intakeRequest(store, { requesterId: 'r', targetUserId: null, targetEntityId: 't', legalBasis: null });
  const rejected = await rejectRequest(store, req.id, 'not a valid erasure basis');
  assert.equal(rejected.status, 'rejected');
  assert.ok(store.lifecycle.some((e) => e.event === 'deletion_request_rejected'));
});
