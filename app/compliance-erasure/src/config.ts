// ISSUE-082 (C10) — the LIVE config this workflow reads. Canonical values live in spec/02-config/config-registry.md
// (Rule 0 — read there, not here); these are the shipped DEFAULTS the fake + tests use, and a live loadConfig would
// override them from config_values. The `check` gate (index.ts) asserts each required key is present + correct-class
// in the registry, so a drift between this contract and the registry is caught offline (a #3 silent config drift —
// a two-person gate silently keying off a stale value, or an audit-retention floor drifting, is exactly what this
// slice guards).

export interface DeletionWorkflowConfig {
  /** CFG-deletion_two_person_auth_required (true, LIVE) — a Restricted/Personal erasure needs a second DISTINCT
   *  Admin/Super-Admin (AC-10.DEL.006.2). Read at run time; an UNRESOLVABLE read fails CLOSED (treated as required,
   *  AC-10.DEL.006.4) — this default is the fail-closed value, never a fail-open one. */
  twoPersonAuthRequired: boolean;
  /** CFG-individual_deletion_audit_years (7, BOOT) — how long the immutable deletion audit record is retained after
   *  the data is gone (AC-10.DEL.005.2). Recorded on the audit entry; enforced by the C7 retention floor. */
  individualDeletionAuditYears: number;
  /** the erasure-request escalation window (FR-10.DEL.001). No dedicated CFG exists (config_values seed is deferred to
   *  ISSUE-010); this reuses CFG-review_escalation_days (7, LIVE) — the same server-owned escalation clock the memory
   *  review queues use (ISSUE-028). A request/connector-flag sitting past it escalates, never silently expiring
   *  (AC-10.DEL.001.2 / AC-10.DEL.006.3). Documented as an interpretation in OD-206-adjacent build notes. */
  requestEscalationDays: number;
}

/** The shipped defaults (config-registry.md rows). twoPersonAuthRequired defaults TRUE = the fail-closed value. */
export const DEFAULT_DELETION_WORKFLOW_CONFIG: DeletionWorkflowConfig = {
  twoPersonAuthRequired: true,
  individualDeletionAuditYears: 7,
  requestEscalationDays: 7,
};

/** The CFG keys the `check` gate asserts are present in the registry (with their required class). */
export const REQUIRED_CFG: readonly { key: string; cls: 'LIVE' | 'BOOT' }[] = [
  { key: 'deletion_two_person_auth_required', cls: 'LIVE' },
  { key: 'individual_deletion_audit_years', cls: 'BOOT' },
  { key: 'review_escalation_days', cls: 'LIVE' },
];
