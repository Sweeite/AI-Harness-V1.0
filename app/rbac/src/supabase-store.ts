// ISSUE-018 — the LIVE pg adapter for the RbacStore port. Authored to the schema.md §2 DDL; it is the
// reference model (InMemoryRbacStore) realised against the real silo. NOT exercised by the offline suite —
// its behaviour is proven by the ISSUE-018 live capstone (seed applied, can() reads through the ISSUE-009
// helpers, the atomic guards proven under real concurrency). Every method mirrors an InMemory method 1:1.
//
// AF-080 non-drift: userRoleId + roleNodes read user_roles ⋈ role_permissions — the SAME tables the 0002
// user_perms(uid) SECURITY-DEFINER helper reads — so the harness gate and the RLS backstop cannot diverge.
//
// FR-1.ROLE.005 atomicity: atomicChangeRole / atomicDeactivate are single conditional UPDATEs whose WHERE
// clause re-counts active Super Admins in the same statement (ADR-004) — two concurrent callers serialize
// at the row lock, so at most one can drop the count and it can never reach zero.

import type { Pool, PoolClient } from 'pg';
import {
  type RbacStore,
  type RoleRow,
  type RolePermissionRow,
  type UserRoleRow,
  type RestrictedGrantRow,
  type ClearanceRow,
  type AuditRow,
} from './store.ts';

const SUPER_ADMIN = 'Super Admin';
// One coarse advisory-lock key serializing every mutation that can change the active-Super-Admin count
// (ADR-004 §2 — the transaction-scoped advisory lock is the correctness boundary, not the row lock). These
// mutations are rare, so a single global key is the right granularity (no per-entity fan-out here).
const SA_GUARD_KEY = 'rbac:super_admin_guard';

export class SupabaseRbacStore implements RbacStore {
  constructor(private pool: Pool) {}

