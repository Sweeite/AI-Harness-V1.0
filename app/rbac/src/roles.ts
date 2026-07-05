// ISSUE-018 — role seed + runtime CRUD + the two safety guards (FR-1.ROLE.001–005).
//
//   • seedRoles()       — provisioning writes exactly the six default roles + their default node grants +
//                         default clearances; fails LOUD on a partial seed (never silently incomplete, #3).
//   • createRole/toggleNode/deleteRole — Super-Admin-only runtime data writes (no migration/redeploy); every
//                         write routes through can(PERM-system.role_manage) and audits a denial (ROLE.002/003).
//   • deleteRole guard  — blocked when the role is protected OR has ≥1 assigned user (ROLE.004).
//   • last-Super-Admin guard — the shared, ATOMIC precondition (ROLE.005) that ISSUE-021's deactivate /
//                         role-change actions also call; safe under concurrency (ADR-004).

import {
  ROLES,
  PROTECTED_ROLE,
  defaultMatrix,
  CATALOG_NODES,
  type Role,
} from './catalog.ts';
import { can } from './can.ts';
import {
  RbacError,
  ERR_DENIED,
  ERR_PROTECTED,
  ERR_ROLE_IN_USE,
  ERR_LAST_SUPER_ADMIN,
  ERR_NO_SUCH_ROLE,
  type RbacStore,
  type RoleRow,
} from './store.ts';

export const ROLE_MANAGE_NODE = 'PERM-system.role_manage';

/** The per-role default clearance seed (ISSUE-018 scope). tier ∈ {confidential, personal}; Global scope
 * (entity_type_scope null). Standard is implicit for every role (no row). The entity-scoped narrowing
 * (Finance→confidential-finance-only, HR→personal-team-only, Account Manager→confidential-client-only) is
 * ISSUE-019 territory (it composes with the entity model, ISSUE-022) — NOT seeded here to avoid inventing
 * entity-type tokens. Source: design-doc L509-615 "SENSITIVITY CLEARANCE" (the "(all)" rows). */
function defaultClearances(role: Role): Array<{ tier: 'confidential' | 'personal'; entity_type_scope: string | null }> {
  if (role === 'Super Admin' || role === 'Admin') {
    return [
      { tier: 'confidential', entity_type_scope: null },
      { tier: 'personal', entity_type_scope: null },
    ];
  }
  return []; // standard-implicit only; entity-scoped defaults are ISSUE-019
}

/**
 * Provisioning seed (FR-1.ROLE.001 / AC-1.ROLE.001.1). Fresh deployment → exactly the six named roles, each
 * with its default node set + default clearances. Fails loud on a partial pre-existing seed rather than
 * silently completing an inconsistent state. Idempotent on a fully-seeded deployment.
 */
export async function seedRoles(store: RbacStore): Promise<void> {
  const existing = await store.listRoles();
  const seedRolesPresent = existing.filter((r) => (ROLES as readonly string[]).includes(r.name));
  if (seedRolesPresent.length !== 0 && seedRolesPresent.length !== 6) {
    throw new RbacError('partial_seed', `partial role seed detected (${seedRolesPresent.length}/6 seed roles present) — refusing to silently complete an inconsistent seed`);
  }

  const matrix = defaultMatrix();
  for (const name of ROLES) {
    let role = await store.getRoleByName(name);
    if (!role) role = await store.createRole(name, true, name === PROTECTED_ROLE);
    for (const node of matrix.get(name)!) await store.setNode(role.id, node, true);
    for (const cl of defaultClearances(name)) {
      await store.seedClearance({ role_id: role.id, user_id: null, tier: cl.tier, entity_type_scope: cl.entity_type_scope });
    }
  }

  // Post-condition: exactly the six seed roles exist (fail loud if not).
  const after = (await store.listRoles()).filter((r) => (ROLES as readonly string[]).includes(r.name));
  if (after.length !== 6) {
    throw new RbacError('seed_incomplete', `role seed did not converge to six roles (got ${after.length}) — provisioning must fail loud`);
  }
}

/** Route a role-management write through the single gate; on deny, audit the refusal and throw (never silent). */
async function requireRoleManage(store: RbacStore, actorId: string, action: string, targetRoleId: string | null): Promise<void> {
  const decision = await can(store, actorId, ROLE_MANAGE_NODE);
  if (!decision.allow) {
    await store.appendAudit({
      audit_type: 'rbac',
      actor_identity: actorId,
      action: `denied:${action}`,
      target_type: 'role',
      target_entity_id: targetRoleId,
      reason: decision.reason,
    });
    throw new RbacError(ERR_DENIED, `authorization denied: ${ROLE_MANAGE_NODE} required to ${action}`);
  }
}

/** Create a custom role at runtime (data write; immediately assignable — AC-1.ROLE.002.2 / FR-1.ROLE.002). */
export async function createRole(store: RbacStore, actorId: string, name: string): Promise<RoleRow> {
  await requireRoleManage(store, actorId, 'create-role', null);
  const role = await store.createRole(name, false, false);
  await store.appendAudit({ audit_type: 'rbac', actor_identity: actorId, action: 'create-role', target_type: 'role', target_entity_id: role.id, reason: null });
  return role;
}

