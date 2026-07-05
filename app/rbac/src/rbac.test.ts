// ISSUE-018 — one test per AC in §4 Definition of done. Proved against the InMemoryRbacStore reference
// model (offline; the live seed + can()-through-RLS-helpers proof is the ISSUE-018 capstone).
//
// AC map:
//   AC-1.ROLE.001.1  — fresh deployment → exactly the six roles with default nodes + clearances
//   AC-1.ROLE.002.1  — toggle a node → effective on the next request, no deploy
//   AC-1.ROLE.002.2  — a custom role is immediately assignable
//   AC-1.ROLE.003.1  — an Admin attempt to manage roles is denied + logged
//   AC-1.ROLE.004.1  — role with users → delete blocked with a reassign message
//   AC-1.ROLE.004.2  — unused + unprotected role → deletable + audited
//   AC-1.ROLE.005.1  — last Super Admin removal/deactivation blocked
//   AC-1.ROLE.005.2  — concurrent double-demotion → at most one succeeds, ≥1 Super Admin remains
//   AC-1.PERM.001.1  — a harness deny holds even when the prompt instructs the AI to proceed
//   AC-1.PERM.002.1  — a node absent from a user's role → denied
//   AC-1.PERM.002.2  — a brand-new unassigned node → denied until granted
//   AC-1.PERM.003.1  — a context-scoped node with out-of-scope context → deny
//   AC-1.PERM.004.1  — a matrix toggle adds/removes a role_permissions row, effective no deploy
//   AC-1.PERM.005.1  — every catalog node carries all four fields
//   AC-1.PERM.005.2  — the admin matrix renders every catalog node (none hardcoded/omitted)
//   AC-1.PERM.006.1  — a direct call to a denied endpoint → explicit auth error + logged
//   AC-1.PERM.006.2  — the denied surface is absent from the user's UI
//   AC-1.PERM.007.1  — seed catalog: all thirteen categories + every C0 stub node
//   AC-NFR-SEC.013.1 — the same action on every surface hits the identical gate (no bypass)
//   AC-NFR-SEC.013.2 — a destructive action's node-gate fires before any confirm dialog
//   AC-NFR-SEC.005.1 — a coverage gap routes to denial, never silent permission
//   AF-080           — can() and the RLS helper agree on the grant subset (no drift)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  InMemoryRbacStore,
  seedRoles,
  createRole,
  toggleNode,
  deleteRole,
  changeUserRole,
  deactivateUser,
  auditDeniedAccess,
  can,
  canWithPrompt,
  authorizeDestructive,
  effectiveNodes,
  rlsHelperPerms,
  renderAdminMatrix,
  CATALOG,
  CATALOG_NODES,
  SEED_MATRIX,
  THIRTEEN_CATEGORIES,
  C0_STUB_NODES,
  ROLES,
  ROLE_MANAGE_NODE,
  ERR_DENIED,
  ERR_PROTECTED,
  ERR_ROLE_IN_USE,
  ERR_LAST_SUPER_ADMIN,
  type RbacStore,
  type ScopeCheck,
} from './index.ts';

async function roleId(store: RbacStore, name: string): Promise<string> {
  const r = await store.getRoleByName(name);
  assert.ok(r, `seed role ${name} must exist`);
  return r.id;
}

/** A seeded deployment with one user per key role. */
async function seeded(): Promise<{ store: InMemoryRbacStore; sa: string; admin: string; std: string }> {
  const store = new InMemoryRbacStore();
  await seedRoles(store);
  const sa = await roleId(store, 'Super Admin');
  const admin = await roleId(store, 'Admin');
  const std = await roleId(store, 'Standard User');
  await store.assignRole('u-super', sa);
  await store.assignRole('u-admin', admin);
  await store.assignRole('u-std', std);
  return { store, sa, admin, std };
}

