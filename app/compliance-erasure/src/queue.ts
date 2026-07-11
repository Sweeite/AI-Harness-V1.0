// ISSUE-082 §8 step 2 — the Admin deletion request queue (FR-10.DEL.001 / AC-10.DEL.001.*).
//
// Intake records requester + legal-basis + resolved target; the request enters the queue at status='received'. A
// request is NEVER silently dropped — one that sits un-actioned past the escalation window is stamped `escalated_at`
// (server-owned) so it surfaces as overdue (AC-10.DEL.001.2); it is a legal obligation with a statutory clock. A
// request can be REJECTED (not a valid erasure basis) — recorded, never silently discarded. RBAC (PERM-memory.delete,
// AC-10.DEL.001.3) is enforced at the authorise/execute boundary in authorize.ts / execute.ts.

import type { DeletionRequest, DeletionRequestIntake, DeletionWorkflowStore } from './store.ts';

/** Intake a documented erasure request into the Admin queue (AC-10.DEL.001.1). Requester + legal basis + target
 *  recorded; lifecycle 'received' emitted. */
export async function intakeRequest(store: DeletionWorkflowStore, intake: DeletionRequestIntake): Promise<DeletionRequest> {
  const req = await store.createRequest(intake);
  await store.emitLifecycle('deletion_request_received', req.id, {
    requester_id: req.requesterId,
    target_entity_id: req.targetEntityId,
    target_user_id: req.targetUserId,
    legal_basis: req.legalBasis,
  });
  return req;
}

/** Reject a request that is not a valid erasure basis — recorded (never silently dropped). */
export async function rejectRequest(store: DeletionWorkflowStore, requestId: string, reason: string): Promise<DeletionRequest> {
  const req = await store.updateRequest(requestId, { status: 'rejected' });
  await store.emitLifecycle('deletion_request_rejected', requestId, { reason });
  return req;
}

export interface EscalationSummary {
  escalatedRequests: string[];
  escalatedConnectorFlags: string[];
}

/** The escalation sweep — the server-owned clock over BOTH the request queue and the connector-deletion flags.
 *   • Requests: overdue is DERIVED (deletion_requests has no escalated_at column) — an un-actioned request past the
 *     window is re-surfaced + re-alerted each sweep (a legal-clock nag until actioned; never silent expiry,
 *     AC-10.DEL.001.2). The durable backstop is the derived overdue badge on the surface (created_at vs the window).
 *   • Connector flags: stamped `escalated_at` (the table has the column) — at-most-once per flag, the stamp gates
 *     re-emit, so a crash between the atomic stamp and the alert leaves the flag durably escalated (AC-10.DEL.006.3). */
export async function runRequestEscalationSweep(store: DeletionWorkflowStore, escalationDays: number, now: number): Promise<EscalationSummary> {
  const escalatedRequests = await store.overdueRequests(escalationDays, now);
  for (const id of escalatedRequests) {
    await store.emitLifecycle('deletion_request_escalated', id, { reason: `un-actioned past escalation window (${escalationDays}d)` });
  }
  const escalatedConnectorFlags = await store.escalateOverdueConnectorFlags(escalationDays, now);
  for (const id of escalatedConnectorFlags) {
    await store.emitLifecycle('connector_deletion_flag_escalated', id, { reason: `un-acknowledged past escalation window (${escalationDays}d)` });
  }
  return { escalatedRequests, escalatedConnectorFlags };
}