/** Toggle a (role, node) matrix cell — add/remove a role_permissions row; effective next request, no deploy
 *  (AC-1.PERM.004.1 / AC-1.ROLE.002.1 / FR-1.RLS.006). Rejects a node absent from the catalog (PERM.005). */
export async function toggleNode(store: RbacStore, actorId: string, roleId: string, node: string, granted: boolean): Promise<void> {
  await requireRoleManage(store, actorId, 'toggle-node', roleId);
  if (!CATALOG_NODES.has(node)) {
    throw new RbacError('unknown_node', `'${node}' is not in PERMISSION_NODES.md — a gate must be catalogued before it can be granted (FR-1.PERM.005)`);
  }
  const role = await store.getRole(roleId);
  if (!role) throw new RbacError(ERR_NO_SUCH_ROLE, `no such role ${roleId}`);
  await store.setNode(roleId, node, granted);
  await store.appendAudit({ audit_type: 'rbac', actor_identity: actorId, action: granted ? 'grant-node' : 'revoke-node', target_type: 'role', target_entity_id: roleId, reason: node });
}

/**
 * Delete a role (FR-1.ROLE.004). Allowed only when the role is not protected AND has zero assigned users;
 * otherwise blocked with an explicit reason (AC-1.ROLE.004.1/.2). A successful delete is audited.
 */
export async function deleteRole(store: RbacStore, actorId: string, roleId: string): Promise<void> {
  await requireRoleManage(store, actorId, 'delete-role', roleId);
  const role = await store.getRole(roleId);
  if (!role) throw new RbacError(ERR_NO_SUCH_ROLE, `no such role ${roleId}`);
  if (role.is_protected) {
    throw new RbacError(ERR_PROTECTED, `role '${role.name}' is protected and cannot be deleted`);
  }
  const assigned = await store.usersInRole(roleId);
  if (assigned > 0) {
    throw new RbacError(ERR_ROLE_IN_USE, `role '${role.name}' has ${assigned} assigned user(s) — reassign them to another role before deleting`);
  }
  await store.deleteRoleRow(roleId);
  await store.appendAudit({ audit_type: 'rbac', actor_identity: actorId, action: 'delete-role', target_type: 'role', target_entity_id: roleId, reason: 'unused-unprotected' });
}

// ── FR-1.ROLE.005 — the last-Super-Admin guard (the shared precondition ISSUE-021 also calls) ───────

/** Read-side pre-flight check (for UI/pre-validation): would this change orphan the last Super Admin?
 *  NOT the enforcement point — the atomic store methods below are. */
export async function isLastSuperAdmin(store: RbacStore, userId: string): Promise<boolean> {
  const sa = await store.getRoleByName(PROTECTED_ROLE);
  if (!sa) return false;
  const targetRoleId = await store.userRoleId(userId);
  if (targetRoleId !== sa.id) return false;
  return (await store.superAdminUserCount()) <= 1;
}

/** Atomically change a user's role, refusing if it would remove the last Super Admin (AC-1.ROLE.005.1/.2).
 *  Safe under concurrency (ADR-004): the underlying store method is one critical section. */
export async function changeUserRole(store: RbacStore, actorId: string, targetUserId: string, newRoleId: string): Promise<void> {
  await requireRoleManage(store, actorId, 'change-user-role', newRoleId);
  const ok = await store.atomicChangeRole(targetUserId, newRoleId);
  if (!ok) {
    await store.appendAudit({ audit_type: 'rbac', actor_identity: actorId, action: 'denied:change-user-role', target_type: 'user', target_entity_id: targetUserId, reason: ERR_LAST_SUPER_ADMIN });
    throw new RbacError(ERR_LAST_SUPER_ADMIN, 'cannot remove the Super Admin role from the last remaining Super Admin');
  }
  await store.appendAudit({ audit_type: 'rbac', actor_identity: actorId, action: 'change-user-role', target_type: 'user', target_entity_id: targetUserId, reason: null });
}

/** Atomically deactivate a user, refusing if it would remove the last Super Admin (AC-1.ROLE.005.1). */
export async function deactivateUser(store: RbacStore, actorId: string, targetUserId: string): Promise<void> {
  // gated by PERM-user.deactivate at the ISSUE-021 call site; here we enforce the shared ROLE.005 guard.
  const ok = await store.atomicDeactivate(targetUserId);
  if (!ok) {
    await store.appendAudit({ audit_type: 'rbac', actor_identity: actorId, action: 'denied:deactivate-user', target_type: 'user', target_entity_id: targetUserId, reason: ERR_LAST_SUPER_ADMIN });
    throw new RbacError(ERR_LAST_SUPER_ADMIN, 'cannot deactivate the last remaining Super Admin');
  }
  await store.appendAudit({ audit_type: 'rbac', actor_identity: actorId, action: 'deactivate-user', target_type: 'user', target_entity_id: targetUserId, reason: null });
}

// ── FR-1.PERM.006 — denied-access audit helper (explicit error + logged; never silent) ─────────────
/** Record a denied direct/API access attempt (AC-1.PERM.006.1). The caller returns an explicit auth error
 *  (OD-026) to the client; this logs it so a probe is never a silent empty success. */
export async function auditDeniedAccess(store: RbacStore, actorId: string, node: string): Promise<void> {
  await store.appendAudit({ audit_type: 'rbac', actor_identity: actorId, action: 'denied:direct-access', target_type: 'node', target_entity_id: null, reason: node });
}
