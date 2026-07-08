// ISSUE-079 — the mobile Alerts / notification centre chrome (the SECOND Realtime surface). The alert rules +
// the watchdog + unroutable-fails-loud are C7's (ISSUE-075); this owns the mobile RENDERING guarantees:
//   • FR-7.ALR.001 / AC-7.ALR.001.1/.2 — the notification centre is primary + persistent; a row stays UNREAD
//     until actioned (mark-actioned is the only state transition mobile drives).
//   • FR-7.ALR.002 / AC-7.ALR.002.2 — the hard-limit alert is NON-suppressible (a user cannot filter/mute it).
//   • FR-7.ALR.006 / AC-7.ALR.006.1/.2 — the in-app record is authoritative and INDEPENDENT of Slack/push
//     arriving: a Slack/push outage never removes a row, and a failed delivery is SURFACED (delivery_state),
//     not dropped (#1/#3).
//   • FR-7.ALR.008 / AC-7.ALR.008.2 (alert-engine-stalled) and FR-7.ALR.009 / AC-7.ALR.009.1 (unroutable
//     alert) — the two PROTECTIVE BANNERS pin above all content, computed INDEPENDENTLY of the list fetch so
//     they still show even when the alert list itself failed to load (#3).
//   • NFR-OBS.011 — "No alerts" only on a confirmed-live connection; otherwise "can't confirm alert state".

import type { NotificationRow } from "./store.ts";

/** alert_type values that can NEVER be user-suppressed (⊆ the live alert_type enum; hard-limit is the floor). */
export const NON_SUPPRESSIBLE_ALERT_TYPES: readonly string[] = ["hard_limit_hit"] as const;

/** AC-7.ALR.002.2 — a hard-limit alert is non-suppressible; a suppress request against it is refused (#3). */
export function isSuppressibleAlert(alertType: string): boolean {
  return !NON_SUPPRESSIBLE_ALERT_TYPES.includes(alertType);
}

/** AC-7.ALR.001.2 — a row is unread-until-actioned; only an explicit mark-actioned clears it. */
export function isUnreadUntilActioned(n: Pick<NotificationRow, "read_state" | "actioned_at">): boolean {
  return n.read_state !== "actioned" || n.actioned_at === null;
}

// ── the two pinned protective banners (computed independently of the list fetch) ────────────────────
export interface BannerInputs {
  alertEngineStalled: boolean; // AC-7.ALR.008.2 — the alert engine watching itself
  hasUnroutableAlert: boolean; // AC-7.ALR.009.1 — an alert with no delivery target
}

export interface Banner {
  id: "alert-engine-stalled" | "unroutable-alert";
  severity: "critical";
  message: string;
}

/**
 * The protective banners that pin above ALL content. They are computed from the watchdog/routing signals
 * directly, NOT from the alert-list fetch, so a failed list load never hides them (#3). Returns them in a
 * stable order (stalled first — a stalled engine means the list itself may be untrustworthy).
 */
export function protectiveBanners(i: BannerInputs): Banner[] {
  const banners: Banner[] = [];
  if (i.alertEngineStalled) {
    banners.push({
      id: "alert-engine-stalled",
      severity: "critical",
      message: "Alert engine stalled — alerts may be delayed or missing. Do not trust an 'all clear' (AC-7.ALR.008.2).",
    });
  }
  if (i.hasUnroutableAlert) {
    banners.push({
      id: "unroutable-alert",
      severity: "critical",
      message: "An alert has no delivery target and could not be routed — surfaced here so it never fails silently (AC-7.ALR.009.1).",
    });
  }
  return banners;
}

// ── durability: the in-app record is authoritative, independent of Slack/push ──────────────────────
export interface DeliveryOutcome {
  channel: "slack" | "push";
  ok: boolean;
  detail: string;
}

export interface AlertCentreRow {
  row: NotificationRow;
  deliveryFailures: DeliveryOutcome[]; // surfaced on the card, never hidden (AC-7.ALR.006.2)
}

/**
 * AC-7.ALR.006.1/.2 — compose the notification-centre view from the persisted rows + the (best-effort)
 * delivery outcomes. The rows are ALWAYS present regardless of delivery: a Slack/push failure NEVER removes a
 * row (#1); a failed delivery is attached to the row so it is surfaced, not dropped (#3). `deliveries` maps a
 * notification id → its per-channel outcomes.
 */
export function composeAlertCentre(
  rows: readonly NotificationRow[],
  deliveries: ReadonlyMap<string, DeliveryOutcome[]>,
): AlertCentreRow[] {
  return rows.map((row) => ({
    row: { ...row },
    deliveryFailures: (deliveries.get(row.id) ?? []).filter((d) => !d.ok),
  }));
}
