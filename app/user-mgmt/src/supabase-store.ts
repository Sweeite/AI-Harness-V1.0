// ISSUE-021 — the LIVE pg adapter for UserMgmtStore. Runs as the service_role/owner connection (the harness
// path). NOT exercised by the offline suite — its behaviour is proven by the R10 live-adapter smoke
// (results/live-smoke.sql, rolled back). Every method mirrors an InMemoryUserMgmtStore method 1:1.
//
// Authored to schema.md §2 (user_roles / sensitivity_clearances / restricted_grants / access_audit + its
// append-only trigger) + §1 (profiles.active). NO new DDL — the tables land in ISSUE-008/018/019.
//
// The last-Super-Admin guard (FR-1.ROLE.005) is enforced HERE the same way @harness/rbac's adapter does it.
// CONCURRENCY (corrected — the previous note here was wrong and fail-open): the guard's active-SA count is a
// set-based predicate, but it is NOT over the same rows the UPDATE touches — two concurrent txns each
// deactivating/demoting a DIFFERENT Super-Admin row take independent snapshots, both read count=2 under READ
// COMMITTED (Supabase default), both evaluate 2<=1=false, both pass, both commit → 0 Super Admins (write
// skew). There is no row-lock overlap to serialize them. We therefore serialize every SA-guard mutation on a
// single transaction-scoped advisory lock (ADR-004 `pg_advisory_xact_lock`, key SUPER_ADMIN_GUARD_LOCK):
// begin → take the lock → count+mutate → commit. Only one SA-guard mutation runs at a time, so the count each
// one reads reflects the prior one's committed change and ≥1 Super Admin always survives (AC-1.ROLE.005.2).
// @harness/rbac's adapter (ISSUE-018, which HOMES this guard) MUST use this exact lock key so the two packages
// serialize against each other, not just within themselves (see sharedSpecEdits / designForks).

import type { Pool, PoolClient } from 'pg';
import {
  UserMgmtError,
  ERR_NO_SUCH_USER,
  type UserMgmtStore,
  type AuditAppend,
  type AuditRow,
  type ClearanceRow,
  type RestrictedGrantRow,
} from './store.ts';

const SUPER_ADMIN = 'Super Admin';

// Well-known transaction-scoped advisory-lock key for the last-Super-Admin guard (FR-1.ROLE.005). EVERY
// SA-guard mutation — here AND @harness/rbac's atomicDeactivate/atomicChangeRole — MUST take this EXACT key
// under `pg_advisory_xact_lock(hashtext(key))` so demotions/deactivations across BOTH adapters serialize
// GLOBALLY (ADR-004). @harness/rbac is the homed owner (ISSUE-018); this adapter adopts rbac's key verbatim.
// Using a different value (as an earlier draft did with 0x55410005) silently re-opens the cross-package
// write-skew race — the lock only serializes callers that take the SAME key. Locked cross-package const.
const SA_GUARD_KEY = 'rbac:super_admin_guard'; // MUST equal @harness/rbac SA_GUARD_KEY verbatim

export class SupabaseUserMgmtStore implements UserMgmtStore {
  constructor(private readonly pool: Pool) {}

  async userPermissionNodes(userId: string): Promise<Set<string>> {
    // Effective nodes = the grants of the user's ACTIVE role — but only if the profile is active (a deactivated
    // user holds no effective authority, FR-1.USR.002). Mirrors the ISSUE-018 can() resolution surface.
    const { rows } = await this.pool.query<{ permission_node: string }>(
      `select rp.permission_node
         from public.profiles p
         join public.user_roles ur on ur.user_id = p.id and ur.active
         join public.role_permissions rp on rp.role_id = ur.role_id
        where p.id = $1 and p.active`,
      [userId],
    );
    return new Set(rows.map((r) => r.permission_node));
  }

  async appendAudit(rec: AuditAppend): Promise<AuditRow> {
    const { rows } = await this.pool.query<{ id: string; created_at: string }>(
      `insert into public.access_audit
         (audit_type, actor_identity, actor_type, action, target_type, target_entity_id, before_value, after_value, reason, path_context, originating_user_id)
       values ($1, $2, $3::actor_type, $4, $5, $6, $7, $8, $9, $10, $11)
       returning id, created_at`,
      [
        rec.audit_type,
        rec.actor_identity,
        rec.actor_type ?? 'user',
        rec.action,
        rec.target_type,
        rec.target_entity_id,
        rec.before_value === undefined ? null : JSON.stringify(rec.before_value),
        rec.after_value === undefined ? null : JSON.stringify(rec.after_value),
        rec.reason,
        rec.path_context ?? null,
        rec.originating_user_id ?? null,
      ],
    );
    const r = rows[0]!;
    return { ...rec, id: r.id, created_at: r.created_at };
  }

