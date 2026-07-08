// ISSUE-078 — the OpsDashboardStore PORT + in-memory reference fake. These surfaces are almost entirely
// read-to-render, but they own ONE genuine side effect: every export and every view of a Personal/Restricted-
// touching log row is itself an audited access (FR-1.AUD.001/002 — surface-05 DATA lists `access_audit`; the
// nav table: "Any panel: Export → a download (compliance-gated) — audited in access_audit"). If that audit
// write were skipped or swallowed, a sensitive export would leave no trace — a #3 (silent) + #2 hole. So the
// audit append is a first-class, fail-loud port method with a live adapter (supabase-store.ts) + an R10 smoke.
//
// access_audit is append-only (schema.md §8 / migration 0001_baseline) — this port only ever INSERTs.

/** actor_type enum (0001_baseline `create type actor_type as enum ('user','agent','system')`). */
export type ActorType = "user" | "agent" | "system";
export const ACTOR_TYPES: readonly ActorType[] = ["user", "agent", "system"];

/** One access_audit row this surface writes (columns per schema.md §8 access_audit DDL). `reason` is
 *  mandatory for a Restricted-touching access (enforced here, not in the DB). */
export interface AccessAuditAppend {
  auditType: string; // e.g. "dashboard_export" | "sensitive_view"
  actorIdentity: string; // the acting operator's identity
  actorType: ActorType;
  action: string; // e.g. "export:guardrail_log" | "view:restricted_event"
  targetEntityId?: string | null;
  targetType?: string | null;
  reason?: string | null; // REQUIRED when the access touches Restricted data
  pathContext?: string | null; // the surface/panel the access came from
  touchesRestricted?: boolean; // when true, `reason` must be present (else the write is refused, loud)
}

export interface OpsDashboardStore {
  /** Append one access_audit row for an export/sensitive-view. Fail-loud: a Restricted access with no reason
   *  is REFUSED (throws), never written un-reasoned — an un-audited/under-audited sensitive export is a #2/#3. */
  appendAccessAudit(a: AccessAuditAppend): Promise<void>;
}

export class OpsDashboardError extends Error {
  constructor(
    public reason: string,
    message: string,
  ) {
    super(message);
    this.name = "OpsDashboardError";
  }
}
export const ERR_MISSING_REASON = "restricted_access_needs_reason";
export const ERR_BAD_ACTOR_TYPE = "bad_actor_type";
export const ERR_BAD_TARGET_UUID = "bad_target_entity_uuid";

/** access_audit.target_entity_id is a UUID column (0001_baseline.sql L216). Validate the format in the SHARED
 *  gate so the fake refuses the same value the live INSERT would reject with `invalid input syntax for type
 *  uuid` — without this, a non-UUID passes the fake/offline suite but throws only against the real DB
 *  (fake-passes-offline / live-diverges, a latent #3). Fail-closed: an ill-formed id is refused pre-DB. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Shared validation the fake AND the live adapter both apply before any write (so their semantics match 1:1,
 *  proven by the R10 smoke). Throws on a #2/#3-violating write; returns normally otherwise. */
export function validateAccessAudit(a: AccessAuditAppend): void {
  if (!ACTOR_TYPES.includes(a.actorType)) {
    throw new OpsDashboardError(ERR_BAD_ACTOR_TYPE, `actor_type '${a.actorType}' is not one of ${ACTOR_TYPES.join("/")}`);
  }
  if (a.touchesRestricted && !(a.reason && a.reason.trim().length > 0)) {
    throw new OpsDashboardError(
      ERR_MISSING_REASON,
      "an access_audit for a Restricted-touching export/view requires a non-empty reason (FR-1.AUD.002) — refused, never written un-reasoned",
    );
  }
  if (a.targetEntityId != null && !UUID_RE.test(a.targetEntityId)) {
    throw new OpsDashboardError(
      ERR_BAD_TARGET_UUID,
      `target_entity_id '${a.targetEntityId}' is not a valid UUID — refused pre-DB so the fake matches the live UUID column (never written malformed)`,
    );
  }
}

// ── in-memory reference fake — the semantics the live adapter must match 1:1 ─────────────────────────────
export class InMemoryOpsDashboardStore implements OpsDashboardStore {
  readonly audits: AccessAuditAppend[] = [];

  async appendAccessAudit(a: AccessAuditAppend): Promise<void> {
    validateAccessAudit(a);
    this.audits.push({ ...a });
  }
}