  async userRoleId(userId: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ role_id: string }>(
      `select role_id from user_roles where user_id = $1 and active limit 1`,
      [userId],
    );
    return rows[0]?.role_id ?? null;
  }

  async roleNodes(roleId: string): Promise<Set<string>> {
    const { rows } = await this.pool.query<{ permission_node: string }>(
      `select permission_node from role_permissions where role_id = $1`,
      [roleId],
    );
    return new Set(rows.map((r) => r.permission_node));
  }

  async activeRestricted(userId: string): Promise<RestrictedGrantRow[]> {
    const { rows } = await this.pool.query<RestrictedGrantRow>(
      `select grantee_user_id, entity_id, entity_type, revoked_at
         from restricted_grants where grantee_user_id = $1 and revoked_at is null`,
      [userId],
    );
    return rows;
  }

  async listRoles(): Promise<RoleRow[]> {
    const { rows } = await this.pool.query<RoleRow>(`select id, name, is_default, is_protected from roles`);
    return rows;
  }
  async getRole(roleId: string): Promise<RoleRow | null> {
    const { rows } = await this.pool.query<RoleRow>(`select id, name, is_default, is_protected from roles where id = $1`, [roleId]);
    return rows[0] ?? null;
  }
  async getRoleByName(name: string): Promise<RoleRow | null> {
    const { rows } = await this.pool.query<RoleRow>(`select id, name, is_default, is_protected from roles where name = $1`, [name]);
    return rows[0] ?? null;
  }
  async createRole(name: string, isDefault: boolean, isProtected: boolean): Promise<RoleRow> {
    const { rows } = await this.pool.query<RoleRow>(
      `insert into roles (name, is_default, is_protected) values ($1, $2, $3)
         returning id, name, is_default, is_protected`,
      [name, isDefault, isProtected],
    );
    return rows[0]!;
  }
  async deleteRoleRow(roleId: string): Promise<void> {
    await this.pool.query(`delete from roles where id = $1`, [roleId]); // role_permissions cascade on FK
  }
  async setNode(roleId: string, node: string, granted: boolean): Promise<void> {
    if (granted) {
      await this.pool.query(
        `insert into role_permissions (role_id, permission_node) values ($1, $2)
           on conflict (role_id, permission_node) do nothing`,
        [roleId, node],
      );
    } else {
      await this.pool.query(`delete from role_permissions where role_id = $1 and permission_node = $2`, [roleId, node]);
    }
  }
  async usersInRole(roleId: string): Promise<number> {
    const { rows } = await this.pool.query<{ n: string }>(`select count(*)::int as n from user_roles where role_id = $1 and active`, [roleId]);
    return Number(rows[0]?.n ?? 0);
  }

  async assignRole(userId: string, roleId: string): Promise<void> {
    await this.pool.query(
      `insert into user_roles (user_id, role_id, active) values ($1, $2, true)
         on conflict (user_id) do update set role_id = excluded.role_id, active = true`,
      [userId, roleId],
    );
  }
  async superAdminUserCount(): Promise<number> {
    const { rows } = await this.pool.query<{ n: string }>(
      `select count(*)::int as n from user_roles ur join roles r on ur.role_id = r.id
         where r.name = $1 and ur.active`,
      [SUPER_ADMIN],
    );
    return Number(rows[0]?.n ?? 0);
  }

  // ADR-004 atomic guard. The conditional UPDATE's count sub-select alone is NOT sufficient under READ
  // COMMITTED: two concurrent demotions of the last two *distinct* Super-Admin rows update different rows
  // (no mutual row-lock) and each count sub-select reads the pre-change snapshot → both could pass → zero
  // Super Admins (write-skew). So we serialize every count-affecting mutation behind ONE transaction-scoped
  // advisory lock (ADR-004 §2): the second caller blocks until the first commits, then its count sub-select
  // sees the committed decrement and the guard refuses it. The lock is held only for the cheap UPDATE.
  private async withGuardLock<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('begin');
      await c.query('select pg_advisory_xact_lock(hashtext($1))', [SA_GUARD_KEY]);
      const result = await fn(c);
      await c.query('commit');
      return result;
    } catch (e) {
      await c.query('rollback').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }
  async atomicChangeRole(userId: string, newRoleId: string): Promise<boolean> {
    return this.withGuardLock(async (c) => {
      const { rowCount } = await c.query(
        `update user_roles set role_id = $2
           where user_id = $1 and active
             and not (
               role_id = (select id from roles where name = $3)
               and (select count(*) from user_roles ur join roles r on ur.role_id = r.id
                      where r.name = $3 and ur.active) <= 1
             )`,
        [userId, newRoleId, SUPER_ADMIN],
      );
      return (rowCount ?? 0) > 0;
    });
  }
  async atomicDeactivate(userId: string): Promise<boolean> {
    return this.withGuardLock(async (c) => {
      const { rowCount } = await c.query(
        `update user_roles set active = false
           where user_id = $1 and active
             and not (
               role_id = (select id from roles where name = $2)
               and (select count(*) from user_roles ur join roles r on ur.role_id = r.id
                      where r.name = $2 and ur.active) <= 1
             )`,
        [userId, SUPER_ADMIN],
      );
      return (rowCount ?? 0) > 0;
    });
  }

  // Raw-table readers (used by the independent AF-080 differential reader; mirror what user_perms(uid) joins).
  async rawUserRoles(): Promise<UserRoleRow[]> {
    const { rows } = await this.pool.query<UserRoleRow>(`select user_id, role_id, active from user_roles`);
    return rows;
  }
  async rawRolePermissions(): Promise<RolePermissionRow[]> {
    const { rows } = await this.pool.query<RolePermissionRow>(`select role_id, permission_node from role_permissions`);
    return rows;
  }

  async seedClearance(row: ClearanceRow): Promise<void> {
    await this.pool.query(
      `insert into sensitivity_clearances (role_id, user_id, tier, entity_type_scope, granted_at)
         values ($1, $2, $3::clearance_tier, $4, coalesce($5, now()))`,
      [row.role_id, row.user_id, row.tier, row.entity_type_scope, row.granted_at ?? null],
    );
  }
  async roleClearances(roleId: string): Promise<ClearanceRow[]> {
    const { rows } = await this.pool.query<ClearanceRow>(
      `select id, role_id, user_id, tier, entity_type_scope, granted_by, granted_at, last_reviewed_at
         from sensitivity_clearances where role_id = $1`,
      [roleId],
    );
    return rows;
  }

  // ── Clearance grant/revoke/review (ISSUE-019). Revoke = hard DELETE (no revoked_at column, schema.md §2). ─
  async insertClearance(row: ClearanceRow): Promise<ClearanceRow> {
    const { rows } = await this.pool.query<ClearanceRow>(
      `insert into sensitivity_clearances (role_id, user_id, tier, entity_type_scope, granted_by, last_reviewed_at, granted_at)
         values ($1, $2, $3::clearance_tier, $4, $5, $6, coalesce($7, now()))
         returning id, role_id, user_id, tier, entity_type_scope, granted_by, granted_at, last_reviewed_at`,
      [row.role_id, row.user_id, row.tier, row.entity_type_scope, row.granted_by ?? null, row.last_reviewed_at ?? null, row.granted_at ?? null],
    );
    return rows[0]!;
  }
  async deleteClearance(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(`delete from sensitivity_clearances where id = $1`, [id]);
    return (rowCount ?? 0) > 0;
  }
  async touchClearanceReview(id: string, reviewedAt: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(`update sensitivity_clearances set last_reviewed_at = $2 where id = $1`, [id, reviewedAt]);
    return (rowCount ?? 0) > 0;
  }
  async listClearances(): Promise<ClearanceRow[]> {
    const { rows } = await this.pool.query<ClearanceRow>(
      `select id, role_id, user_id, tier, entity_type_scope, granted_by, granted_at, last_reviewed_at from sensitivity_clearances`,
    );
    return rows;
  }

  // ── Restricted grant/revoke (ISSUE-019). Revoke = instant soft-delete via revoked_at. ─────────────────
  async insertRestricted(row: RestrictedGrantRow): Promise<RestrictedGrantRow> {
    const { rows } = await this.pool.query<RestrictedGrantRow>(
      `insert into restricted_grants (grantee_user_id, granter_user_id, entity_id, entity_type, reason)
         values ($1, $2, $3, $4, $5)
         returning id, grantee_user_id, granter_user_id, entity_id, entity_type, reason, granted_at, revoked_at, revoked_by`,
      [row.grantee_user_id, row.granter_user_id ?? null, row.entity_id, row.entity_type, row.reason ?? null],
    );
    return rows[0]!;
  }
  async revokeRestrictedById(id: string, revokedBy: string, revokedAt: string): Promise<boolean> {
    // Only revoke an active grant — a second revoke is a no-op, never a silent double-write.
    const { rowCount } = await this.pool.query(
      `update restricted_grants set revoked_at = $2, revoked_by = $3 where id = $1 and revoked_at is null`,
      [id, revokedAt, revokedBy],
    );
    return (rowCount ?? 0) > 0;
  }
  async listRestricted(): Promise<RestrictedGrantRow[]> {
    const { rows } = await this.pool.query<RestrictedGrantRow>(
      `select id, grantee_user_id, granter_user_id, entity_id, entity_type, reason, granted_at, revoked_at, revoked_by from restricted_grants`,
    );
    return rows;
  }

  async appendAudit(row: AuditRow): Promise<void> {
    // actor_type is parameterized (default 'user'): the review scheduler writes 'system' — hardcoding 'user'
    // would falsely attribute an auto-revoke to a person in the immutable trail (#3).
    await this.pool.query(
      `insert into access_audit (audit_type, actor_identity, actor_type, action, target_type, target_entity_id, reason)
         values ($1, $2, $3::actor_type, $4, $5, $6, $7)`,
      [row.audit_type, row.actor_identity, row.actor_type ?? 'user', row.action, row.target_type, row.target_entity_id, row.reason],
    );
  }
  async audits(): Promise<AuditRow[]> {
    const { rows } = await this.pool.query<AuditRow>(
      `select audit_type, actor_identity, action, target_type, target_entity_id, reason from access_audit where audit_type = 'rbac'`,
    );
    return rows;
  }
}