// ── ROLE ────────────────────────────────────────────────────────────────────────────────────────
test('AC-1.ROLE.001.1 — fresh deployment seeds exactly the six roles with default nodes + clearances', async () => {
  const store = new InMemoryRbacStore();
  await seedRoles(store);
  const roles = await store.listRoles();
  assert.equal(roles.length, 6);
  assert.deepEqual(new Set(roles.map((r) => r.name)), new Set(ROLES));
  // Super Admin is protected; all six are default.
  assert.ok(roles.find((r) => r.name === 'Super Admin')!.is_protected);
  assert.ok(roles.every((r) => r.is_default));
  // Super Admin holds role_manage; default clearances seeded for Super Admin + Admin (Global confidential+personal).
  const saNodes = await store.roleNodes(await roleId(store, 'Super Admin'));
  assert.ok(saNodes.has(ROLE_MANAGE_NODE));
  const saClear = await store.roleClearances(await roleId(store, 'Super Admin'));
  assert.deepEqual(new Set(saClear.map((c) => c.tier)), new Set(['confidential', 'personal']));
  const stdClear = await store.roleClearances(await roleId(store, 'Standard User'));
  assert.equal(stdClear.length, 0); // standard is implicit — no row
});

test('AC-1.ROLE.001.1(guard) — a partial pre-existing seed fails loud, never silently completes', async () => {
  const store = new InMemoryRbacStore();
  await store.createRole('Super Admin', true, true); // a lone, partial seed
  await assert.rejects(() => seedRoles(store), /partial role seed/);
});

test('AC-1.ROLE.002.1 — toggling a node changes effective permission on the next request, no deploy', async () => {
  const { store, std } = await seeded();
  const node = 'PERM-dashboard.ops';
  assert.equal(await (await effectiveNodes(store, 'u-std')).has(node), false);
  await toggleNode(store, 'u-super', std, node, true);
  assert.equal((await can(store, 'u-std', node)).allow, true); // effective immediately, same store read
});

test('AC-1.ROLE.002.2 — a custom role is immediately assignable', async () => {
  const { store } = await seeded();
  const role = await createRole(store, 'u-super', 'Analyst');
  await store.assignRole('u-new', role.id);
  assert.equal(await store.userRoleId('u-new'), role.id);
});

test('AC-1.ROLE.003.1 — an Admin attempt to manage roles is denied and logged', async () => {
  const { store } = await seeded();
  await assert.rejects(() => createRole(store, 'u-admin', 'Analyst'), (e: Error) => (e as any).reason === ERR_DENIED);
  const audits = await store.audits();
  assert.ok(audits.some((a) => a.action === 'denied:create-role' && a.actor_identity === 'u-admin'));
});

test('AC-1.ROLE.004.1 — a role with assigned users cannot be deleted (reassign-first message)', async () => {
  const { store } = await seeded();
  const role = await createRole(store, 'u-super', 'Analyst');
  await store.assignRole('u-x', role.id);
  await assert.rejects(
    () => deleteRole(store, 'u-super', role.id),
    (e: Error) => (e as any).reason === ERR_ROLE_IN_USE && /reassign/.test(e.message),
  );
});

test('AC-1.ROLE.004.2 — an unused, unprotected role is deletable and audited; a protected role is not', async () => {
  const { store, sa } = await seeded();
  const role = await createRole(store, 'u-super', 'Analyst');
  await deleteRole(store, 'u-super', role.id);
  assert.equal(await store.getRole(role.id), null);
  assert.ok((await store.audits()).some((a) => a.action === 'delete-role' && a.target_entity_id === role.id));
  // the protected Super Admin role can never be deleted
  await assert.rejects(() => deleteRole(store, 'u-super', sa), (e: Error) => (e as any).reason === ERR_PROTECTED);
});

test('AC-1.ROLE.005.1 — the last Super Admin cannot be demoted or deactivated', async () => {
  const { store, std } = await seeded(); // exactly one Super Admin (u-super)
  await assert.rejects(() => changeUserRole(store, 'u-super', 'u-super', std), (e: Error) => (e as any).reason === ERR_LAST_SUPER_ADMIN);
  await assert.rejects(() => deactivateUser(store, 'u-super', 'u-super'), (e: Error) => (e as any).reason === ERR_LAST_SUPER_ADMIN);
  assert.equal(await store.superAdminUserCount(), 1); // still one — never orphaned
});

test('AC-1.ROLE.005.2 — concurrent double-demotion: at most one succeeds, ≥1 Super Admin remains', async () => {
  const store = new InMemoryRbacStore();
  await seedRoles(store);
  const sa = await roleId(store, 'Super Admin');
  const std = await roleId(store, 'Standard User');
  await store.assignRole('u-sa1', sa);
  await store.assignRole('u-sa2', sa);
  assert.equal(await store.superAdminUserCount(), 2);
  // the ADR-004 atomic guard is the enforcement point — race both demotions on it
  const results = await Promise.all([store.atomicChangeRole('u-sa1', std), store.atomicChangeRole('u-sa2', std)]);
  assert.equal(results.filter(Boolean).length, 1); // exactly one succeeded
  assert.ok((await store.superAdminUserCount()) >= 1); // never zero
});

