// ISSUE-020 / FR-1.RLS.007 — the mid-task authorization RE-CHECK rule (the authorization decision only;
// the abort/quarantine MECHANISM is C5/C6/C8 — OD-010). A task running as service_role carries its
// originating user's identity; at each step/injection boundary the harness re-evaluates, against the LIVE
// authorization state, that the user is still active and still holds the clearances/Restricted grants the
// task RELIES ON, and stops before the next CONSEQUENTIAL side effect on deactivation/revocation.
//
// expiry ≠ revocation (AC-1.RLS.007.3 / C0 FR-0.SESS.006): this rule keys ONLY on authorization DATA
// (profiles.active + held clearances/grants). A merely-expired user session does not touch that data, so a
// service_role continuation (FR-0.SESS.006) re-checks as still-authorized → continue. Only a deactivation
// or a clearance/Restricted revoke — real data changes — flip it to stop. Fail-closed throughout (#2): an
// unknown user, or an unreadable authz state, is treated as NOT authorized.

import {
  type RlsEnforcementStore,
  type OriginatingAuthz,
  type ClearanceHold,
  type RestrictedHold,
  EVT_AUTHZ_REVOKED_MIDTASK,
} from "./store.ts";

export type StopReason = "deactivated" | "clearance_revoked" | "restricted_revoked";

export interface AuthzReeval {
  authorized: boolean;
  stopReason: StopReason | null;
  detail: string;
}

/** What a task depends on — recorded when it starts, re-verified at each boundary. */
export interface ReliedOn {
  clearances: ClearanceHold[];
  restricted: RestrictedHold[];
}

/** A held Global-scoped clearance (entityTypeScope null) covers any relied-on scope for that tier. */
function clearanceStillHeld(held: ClearanceHold[], need: ClearanceHold): boolean {
  return held.some(
    (h) => h.tier === need.tier && (h.entityTypeScope === null || h.entityTypeScope === need.entityTypeScope),
  );
}

/** A held grant covers a relied-on grant when a wider-scoped (null) hold subsumes it, else an exact match. */
function restrictedStillHeld(held: RestrictedHold[], need: RestrictedHold): boolean {
  return held.some(
    (h) =>
      (h.entityId === null || h.entityId === need.entityId) &&
      (h.entityType === null || h.entityType === need.entityType),
  );
}

/**
 * The pure rule: given the CURRENT authz state (null = unknown/unreadable → fail-closed) and what the task
 * relies on, is the task still authorized? Deactivation dominates; then each relied-on clearance/grant must
 * still be held.
 */
export function reevaluate(current: OriginatingAuthz | null, reliedOn: ReliedOn): AuthzReeval {
  if (current === null) {
    return { authorized: false, stopReason: "deactivated", detail: "originating user not found — fail-closed (#2)" };
  }
  if (!current.active) {
    return { authorized: false, stopReason: "deactivated", detail: `originating user ${current.userId} is deactivated` };
  }
  for (const c of reliedOn.clearances) {
    if (!clearanceStillHeld(current.clearances, c)) {
      return {
        authorized: false,
        stopReason: "clearance_revoked",
        detail: `relied-on clearance ${c.tier}/${c.entityTypeScope ?? "global"} no longer held`,
      };
    }
  }
  for (const r of reliedOn.restricted) {
    if (!restrictedStillHeld(current.restricted, r)) {
      return {
        authorized: false,
        stopReason: "restricted_revoked",
        detail: `relied-on Restricted grant (${r.entityId ?? r.entityType ?? "scoped"}) no longer active`,
      };
    }
  }
  return { authorized: true, stopReason: null, detail: "authorization intact" };
}

export interface TaskContext {
  taskId: string;
  serviceRoleIdentity: string; // the acting service_role task identity (audit actor)
  originatingUserId: string;
  reliedOn: ReliedOn;
}

export interface Boundary {
  /** true iff the NEXT action gated by this boundary is a consequential side effect (external comm,
   * financial action, cross-entity write, memory write of relied-on-sensitive content — OD-031). */
  consequential: boolean;
  describe: string; // e.g. "send external email", "commit memory write"
}

export type BoundaryAction = "proceed" | "halt_and_quarantine";

export interface BoundaryOutcome {
  action: BoundaryAction;
  reeval: AuthzReeval;
}

/**
 * FR-1.RLS.007 boundary guard. Loads the live authz state, re-evaluates, and — when the task is no longer
 * authorized AND the boundary gates a consequential side effect — halts + quarantines (writes the loud
 * authz_revoked_midtask event + the access_audit stop row; the caller performs the actual halt/quarantine,
 * OD-010) BEFORE the side effect runs. A benign expiry (still active + grants held) proceeds.
 *
 * A non-consequential boundary never runs a side effect, so an unauthorized task is reported (reeval carries
 * authorized:false) but not quarantined here — it will be stopped at the next consequential boundary, which
 * is the exact contract (AC-1.RLS.007.1). This keeps a pure reasoning/read step from spuriously quarantining
 * while guaranteeing no consequential effect slips through.
 */
export async function guardBoundary(
  store: RlsEnforcementStore,
  task: TaskContext,
  boundary: Boundary,
): Promise<BoundaryOutcome> {
  const current = await store.loadOriginatingAuthz(task.originatingUserId);
  const reeval = reevaluate(current, task.reliedOn);

  if (reeval.authorized) return { action: "proceed", reeval };
  if (!boundary.consequential) return { action: "proceed", reeval }; // no side effect here; stop at the next consequential one

  // Unauthorized AND about to do something consequential → stop loud, before the effect (#1 never drop it
  // silently: it is quarantined for human review; #3 never fail silently: both sinks are written).
  await store.appendEventLog({
    eventType: EVT_AUTHZ_REVOKED_MIDTASK,
    entityIds: [],
    summary: `mid-task authorization stop (${reeval.stopReason}) before "${boundary.describe}"`,
    payload: {
      task_id: task.taskId,
      originating_user_id: task.originatingUserId,
      stop_reason: reeval.stopReason,
      detail: reeval.detail,
      boundary: boundary.describe,
    },
  });
  await store.appendAudit({
    auditType: "authz_revoked_midtask",
    actorIdentity: task.serviceRoleIdentity,
    action: `halt_and_quarantine:${boundary.describe}`,
    originatingUserId: task.originatingUserId,
    reason: reeval.detail,
    pathContext: task.taskId,
  });
  return { action: "halt_and_quarantine", reeval };
}
