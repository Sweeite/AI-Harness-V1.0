// ISSUE-082 — RBAC + two-person authorisation (FR-10.DEL.001/.006 / NFR-SEC.015 / AC-10.DEL.001.3, .006.2, .006.4).
// The control is a perm-checked, persisted, two-step handshake + an execute-time distinctness gate — distinct IDs
// asserted by one actor is NOT two humans who acted (the verify B1 finding).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorizeRequest, secondAuthorizeRequest, checkExecutorAuthorization, AuthorizationError } from './authorize.ts';
import { InMemoryDeletionWorkflowStore, PERM_MEMORY_DELETE } from './store.ts';

const PERMS = [PERM_MEMORY_DELETE];

async function freshRequest(store: InMemoryDeletionWorkflowStore): Promise<string> {
  const r = await store.createRequest({ requesterId: 'requester', targetUserId: null, targetEntityId: 'e1', legalBasis: 'gdpr' });
  return r.id;
}

test('authorizeRequest persists the first authoriser only when they hold PERM-memory.delete', async () => {
  const store = new InMemoryDeletionWorkflowStore();
  const id = await freshRequest(store);
  await assert.rejects(() => authorizeRequest(store, id, { actorId: 'a', permissions: [] }), AuthorizationError);
  const req = await authorizeRequest(store, id, { actorId: 'admin-a', permissions: PERMS });
  assert.equal(req.status, 'authorised');
  assert.equal(req.authorizedBy, 'admin-a');
});

test('a non-array permissions field is a clean rejection, never a TypeError (fail-closed)', async () => {
  const store = new InMemoryDeletionWorkflowStore();
  const id = await freshRequest(store);
  await assert.rejects(() => authorizeRequest(store, id, { actorId: 'a', permissions: undefined as unknown as string[] }), AuthorizationError);
});

test('secondAuthorizeRequest requires the perm AND a DISTINCT admin (DB CHECK rejects self-second, AC-10.DEL.006.2)', async () => {
  const store = new InMemoryDeletionWorkflowStore();
  const id = await freshRequest(store);
  await authorizeRequest(store, id, { actorId: 'admin-a', permissions: PERMS });
  // second lacks the perm → rejected
  await assert.rejects(() => secondAuthorizeRequest(store, id, { actorId: 'admin-b', permissions: [] }), AuthorizationError);
  // second == first → the distinctness CHECK throws (no self-second-authorisation)
  await assert.rejects(() => secondAuthorizeRequest(store, id, { actorId: 'admin-a', permissions: PERMS }), /distinct from authorized_by/);
  // a distinct perm-holding admin → persisted
  const req = await secondAuthorizeRequest(store, id, { actorId: 'admin-b', permissions: PERMS });
  assert.equal(req.secondAuthoriserId, 'admin-b');
});

test('checkExecutorAuthorization requires the executor perm + three distinct non-null identities (two-person unconditional)', () => {
  const ok = checkExecutorAuthorization({ executorId: 'exec', executorPermissions: PERMS, authorizedBy: 'admin-a', secondAuthoriserId: 'admin-b' });
  assert.equal(ok.allowed, true);
});

test('a missing second authoriser is always rejected — there is no single-authorised path (AC-10.DEL.006.2/.4)', () => {
  const v = checkExecutorAuthorization({ executorId: 'exec', executorPermissions: PERMS, authorizedBy: 'admin-a', secondAuthoriserId: null });
  assert.equal(v.allowed, false);
  assert.ok(v.reasons.includes('missing_second_authoriser'));
});

test('the executor cannot be either authoriser — no self-authorisation (AC-10.DEL.006.2)', () => {
  assert.ok(checkExecutorAuthorization({ executorId: 'exec', executorPermissions: PERMS, authorizedBy: 'exec', secondAuthoriserId: 'admin-b' }).reasons.includes('executor_equals_authoriser'));
  assert.ok(checkExecutorAuthorization({ executorId: 'exec', executorPermissions: PERMS, authorizedBy: 'admin-a', secondAuthoriserId: 'exec' }).reasons.includes('executor_equals_second'));
});

test('an executor without PERM-memory.delete is rejected (AC-10.DEL.001.3)', () => {
  const v = checkExecutorAuthorization({ executorId: 'exec', executorPermissions: [], authorizedBy: 'admin-a', secondAuthoriserId: 'admin-b' });
  assert.equal(v.allowed, false);
  assert.ok(v.reasons.includes(`executor_missing_${PERM_MEMORY_DELETE}`));
});