// ── PERM ────────────────────────────────────────────────────────────────────────────────────────
test('AC-1.PERM.001.1 — a harness deny holds even when the prompt instructs the AI to proceed', async () => {
  const { store } = await seeded();
  const d = await canWithPrompt(store, 'u-std', ROLE_MANAGE_NODE, /* promptSaysProceed */ true);
  assert.equal(d.allow, false); // the prompt cannot upgrade a harness deny (ADR-007)
});

test('AC-1.PERM.002.1 — a node absent from a user’s role is denied', async () => {
  const { store } = await seeded();
  assert.equal((await can(store, 'u-std', ROLE_MANAGE_NODE)).allow, false);
  assert.equal((await can(store, 'u-super', ROLE_MANAGE_NODE)).allow, true); // sanity: SA holds it
});

test('AC-1.PERM.002.2 — a brand-new unassigned node is denied for everyone until granted', async () => {
  const { store } = await seeded();
  const brandNew = 'PERM-brandnew.capability_xyz';
  for (const u of ['u-super', 'u-admin', 'u-std']) {
    assert.equal((await can(store, u, brandNew)).allow, false);
  }
});

test('AC-1.PERM.003.1 — a context-scoped node with out-of-scope context is denied', async () => {
  const { store, std } = await seeded();
  const node = 'PERM-dashboard.ops';
  await toggleNode(store, 'u-super', std, node, true);
  const financeOnly: ScopeCheck = (ctx) => ctx.entityType === 'finance';
  assert.equal((await can(store, 'u-std', node, { entityType: 'hr' }, financeOnly)).allow, false);
  assert.equal((await can(store, 'u-std', node, { entityType: 'finance' }, financeOnly)).allow, true);
});

test('AC-1.PERM.004.1 — a matrix toggle adds/removes a role_permissions row, effective no deploy', async () => {
  const { store, std } = await seeded();
  const node = 'PERM-dashboard.ops';
  await toggleNode(store, 'u-super', std, node, true);
  assert.ok((await store.roleNodes(std)).has(node));
  await toggleNode(store, 'u-super', std, node, false);
  assert.equal((await store.roleNodes(std)).has(node), false);
  assert.equal((await can(store, 'u-std', node)).allow, false); // revoked, effective immediately
});

test('AC-1.PERM.005.1 — every catalog node carries all four required fields', () => {
  for (const n of CATALOG) {
    assert.ok(n.description.trim(), `${n.node} description`);
    assert.ok(n.defaultRoles.length > 0, `${n.node} default roles`);
    assert.ok(n.scope.trim(), `${n.node} scope`);
    assert.ok(n.addedIn.trim(), `${n.node} added-in`);
  }
});

test('AC-1.PERM.005.2 — the admin matrix renders every catalog node, none hardcoded or omitted', () => {
  const rendered = new Set(renderAdminMatrix().map((r) => r.node));
  assert.deepEqual(rendered, CATALOG_NODES);
  // every rendered row exposes a grant flag for all six roles
  for (const row of renderAdminMatrix()) {
    assert.deepEqual(new Set(Object.keys(row.grants)), new Set(ROLES));
  }
});

test('AC-1.PERM.006.1 — a direct call to a denied endpoint yields an explicit auth error and is logged', async () => {
  const { store } = await seeded();
  const node = 'PERM-compliance.view_audit';
  const d = await can(store, 'u-std', node);
  assert.equal(d.allow, false);
  assert.equal(d.reason, 'node-not-granted'); // explicit, not a silent empty success
  await auditDeniedAccess(store, 'u-std', node);
  assert.ok((await store.audits()).some((a) => a.action === 'denied:direct-access' && a.reason === node));
});

test('AC-1.PERM.006.2 — a denied surface is absent from the user’s visible node set', async () => {
  const { store } = await seeded();
  const visible = await effectiveNodes(store, 'u-std');
  assert.equal(visible.has('PERM-compliance.view_audit'), false);
  assert.equal(visible.has('PERM-dashboard.workspace'), true); // std does see its own workspace
});