  async listAudits(): Promise<AuditRow[]> {
    const { rows } = await this.pool.query<AuditRow>(
      `select id, audit_type, actor_identity, actor_type, action, target_type, target_entity_id,
              before_value, after_value, reason, path_context, originating_user_id, created_at
         from public.access_audit
        order by created_at`,
    );
    return rows;
  }

  async getUserActive(userId: string): Promise<boolean | null> {
    const { rows } = await this.pool.query<{ active: boolean }>(
      `select active from public.profiles where id = $1`,
      [userId],
    );
    return rows.length === 0 ? null : rows[0]!.active;
  }

  /**
   * Run `body` inside ONE transaction that first takes the shared last-Super-Admin advisory lock, so every
   * SA-guard mutation serializes (closes the READ-COMMITTED write-skew race — see the file header). The lock is
   * transaction-scoped (`pg_advisory_xact_lock`), so it releases automatically on COMMIT/ROLLBACK — a crashed
   * txn cannot leak it. Any error rolls back and re-throws (never a silent partial mutation, #3).
   */
  private async withGuardTxn<T>(body: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [SA_GUARD_KEY]);
      const result = await body(client);
      await client.query('commit');
      return result;
    } catch (err) {
      await client.query('rollback').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async atomicDeactivate(userId: string): Promise<boolean> {
    // Deactivate, but ONLY if this would not drop the last active Super Admin. Serialized on the SA-guard
    // advisory lock (withGuardTxn), so the count subquery reflects any concurrent demotion's committed change.
    return this.withGuardTxn(async (client) => {
      const { rowCount } = await client.query(
        `update public.profiles p
            set active = false
          where p.id = $1
            and p.active
            and not (
              exists (
                select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                 where ur.user_id = p.id and ur.active and r.name = $2
              )
              and (
                select count(*) from public.profiles p2
                  join public.user_roles ur2 on ur2.user_id = p2.id and ur2.active
                  join public.roles r2 on r2.id = ur2.role_id
                 where p2.active and r2.name = $2
              ) <= 1
            )`,
        [userId, SUPER_ADMIN],
      );
      if (rowCount === 0) {
        // Distinguish "no such user / already inactive" from "guard refused" — never a silent false.
        const { rows } = await client.query<{ active: boolean }>(
          `select active from public.profiles where id = $1`,
          [userId],
        );
        if (rows.length === 0) throw new UserMgmtError(ERR_NO_SUCH_USER, `no such user ${userId}`);
        return false; // guard refused (last Super Admin) OR already inactive; the action layer audits the refusal
      }
      return true;
    });
  }

  async atomicChangeRole(userId: string, newRoleId: string): Promise<boolean> {
    // Change the role only if it would not orphan the last Super Admin (moving a sole SA off the SA role).
    // Serialized on the SA-guard advisory lock (withGuardTxn) — see atomicDeactivate.
    return this.withGuardTxn(async (client) => {
      const { rowCount } = await client.query(
        `update public.user_roles ur
            set role_id = $2
          where ur.user_id = $1
            and not (
              exists (
                select 1 from public.roles r where r.id = ur.role_id and r.name = $3
              )
              and $2 <> (select id from public.roles where name = $3)
              and (
                select count(*) from public.user_roles ur2
                  join public.roles r2 on r2.id = ur2.role_id
                  join public.profiles p2 on p2.id = ur2.user_id
                 where ur2.active and p2.active and r2.name = $3
              ) <= 1
            )`,
        [userId, newRoleId, SUPER_ADMIN],
      );
      if (rowCount === 0) {
        const { rows } = await client.query(`select 1 from public.user_roles where user_id = $1`, [userId]);
        if (rows.length === 0) throw new UserMgmtError(ERR_NO_SUCH_USER, `no user_roles row for ${userId}`);
        return false;
      }
      return true;
    });
  }

  async getUserRoleId(userId: string): Promise<string | null> {
    // The user's current ACTIVE role id — read for before/after audit capture (FR-1.AUD.002). null = no role row.
    const { rows } = await this.pool.query<{ role_id: string }>(
      `select role_id from public.user_roles where user_id = $1 and active`,
      [userId],
    );
    return rows.length === 0 ? null : rows[0]!.role_id;
  }

  async reactivateUser(userId: string): Promise<boolean> {
    // Flip active=true ONLY. Deliberately touches NO clearance/grant row (AC-1.USR.002.2).
    const { rowCount } = await this.pool.query(
      `update public.profiles set active = true where id = $1 and not active`,
      [userId],
    );
    if (rowCount === 0) {
      const active = await this.getUserActive(userId);
      if (active === null) throw new UserMgmtError(ERR_NO_SUCH_USER, `no such user ${userId}`);
      return false; // already active — noop
    }
    return true;
  }

  async isOAuthUser(userId: string): Promise<boolean> {
    // OAuth users authenticate via an external IdP (auth.identities.provider <> 'email'); their MFA is at the
    // IdP, so there is no app-layer TOTP factor to reset. A password/TOTP account has the 'email' provider.
    // The exists/not-exists expression ALWAYS yields exactly one row, so a `rows.length === 0` guard would be
    // dead and a nonexistent user would wrongly return is_oauth=false (diverging from the fake, which throws
    // NO_SUCH_USER). Carry an explicit profile-existence flag and fail LOUD when the user is absent (#3 / matches
    // the InMemory contract) rather than silently reporting "not an OAuth user" for someone who doesn't exist.
    const { rows } = await this.pool.query<{ user_exists: boolean; is_oauth: boolean }>(
      `select
         exists (select 1 from public.profiles where id = $1) as user_exists,
         (
           exists (
             select 1 from auth.identities i
              where i.user_id = $1 and i.provider <> 'email'
           )
           and not exists (
             select 1 from auth.identities i2
              where i2.user_id = $1 and i2.provider = 'email'
           )
         ) as is_oauth`,
      [userId],
    );
    if (!rows[0]!.user_exists) throw new UserMgmtError(ERR_NO_SUCH_USER, `no such user ${userId}`);
    return rows[0]!.is_oauth;
  }

  async removeMfaFactors(userId: string): Promise<number> {
    // Remove enrolled TOTP factors so the user must re-enroll before reaching aal2 (FR-1.USR.003). In production
    // this SHOULD go through the Supabase Admin API (auth.admin.mfa.*); the direct delete is the DB-equivalent
    // the live smoke exercises. Fails loud if the profile is absent.
    const active = await this.getUserActive(userId);
    if (active === null) throw new UserMgmtError(ERR_NO_SUCH_USER, `no such user ${userId}`);
    const { rowCount } = await this.pool.query(
      `delete from auth.mfa_factors where user_id = $1 and factor_type = 'totp'`,
      [userId],
    );
    return rowCount ?? 0;
  }

  async insertClearance(row: Omit<ClearanceRow, 'id'>): Promise<ClearanceRow> {
    const { rows } = await this.pool.query<{ id: string }>(
      `insert into public.sensitivity_clearances (user_id, role_id, tier, entity_type_scope, granted_by, granted_at)
       values ($1, $2, $3::clearance_tier, $4, $5, coalesce($6::timestamptz, now()))
       returning id`,
      [row.user_id, row.role_id, row.tier, row.entity_type_scope, row.granted_by ?? null, row.granted_at ?? null],
    );
    return { ...row, id: rows[0]!.id };
  }

  async deleteClearance(clearanceId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `delete from public.sensitivity_clearances where id = $1`,
      [clearanceId],
    );
    return (rowCount ?? 0) > 0;
  }

  async listUserClearances(userId: string): Promise<ClearanceRow[]> {
    const { rows } = await this.pool.query<ClearanceRow>(
      `select id, user_id, role_id, tier, entity_type_scope, granted_by, granted_at::text
         from public.sensitivity_clearances
        where user_id = $1`,
      [userId],
    );
    return rows;
  }

  async insertRestricted(row: Omit<RestrictedGrantRow, 'id'>): Promise<RestrictedGrantRow> {
    const { rows } = await this.pool.query<{ id: string }>(
      `insert into public.restricted_grants (grantee_user_id, granter_user_id, entity_id, entity_type, reason, granted_at, revoked_at)
       values ($1, $2, $3, $4, $5, coalesce($6::timestamptz, now()), $7)
       returning id`,
      [row.grantee_user_id, row.granter_user_id, row.entity_id, row.entity_type, row.reason, row.granted_at, row.revoked_at],
    );
    return { ...row, id: rows[0]!.id };
  }

  async listActiveRestricted(userId: string): Promise<RestrictedGrantRow[]> {
    const { rows } = await this.pool.query<RestrictedGrantRow>(
      `select id, grantee_user_id, granter_user_id, entity_id, entity_type, reason,
              granted_at::text, revoked_at::text, revoked_by
         from public.restricted_grants
        where grantee_user_id = $1 and revoked_at is null`,
      [userId],
    );
    return rows;
  }

  async revokeRestrictedById(grantId: string, revokedBy: string, revokedAt: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `update public.restricted_grants
          set revoked_at = coalesce($3::timestamptz, now()), revoked_by = $2
        where id = $1 and revoked_at is null`,
      [grantId, revokedBy, revokedAt],
    );
    return (rowCount ?? 0) > 0;
  }
}
