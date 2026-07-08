// ISSUE-079 — FR-7.ALR.001/002/006/008/009 the mobile Alerts / notification centre.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isSuppressibleAlert,
  isUnreadUntilActioned,
  protectiveBanners,
  composeAlertCentre,
  type DeliveryOutcome,
} from "./alerts.ts";
import type { NotificationRow } from "./store.ts";

const rows: NotificationRow[] = [
  { id: "n1", type: "hard_limit_hit", severity: "critical", title: "Hard limit hit", read_state: "unread", actioned_at: null },
  { id: "n2", type: "queue_backup", severity: "warning", title: "Queue backing up", read_state: "read", actioned_at: null },
];

// ── AC-7.ALR.001.1 — the notification centre is primary/persistent (all rows present) ──
test("AC-7.ALR.001.1 — the notification centre renders every persisted row (primary/persistent)", () => {
  const centre = composeAlertCentre(rows, new Map());
  assert.equal(centre.length, 2);
  assert.deepEqual(centre.map((c) => c.row.id), ["n1", "n2"]);
});

// ── AC-7.ALR.001.2 — a row is unread-until-actioned ──
test("AC-7.ALR.001.2 — a row stays unread until explicitly actioned", () => {
  assert.equal(isUnreadUntilActioned({ read_state: "unread", actioned_at: null }), true);
  assert.equal(isUnreadUntilActioned({ read_state: "read", actioned_at: null }), true); // read ≠ actioned
  assert.equal(isUnreadUntilActioned({ read_state: "actioned", actioned_at: "t" }), false);
});

// ── AC-7.ALR.002.2 — the hard-limit alert is non-suppressible ──
test("AC-7.ALR.002.2 — a hard-limit alert is non-suppressible; other types may be suppressed", () => {
  assert.equal(isSuppressibleAlert("hard_limit_hit"), false);
  assert.equal(isSuppressibleAlert("queue_backup"), true);
});

// ── AC-7.ALR.006.1 — the dashboard record survives a Slack/push outage ──
// ── AC-7.ALR.006.2 — a failed delivery is surfaced, not dropped ──
test("AC-7.ALR.006.1/.2 — a Slack/push outage keeps every row and surfaces the failure", () => {
  const deliveries = new Map<string, DeliveryOutcome[]>([
    ["n1", [{ channel: "slack", ok: false, detail: "slack 503" }, { channel: "push", ok: false, detail: "no subscription" }]],
  ]);
  const centre = composeAlertCentre(rows, deliveries);
  assert.equal(centre.length, 2, "rows survive regardless of delivery (#1)");
  const n1 = centre.find((c) => c.row.id === "n1")!;
  assert.equal(n1.deliveryFailures.length, 2, "failed deliveries are surfaced on the row (#3)");
  const n2 = centre.find((c) => c.row.id === "n2")!;
  assert.equal(n2.deliveryFailures.length, 0);
});

// ── AC-7.ALR.008.2 — the alert-engine-stalled banner pins ──
// ── AC-7.ALR.009.1 — the unroutable-alert banner pins ──
test("AC-7.ALR.008.2 / AC-7.ALR.009.1 — the two protective banners pin when active", () => {
  const both = protectiveBanners({ alertEngineStalled: true, hasUnroutableAlert: true });
  assert.deepEqual(both.map((b) => b.id), ["alert-engine-stalled", "unroutable-alert"]);
  assert.ok(both.every((b) => b.severity === "critical"));

  const none = protectiveBanners({ alertEngineStalled: false, hasUnroutableAlert: false });
  assert.equal(none.length, 0);

  const stalledOnly = protectiveBanners({ alertEngineStalled: true, hasUnroutableAlert: false });
  assert.deepEqual(stalledOnly.map((b) => b.id), ["alert-engine-stalled"]);
});
