// ISSUE-078 — the surface-06 §H guarded offboarding wizard (OD-127). The WORKFLOW LOGIC is C10-owned
// (ISSUE-083 executes it); this module RENDERS the sequence as enforced UI steps and GATES each transition on
// the C10 workflow's #1 acceptance criteria, so a gate can never be skipped from the console:
//
//   • Step 2 Export — verified-complete before ANY deletion (AC-10.OFF.002.4, #1) + client sign-off before
//     retention (AC-10.OFF.003.3). An unverifiable/unacknowledged export BLOCKS the sequence.
//   • Step 4 Hard-delete — inline two-person auth: a DISTINCT second approver, no self-second
//     (AC-10.DEL.006.2). The executor cannot self-authorise.
//   • Every destructive action is disabled while the row's state is unloaded/stale (surface-06 §H states).
//
// This module does NOT truncate/deprovision anything — it returns a decision ("may this transition proceed?")
// that the C10 workflow acts on. A refusal is loud (a typed reason), never a silent no-op (#3).

export type OffboardingStep =
  | "not-started"
  | "initiated" // Step 1 — status → offboarding
  | "export-in-progress" // Step 2 — export running
  | "export-verified" // Step 2 — export verified-complete + client sign-off recorded
  | "frozen" // Step 3 — retention freeze
  | "hard-deleting" // Step 4 — destructive sequence running
  | "deleted" // Step 5 — meta-record written
  | "deletion-failed"; // Step 4 partial — never "complete", escalated (AC-10.OFF.005.2)

/** The console's view of a registry row's offboarding state. `dataFreshness` gates destructive actions. */
export interface OffboardingRowState {
  clientSlug: string;
  step: OffboardingStep;
  exportVerifiedComplete: boolean; // AC-10.OFF.002.4
  clientSignedOff: boolean; // AC-10.OFF.003.3
  dataFreshness: "loaded" | "unloaded" | "stale"; // surface-06 §H — destructive disabled unless "loaded"
  retentionWindowEndEpochS: number | null;
}

export interface GateDecision {
  allowed: boolean;
  reason: string; // always populated — a refusal is explained, never silent
}

const ok = (reason = "ok"): GateDecision => ({ allowed: true, reason });
const deny = (reason: string): GateDecision => ({ allowed: false, reason });

/** A destructive action may only proceed when the row's state is freshly loaded (never on unloaded/stale —
 *  surface-06 §H: "all destructive actions disabled while unloaded/stale"). */
function destructiveDataGate(row: OffboardingRowState): GateDecision {
  if (row.dataFreshness !== "loaded") {
    return deny(`row state is ${row.dataFreshness} — destructive actions disabled until a fresh load (#3: never act on an unconfirmed state)`);
  }
  return ok();
}

/** Step 3 gate — Freeze may begin ONLY after the export is verified-complete AND the client signed off
 *  (AC-10.OFF.002.4 / AC-10.OFF.003.3, #1: never freeze/delete on an unverified export). */
export function canFreeze(row: OffboardingRowState): GateDecision {
  const d = destructiveDataGate(row);
  if (!d.allowed) return d;
  if (row.step !== "export-verified") return deny(`cannot freeze from step "${row.step}" — export must be verified first`);
  if (!row.exportVerifiedComplete) return deny("export is not verified-complete — freeze blocked (#1, AC-10.OFF.002.4)");
  if (!row.clientSignedOff) return deny("client has not signed off on the export — freeze blocked (AC-10.OFF.003.3)");
  return ok("export verified-complete + client sign-off present — freeze may proceed");
}

/** The two-person authorisation for the hard-delete (AC-10.DEL.006.2): a DISTINCT second approver, the
 *  executor cannot self-authorise. Both must hold PERM-fleet.offboard (checked by rbac.ts before this). */
export interface TwoPersonAuth {
  firstApproverId: string;
  secondApproverId: string;
  executorId: string;
}

export function authorizeTwoPerson(auth: TwoPersonAuth): GateDecision {
  if (!auth.firstApproverId || !auth.secondApproverId || !auth.executorId) {
    return deny("two-person auth requires a first approver, a distinct second approver, and an executor — all present (#2)");
  }
  if (auth.firstApproverId === auth.secondApproverId) {
    return deny("the second approver must be DISTINCT from the first — no self-second (AC-10.DEL.006.2)");
  }
  // The executor cannot self-authorise: they may not be EITHER approver. This mirrors the ground-truth DB CHECK
  // on deletion_requests (0001_baseline.sql L655-656 / schema.md): `executor_id is distinct from authorized_by
  // AND executor_id is distinct from second_authoriser_id`. All three roles must be three distinct people.
  // (Checking each approver INDIVIDUALLY — the old compound `executor===first && executor===second` was dead
  // code, unreachable after the first!==second early return above, so it protected nothing: fail-open #2.)
  if (auth.executorId === auth.firstApproverId) {
    return deny("the executor cannot self-authorise as the first approver (executor_id ≠ authorized_by, AC-10.DEL.006.2)");
  }
  if (auth.executorId === auth.secondApproverId) {
    return deny("the executor cannot self-authorise as the second approver (executor_id ≠ second_authoriser_id, AC-10.DEL.006.2)");
  }
  return ok("two-person auth satisfied — executor + two distinct approvers, three distinct people confirmed");
}

/** The full Step-4 hard-delete gate: fresh data + prior steps complete + two-person auth. This is the most
 *  consequential decision on the surface — every precondition is checked and any failure is loud. */
export function canHardDelete(row: OffboardingRowState, auth: TwoPersonAuth): GateDecision {
  const d = destructiveDataGate(row);
  if (!d.allowed) return d;
  if (row.step !== "frozen") {
    return deny(`cannot hard-delete from step "${row.step}" — the row must be frozen (post export-verify + sign-off) first`);
  }
  if (!row.exportVerifiedComplete || !row.clientSignedOff) {
    return deny("hard-delete requires a verified-complete, signed-off export (#1) — blocked");
  }
  const two = authorizeTwoPerson(auth);
  if (!two.allowed) return two;
  return ok("all #1 gates satisfied + two-person auth confirmed — hard-delete may execute");
}
