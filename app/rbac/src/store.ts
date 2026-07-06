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
/** restricted_grants (schema.md §2). Per-named-individual only (grantee_user_id NOT NULL — no role column,
 *  structurally never a role default, FR-1.RST.001). `reason` mandatory; revoke = soft-delete via revoked_at
 *  (instant, effective next query, FR-1.RST.002). ISSUE-018 read the active rows for can(); ISSUE-019 owns the
 *  grant/revoke flows, so the full audit columns (id/granter/reason/granted_at/revoked_by) are surfaced here. */
export interface RestrictedGrantRow {
  id?: string;
  grantee_user_id: string;
  granter_user_id?: string;
  reason?: string;
  entity_id: string | null;
  entity_type: string | null;
  granted_at?: string;
  revoked_at: string | null; // null = active
  revoked_by?: string | null;
}
/** sensitivity_clearances (schema.md §2). tier ∈ {confidential, personal}; standard is implicit, Restricted
 *  is per-individual via restricted_grants (never a tier here — the enum can't hold it). entity_type_scope
 *  null = Global. ISSUE-018 seeds the per-role DEFAULT rows; ISSUE-019 adds the grant/revoke/review flows +
 *  the entity-scoped narrowing. `id`/`granted_by`/`last_reviewed_at` are present on stored rows (the review
 *  cadence reads last_reviewed_at; a grant/auto-revoke targets a row by id). */
export interface ClearanceRow {
  id?: string;
  role_id: string | null;
  user_id: string | null;
  tier: 'confidential' | 'personal';
  entity_type_scope: string | null; // null = Global
  granted_by?: string | null;
  granted_at?: string;
  last_reviewed_at?: string | null; // null = never reviewed since grant → cadence measured from granted_at
}
export interface AuditRow {
  audit_type: string;
  actor_identity: string;
  actor_type?: 'user' | 'agent' | 'system'; // schema.md §Types actor_type enum; the scheduler audits as 'system'
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

  // ── Clearance grant/revoke/review (ISSUE-019). ────────────────────────────────────────────────────
  // A clearance has NO revoked_at column (schema.md §2) — revoke is a hard delete of the row. The review
  // cadence reads last_reviewed_at (null ⇒ measure from granted_at) and either touches it (confirm) or
  // deletes the row (fail-closed auto-revoke). listClearances returns every stored row (seed + granted).
  insertClearance(row: ClearanceRow): Promise<ClearanceRow>; // returns the row incl. its assigned id
  deleteClearance(id: string): Promise<boolean>; // true ⇒ a row was removed (revoke / auto-revoke)
  touchClearanceReview(id: string, reviewedAt: string): Promise<boolean>; // set last_reviewed_at (confirm)
  listClearances(): Promise<ClearanceRow[]>;

  // ── Restricted grant/revoke (ISSUE-019). ──────────────────────────────────────────────────────────
  insertRestricted(row: RestrictedGrantRow): Promise<RestrictedGrantRow>; // returns the row incl. its id
  revokeRestrictedById(id: string, revokedBy: string, revokedAt: string): Promise<boolean>; // instant soft-delete
  listRestricted(): Promise<RestrictedGrantRow[]>;

  // Audit sink (append-only).
  appendAudit(row: AuditRow): Promise<void>;
  audits(): Promise<AuditRow[]>;
}

let __id = 0;
const nextId = () => `id-${++__id}`;

/** Fallback provisioning timestamp for a seeded clearance whose granted_at the caller didn't supply. Deliberately
 *  old ("unknown-age seed is stale") so an un-timestamped seed fails TOWARD review, never toward silent staleness
 *  (#3). The seed path (seedDefaultClearances) passes the real provisioning time; the live DDL uses now(). */
export const SEED_PROVISION_TS = '2000-01-01T00:00:00.000Z';

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
    // Mirror the DDL defaults the live INSERT relies on (schema.md §2): id gen_random_uuid, granted_at now().
    // A seed row WITHOUT these masked the review-cadence sweep (undefined id, no age) — a fake-vs-schema drift.
    if (!dup) {
      this.clearances.push({
        id: row.id ?? nextId(),
        role_id: row.role_id,
        user_id: row.user_id,
        tier: row.tier,
        entity_type_scope: row.entity_type_scope,
        granted_by: row.granted_by ?? null,
        granted_at: row.granted_at ?? SEED_PROVISION_TS,
        last_reviewed_at: row.last_reviewed_at ?? null,
      });
    }
  }
  async roleClearances(roleId: string): Promise<ClearanceRow[]> {
    return this.clearances.filter((c) => c.role_id === roleId).map((c) => ({ ...c }));
  }

  async insertClearance(row: ClearanceRow): Promise<ClearanceRow> {
    const stored: ClearanceRow = {
      id: row.id ?? nextId(),
      role_id: row.role_id,
      user_id: row.user_id,
      tier: row.tier,
      entity_type_scope: row.entity_type_scope,
      granted_by: row.granted_by ?? null,
      granted_at: row.granted_at ?? '1970-01-01T00:00:00.000Z',
      last_reviewed_at: row.last_reviewed_at ?? null,
    };
    this.clearances.push(stored);
    return { ...stored };
  }
  async deleteClearance(id: string): Promise<boolean> {
    const before = this.clearances.length;
    this.clearances = this.clearances.filter((c) => c.id !== id);
    return this.clearances.length < before;
  }
  async touchClearanceReview(id: string, reviewedAt: string): Promise<boolean> {
    const row = this.clearances.find((c) => c.id === id);
    if (!row) return false;
    row.last_reviewed_at = reviewedAt;
    return true;
  }
  async listClearances(): Promise<ClearanceRow[]> {
    return this.clearances.map((c) => ({ ...c }));
  }

  async insertRestricted(row: RestrictedGrantRow): Promise<RestrictedGrantRow> {
    const stored: RestrictedGrantRow = {
      id: row.id ?? nextId(),
      grantee_user_id: row.grantee_user_id,
      granter_user_id: row.granter_user_id,
      reason: row.reason,
      entity_id: row.entity_id,
      entity_type: row.entity_type,
      granted_at: row.granted_at ?? '1970-01-01T00:00:00.000Z',
      revoked_at: row.revoked_at,
      revoked_by: row.revoked_by ?? null,
    };
    this.restricted.push(stored);
    return { ...stored };
  }
  async revokeRestrictedById(id: string, revokedBy: string, revokedAt: string): Promise<boolean> {
    const row = this.restricted.find((g) => g.id === id && g.revoked_at === null);
    if (!row) return false; // absent or already revoked — idempotent, never a silent double-revoke
    row.revoked_at = revokedAt;
    row.revoked_by = revokedBy;
    return true;
  }
  async listRestricted(): Promise<RestrictedGrantRow[]> {
    return this.restricted.map((g) => ({ ...g }));
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
