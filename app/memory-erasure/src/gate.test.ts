// ISSUE-029 — the erasure gate: destructive-by-design → stricter than retire/supersede, fail-closed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkErasureGate, ErasureGateError } from './gate.ts';
import type { ErasureAuthz } from './store.ts';

const full: ErasureAuthz = {
  actorIdentity: 'sa@client',
  originatingUserId: '11111111-1111-1111-1111-111111111111',
  isSuperAdmin: true,
  permissions: ['PERM-memory.delete'],
  erasureConfirmed: true,
};

test('the gate ALLOWS only when every precondition holds', () => {
  const v = checkErasureGate(full);
  assert.equal(v.allowed, true);
  assert.deepEqual(v.reasons, []);
});

test('a non-Super-Admin is rejected', () => {
  const v = checkErasureGate({ ...full, isSuperAdmin: false });
  assert.equal(v.allowed, false);
  assert.ok(v.reasons.includes('not_super_admin'));
});

test('missing PERM-memory.delete is rejected', () => {
  const v = checkErasureGate({ ...full, permissions: ['PERM-memory.retire'] });
  assert.equal(v.allowed, false);
  assert.ok(v.reasons.includes('missing_PERM-memory.delete'));
});

test('a retire-level confirmation is NOT enough — the erasure-specific gate must be set (destructive)', () => {
  const v = checkErasureGate({ ...full, erasureConfirmed: false });
  assert.equal(v.allowed, false);
  assert.ok(v.reasons.includes('erasure_not_confirmed'));
});

test('an empty/undefined-shaped authz fails closed with EVERY missing reason surfaced (#3)', () => {
  const v = checkErasureGate({ actorIdentity: '', originatingUserId: '', isSuperAdmin: false, permissions: [], erasureConfirmed: false });
  assert.equal(v.allowed, false);
  assert.deepEqual(
    v.reasons.sort(),
    ['erasure_not_confirmed', 'missing_PERM-memory.delete', 'missing_actor_identity', 'missing_originating_user', 'not_super_admin'].sort(),
  );
});

test('ErasureGateError carries the reasons', () => {
  const e = new ErasureGateError(['not_super_admin']);
  assert.match(e.message, /not_super_admin/);
  assert.deepEqual(e.reasons, ['not_super_admin']);
});
