// ISSUE-082 — the InMemory workflow store fake + the deletion_requests distinctness mirror (AC-10.DEL.006.2).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryDeletionWorkflowStore } from './store.ts';

test('createRequest enters the queue at status=received with requester + target recorded (AC-10.DEL.001.1)', async () => {
  const store = new InMemoryDeletionWorkflowStore();
  const req = await store.createRequest({ requesterId: 'r1', targetUserId: 'u1', targetEntityId: 'e1', legalBasis: 'gdpr-art-17' });
  assert.equal(req.status, 'received');
  assert.equal(req.requesterId, 'r1');
  assert.equal(req.targetEntityId, 'e1');
  assert.equal(req.legalBasis, 'gdpr-art-17');
});

test('the distinctness mirror rejects a self-second-authoriser (mirrors the DB CHECK, AC-10.DEL.006.2)', async () => {
  const store = new InMemoryDeletionWorkflowStore();
  const req = await store.createRequest({ requesterId: 'r1', targetUserId: null, targetEntityId: 'e1', legalBasis: null });
  await assert.rejects(() => store.updateRequest(req.id, { authorizedBy: 'a', secondAuthoriserId: 'a' }), /distinct from authorized_by/);
});

test('the distinctness mirror rejects executor == authoriser and executor == second', async () => {
  const store = new InMemoryDeletionWorkflowStore();
  const req = await store.createRequest({ requesterId: 'r1', targetUserId: null, targetEntityId: 'e1', legalBasis: null });
  await assert.rejects(() => store.updateRequest(req.id, { authorizedBy: 'a', secondAuthoriserId: 'b', executorId: 'a' }), /executor_id must be distinct from authorized_by/);
  await assert.rejects(() => store.updateRequest(req.id, { authorizedBy: 'a', secondAuthoriserId: 'b', executorId: 'b' }), /distinct from second_authoriser_id/);
});

test('status=executed requires all three authoriser roles non-null (the DB guarantee)', async () => {
  const store = new InMemoryDeletionWorkflowStore();
  const req = await store.createRequest({ requesterId: 'r1', targetUserId: null, targetEntityId: 'e1', legalBasis: null });
  await assert.rejects(() => store.updateRequest(req.id, { status: 'executed', authorizedBy: 'a', secondAuthoriserId: 'b' }), /status=executed requires/);
  // all three present → allowed
  const ok = await store.updateRequest(req.id, { status: 'executed', authorizedBy: 'a', secondAuthoriserId: 'b', executorId: 'c', executedAt: '2026-07-11T00:00:00.000Z' });
  assert.equal(ok.status, 'executed');
});

test('overdueRequests is DERIVED (no stamp) — an un-actioned request past the window is returned; an executed one is not', async () => {
  const store = new InMemoryDeletionWorkflowStore(() => '2026-01-01T00:00:00.000Z');
  const old = await store.createRequest({ requesterId: 'r', targetUserId: null, targetEntityId: 'e', legalBasis: null });
  const now = Date.parse('2026-01-15T00:00:00.000Z'); // 14d later
  const overdue = await store.overdueRequests(7, now);
  assert.deepEqual(overdue, [old.id]);
  // executing it removes it from the overdue set
  await store.updateRequest(old.id, { status: 'executed', authorizedBy: 'a', secondAuthoriserId: 'b', executorId: 'c' });
  assert.deepEqual(await store.overdueRequests(7, now), []);
  // it is returned AGAIN while still un-actioned (a legal-clock nag, never silent) — idempotent select, re-surfaced
  const fresh = await store.createRequest({ requesterId: 'r', targetUserId: null, targetEntityId: 'e2', legalBasis: null });
  assert.deepEqual(await store.overdueRequests(7, now), [fresh.id]);
  assert.deepEqual(await store.overdueRequests(7, now), [fresh.id]);
});

test('scrubMemory removes the target entity_id + sets content; connector flags raise idempotently', async () => {
  const store = new InMemoryDeletionWorkflowStore();
  store.putMemory({ id: 'm', content: 'John and Acme', entity_ids: ['target', 'acme'], sensitivity: 'confidential' });
  const res = await store.scrubMemory('m', 'target', '[REDACTED] and Acme', true);
  assert.deepEqual(res.entity_ids, ['acme']);
  assert.equal((await store.getMemory('m'))!.content, '[REDACTED] and Acme');

  const req = await store.createRequest({ requesterId: 'r', targetUserId: null, targetEntityId: 'target', legalBasis: null });
  const f1 = await store.raiseConnectorFlag(req.id, 'ghl');
  const f2 = await store.raiseConnectorFlag(req.id, 'ghl');
  assert.equal(f1.id, f2.id, 'a re-raise returns the existing open flag');
});
