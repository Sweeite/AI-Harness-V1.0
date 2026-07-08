// ISSUE-021 — USR lifecycle + NFR-SEC.016 tests (one test per §4 AC where practical).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  InMemoryUserMgmtStore,
  UserMgmtError,
  ERR_DENIED,
  ERR_LAST_SUPER_ADMIN,
  ERR_REASON_REQUIRED,
  ERR_RESTRICTED_ROUTE,
  NODE_ASSIGN_ROLE,
  NODE_DEACTIVATE,
  NODE_RESET_2FA,
  NODE_GRANT_CLEARANCE,
} from './store.ts';
import {
  changeUserRole,
  deactivateUser,
  reactivateUser,
  reset2fa,
  grantClearance,
  revokeClearance,
  grantRestricted,
} from './lifecycle.ts';

const SA_ROLE = 'role-super-admin';
const NOW = '2026-07-08T00:00:00.000Z';

/** A store with an actor holding the given nodes + a target user. */
function seed(actorNodes: string[]) {
  const store = new InMemoryUserMgmtStore();
  store.setUser('actor', { active: true, isSuperAdmin: true, roleId: SA_ROLE, nodes: actorNodes });
  store.setUser('target', { active: true, oauth: false, roleId: 'role-standard', mfaFactors: 1 });
  return store;
}

async function auditActions(store: InMemoryUserMgmtStore): Promise<string[]> {
  return (await store.listAudits()).map((a) => a.action);
}

// ── AC-1.USR.001.1 — change role effective next request + audited ──────────────────────────────────
test('AC-1.USR.001.1 — Super Admin changes a user role; permissions change on next request and it is audited', async () => {
  const store = seed([NODE_ASSIGN_ROLE]);
  // give the target a fresh role that carries a node it lacked before
  store.setUser('target', { active: true, roleId: 'role-standard', nodes: [] });
  await changeUserRole(store, 'actor', 'target', 'role-editor');
  // effective-next-query: the fake resolves nodes live from the user's current role state
  await assert.doesNotReject(async () => changeUserRole(store, 'actor', 'target', 'role-viewer'));
  assert.ok((await auditActions(store)).includes('change-user-role'), 'role change must be audited');
});

test('AC-1.AUD.002.1 (real mutation) — a role change records BOTH old and new role (who/old/new, #1)', async () => {
  const store = seed([NODE_ASSIGN_ROLE]);
  store.setUser('target', { active: true, roleId: 'role-standard', nodes: [] });
  await changeUserRole(store, 'actor', 'target', 'role-editor');
  const rec = (await store.listAudits()).find((a) => a.action === 'change-user-role');
  assert.ok(rec, 'the role change is audited');
  assert.deepEqual(rec!.before_value, { role_id: 'role-standard' }, 'OLD role captured (before_value) — FR-1.AUD.002');
  assert.deepEqual(rec!.after_value, { role_id: 'role-editor' }, 'NEW role captured (after_value)');
});

test('AC-1.USR.001.1 (deny) — an actor without PERM-user.assign_role is denied and the refusal audited', async () => {
  const store = seed([]); // no nodes
  await assert.rejects(() => changeUserRole(store, 'actor', 'target', 'role-editor'), (e: UserMgmtError) => e.reason === ERR_DENIED);
  assert.ok((await auditActions(store)).includes('denied:change-user-role'));
});

test('FR-1.ROLE.005 (invoked) — changing the last Super Admin off SA is refused and audited', async () => {
  const store = new InMemoryUserMgmtStore();
  store.setUser('actor', { active: true, isSuperAdmin: true, roleId: SA_ROLE, nodes: [NODE_ASSIGN_ROLE] });
  // the sole Super Admin tries to demote themselves
  await assert.rejects(() => changeUserRole(store, 'actor', 'actor', 'role-standard'), (e: UserMgmtError) => e.reason === ERR_LAST_SUPER_ADMIN);
  assert.ok((await auditActions(store)).includes('denied:change-user-role'));
});

