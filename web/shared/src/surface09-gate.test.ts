// ISSUE-067 (surface-09) — the RBAC gate proof for the agent Builder, tying THREE real sources together so none can
// drift: (1) the CLIENT_NAV 'agents' entry gates on PERM-agents.view and is ABSENT (not empty) for a caller lacking
// it (absent-not-empty, FR-1.PERM.006); (2) the OD-080 authority split is exactly what app/rbac's DEFAULT matrix
// grants — Admin gets view + edit_description but NOT edit_capability, Super Admin gets all three; (3) builderAuthority
// (the render's field-lock projection) reads that same node set, so the Builder's locked-capability UI can never
// disagree with the harness gate. Runs under tsx --test like nav.test.ts, importing the REAL app/rbac source.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ROLES,
  CATALOG_NODES,
  defaultMatrix,
  InMemoryRbacStore,
  effectiveNodes,
  type Role,
} from '../../../app/rbac/src/index.ts';
import { builderAuthority } from '../../agent-bridge/src/builder-ui.ts';

import { CLIENT_NAV, visibleNav } from './nav.ts';

const PERM_VIEW = 'PERM-agents.view';
const PERM_EDIT_DESCRIPTION = 'PERM-agents.edit_description';
const PERM_EDIT_CAPABILITY = 'PERM-agents.edit_capability';

async function nodesForRole(role: Role): Promise<Set<string>> {
  const store = new InMemoryRbacStore();
  const roleRow = await store.createRole(role, true, role === 'Super Admin');
  for (const node of defaultMatrix().get(role) ?? new Set<string>()) store._grant(roleRow.id, node);
  const userId = `user-${role.replace(/\s+/g, '-').toLowerCase()}`;
  await store.assignRole(userId, roleRow.id);
  return effectiveNodes(store, userId);
}

test('the three OD-080 nodes are REAL app/rbac catalog nodes (no invented permission)', () => {
  for (const n of [PERM_VIEW, PERM_EDIT_DESCRIPTION, PERM_EDIT_CAPABILITY]) {
    assert.ok(CATALOG_NODES.has(n), `${n} must be in app/rbac's CATALOG`);
  }
});

test("surface-09 nav entry 'agents' gates on PERM-agents.view", () => {
  const entry = CLIENT_NAV.find((e) => e.id === 'agents');
  assert.ok(entry, "CLIENT_NAV must carry an 'agents' entry");
  assert.equal(entry!.node, PERM_VIEW);
});

test('absent-not-empty: a caller WITHOUT PERM-agents.view sees NO agents nav entry (direct visit 404s)', async () => {
  const stdNodes = await nodesForRole('Standard User');
  assert.ok(!stdNodes.has(PERM_VIEW), 'Standard User must not hold PERM-agents.view by default');
  const visibleIds = new Set(visibleNav(CLIENT_NAV, stdNodes).map((e) => e.id));
  assert.ok(!visibleIds.has('agents'), "the 'agents' entry must be ABSENT for a Standard User, not shown-and-disabled");
});

test('a caller WITH PERM-agents.view (Admin, Super Admin) sees the agents nav entry', async () => {
  for (const role of ['Admin', 'Super Admin'] as Role[]) {
    const nodes = await nodesForRole(role);
    const visibleIds = new Set(visibleNav(CLIENT_NAV, nodes).map((e) => e.id));
    assert.ok(visibleIds.has('agents'), `${role} must see the agents entry`);
  }
});

test('OD-080 default matrix: Admin can view + edit_description but CANNOT edit_capability', async () => {
  const adminNodes = await nodesForRole('Admin');
  const a = builderAuthority(adminNodes);
  assert.equal(a.canView, true, 'Admin enters the Builder');
  assert.equal(a.canEditDescription, true, 'Admin edits description/tuning');
  assert.equal(
    a.canEditCapability,
    false,
    'Admin must NOT edit memory_scope / tools_allowed / enabled / add / disable — Super-Admin-only (OD-080)',
  );
});

test('OD-080 default matrix: Super Admin holds all three authority tiers', async () => {
  const saNodes = await nodesForRole('Super Admin');
  const a = builderAuthority(saNodes);
  assert.equal(a.canView && a.canEditDescription && a.canEditCapability, true);
});

test('OD-080 default matrix: no role OTHER than Super Admin holds edit_capability', async () => {
  for (const role of ROLES) {
    const nodes = await nodesForRole(role);
    if (role === 'Super Admin') continue;
    assert.ok(!nodes.has(PERM_EDIT_CAPABILITY), `${role} must not hold ${PERM_EDIT_CAPABILITY} by default (OD-080)`);
  }
});
