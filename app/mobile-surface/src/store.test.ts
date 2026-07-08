// ISSUE-079 — the InMemoryMobileSurfaceStore reference semantics (the live pg adapter must match 1:1, R10).
import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryMobileSurfaceStore, MobileError, ERR_AUDIT_LOG_FAILED, type NotificationRow } from "./store.ts";

const sub = { userId: "u1", endpoint: "https://push.example/abc", keys: { p256dh: "k" }, platform: "web" };

test("push_subscriptions: register then list; a re-register from the same device upserts (no duplicate)", async () => {
  const store = new InMemoryMobileSurfaceStore();
  const first = await store.registerPushSubscription(sub);
  const again = await store.registerPushSubscription({ ...sub, platform: "web-updated" });
  assert.equal(first.id, again.id, "same (user, endpoint) upserts to one row (unique constraint)");
  const list = await store.listPushSubscriptions("u1");
  assert.equal(list.length, 1);
  assert.equal(list[0]!.platform, "web-updated");
});

test("push_subscriptions: an empty endpoint throws (a failed registration is never a silent 'on' — #3)", async () => {
  const store = new InMemoryMobileSurfaceStore();
  await assert.rejects(store.registerPushSubscription({ ...sub, endpoint: "" }), MobileError);
});

test("appendEventLog fails loud when the sink is down (drives the fail-closed command dispatch)", async () => {
  const store = new InMemoryMobileSurfaceStore();
  store.failEventLog = true;
  await assert.rejects(
    store.appendEventLog({ eventType: "tool_called", entityIds: [], summary: "x", payload: {} }),
    (e) => e instanceof MobileError && e.code === ERR_AUDIT_LOG_FAILED,
  );
});

test("markNotificationActioned flips read_state and stamps actioned_at; a missing row fails loud", async () => {
  const store = new InMemoryMobileSurfaceStore();
  const rows: NotificationRow[] = [{ id: "n1", type: "queue_backup", severity: "warning", title: "t", read_state: "unread", actioned_at: null }];
  store.seedNotifications(rows);
  await store.markNotificationActioned("n1");
  const after = await store.listNotifications("u1");
  assert.equal(after[0]!.read_state, "actioned");
  assert.ok(after[0]!.actioned_at);
  await assert.rejects(store.markNotificationActioned("nope"), MobileError);
});

test("homeActiveAlertCount counts non-actioned rows; activity read round-trips", async () => {
  const store = new InMemoryMobileSurfaceStore();
  store.seedNotifications([
    { id: "n1", type: "queue_backup", severity: "warning", title: "t", read_state: "unread", actioned_at: null },
    { id: "n2", type: "queue_backup", severity: "warning", title: "t", read_state: "actioned", actioned_at: "x" },
  ]);
  assert.equal(await store.homeActiveAlertCount("u1"), 1);
  store.seedActivity([{ id: "e1", summary: "did a thing", eventType: "tool_called", answerMode: null, createdAt: "t" }]);
  const act = await store.listActivity("u1");
  assert.equal(act.length, 1);
  assert.equal(act[0]!.answerMode, null); // an unresolved pill stays null → resolvePill renders "mode unknown"
});
