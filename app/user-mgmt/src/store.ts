// ISSUE-021 — the UserMgmtStore PORT + the in-memory reference fake.
//
// This slice owns the post-invite AUTHORIZATION lifecycle (USR) and the access/RBAC-mutation AUDIT spine
// (AUD), on top of the tables ISSUE-008/018/019 already landed (schema.md §2 — user_roles, profiles.active,
// sensitivity_clearances, restricted_grants, access_audit + its append-only trigger). It authors NO new DDL.
//
// The load-bearing invariants this port encodes:
//   • appendAudit is the SINGLE write path into access_audit — every USR mutation and every Personal/Restricted
//     access routes through it, so no action can ship un-audited (#3). access_audit is APPEND-ONLY: the port
//     exposes appendAudit + read helpers ONLY — there is deliberately no update/delete of an audit row (the DB
//     trigger enforces this at the table for real; the R10 live smoke proves it — results/live-smoke.sql).
//   • the last-Super-Admin guard (FR-1.ROLE.005) is HOMED in ISSUE-018 (@harness/rbac); this slice INVOKES it
//     through the atomic store methods (atomicDeactivate / atomicChangeRole) — they re-count active Super Admins
//     in the SAME critical section as the mutation, so two concurrent demotions can never orphan the last one
//     (ADR-004). Return false ⇒ the change would drop the last Super Admin and was refused.
//   • reactivation re-reads live grants and NEVER auto-restores above-Standard clearances / Restricted grants
//     (AC-1.USR.002.2, #2) — reactivateUser only flips profiles.active; it touches no clearance/grant row.
//   • the service_role/agent path has no RLS/DB backstop (ADR-004), so agent-path Personal/Restricted access
//     is audited via harness discipline (AF-081) — recordSensitiveAccess is the single choke point that makes
//     an un-audited sensitive access structurally impossible for both paths.

