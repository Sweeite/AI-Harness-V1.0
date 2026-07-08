// ISSUE-079 — proactive suggestions on mobile (delivery + dismissal safety-floor; the lifecycle is C9's,
// ISSUE-070). Two rules mobile must honour:
//   • FR-9.SUG.004 / AC-9.SUG.004.1 — a suggestion is DELIVERED/routed to the correct owner (a suggestion for
//     this user reaches the mobile inline surface; one for another recipient does NOT). Acting on it routes
//     through the identical C6 path (FR-9.MODE.003 — see commands.ts / approvals.ts).
//   • FR-9.SUG.005 / AC-9.SUG.005.3 — dismissing a suggestion NEVER drives a hard-risk class below its safety
//     floor. A floor-flagged (is_floor) suggestion cannot be dismissed away on mobile (#1/#2) — the dismissal
//     is refused and the item stays surfaced.

export interface Suggestion {
  id: string;
  recipientId: string; // the resolved owner
  isFloor: boolean; // a hard-risk safety-floor item — never droppable below the floor
  riskType: string | null;
}

/** AC-9.SUG.004.1 — is this suggestion routed to the given mobile viewer? Only the resolved owner receives it. */
export function isDeliveredTo(s: Suggestion, viewerId: string): boolean {
  return s.recipientId === viewerId;
}

/** Filter a batch to the suggestions this mobile viewer should see inline (correct-owner routing). */
export function inlineSuggestionsFor(batch: readonly Suggestion[], viewerId: string): Suggestion[] {
  return batch.filter((s) => isDeliveredTo(s, viewerId));
}

export type DismissResult =
  | { dismissed: true; id: string }
  | { dismissed: false; id: string; reason: string }; // refused — floor preserved

/**
 * AC-9.SUG.005.3 — dismiss a suggestion. A safety-floor (is_floor) item is NOT dismissible on mobile: the
 * dismissal is refused so the item stays surfaced and the hard-risk class never drops below the floor (#2).
 */
export function dismissSuggestion(s: Suggestion): DismissResult {
  if (s.isFloor) {
    return {
      dismissed: false,
      id: s.id,
      reason: `suggestion ${s.id} is a safety-floor item (risk '${s.riskType ?? "hard"}') — dismissal refused, floor preserved (AC-9.SUG.005.3)`,
    };
  }
  return { dismissed: true, id: s.id };
}
