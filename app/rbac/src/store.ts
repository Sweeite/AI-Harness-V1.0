// ISSUE-018 — the RbacStore PORT + in-memory fake reference model (the house port+fake pattern, cf.
// app/config-store, app/webhook-auth, app/silo). Every live side effect of the authorization core goes
// through this port so can() + the role lifecycle stay unit-testable with NO live DB. The in-memory fake
// is BOTH the test double AND the reference model the live pg adapter (supabase-store.ts) must match.
//
// Faithful to schema.md §2 (roles / role_permissions / user_roles / sensitivity_clearances /
// restricted_grants / access_audit). Invariants enforced in the fake EXACTLY as the DB would:
//   1. role_permissions unique(role_id, permission_node) — presence = grant, absence = default-deny.
//   2. user_roles unique(user_id) — one active role per user, v1 (OD-029).
//   3. roles.is_protected can never be deleted; a role with ≥1 assigned user can never be deleted.
//   4. The last-Super-Admin guard is ATOMIC (ADR-004): the count-check and the mutation are one critical
//      section — two concurrent demotions serialize, at most one succeeds, ≥1 Super Admin always remains.
//   5. access_audit is append-only — the store exposes appendAudit only (no update/delete of an audit row).

import { ROLES, type Role, PROTECTED_ROLE } from './catalog.ts';

// ── Row shapes (schema.md §2) ─────────────────────────────────────────────────────────────────────
export interface RoleRow {
  id: string;
  name: string;
  is_default: boolean;
  is_protected: boolean;
}
export interface RolePermissionRow {
  role_id: string;
  permission_node: string;
}
export interface UserRoleRow {
  user_id: string;
  role_id: string;
  active: boolean;
}
export interface RestrictedGrantRow {
  grantee_user_id: string;
  entity_id: string | null;
  entity_type: string | null;
  revoked_at: string | null; // null = active
}
/** sensitivity_clearances (schema.md §2). tier ∈ {confidential, personal}; standard is implicit, Restricted
 *  is per-individual via restricted_grants. entity_type_scope null = Global. ISSUE-018 seeds the per-role
 *  DEFAULT rows only; the grant/revoke/review flows + entity-scoped narrowing are ISSUE-019. */
export interface ClearanceRow {
  role_id: string | null;
  user_id: string | null;
  tier: 'confidential' | 'personal';
  entity_type_scope: string | null; // null = Global
}
export interface AuditRow {
  audit_type: string;
  actor_identity: string;
  action: string;
  target_type: string | null;
  target_entity_id: string | null;
  reason: string | null;
}

/** Raised by every guard/gate failure — carries a machine reason so callers surface, never swallow (#3). */
export class RbacError extends Error {
  constructor(
    public reason: string,
    message: string,
  ) {
    super(message);
    this.name = 'RbacError';
  }
}
export const ERR_DENIED = 'denied'; // authorization failure (FR-1.PERM.006)
export const ERR_PROTECTED = 'role_protected';
export const ERR_ROLE_IN_USE = 'role_in_use';
export const ERR_LAST_SUPER_ADMIN = 'last_super_admin';
export const ERR_NO_SUCH_ROLE = 'no_such_role';

// ── The port ────────────────────────────────────────────────────────────────────────────────────
export interface RbacStore {
  // Reads — the SAME tables the ISSUE-009 RLS helpers read (AF-080 non-drift).
  userRoleId(userId: string): Promise<string | null>; // user_roles.role_id where active
  roleNodes(roleId: string): Promise<Set<string>>; // role_permissions.permission_node for a role
  activeRestricted(userId: string): Promise<RestrictedGrantRow[]>; // restricted_grants where revoked_at is null

  // Raw-table snapshots — used by the AF-080 differential's INDEPENDENT reader (rlsHelperPerms), which
  // re-joins user_roles ⋈ role_permissions itself (honouring `active`) rather than delegating to the
  // methods above, so the two readers are genuinely distinct code and a real drift would be caught.
  rawUserRoles(): Promise<UserRoleRow[]>;
  rawRolePermissions(): Promise<RolePermissionRow[]>;

