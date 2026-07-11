// ISSUE-028 — the un-actioned → escalated sweep across BOTH review queues (AC-2.WRT.002.3 / AC-2.MNT.014.2).
//
// This is the operational driver the schedule assigns to ISSUE-028 ("the mechanism lives in the write path; ISSUE-028
// drives + renders it"). `escalated_at` is SERVER-owned: when an item passes CFG-review_escalation_days it is stamped
// escalated + an alert is raised via the C7 seam (reusing the baseline `approval_queue_stale` event). The surface only
// READS escalated_at (+ created_at vs the cadence) to render the overdue badge — it never decides escalation, so the
// badge is correct even when the surface is idle. An escalated item is NEVER auto-resolved and NEVER silently held.
//
// The conflicts-queue sweep mirrors ISSUE-024's SupabaseCommitStore.escalateOverdueConflicts (identical UPDATE, same
// table) — 024 owns it as the write-package backstop; this driver runs both queues together as the one C2 cadence
// step, so a deployment that runs this sweep never leaves either queue in silent indefinite hold.

import type { ConflictConsolidationStore } from './store.ts';

export interface EscalationSummary {
  escalatedConflicts: string[];
  escalatedConsolidations: string[];
}

/** Run the escalation sweep for both queues. Emits one `approval_queue_stale` alert per newly-escalated item (C7).
 *
 *  #3 crash-window note: the `state='escalated'` + `escalated_at` UPDATE is atomic (one statement); the C7 alert is a
 *  separate emit. A crash between them leaves the row escalated (so the next sweep, selecting only `state='pending'`,
 *  won't re-emit) — the alert is at-most-once. This does NOT violate "never silently held": `escalated_at` is set
 *  atomically with the state, and the surface renders the overdue badge from `escalated_at` regardless of the alert,
 *  so the item is always visibly escalated. The alert is a best-effort push on top of that durable badge backstop
 *  (identical posture to ISSUE-024's escalateOverdueConflicts). */
export async function runEscalationSweep(store: ConflictConsolidationStore, reviewEscalationDays: number, now: number = Date.now()): Promise<EscalationSummary> {
  const escalatedConflicts = await store.escalateOverdueConflicts(reviewEscalationDays, now);
  for (const id of escalatedConflicts) {
    await store.escalated({ queue: 'conflicts', record_id: id, escalated: true, reason: `un-actioned past review_escalation_days (${reviewEscalationDays}d)` });
  }
  const escalatedConsolidations = await store.escalateOverdueConsolidations(reviewEscalationDays, now);
  for (const id of escalatedConsolidations) {
    await store.escalated({ queue: 'consolidation', record_id: id, escalated: true, reason: `un-actioned past review_escalation_days (${reviewEscalationDays}d)` });
  }
  return { escalatedConflicts, escalatedConsolidations };
}
