// ISSUE-020 — the RlsEnforcementStore PORT + the in-memory reference fake.
//
// The harness/service_role path bypasses RLS (ADR-006 part 6), so the two enforcement rules here read the
// live authorization state THEMSELVES (not via auth.uid()) and write the loud signals the invariants demand:
//   • loadOriginatingAuthz — the originating user's CURRENT active-status + held clearances + active
//     Restricted grants, read live (no snapshot — FR-1.RLS.006). Returns null for an unknown user, which the
//     re-check treats as fail-closed = deactivated (#2: absence of proof of authorization is denial).
//   • appendEventLog — the append-only observability sink (schema.md §8) the mid-task stop
//     (authz_revoked_midtask) and the divergence signal (rls_harness_divergence) write to (OD-170 enum).
//   • appendAudit — the access_audit append the mid-task stop records (originating_user_id attribution).
//
// Both event_type values already ship in the 0001 baseline enum (OD-170) — the constants below are the
// single source of truth the fake, the live adapter, and index.ts's non-drift check all reference.

export const EVT_AUTHZ_REVOKED_MIDTASK = "authz_revoked_midtask";
export const EVT_RLS_HARNESS_DIVERGENCE = "rls_harness_divergence";

export const CLEARANCE_TIERS = ["confidential", "personal"] as const;
export type ClearanceTier = (typeof CLEARANCE_TIERS)[number];

/** A sensitivity clearance the user holds (or a task relies on). entityTypeScope null = Global (FR-1.CLR.004). */
export interface ClearanceHold {
  tier: ClearanceTier;
  entityTypeScope: string | null;
}

/** A Restricted per-individual grant. entityId/entityType null = wider scope (OD-027). */
export interface RestrictedHold {
  entityId: string | null;
  entityType: string | null;
}

/** The originating user's live authorization state, read at a boundary. */
export interface OriginatingAuthz {
  userId: string;
  active: boolean; // profiles.active — FR-1.USR.002 deactivation ≠ delete
  clearances: ClearanceHold[]; // user- + active-role-scoped (mirrors user_clearances)
  restricted: RestrictedHold[]; // restricted_grants where revoked_at is null (mirrors user_restricted)
}

export interface EventLogAppend {
  eventType: string;
  entityIds: string[];
  summary: string;
  payload: Record<string, unknown>;
}

export interface AuditAppend {
  auditType: string;
  actorIdentity: string; // the service_role task identity
  action: string;
  originatingUserId: string;
  reason: string;
  pathContext: string | null;
}

export interface RlsEnforcementStore {
  /** Live read; null = unknown user (fail-closed → treated as deactivated by the re-check). */
  loadOriginatingAuthz(userId: string): Promise<OriginatingAuthz | null>;
  appendEventLog(e: EventLogAppend): Promise<void>;
  appendAudit(a: AuditAppend): Promise<void>;
}

// ── In-memory reference fake — the semantics the live adapter must match 1:1 (proven by the R10 smoke) ──
export class InMemoryRlsEnforcementStore implements RlsEnforcementStore {
  private users = new Map<string, OriginatingAuthz>();
  readonly events: EventLogAppend[] = [];
  readonly audits: AuditAppend[] = [];

  /** Test/seed helper — register (or overwrite) a user's live authorization state. */
  setUser(a: OriginatingAuthz): void {
    this.users.set(a.userId, { ...a, clearances: [...a.clearances], restricted: [...a.restricted] });
  }

  async loadOriginatingAuthz(userId: string): Promise<OriginatingAuthz | null> {
    const a = this.users.get(userId);
    return a ? { ...a, clearances: [...a.clearances], restricted: [...a.restricted] } : null;
  }

  async appendEventLog(e: EventLogAppend): Promise<void> {
    this.events.push(e);
  }

  async appendAudit(a: AuditAppend): Promise<void> {
    this.audits.push(a);
  }
}
