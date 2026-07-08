// ISSUE-079 — NFR-A11Y.001 the accessibility baseline (one of the 14 surfaces). The pure, testable part of the
// a11y contract that logic can enforce (keyboard-nav DOM order and contrast are build-time-audited in the
// shell — see §9): NO status is conveyed by COLOUR ALONE (AC-NFR-A11Y.001.2). Every status the mobile chrome
// renders (the connection indicator, freshness, banners, pills) must carry a text LABEL and a non-colour SHAPE
// token in addition to any colour, so it is legible to a colour-blind user and to a screen reader.
//
// statusToken(kind) is the single source the shell renders from; a status with an empty label or no shape is a
// programming error (it would collapse to colour-only) and throws — the #3 discipline applied to a11y.

export type StatusKind =
  | "live"
  | "reconnecting"
  | "polling"
  | "offline"
  | "healthy"
  | "cant_confirm"
  | "critical"
  | "unread";

export interface StatusToken {
  kind: StatusKind;
  label: string; // the accessible text label (never empty — colour is never the only signal)
  shape: string; // a non-colour glyph/shape token (icon name) — redundant with colour for colour-blind users
  ariaLive: "off" | "polite" | "assertive";
}

const TOKENS: Record<StatusKind, StatusToken> = {
  live: { kind: "live", label: "Live", shape: "dot-filled", ariaLive: "polite" },
  reconnecting: { kind: "reconnecting", label: "Reconnecting", shape: "dot-pulse", ariaLive: "polite" },
  polling: { kind: "polling", label: "Polling", shape: "arrows-cycle", ariaLive: "polite" },
  offline: { kind: "offline", label: "Offline", shape: "slash-circle", ariaLive: "assertive" },
  healthy: { kind: "healthy", label: "Healthy", shape: "check", ariaLive: "off" },
  cant_confirm: { kind: "cant_confirm", label: "Can't confirm", shape: "question", ariaLive: "polite" },
  critical: { kind: "critical", label: "Critical", shape: "triangle-exclaim", ariaLive: "assertive" },
  unread: { kind: "unread", label: "Unread", shape: "dot-filled", ariaLive: "off" },
};

/**
 * The token the shell renders for a status. Guarantees a non-empty label + a shape (AC-NFR-A11Y.001.2 — state
 * is never colour-alone). Throws for an unknown kind rather than silently rendering colour-only chrome.
 */
export function statusToken(kind: StatusKind): StatusToken {
  const t = TOKENS[kind];
  if (!t) throw new Error(`no a11y token for status '${kind}' — a status must never be colour-only (AC-NFR-A11Y.001.2)`);
  if (t.label.trim().length === 0 || t.shape.trim().length === 0) {
    throw new Error(`status '${kind}' would collapse to colour-only (empty label/shape) — NFR-A11Y.001`);
  }
  return t;
}

/** True iff every status kind has a non-colour label + shape (asserted by index.ts `check`). */
export function allStatusesLabelled(): boolean {
  return (Object.keys(TOKENS) as StatusKind[]).every((k) => {
    const t = TOKENS[k];
    return t.label.trim().length > 0 && t.shape.trim().length > 0;
  });
}