  // Role lifecycle.
  listRoles(): Promise<RoleRow[]>;
  getRole(roleId: string): Promise<RoleRow | null>;
  getRoleByName(name: string): Promise<RoleRow | null>;
  createRole(name: string, isDefault: boolean, isProtected: boolean): Promise<RoleRow>;
  deleteRoleRow(roleId: string): Promise<void>;
  setNode(roleId: string, node: string, granted: boolean): Promise<void>; // matrix toggle
  usersInRole(roleId: string): Promise<number>;

  // Assignment + the Super-Admin invariant.
  assignRole(userId: string, roleId: string): Promise<void>;
  superAdminUserCount(): Promise<number>; // active users assigned to the Super Admin role

  // ADR-004 atomic guards for FR-1.ROLE.005 — the count-check and the mutation are ONE critical section
  // (the live adapter maps each to a conditional UPDATE guarded by a `count(*) > 1` sub-select in the same
  // txn). Return false ⇒ the change would drop the last Super Admin and was refused; true ⇒ applied.
  atomicChangeRole(userId: string, newRoleId: string): Promise<boolean>;
  atomicDeactivate(userId: string): Promise<boolean>;

  // Default clearance seed (ISSUE-018 seeds the rows; enforcement is ISSUE-019/020).
  seedClearance(row: ClearanceRow): Promise<void>;
  roleClearances(roleId: string): Promise<ClearanceRow[]>;

  // Audit sink (append-only).
  appendAudit(row: AuditRow): Promise<void>;
  audits(): Promise<AuditRow[]>;
}

let __id = 0;
const nextId = () => `id-${++__id}`;

// ── The in-memory fake reference model ────────────────────────────────────────────────────────────
export class InMemoryRbacStore implements RbacStore {
  private roles: RoleRow[] = [];
  private rolePerms: RolePermissionRow[] = [];
  private userRoles: UserRoleRow[] = [];
  private restricted: RestrictedGrantRow[] = [];
  private clearances: ClearanceRow[] = [];
  private auditLog: AuditRow[] = [];

  async userRoleId(userId: string): Promise<string | null> {
    const ur = this.userRoles.find((r) => r.user_id === userId && r.active);
    return ur ? ur.role_id : null;
  }
  async roleNodes(roleId: string): Promise<Set<string>> {
    return new Set(this.rolePerms.filter((rp) => rp.role_id === roleId).map((rp) => rp.permission_node));
  }
  async activeRestricted(userId: string): Promise<RestrictedGrantRow[]> {
    return this.restricted.filter((g) => g.grantee_user_id === userId && g.revoked_at === null);
  }
  async rawUserRoles(): Promise<UserRoleRow[]> {
    return this.userRoles.map((r) => ({ ...r }));
  }
  async rawRolePermissions(): Promise<RolePermissionRow[]> {
    return this.rolePerms.map((r) => ({ ...r }));
  }

  async listRoles(): Promise<RoleRow[]> {
    return [...this.roles];
  }
  async getRole(roleId: string): Promise<RoleRow | null> {
    return this.roles.find((r) => r.id === roleId) ?? null;
  }
  async getRoleByName(name: string): Promise<RoleRow | null> {
    return this.roles.find((r) => r.name === name) ?? null;
  }
  async createRole(name: string, isDefault: boolean, isProtected: boolean): Promise<RoleRow> {
    if (this.roles.some((r) => r.name === name)) throw new RbacError('duplicate_role', `role '${name}' already exists`);
    const row: RoleRow = { id: nextId(), name, is_default: isDefault, is_protected: isProtected };
    this.roles.push(row);
    return row;
  }
  async deleteRoleRow(roleId: string): Promise<void> {
    this.roles = this.roles.filter((r) => r.id !== roleId);
    this.rolePerms = this.rolePerms.filter((rp) => rp.role_id !== roleId);
  }
  async setNode(roleId: string, node: string, granted: boolean): Promise<void> {
    const has = this.rolePerms.some((rp) => rp.role_id === roleId && rp.permission_node === node);
    if (granted && !has) this.rolePerms.push({ role_id: roleId, permission_node: node });
    if (!granted && has) this.rolePerms = this.rolePerms.filter((rp) => !(rp.role_id === roleId && rp.permission_node === node));
  }
  async usersInRole(roleId: string): Promise<number> {
    return this.userRoles.filter((ur) => ur.role_id === roleId && ur.active).length;
  }

