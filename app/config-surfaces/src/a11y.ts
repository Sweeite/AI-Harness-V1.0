// ISSUE-086 — the accessibility-baseline floor for both surfaces (NFR-A11Y.001 / AC-NFR-A11Y.001.1/.2). The
// two machine-checkable properties this surface must uphold:
//   - status indicators are NEVER colour-only — every edit-class / Locked / Hard-limit / banner status carries
//     a TEXT cue (AC-NFR-A11Y.001.2). assertNotColourOnly + the sweep in the tests prove no badge is a bare
//     colour swatch.
//   - neither config surface holds an open Realtime subscription (FR-7.RTP.001 / AC-7.RTP.001.3) — they are
//     static-on-load + on-demand refresh; NO_REALTIME_SUBSCRIPTION is the structural assertion the surfaces
//     export so the C7 realtime audit can confirm they are outside the two Realtime surfaces.
//
// The remaining NFR-A11Y.001 properties (keyboard-navigable, contrast, semantic markup, labelled controls)
// are DOM-level and verified in the build-time a11y audit named in the FR; this module holds the parts that
// are logic — the non-colour-only status rule and the no-subscription rule.

/** Neither config surface holds a Realtime subscription (AC-7.RTP.001.3). Static-on-load + on-demand only. */
export const NO_REALTIME_SUBSCRIPTION = true as const;

/** True if a status label carries a non-empty TEXT cue (not colour-only). */
export function hasTextCue(label: string | null | undefined): boolean {
  return typeof label === 'string' && label.trim().length > 0;
}

/** Assert a status label is not colour-only — throws if it is empty/whitespace (AC-NFR-A11Y.001.2). */
export function assertNotColourOnly(kind: string, label: string | null | undefined): void {
  if (!hasTextCue(label)) {
    throw new Error(`a11y (NFR-A11Y.001.2): status '${kind}' has no text cue — a colour-only indicator is not accessible.`);
  }
}