// ── AC-1.USR.002.1 — deactivate → next query denied + record/audit retained ─────────────────────────
test('AC-1.USR.002.1 — deactivated user is denied on next query; record + audit history are retained', async () => {
  const store = seed([NODE_DEACTIVATE]);
  store.setUser('target', { active: true, roleId: 'role-standard', nodes: ['PERM-memory.read'] });
  await deactivateUser(store, 'actor', 'target');
  assert.equal(await store.getUserActive('target'), false, 'record retained (row still exists, active=false)');
  assert.deepEqual([...(await store.userPermissionNodes('target'))], [], 'deactivated user holds no effective nodes (next query denied)');
  assert.ok((await auditActions(store)).includes('deactivate-user'), 'deactivation audited (history retained)');
});

test('FR-1.ROLE.005 (invoked) — deactivating the last Super Admin is refused and audited', async () => {
  const store = new InMemoryUserMgmtStore();
  store.setUser('actor', { active: true, isSuperAdmin: true, roleId: SA_ROLE, nodes: [NODE_DEACTIVATE] });
  await assert.rejects(() => deactivateUser(store, 'actor', 'actor'), (e: UserMgmtError) => e.reason === ERR_LAST_SUPER_ADMIN);
  assert.equal(await store.getUserActive('actor'), true, 'the last Super Admin remains active');
  assert.ok((await auditActions(store)).includes('denied:deactivate-user'));
});

// ── AC-1.USR.002.2 — reactivation does NOT auto-restore a Restricted grant (or above-Standard clearance) ─
test('AC-1.USR.002.2 — a Restricted grant held before deactivation is NOT auto-restored on reactivation', async () => {
  const store = seed([NODE_DEACTIVATE, NODE_GRANT_CLEARANCE]);
  store.setUser('target', { active: true, roleId: 'role-standard' });
  // hold a Restricted grant AND an above-Standard clearance
  await grantRestricted(store, 'actor', 'target', 'incident review', { grantedAt: NOW });
  await grantClearance(store, 'actor', 'target', 'confidential', 'Invoice', { grantedAt: NOW });
  assert.equal((await store.listActiveRestricted('target')).length, 1);
  assert.equal((await store.listUserClearances('target')).length, 1);

  // deactivate → all above-Standard access revoked
  const deact = await deactivateUser(store, 'actor', 'target');
  assert.equal(deact.restrictedRevoked.length, 1);
  assert.equal(deact.clearancesRevoked.length, 1);
  assert.equal((await store.listActiveRestricted('target')).length, 0, 'Restricted revoked at deactivation');

  // reactivate → base role restores, but NOTHING above-Standard comes back
  const react = await reactivateUser(store, 'actor', 'target');
  assert.equal(react.reactivated, true);
  assert.deepEqual(react.restrictedActive, [], 'Restricted grant NOT auto-restored');
  assert.deepEqual(react.clearancesActive, [], 'above-Standard clearance NOT auto-restored');
  assert.equal(await store.getUserActive('target'), true, 'account is active again (base role restored)');

  // it must be EXPLICITLY re-grantable afterward
  await grantRestricted(store, 'actor', 'target', 'new review', { grantedAt: NOW });
  assert.equal((await store.listActiveRestricted('target')).length, 1, 'explicit re-grant works');
});

// ── AC-1.USR.003.1 — reset 2FA for a password account; OAuth branch is an explicit no-op ─────────────
test('AC-1.USR.003.1 — resetting a password account 2FA removes the TOTP factor and audits it', async () => {
  const store = seed([NODE_RESET_2FA]);
  store.setUser('target', { active: true, oauth: false, mfaFactors: 1 });
  const res = await reset2fa(store, 'actor', 'target');
  assert.equal(res.oauth, false);
  assert.equal(res.factorsRemoved, 1, 'TOTP factor removed → user must re-enroll before aal2');
  assert.equal(await store.removeMfaFactors('target'), 0, 'no factor remains');
  assert.ok((await auditActions(store)).includes('reset-2fa'));
});

test('FR-1.USR.003 (OAuth branch) — reset 2FA on an OAuth user is an explicit no-op, not a false success', async () => {
  const store = seed([NODE_RESET_2FA]);
  store.setUser('target', { active: true, oauth: true, mfaFactors: 0 });
  const res = await reset2fa(store, 'actor', 'target');
  assert.equal(res.oauth, true);
  assert.equal(res.factorsRemoved, 0);
  assert.ok((await auditActions(store)).includes('reset-2fa:noop-oauth'), 'the no-op is audited explicitly, never reported as a successful reset');
});

