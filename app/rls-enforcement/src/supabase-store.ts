// ISSUE-020 — the LIVE pg adapter for RlsEnforcementStore. Runs as the service_role/owner connection (the
// harness path, which bypasses RLS by design — it reads the authz tables directly, not via auth.uid()). NOT
// exercised by the offline suite — its behaviour is proven by the R10 live-adapter smoke (results/
// live-smoke.sql, rolled back). Every method mirrors an InMemoryRlsEnforcementStore method 1:1.
//
//   • loadOriginatingAuthz — reads profiles.active + the user's held clearances (user- OR active-role-scoped,
//     mirroring the user_clearances helper) + active Restricted grants (revoked_at is null, mirroring
//     user_restricted). LIVE read, no snapshot (FR-1.RLS.006). Returns null if the profile row is absent.
//   • appendEventLog / appendAudit — append-only writes to event_log / access_audit (schema.md §8 / §2).

import type { Pool } from "pg";
import {
  type RlsEnforcementStore,
  type OriginatingAuthz,
  type ClearanceHold,
  type RestrictedHold,
  type EventLogAppend,
  type AuditAppend,
} from "./store.ts";

export class SupabaseRlsEnforcementStore implements RlsEnforcementStore {
  constructor(private readonly pool: Pool) {}

  async loadOriginatingAuthz(userId: string): Promise<OriginatingAuthz | null> {
    const prof = await this.pool.query<{ active: boolean }>(
      `select active from public.profiles where id = $1`,
      [userId],
    );
    if (prof.rowCount === 0) return null; // unknown user → fail-closed at the re-check
    const active = prof.rows[0]!.active;

    // Held clearances: user-scoped OR granted to the user's active role (mirrors user_clearances).
    const clr = await this.pool.query<{ tier: ClearanceHold["tier"]; entity_type_scope: string | null }>(
      `select sc.tier, sc.entity_type_scope
         from public.sensitivity_clearances sc
        where sc.user_id = $1
           or sc.role_id in (select ur.role_id from public.user_roles ur where ur.user_id = $1 and ur.active)`,
      [userId],
    );
    const clearances: ClearanceHold[] = clr.rows.map((r) => ({ tier: r.tier, entityTypeScope: r.entity_type_scope }));

    // Active Restricted grants (mirrors user_restricted — revoked_at is null).
    const rst = await this.pool.query<{ entity_id: string | null; entity_type: string | null }>(
      `select rg.entity_id, rg.entity_type
         from public.restricted_grants rg
        where rg.grantee_user_id = $1 and rg.revoked_at is null`,
      [userId],
    );
    const restricted: RestrictedHold[] = rst.rows.map((r) => ({ entityId: r.entity_id, entityType: r.entity_type }));

    return { userId, active, clearances, restricted };
  }

  async appendEventLog(e: EventLogAppend): Promise<void> {
    await this.pool.query(
      `insert into public.event_log (event_type, entity_ids, summary, payload)
       values ($1, $2, $3, $4)`,
      [e.eventType, e.entityIds, e.summary, JSON.stringify(e.payload)],
    );
  }

  async appendAudit(a: AuditAppend): Promise<void> {
    await this.pool.query(
      `insert into public.access_audit (audit_type, actor_identity, actor_type, action, originating_user_id, reason, path_context)
       values ($1, $2, 'system', $3, $4, $5, $6)`,
      [a.auditType, a.actorIdentity, a.action, a.originatingUserId, a.reason, a.pathContext],
    );
  }
}
