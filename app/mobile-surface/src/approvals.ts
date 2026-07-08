// ISSUE-079 — the approval path on mobile (the mobile treatment of surface-04; the tiers/pipeline are C6's,
// ISSUE-056). Every Approve/Reject/hold runs the IDENTICAL C6 pipeline as desktop (no mobile back-door, #2 —
// FR-9.MODE.003 / NFR-SEC.013). Two mobile-specific rules:
//   • Modify DEGRADES to desktop (FR-6.ESC.003 / OD-152) — editing action parameters on a phone is a #2 risk.
//   • A Restricted-content action needs the SAME explicit, audited reveal as desktop BEFORE it can be approved
//     (FR-1.RST.003) — Restricted content is never auto-injected into the mobile card.
// The reversible-soft countdown is SERVER-authoritative: a soft item may auto-run server-side while the phone
// is offline, so on reconnect the queue re-fetches before any button re-enables (see connection.ts) and
// hold-for-review promotes a soft item to explicit approval, STOPPING the auto-run (AC-6.APR.003.3).

export type ApprovalTier = "notify" | "reversible_soft" | "hard_approval"; // FR-6.APR.001–003
export type EscalationResolution = "approve" | "reject" | "modify";

export interface HeldAction {
  taskId: string;
  tier: ApprovalTier;
  restricted: boolean; // the action touches Restricted content (FR-1.RST.003)
}

export type ApprovalDecision =
  | { action: "run_pipeline"; taskId: string } // approved → identical C6 pipeline
  | { action: "reject"; taskId: string; reason: string }
  | { action: "hold_stop_autorun"; taskId: string } // AC-6.APR.003.3
  | { action: "reveal_required"; taskId: string } // Restricted — audited reveal first (FR-1.RST.003)
  | { action: "degrade_to_desktop"; capability: string; surface: string }; // Modify (FR-6.ESC.003)

/**
 * Approve a held action. If it touches Restricted content and the reveal has NOT been performed+audited, we
 * return reveal_required — the approval cannot proceed on un-revealed Restricted content (#2, FR-1.RST.003).
 * Otherwise it routes to the identical C6 pipeline (FR-9.MODE.003 — no bypass).
 */
export function approve(held: HeldAction, revealed: boolean): ApprovalDecision {
  if (held.restricted && !revealed) {
    return { action: "reveal_required", taskId: held.taskId };
  }
  return { action: "run_pipeline", taskId: held.taskId };
}

/** Reject requires a mandatory reason (FR-6.ESC.003) — an empty/blank reason is refused (#3, no silent reject). */
export function reject(held: HeldAction, reason: string): ApprovalDecision {
  if (reason.trim().length === 0) {
    throw new Error("reject requires a mandatory reason (FR-6.ESC.003)");
  }
  return { action: "reject", taskId: held.taskId, reason };
}

/**
 * AC-6.APR.003.3 — promote a reversible-soft item to explicit approval, STOPPING the pending auto-run so it is
 * held for full review. Only meaningful for the reversible-soft tier (the tier with an auto-run countdown).
 */
export function holdForReview(held: HeldAction): ApprovalDecision {
  if (held.tier !== "reversible_soft") {
    throw new Error(`hold-for-review only applies to a reversible_soft item (got '${held.tier}')`);
  }
  return { action: "hold_stop_autorun", taskId: held.taskId };
}

/**
 * FR-6.ESC.003 / AC-6.ESC.003.1 — resolve a flagged/escalated hold. Approve resumes (identical pipeline);
 * Reject stops with a reason; Modify DEGRADES to the desktop editor (surface-04) — never editable on mobile.
 *
 * `revealed` carries the caller's actual Restricted-reveal state (FR-1.RST.003) and defaults to FALSE
 * (fail-safe: an un-threaded caller can never accidentally approve un-revealed Restricted content, #2). A
 * legitimately-revealed Restricted item MUST pass `revealed: true` to proceed — otherwise an
 * escalation-Approve on already-revealed Restricted content would dead-end back to reveal_required.
 */
export function resolveEscalation(
  held: HeldAction,
  resolution: EscalationResolution,
  reason?: string,
  revealed = false,
): ApprovalDecision {
  switch (resolution) {
    case "approve":
      // Thread the caller's real reveal state. `approve` ignores it for non-restricted items (they never
      // need a reveal) and enforces it for Restricted ones (un-revealed → reveal_required, #2).
      return approve(held, revealed);
    case "reject":
      return reject(held, reason ?? "");
    case "modify":
      return { action: "degrade_to_desktop", capability: "Modify an approval's parameters", surface: "surface-04" };
  }
}