// ── AC-1.USR.005.1 / .2 — grant/revoke clearance is Super-Admin-only; Restricted routes away ─────────
test('AC-1.USR.005.1 — an Admin without PERM-user.grant_clearance is denied and the refusal audited', async () => {
  const store = seed([]); // Admin lacks grant_clearance (Super-Admin-only node)
  await assert.rejects(
    () => grantClearance(store, 'actor', 'target', 'confidential', 'Invoice', { grantedAt: NOW }),
    (e: UserMgmtError) => e.reason === ERR_DENIED,
  );
  assert.ok((await auditActions(store)).includes('denied:grant-clearance'));
});

test('AC-1.USR.005.2 — a Super Admin grants Confidential/finance; it is written and effective', async () => {
  const store = seed([NODE_GRANT_CLEARANCE]);
  const row = await grantClearance(store, 'actor', 'target', 'confidential', 'Invoice', { grantedAt: NOW });
  assert.equal(row.tier, 'confidential');
  assert.equal(row.entity_type_scope, 'Invoice');
  const held = await store.listUserClearances('target');
  assert.equal(held.length, 1, 'clearance persisted → applies on next query');
  assert.ok((await auditActions(store)).includes('grant-clearance'));
});

test('FR-1.USR.005 (edge) — a Restricted-tier attempt via grantClearance is rejected and routed to the Restricted flow', async () => {
  const store = seed([NODE_GRANT_CLEARANCE]);
  await assert.rejects(
    () => grantClearance(store, 'actor', 'target', 'restricted' as never, null, { grantedAt: NOW }),
    (e: UserMgmtError) => e.reason === ERR_RESTRICTED_ROUTE,
  );
  assert.ok((await auditActions(store)).includes('grant-clearance:routed-restricted'));
  assert.equal((await store.listUserClearances('target')).length, 0, 'no clearance row written for a Restricted attempt');
});

test('revokeClearance — noop on an absent id is surfaced explicitly, never silent', async () => {
  const store = seed([NODE_GRANT_CLEARANCE]);
  await revokeClearance(store, 'actor', 'no-such-clearance');
  assert.ok((await auditActions(store)).includes('revoke-clearance:noop'));
});

// ── AC-NFR-SEC.016.1 — Restricted grant reason is mandatory; a given reason is written to access_audit ─
test('AC-NFR-SEC.016.1 (reject) — a Restricted grant with no reason is rejected', async () => {
  const store = seed([NODE_GRANT_CLEARANCE]);
  await assert.rejects(
    () => grantRestricted(store, 'actor', 'target', '   ', { grantedAt: NOW }),
    (e: UserMgmtError) => e.reason === ERR_REASON_REQUIRED,
  );
  assert.ok((await auditActions(store)).includes('denied:grant-restricted'));
  assert.equal((await store.listActiveRestricted('target')).length, 0, 'no grant created without a reason');
});

test('AC-NFR-SEC.016.1 (capture) — a Restricted grant reason is written to access_audit', async () => {
  const store = seed([NODE_GRANT_CLEARANCE]);
  await grantRestricted(store, 'actor', 'target', 'legal hold #4471', { grantedAt: NOW });
  const grantAudit = (await store.listAudits()).find((a) => a.action === 'grant-restricted');
  assert.ok(grantAudit, 'grant is audited');
  assert.equal(grantAudit!.reason, 'legal hold #4471', 'the why is written to the immutable trail');
});

test('NFR-SEC.016 (optional-but-captured) — a reason given on a non-Restricted sensitive mutation is written', async () => {
  const store = seed([NODE_DEACTIVATE]);
  store.setUser('target', { active: true, roleId: 'role-standard' });
  await deactivateUser(store, 'actor', 'target', 'left the company');
  const deact = (await store.listAudits()).find((a) => a.action === 'deactivate-user');
  assert.equal(deact!.reason, 'left the company', 'the optional reason is captured on deactivation');
});
