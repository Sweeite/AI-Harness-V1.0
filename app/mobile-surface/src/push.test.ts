// ISSUE-079 — FR-7.VIEW.003 the mobile web-push contract.
import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryMobileSurfaceStore } from "./store.ts";
import {
  classifyPush,
  isSuppressible,
  registerPush,
  pushSettingsView,
  CFG_APPROVAL_PUSH_FREQUENCY_MINUTES,
  CFG_STALE_QUEUE_PUSH_HOURS,
} from "./push.ts";

const goodSub = { userId: "u1", endpoint: "https://push.example/abc", keys: { p256dh: "k", auth: "a" }, platform: "web" };

// ── AC-7.VIEW.003.1 — hard-limit + critical are immediate AND non-suppressible ──
test("AC-7.VIEW.003.1 — hard-limit + critical push are immediate and non-suppressible", () => {
  for (const cls of ["hard_limit", "critical"] as const) {
    const t = classifyPush(cls);
    assert.equal(t.kind, "immediate");
    assert.equal(t.suppressible, false);
    assert.equal(isSuppressible(cls), false, `${cls} must never be user-suppressible`);
  }
});

// ── AC-7.VIEW.003.2 — approval push frequencies are configurable (drive off the LIVE config keys) ──
test("AC-7.VIEW.003.2 — pending/stale approval pushes are configurable off the LIVE config keys", () => {
  const pending = classifyPush("pending_approval");
  assert.equal(pending.kind, "configurable");
  assert.equal(pending.suppressible, true);
  assert.equal(pending.kind === "configurable" && pending.configKey, CFG_APPROVAL_PUSH_FREQUENCY_MINUTES);

  const stale = classifyPush("stale_approval_queue");
  assert.equal(stale.kind, "configurable");
  assert.equal(stale.kind === "configurable" && stale.configKey, CFG_STALE_QUEUE_PUSH_HOURS);

  const view = pushSettingsView(30, 4);
  assert.equal(view.approvalPushFrequencyMinutes, 30);
  assert.equal(view.staleQueuePushHours, 4);
  // the non-suppressible classes are shown so the user knows they can't be turned off
  assert.ok(view.nonSuppressible.includes("hard_limit"));
  assert.ok(view.nonSuppressible.includes("critical"));
});

// ── registration truthfulness (#3) — a failed registration reads "push not enabled", never a false "on" ──
test("a successful registration reads push enabled with the subscription id", async () => {
  const store = new InMemoryMobileSurfaceStore();
  const res = await registerPush(store, goodSub);
  assert.equal(res.enabled, true);
  assert.ok(res.enabled && res.subscriptionId.length > 0);
  assert.equal((await store.listPushSubscriptions("u1")).length, 1);
});

test("a failed registration reads 'push not enabled' (never a false 'on') — #3", async () => {
  const store = new InMemoryMobileSurfaceStore();
  store.failNextRegistration = true;
  const res = await registerPush(store, goodSub);
  assert.equal(res.enabled, false);
  assert.ok(res.enabled === false && /failed/i.test(res.reason));
});

test("a registration returning no endpoint is NOT enabled (#3)", async () => {
  const store = new InMemoryMobileSurfaceStore();
  const res = await registerPush(store, { ...goodSub, endpoint: "" });
  assert.equal(res.enabled, false);
});