// ── enums mirrored from the live schema (schema.md §Types; index.ts `check` guards these against 0001) ──
export const ACTOR_TYPES = ['user', 'agent', 'system'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

/** The four sensitivity tiers (schema.md §Types sensitivity_tier). Standard is auto-injectable and needs no
 *  access audit; Personal + Restricted require an audit on EVERY read/write/injection (FR-1.AUD.001). */
export const SENSITIVITY_TIERS = ['standard', 'confidential', 'personal', 'restricted'] as const;
export type SensitivityTier = (typeof SENSITIVITY_TIERS)[number];

/** Which tiers demand an access-audit record on every access (FR-1.AUD.001 — Personal + Restricted). */
export function isSensitiveTier(tier: SensitivityTier): boolean {
  return tier === 'personal' || tier === 'restricted';
}

// ── PERM nodes this slice gates on (catalogued in ISSUE-018 PERMISSION_NODES.md; consumed, not minted) ──
export const NODE_ASSIGN_ROLE = 'PERM-user.assign_role';
export const NODE_DEACTIVATE = 'PERM-user.deactivate';
export const NODE_RESET_2FA = 'PERM-user.reset_2fa';
export const NODE_VIEW_ACTIVITY = 'PERM-user.view_activity';
export const NODE_GRANT_CLEARANCE = 'PERM-user.grant_clearance';

// ── error type (carries a machine reason so callers surface, never swallow — #3) ──────────────────────
export class UserMgmtError extends Error {
  constructor(
    public readonly reason: string,
    message: string,
  ) {
    super(message);
    this.name = 'UserMgmtError';
  }
}
export const ERR_DENIED = 'denied';
export const ERR_LAST_SUPER_ADMIN = 'last_super_admin';
export const ERR_REASON_REQUIRED = 'reason_required';
export const ERR_BAD_TIER = 'bad_tier';
export const ERR_RESTRICTED_ROUTE = 'restricted_route';
export const ERR_NO_SUCH_USER = 'no_such_user';
export const ERR_AUDIT_CONTRACT = 'audit_contract'; // AF-081: a sensitive access with an incomplete audit context

// ── rows (subset of schema.md §2 columns this slice reads/writes) ─────────────────────────────────────
export interface ClearanceRow {
  id: string;
  user_id: string | null;
  role_id: string | null;
  tier: 'confidential' | 'personal';
  entity_type_scope: string | null;
  granted_by?: string | null;
  granted_at?: string;
}

export interface RestrictedGrantRow {
  id: string;
  grantee_user_id: string;
  granter_user_id: string;
  entity_id: string | null;
  entity_type: string | null;
  reason: string;
  granted_at: string;
  revoked_at: string | null;
  revoked_by?: string | null;
}

/** An append to access_audit (schema.md §2). actor_type defaults to 'user'; the agent path sets 'agent' and the
 *  scheduler sets 'system' — hardcoding 'user' would falsely attribute an action in the immutable trail (#3). */
export interface AuditAppend {
  audit_type: string; // 'rbac' (mutation) | 'access' (a Personal/Restricted read/write/injection)
  actor_identity: string;
  actor_type?: ActorType;
  action: string;
  target_type: string | null;
  target_entity_id: string | null;
  before_value?: unknown;
  after_value?: unknown;
  reason: string | null;
  path_context?: string | null;
  originating_user_id?: string | null; // REQUIRED on the service_role/agent path (FR-1.RLS.007 / AF-081)
}

/** A materialised access_audit row (the read shape for the activity view + tests). */
export interface AuditRow extends AuditAppend {
  id: string;
  created_at: string;
}

/** Outcome of a 2FA reset (FR-1.USR.003). oauth=true ⇒ explicit no-op (factor is at the IdP), never a false ok. */
export interface Reset2faResult {
  oauth: boolean;
  factorsRemoved: number;
}

// ── the port ──────────────────────────────────────────────────────────────────────────────────────────
export interface UserMgmtStore {
  // authorization (the PERM gate seam — reads the same role_permissions the ISSUE-018 can() gate reads)
  userPermissionNodes(userId: string): Promise<Set<string>>;

  // the AUD spine — the ONLY write into access_audit (append-only; no update/delete by design)
  appendAudit(rec: AuditAppend): Promise<AuditRow>;
  listAudits(): Promise<AuditRow[]>;

  // user lifecycle (profiles.active + user_roles)
  getUserActive(userId: string): Promise<boolean | null>; // null = no such profile
  /** The user's current active role id — read for before/after audit capture (FR-1.AUD.002). null = no role. */
  getUserRoleId(userId: string): Promise<string | null>;
  /** Atomic; false ⇒ would orphan the last Super Admin (ISSUE-018 guard, FR-1.ROLE.005). */
  atomicDeactivate(userId: string): Promise<boolean>;
  /** Atomic; false ⇒ would orphan the last Super Admin. */
  atomicChangeRole(userId: string, roleId: string): Promise<boolean>;
  /** Reactivate ONLY (flip profiles.active=true). Touches NO clearance/grant row (AC-1.USR.002.2). */
  reactivateUser(userId: string): Promise<boolean>;

  // 2FA (Supabase auth.mfa_factors, admin API)
  isOAuthUser(userId: string): Promise<boolean>;
  removeMfaFactors(userId: string): Promise<number>; // count of TOTP factors removed

  // clearances (sensitivity_clearances)
  insertClearance(row: Omit<ClearanceRow, 'id'>): Promise<ClearanceRow>;
  deleteClearance(clearanceId: string): Promise<boolean>;
  listUserClearances(userId: string): Promise<ClearanceRow[]>;

  // Restricted grants (restricted_grants)
  insertRestricted(row: Omit<RestrictedGrantRow, 'id'>): Promise<RestrictedGrantRow>;
  listActiveRestricted(userId: string): Promise<RestrictedGrantRow[]>; // revoked_at is null
  /** Soft-revoke one active grant (set revoked_at). false ⇒ absent or already revoked. */
  revokeRestrictedById(grantId: string, revokedBy: string, revokedAt: string): Promise<boolean>;
}

// ── in-memory reference fake — the semantics the live adapter must match 1:1 (proven by the R10 smoke) ──
interface FakeProfile {
  active: boolean;
  roleId: string | null;
  isSuperAdmin: boolean;
  oauth: boolean;
  nodes: Set<string>;
  mfaFactors: number;
}

export class InMemoryUserMgmtStore implements UserMgmtStore {
  private profiles = new Map<string, FakeProfile>();
  private clearances: ClearanceRow[] = [];
  private restricted: RestrictedGrantRow[] = [];
  // access_audit is APPEND-ONLY: this array is written only by appendAudit; there is no mutate/delete method,
  // mirroring the DB trigger. Reading is fine (the activity view + tests).
  private readonly audit: AuditRow[] = [];
  private seq = 0;

  private id(prefix: string): string {
    return `${prefix}-${++this.seq}`;
  }

  /** Test/seed helper — register (or overwrite) a user. */
  setUser(
    userId: string,
    opts: {
      active?: boolean;
      roleId?: string | null;
      isSuperAdmin?: boolean;
      oauth?: boolean;
      nodes?: string[];
      mfaFactors?: number;
    } = {},
  ): void {
    this.profiles.set(userId, {
      active: opts.active ?? true,
      roleId: opts.roleId ?? null,
      isSuperAdmin: opts.isSuperAdmin ?? false,
      oauth: opts.oauth ?? true,
      nodes: new Set(opts.nodes ?? []),
      mfaFactors: opts.mfaFactors ?? 0,
    });
  }

  private countActiveSuperAdmins(): number {
    let n = 0;
    for (const p of this.profiles.values()) if (p.active && p.isSuperAdmin) n++;
    return n;
  }

  async userPermissionNodes(userId: string): Promise<Set<string>> {
    const p = this.profiles.get(userId);
    // Deactivated users hold no effective nodes (their access is revoked, FR-1.USR.002) — fail-closed.
    if (!p || !p.active) return new Set();
    return new Set(p.nodes);
  }

  async appendAudit(rec: AuditAppend): Promise<AuditRow> {
    const row: AuditRow = { ...rec, id: this.id('aud'), created_at: new Date(this.seq).toISOString() };
    this.audit.push(row);
    return row;
  }

  async listAudits(): Promise<AuditRow[]> {
    return this.audit.map((a) => ({ ...a }));
  }

  async getUserActive(userId: string): Promise<boolean | null> {
    const p = this.profiles.get(userId);
    return p ? p.active : null;
  }

  async getUserRoleId(userId: string): Promise<string | null> {
    const p = this.profiles.get(userId);
    return p ? p.roleId : null;
  }

  async atomicDeactivate(userId: string): Promise<boolean> {
    const p = this.profiles.get(userId);
    if (!p) throw new UserMgmtError(ERR_NO_SUCH_USER, `no such user ${userId}`);
    // last-Super-Admin guard (ISSUE-018 FR-1.ROLE.005), re-counted in the same critical section.
    if (p.isSuperAdmin && p.active && this.countActiveSuperAdmins() <= 1) return false;
    p.active = false;
    return true;
  }

  async atomicChangeRole(userId: string, roleId: string): Promise<boolean> {
    const p = this.profiles.get(userId);
    if (!p) throw new UserMgmtError(ERR_NO_SUCH_USER, `no such user ${userId}`);
    // Demoting the last Super Admin off the SA role is refused.
    const losingSa = p.isSuperAdmin && roleId !== 'role-super-admin';
    if (losingSa && this.countActiveSuperAdmins() <= 1) return false;
    p.roleId = roleId;
    p.isSuperAdmin = roleId === 'role-super-admin';
    return true;
  }

  async reactivateUser(userId: string): Promise<boolean> {
    const p = this.profiles.get(userId);
    if (!p) throw new UserMgmtError(ERR_NO_SUCH_USER, `no such user ${userId}`);
    if (p.active) return false; // already active — noop (surfaced by the action, never silent)
    p.active = true;
    // Deliberately touches NO clearance/grant row (AC-1.USR.002.2).
    return true;
  }

  async isOAuthUser(userId: string): Promise<boolean> {
    const p = this.profiles.get(userId);
    if (!p) throw new UserMgmtError(ERR_NO_SUCH_USER, `no such user ${userId}`);
    return p.oauth;
  }

  async removeMfaFactors(userId: string): Promise<number> {
    const p = this.profiles.get(userId);
    if (!p) throw new UserMgmtError(ERR_NO_SUCH_USER, `no such user ${userId}`);
    const removed = p.mfaFactors;
    p.mfaFactors = 0;
    return removed;
  }

  async insertClearance(row: Omit<ClearanceRow, 'id'>): Promise<ClearanceRow> {
    const full: ClearanceRow = { ...row, id: this.id('clr') };
    this.clearances.push(full);
    return { ...full };
  }

  async deleteClearance(clearanceId: string): Promise<boolean> {
    const before = this.clearances.length;
    this.clearances = this.clearances.filter((c) => c.id !== clearanceId);
    return this.clearances.length < before;
  }

  async listUserClearances(userId: string): Promise<ClearanceRow[]> {
    return this.clearances.filter((c) => c.user_id === userId).map((c) => ({ ...c }));
  }

  async insertRestricted(row: Omit<RestrictedGrantRow, 'id'>): Promise<RestrictedGrantRow> {
    const full: RestrictedGrantRow = { ...row, id: this.id('rst') };
    this.restricted.push(full);
    return { ...full };
  }

  async listActiveRestricted(userId: string): Promise<RestrictedGrantRow[]> {
    return this.restricted
      .filter((r) => r.grantee_user_id === userId && r.revoked_at === null)
      .map((r) => ({ ...r }));
  }

  async revokeRestrictedById(grantId: string, revokedBy: string, revokedAt: string): Promise<boolean> {
    const g = this.restricted.find((r) => r.id === grantId && r.revoked_at === null);
    if (!g) return false;
    g.revoked_at = revokedAt;
    g.revoked_by = revokedBy;
    return true;
  }
}
