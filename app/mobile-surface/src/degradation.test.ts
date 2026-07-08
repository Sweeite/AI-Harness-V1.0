// ISSUE-079 — OD-152 / NFR-SEC.013 the out-of-scope-on-mobile boundary.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEGRADED_CAPABILITIES, isDegradedOnMobile, degradeNotice } from "./degradation.ts";

// ── OD-152 — every deep-management action renders an explicit notice, never a silent omission ──
test("OD-152 — each degraded capability renders an explicit 'open on a wider display' notice", () => {
  for (const d of DEGRADED_CAPABILITIES) {
    const notice = degradeNotice(d.capability);
    assert.equal(notice.degraded, true);
    assert.equal(notice.surface, d.surface);
    assert.match(notice.message, /open on a wider display/i);
    assert.ok(notice.surface.length > 0, "a notice must point at a real desktop surface (never nowhere)");
  }
});

test("OD-152 — the eight deep-management capabilities are all gated off mobile", () => {
  const caps = DEGRADED_CAPABILITIES.map((d) => d.capability).sort();
  assert.deepEqual(caps, [
    "agent_capability_edit",
    "approval_modify",
    "config_edit",
    "conflict_consolidation_resolution",
    "custom_command_authoring",
    "fleet_actions",
    "memory_mutation",
    "permission_matrix_edit",
  ]);
});

// ── NFR-SEC.013 — a retained (low-risk) action is NOT degraded; synthesising a notice for it is refused ──
test("NFR-SEC.013 — a retained action (approve/disable/verify) is not a degraded capability", () => {
  assert.equal(isDegradedOnMobile("approval_approve"), false);
  assert.equal(isDegradedOnMobile("agent_disable"), false);
  assert.throws(() => degradeNotice("approval_approve"), /not a mobile-degraded capability/);
});
