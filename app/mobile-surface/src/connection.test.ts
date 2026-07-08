// ISSUE-079 — FR-7.RTP.001/004 + NFR-OBS.011.2 the two-Realtime cap + the honest indicator.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  REALTIME_SURFACES,
  isRealtimeSurface,
  pollsOnly,
  connectionState,
  canEnableActions,
  teardownPlan,
  type MobileSurfaceId,
} from "./connection.ts";

// ── AC-7.RTP.001.1/.2 — Approvals + Alerts are the two live surfaces ──
test("AC-7.RTP.001.1/.2 — Approvals + Alerts are the two Realtime surfaces", () => {
  assert.equal(isRealtimeSurface("UI-MOBILE-APPROVALS"), true);
  assert.equal(isRealtimeSurface("UI-MOBILE-ALERTS"), true);
  assert.equal(REALTIME_SURFACES.length, 2);
  assert.deepEqual(
    REALTIME_SURFACES.map((r) => r.table).sort(),
    ["notifications", "task_queue"],
  );
});

// ── AC-7.RTP.001.3 — no third socket; chat + every other surface polls ──
test("AC-7.RTP.001.3 — no third socket: chat/home/activity/command-menu poll", () => {
  const pollers: MobileSurfaceId[] = ["UI-MOBILE-HOME", "UI-MOBILE-CHAT", "UI-MOBILE-ACTIVITY", "UI-MOBILE-COMMAND-MENU"];
  for (const s of pollers) {
    assert.equal(pollsOnly(s), true, `${s} must poll, not hold a socket`);
    assert.equal(isRealtimeSurface(s), false);
  }
  // exactly two surfaces are Realtime — the cap
  const all: MobileSurfaceId[] = [
    "UI-MOBILE-HOME", "UI-MOBILE-APPROVALS", "UI-MOBILE-ACTIVITY", "UI-MOBILE-CHAT", "UI-MOBILE-COMMAND-MENU", "UI-MOBILE-ALERTS",
  ];
  assert.equal(all.filter(isRealtimeSurface).length, 2);
});

// ── AC-7.RTP.004.1 — teardown on unmount ──
test("AC-7.RTP.004.1 — teardown closes the socket on a Realtime surface, clears the timer on a poller", () => {
  assert.deepEqual(teardownPlan("UI-MOBILE-APPROVALS"), { closeSocket: true, clearPollTimer: false });
  assert.deepEqual(teardownPlan("UI-MOBILE-CHAT"), { closeSocket: false, clearPollTimer: true });
});

// ── AC-7.RTP.004.2 — the indicator is honest; a connected-but-stale socket is NOT "live" ──
test("AC-7.RTP.004.2 — a connected-but-frozen socket reads Reconnecting, never Live (the 0023 lesson, #3)", () => {
  assert.equal(connectionState({ socketOpen: true, heartbeatFresh: true, online: true, realtime: true }), "live");
  // socket open but no heartbeat → NOT live
  assert.equal(connectionState({ socketOpen: true, heartbeatFresh: false, online: true, realtime: true }), "reconnecting");
  assert.equal(connectionState({ socketOpen: false, heartbeatFresh: false, online: true, realtime: true }), "reconnecting");
  assert.equal(connectionState({ socketOpen: false, heartbeatFresh: false, online: false, realtime: true }), "offline");
  assert.equal(connectionState({ socketOpen: false, heartbeatFresh: false, online: true, realtime: false }), "polling");
});

// ── AC-7.RTP.004.2 / AC-NFR-OBS.011.2 — re-fetch before re-enabling actions on reconnect ──
test("AC-NFR-OBS.011.2 — actions stay disabled until a re-fetch completes after reconnect", () => {
  // reconnecting / offline → never enable
  assert.equal(canEnableActions("reconnecting", true), false);
  assert.equal(canEnableActions("offline", true), false);
  // back to live but NOT yet re-fetched → still disabled (no blind approve against a stale queue)
  assert.equal(canEnableActions("live", false), false);
  // live AND re-fetched → enabled
  assert.equal(canEnableActions("live", true), true);
  assert.equal(canEnableActions("polling", true), true);
});
