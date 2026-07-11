// ISSUE-082 §8 step 8 — Step 6(a): connector-deletion flags (FR-10.DEL.006(a) / AC-10.DEL.006.1/.3/.4).
//
// If the person's data also lives in a connected system of record (GHL / Slack / Google), the harness NEVER deletes
// it there itself — it RAISES a per-system, tracked-until-acknowledged flag so the cross-system deletion is not
// forgotten (AC-10.DEL.006.1). An un-acknowledged flag ESCALATES rather than silently closing (AC-10.DEL.006.3 —
// store.escalateOverdueConnectorFlags, the sweep). And detection itself failing-closed (AC-10.DEL.006.4): if
// connector-presence detection ERRORS, the erasure cannot complete until it is resolved — a detection error blocks +
// escalates, it never silently produces no flag (the #2 "forgotten connector deletion" path).

import type { ConnectorPresencePort, DeletionWorkflowStore } from './store.ts';

export interface ConnectorFlagResult {
  /** connectors detected as holding the person's data → a flag was raised for each. */
  raised: string[];
  /** true iff presence detection ERRORED — the caller fails closed (blocks the erasure until resolved). */
  detectionError: boolean;
  /** the detection error message, surfaced for the operator (never swallowed). */
  detectionErrorDetail: string | null;
}

/** Detect connector presence and raise a tracked flag per connector. A detection THROW is caught + reported as
 *  detectionError (NOT rethrown) so the orchestrator can fail closed uniformly with its other legs — but it is NEVER
 *  treated as "no connectors present" (that would be the silent #2 failure). */
export async function detectAndRaiseConnectorFlags(store: DeletionWorkflowStore, presence: ConnectorPresencePort, requestId: string, targetEntityId: string): Promise<ConnectorFlagResult> {
  const raised: string[] = [];
  try {
    const connectors = await presence.detect(targetEntityId);
    for (const connector of connectors) {
      await store.raiseConnectorFlag(requestId, connector); // a raise failure is also a fail-closed reason, not a raw reject
      raised.push(connector);
    }
  } catch (e) {
    // a detection error OR a flag-raise failure both fail closed uniformly — a connector that should have a tracked
    // flag but doesn't is the silent #2 "forgotten connector deletion". Never treated as "no connectors present".
    return { raised, detectionError: true, detectionErrorDetail: e instanceof Error ? e.message : String(e) };
  }
  return { raised, detectionError: false, detectionErrorDetail: null };
}
