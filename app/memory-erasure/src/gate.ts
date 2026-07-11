// ISSUE-029 §8 step 1 — the erasure gate. Destructive-by-design, so it is STRICTER than retire/supersede
// (FR-2.MNT.017 preconditions): Super-Admin + PERM-memory.delete + an erasure-specific confirmation. A request that
// fails any leg is rejected BEFORE any read of the target's data — the gate is the entry precondition, fail-closed.

import { PERM_MEMORY_DELETE, type ErasureAuthz } from './store.ts';

export interface GateVerdict {
  allowed: boolean;
  /** the specific reasons a request was rejected (all of them — a caller sees every missing precondition, #3). */
  reasons: string[];
}

/** Evaluate the erasure precondition. ALL must hold; any miss → rejected with the explicit reason(s). Fail-closed:
 *  an undefined/empty authz is a rejection, never a pass. */
export function checkErasureGate(authz: ErasureAuthz): GateVerdict {
  const reasons: string[] = [];
  if (!authz?.isSuperAdmin) reasons.push('not_super_admin');
  // guard the array access — a malformed/missing permissions field is a clean rejection reason, never a TypeError
  // that bypasses the GateVerdict/#3 "every missing precondition reported" contract (fail-closed).
  if (!Array.isArray(authz?.permissions) || !authz.permissions.includes(PERM_MEMORY_DELETE)) reasons.push(`missing_${PERM_MEMORY_DELETE}`);
  if (!authz?.erasureConfirmed) reasons.push('erasure_not_confirmed');
  if (!authz?.actorIdentity) reasons.push('missing_actor_identity');
  if (!authz?.originatingUserId) reasons.push('missing_originating_user');
  // NOTE (OD-205-adjacent, #2): `erasureConfirmed` is a bare boolean this slice TRUSTS — binding it to the
  // deletion_requests id + a second-authoriser token is the C10 two-person-auth workflow's job (ISSUE-082 /
  // NFR-CMP.008). This slice is the C2 mechanism; it takes the resolved, authorised target it is handed.
  return { allowed: reasons.length === 0, reasons };
}

/** Thrown when an erasure is attempted below the gate — a destructive op must never proceed on a failed precondition. */
export class ErasureGateError extends Error {
  constructor(public readonly reasons: string[]) {
    super(`erasure gate rejected: ${reasons.join(', ')}`);
    this.name = 'ErasureGateError';
  }
}