  async assignRole(userId: string, roleId: string): Promise<void> {
    // unique(user_id): one active role per user — replace any existing.
    this.userRoles = this.userRoles.filter((ur) => ur.user_id !== userId);
    this.userRoles.push({ user_id: userId, role_id: roleId, active: true });
  }
  async superAdminUserCount(): Promise<number> {
    const sa = this.roles.find((r) => r.name === PROTECTED_ROLE);
    if (!sa) return 0;
    return this.userRoles.filter((ur) => ur.role_id === sa.id && ur.active).length;
  }

  async seedClearance(row: ClearanceRow): Promise<void> {
    const dup = this.clearances.some(
      (c) => c.role_id === row.role_id && c.user_id === row.user_id && c.tier === row.tier && c.entity_type_scope === row.entity_type_scope,
    );
    if (!dup) this.clearances.push(row);
  }
  async roleClearances(roleId: string): Promise<ClearanceRow[]> {
    return this.clearances.filter((c) => c.role_id === roleId);
  }

  // ADR-004 atomic guards. The body runs to completion synchronously (NO await between the count-check and
  // the mutation), so two "concurrent" calls under Promise.all serialize — modelling the DB txn's atomicity.
  private wouldOrphanSuperAdmin(userId: string): boolean {
    const sa = this.roles.find((r) => r.name === PROTECTED_ROLE);
    if (!sa) return false;
    const ur = this.userRoles.find((u) => u.user_id === userId && u.active);
    const isSuperAdmin = !!ur && ur.role_id === sa.id;
    if (!isSuperAdmin) return false;
    const activeSuperAdmins = this.userRoles.filter((u) => u.active && u.role_id === sa.id).length;
    return activeSuperAdmins <= 1; // removing/demoting this one would leave zero
  }
  async atomicChangeRole(userId: string, newRoleId: string): Promise<boolean> {
    if (this.wouldOrphanSuperAdmin(userId)) return false;
    this.userRoles = this.userRoles.filter((u) => u.user_id !== userId);
    this.userRoles.push({ user_id: userId, role_id: newRoleId, active: true });
    return true;
  }
  async atomicDeactivate(userId: string): Promise<boolean> {
    if (this.wouldOrphanSuperAdmin(userId)) return false;
    for (const ur of this.userRoles) if (ur.user_id === userId) ur.active = false;
    return true;
  }

  async appendAudit(row: AuditRow): Promise<void> {
    this.auditLog.push(row);
  }
  async audits(): Promise<AuditRow[]> {
    return [...this.auditLog];
  }

  // ── Test-seam helpers (not part of the port; live adapter seeds via migration 0006) ──────────────
  /** Directly seed a role_permissions grant (used by the provisioning seed + tests). */
  _grant(roleId: string, node: string): void {
    if (!this.rolePerms.some((rp) => rp.role_id === roleId && rp.permission_node === node)) {
      this.rolePerms.push({ role_id: roleId, permission_node: node });
    }
  }
  /** Deactivate a user's role assignment (models user_roles.active=false / removal). */
  _deactivateUser(userId: string): void {
    for (const ur of this.userRoles) if (ur.user_id === userId) ur.active = false;
  }
  _addRestricted(g: RestrictedGrantRow): void {
    this.restricted.push(g);
  }
  /** The six seeded roles, if provisioning has run (by name). */
  _roleId(name: Role): string | null {
    return this.roles.find((r) => r.name === name)?.id ?? null;
  }
}

export { ROLES };