test('AC-1.PERM.007.1 — the seed catalog has all thirteen categories and every C0 stub node', () => {
  for (const cat of THIRTEEN_CATEGORIES) {
    assert.ok(SEED_MATRIX[cat] && SEED_MATRIX[cat].length > 0, `category ${cat}`);
    for (const row of SEED_MATRIX[cat]) assert.equal(row.roles.length, ROLES.length);
  }
  for (const stub of C0_STUB_NODES) {
    const n = CATALOG.find((x) => x.node === stub);
    assert.ok(n && n.defaultRoles.length > 0, `C0 stub ${stub}`);
  }
});

// ── NFR ─────────────────────────────────────────────────────────────────────────────────────────
test('AC-NFR-SEC.013.1 — the same action on every surface hits the identical gate (no bypass)', async () => {
  const { store } = await seeded();
  const surfaces = ['desktop', 'mobile', 'command', 'quick-tap', 'api'] as const;
  // a denied node is denied on every surface; a granted node is allowed on every surface — no weaker door
  const deniedDecisions = await Promise.all(surfaces.map((s) => can(store, 'u-std', ROLE_MANAGE_NODE, { surface: s })));
  assert.ok(deniedDecisions.every((d) => d.allow === false));
  const allowedDecisions = await Promise.all(surfaces.map((s) => can(store, 'u-super', ROLE_MANAGE_NODE, { surface: s })));
  assert.ok(allowedDecisions.every((d) => d.allow === true));
});

test('AC-NFR-SEC.013.2 — a destructive action’s node-gate fires before any confirm dialog', async () => {
  const { store } = await seeded();
  let confirmShown = false;
  const confirm = async () => {
    confirmShown = true;
    return true;
  };
  const r = await authorizeDestructive(store, 'u-std', ROLE_MANAGE_NODE, confirm);
  assert.equal(r.decision.allow, false);
  assert.equal(r.confirmShown, false);
  assert.equal(confirmShown, false); // the confirm callback was never reached
});

test('AC-NFR-SEC.005.1 — a coverage gap routes to denial, never silent permission', async () => {
  const { store } = await seeded();
  const uncovered = 'PERM-uncovered.dangerous_capability';
  for (const u of ['u-super', 'u-admin', 'u-std']) {
    assert.equal((await can(store, u, uncovered)).allow, false); // fail safe to denial
  }
});

// ── AF-080 — harness/RLS non-drift ────────────────────────────────────────────────────────────────
test('AF-080 — can() and the RLS helper agree on the grant subset (no drift)', async () => {
  const store = new InMemoryRbacStore();
  await seedRoles(store);
  // one user per role, plus a roleless user
  const users: Array<[string, string | null]> = [];
  for (const name of ROLES) {
    const rid = await roleId(store, name);
    const uid = `u-${name.replace(/\s+/g, '').toLowerCase()}`;
    await store.assignRole(uid, rid);
    users.push([uid, rid]);
  }
  users.push(['u-norole', null]);

  for (const [uid] of users) {
    const harness = await effectiveNodes(store, uid);
    const rls = await rlsHelperPerms(store, uid);
    assert.deepEqual(harness, rls, `effectiveNodes ≡ RLS helper perms for ${uid}`);
    // and can()'s decision is exactly membership in the RLS helper set for every catalog node
    for (const node of CATALOG_NODES) {
      assert.equal((await can(store, uid, node)).allow, rls.has(node), `can(${uid}, ${node}) ⇔ RLS helper`);
    }
  }
});

test('AF-080(teeth) — a DEACTIVATED assignment is excluded by BOTH readers (a dropped `active` filter would diverge)', async () => {
  const store = new InMemoryRbacStore();
  await seedRoles(store);
  const sa = await roleId(store, 'Super Admin'); // holds role_manage
  await store.assignRole('u-was-sa', sa);
  store._deactivateUser('u-was-sa'); // user_roles.active = false — a deactivated ex-Super-Admin
  // Both independent readers must resolve the empty set; a reader ignoring `active` would return role_manage.
  const harness = await effectiveNodes(store, 'u-was-sa');
  const rls = await rlsHelperPerms(store, 'u-was-sa');
  assert.equal(harness.size, 0);
  assert.equal(rls.size, 0);
  assert.deepEqual(harness, rls);
  assert.equal((await can(store, 'u-was-sa', ROLE_MANAGE_NODE)).allow, false); // no residual grant
});
