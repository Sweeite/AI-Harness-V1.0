// ISSUE-087 §4/§9 — THE MARQUEE PROOF: the UI nav-gate and app/rbac's can() agree, and the nav invents
// no permission of its own. This is the "no divergent second source of truth for permissions" AC (AF-080
// spirit). It runs under the repo's tsx --test harness exactly like every app/* package, importing the
// REAL @harness/rbac source (not a copy) — so if the UI gate and the harness gate ever diverge, this fails.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ROLES,
  CATALOG_NODES,
  defaultMatrix,
  InMemoryRbacStore,
  effectiveNodes,
  allowed,
  type Role,
} from '../../../app/rbac/src/index.ts';

import { CLIENT_NAV, ADMIN_NAV, visibleNav, navSections, type NavEntry } from './nav.ts';

const ALL_NAV: NavEntry[] = [...CLIENT_NAV, ...ADMIN_NAV];

/** Build a real RbacStore where `user` holds exactly `role`'s default-matrix grants. */
async function storeForRole(role: Role): Promise<{ store: InMemoryRbacStore; userId: string }> {
  const store = new InMemoryRbacStore();
  const isProtected = role === 'Super Admin';
  const roleRow = await store.createRole(role, true, isProtected);
  const nodes = defaultMatrix().get(role) ?? new Set<string>();
  for (const node of nodes) store._grant(roleRow.id, node);
  const userId = `user-${role.replace(/\s+/g, '-').toLowerCase()}`;
  await store.assignRole(userId, roleRow.id);
  return { store, userId };
}

test('every nav entry gates on a REAL app/rbac catalog node (no invented permission = no second source of truth)', () => {
  for (const entry of ALL_NAV) {
    if (entry.node === null) continue;
    assert.ok(
      CATALOG_NODES.has(entry.node),
      `nav entry '${entry.id}' gates on '${entry.node}', which is NOT in app/rbac's CATALOG — the UI would be inventing a permission (drift).`,
    );
  }
});

test('the UI nav-gate agrees with can() pairwise, for every seeded role and every gated entry', async () => {
  for (const role of ROLES) {
    const { store, userId } = await storeForRole(role);
    const granted = await effectiveNodes(store, userId);
    const visible = new Set(visibleNav(ALL_NAV, granted).map((e) => e.id));

    for (const entry of ALL_NAV) {
      if (entry.node === null) {
        assert.ok(visible.has(entry.id), `ungated entry '${entry.id}' must always be visible`);
        continue;
      }
      // The harness gate — the SAME function every backend action routes through.
      const canSee = await allowed(store, userId, entry.node);
      const uiShows = visible.has(entry.id);
      assert.equal(
        uiShows,
        canSee,
        `DIVERGENCE for role '${role}', entry '${entry.id}' (${entry.node}): UI shows=${uiShows} but can()=${canSee}. The nav must never disagree with the harness gate.`,
      );
    }
  }
});

test('absent-not-empty: a denied entry is filtered OUT of the list, never returned as a disabled row', async () => {
  // Standard User holds no admin/fleet nodes by default → those entries must be ABSENT from the list.
  const { store, userId } = await storeForRole('Standard User');
  const granted = await effectiveNodes(store, userId);
  const visible = visibleNav(CLIENT_NAV, granted);
  const visibleIds = new Set(visible.map((e) => e.id));

  // The returned list contains ONLY granted entries — no placeholder/locked rows for denied ones.
  for (const e of visible) {
    assert.ok(e.node === null || granted.has(e.node), `visibleNav leaked a denied entry '${e.id}'`);
  }
  // A representative admin-only entry (User Management, PERM-user.invite) is absent for a Standard User.
  assert.ok(!visibleIds.has('users'), 'User Management must be ABSENT for a Standard User, not shown-and-disabled');
  // …and the caller simply gets a shorter list, not an empty one padded with locked items.
  assert.ok(visible.length < CLIENT_NAV.length, 'a lower-privilege user should see fewer entries');
});

test('a Super Admin sees the full client rail; the admin management-plane rail gates on fleet nodes', async () => {
  const { store, userId } = await storeForRole('Super Admin');
  const granted = await effectiveNodes(store, userId);

  const clientVisible = visibleNav(CLIENT_NAV, granted);
  assert.equal(clientVisible.length, CLIENT_NAV.length, 'Super Admin should see every client-app nav entry');

  const adminVisible = visibleNav(ADMIN_NAV, granted);
  assert.equal(adminVisible.length, ADMIN_NAV.length, 'Super Admin holds the Management Plane fleet nodes');

  // A non-SA role (Admin) does NOT hold the fleet nodes → the admin rail is empty for them.
  const admin = await storeForRole('Admin');
  const adminGranted = await effectiveNodes(admin.store, admin.userId);
  assert.equal(visibleNav(ADMIN_NAV, adminGranted).length, 0, 'only Super Admin enters the management plane by default');
});

test('navSections groups filtered entries without inventing or dropping any', async () => {
  const { store, userId } = await storeForRole('Super Admin');
  const granted = await effectiveNodes(store, userId);
  const visible = visibleNav(CLIENT_NAV, granted);
  const grouped = navSections(visible);
  const flat = grouped.flatMap((g) => g.entries);
  assert.equal(flat.length, visible.length, 'grouping must preserve exactly the filtered entries');
  assert.deepEqual(new Set(flat.map((e) => e.id)), new Set(visible.map((e) => e.id)));
});
