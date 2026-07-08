// ISSUE-078 — the LIVE pg adapter for OpsDashboardStore. Runs on the service_role/owner connection (the audit
// sink writer is service_role, RLS-exempt by design — schema.md §Immutability). NOT exercised by the offline
// suite; its behaviour is proven by the R10 live-adapter smoke (results/live-smoke.sql, rolled back). The one
// method mirrors InMemoryOpsDashboardStore 1:1 and applies the SAME validateAccessAudit gate before the INSERT
// (a Restricted-touching export with no reason is refused BEFORE hitting the DB — #2/#3).
//
// access_audit is append-only (a BEFORE UPDATE OR DELETE trigger rejects mutation) — this adapter only INSERTs.

import type { Pool } from "pg";
import { type OpsDashboardStore, type AccessAuditAppend, validateAccessAudit } from "./store.ts";

export class SupabaseOpsDashboardStore implements OpsDashboardStore {
  constructor(private readonly pool: Pool) {}

  async appendAccessAudit(a: AccessAuditAppend): Promise<void> {
    validateAccessAudit(a); // fail-loud, pre-DB — identical to the fake's guard
    await this.pool.query(
      `insert into public.access_audit
         (audit_type, actor_identity, actor_type, action, target_entity_id, target_type, reason, path_context)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        a.auditType,
        a.actorIdentity,
        a.actorType,
        a.action,
        a.targetEntityId ?? null,
        a.targetType ?? null,
        a.reason ?? null,
        a.pathContext ?? null,
      ],
    );
  }
}
