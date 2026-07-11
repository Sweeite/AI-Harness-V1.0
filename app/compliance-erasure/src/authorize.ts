// ISSUE-082 §8 step 5 — RBAC + two-person authorisation (FR-10.DEL.001 / FR-10.DEL.006 / NFR-SEC.015).
//
// The two-person control (AC-10.DEL.006.2 / OD-093) is only meaningful if it takes THREE genuinely distinct people who
// EACH independently held PERM-memory.delete and EACH acted under their own authenticated identity — distinct *IDs*
// asserted by one actor is NOT two humans who acted (the adversarial-verify B1 finding). So authorisation is a
// two-step, each-actor-perm-checked, PERSISTED handshake:
//   1. authorizeRequest(request, actorA)      — A holds the perm → persists authorized_by = A.
//   2. secondAuthorizeRequest(request, actorB) — B holds the perm, B ≠ A → persists second_authoriser_id = B.
//   3. execute (executor C) READS the persisted authorisers from the request (never trusts caller-supplied ids), and
//      the gate requires C's perm + THREE distinct non-null identities. The DB CHECKs are the ground truth; the
//      in-code gate rejects before the destructive call.
//
// Because deletion_requests' DB CHECK unconditionally requires all three roles non-null at status='executed'
// (0001_baseline.sql), an individual erasure is ALWAYS two-person here — CFG-deletion_two_person_auth_required can
// make a deletion MORE strict but can never loosen the DB. So the gate requires the second authoriser
// UNCONDITIONALLY; there is no single-authorised destructive path (this closes the "config-off destroy-then-held"
// contradiction the verify found). The authenticated binding of an actorId to a real admin session is the C1/ISSUE-021
// seam this consumes.

import { PERM_MEMORY_DELETE, type DeletionRequest, type DeletionWorkflowStore } from './store.ts';

/** An acting admin — their id + the permission nodes their authenticated session holds. */
export interface Authoriser {
  actorId: string;
  permissions: readonly string[];
}

function holdsDeletePerm(permissions: readonly string[]): boolean {
  // guard the array — a malformed/missing permissions field is a clean rejection, never a TypeError bypass (fail-closed).
  return Array.isArray(permissions) && permissions.includes(PERM_MEMORY_DELETE);
}

/** Step 1 — the first authoriser (Admin/Super-Admin) authorises. Perm-checked under THEIR identity, then persisted. */
export async function authorizeRequest(store: DeletionWorkflowStore, requestId: string, actor: Authoriser): Promise<DeletionRequest> {
  if (!actor.actorId) throw new AuthorizationError(['missing_authoriser_identity']);
  if (!holdsDeletePerm(actor.permissions)) throw new AuthorizationError([`authoriser_missing_${PERM_MEMORY_DELETE}`]);
  const req = await store.updateRequest(requestId, { status: 'authorised', authorizedBy: actor.actorId });
  await store.emitLifecycle('deletion_request_authorised', requestId, { authorized_by: actor.actorId });
  return req;
}

/** Step 2 — the second, DISTINCT authoriser confirms. Perm-checked under THEIR identity; the DB CHECK enforces the
 *  distinctness (second ≠ authorised_by). */
export async function secondAuthorizeRequest(store: DeletionWorkflowStore, requestId: string, actor: Authoriser): Promise<DeletionRequest> {
  if (!actor.actorId) throw new AuthorizationError(['missing_second_authoriser_identity']);
  if (!holdsDeletePerm(actor.permissions)) throw new AuthorizationError([`second_authoriser_missing_${PERM_MEMORY_DELETE}`]);
  // updateRequest routes through the distinctness CHECK (second_authoriser_id is distinct from authorized_by) — a
  // self-second-authorisation throws here, never a silent single-person approval (#2).
  const req = await store.updateRequest(requestId, { secondAuthoriserId: actor.actorId });
  await store.emitLifecycle('deletion_request_second_authorised', requestId, { second_authoriser_id: actor.actorId });
  return req;
}

export interface ExecutorAuthorizationInput {
  /** the actor executing the erasure — must hold PERM-memory.delete. */
  executorId: string;
  executorPermissions: readonly string[];
  /** the PERSISTED authorisers, read from the request (set by the two perm-checked authorise steps above). */
  authorizedBy: string | null;
  secondAuthoriserId: string | null;
}

export interface AuthorizationVerdict {
  allowed: boolean;
  /** every failed precondition (a caller sees all of them, #3), never just the first. */
  reasons: string[];
}

/** The execute-time gate: the executor holds the perm, all three roles are present + distinct. Two-person is
 *  unconditional for an individual erasure (DB-mandated) — there is no single-authorised path. */
export function checkExecutorAuthorization(input: ExecutorAuthorizationInput): AuthorizationVerdict {
  const reasons: string[] = [];
  if (!holdsDeletePerm(input.executorPermissions)) reasons.push(`executor_missing_${PERM_MEMORY_DELETE}`);
  if (!input.executorId) reasons.push('missing_executor');
  if (!input.authorizedBy) reasons.push('missing_authoriser');
  if (!input.secondAuthoriserId) reasons.push('missing_second_authoriser');
  // distinctness — mirrors the deletion_requests CHECKs (any collision is a self-authorisation).
  if (input.authorizedBy && input.secondAuthoriserId && input.authorizedBy === input.secondAuthoriserId) reasons.push('authoriser_equals_second');
  if (input.executorId && input.authorizedBy && input.executorId === input.authorizedBy) reasons.push('executor_equals_authoriser');
  if (input.executorId && input.secondAuthoriserId && input.executorId === input.secondAuthoriserId) reasons.push('executor_equals_second');
  return { allowed: reasons.length === 0, reasons };
}

/** Thrown when the authorisation gate rejects — a destructive erasure must never proceed under-authorised. */
export class AuthorizationError extends Error {
  constructor(public readonly reasons: string[]) {
    super(`erasure authorisation rejected: ${reasons.join(', ')}`);
    this.name = 'AuthorizationError';
  }
}
