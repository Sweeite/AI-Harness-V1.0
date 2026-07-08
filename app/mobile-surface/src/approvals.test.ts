// ISSUE-079 — FR-6.APR.003 / FR-6.ESC.003 / FR-1.RST.003 the approval path on mobile.
import { test } from "node:test";
import assert from "node:assert/strict";
import { approve, reject, holdForReview, resolveEscalation, type HeldAction } from "./approvals.ts";

const soft: HeldAction = { taskId: "t1", tier: "reversible_soft", restricted: false };
const hard: HeldAction = { taskId: "t2", tier: "hard_approval", restricted: false };
const restricted: HeldAction = { taskId: "t3", tier: "hard_approval", restricted: true };

// ── AC-6.APR.003.3 — hold-for-review promotes a soft item to explicit approval, stopping the auto-run ──
test("AC-6.APR.003.3 — hold-for-review stops the reversible-soft auto-run", () => {
  assert.deepEqual(holdForReview(soft), { action: "hold_stop_autorun", taskId: "t1" });
  assert.throws(() => holdForReview(hard), /reversible_soft/); // no auto-run to stop on a hard-approval
});

// ── AC-6.ESC.003.1 — Approve resumes; Modify degrades to desktop ──
test("AC-6.ESC.003.1 — Approve resumes the pipeline; Modify degrades to the desktop editor", () => {
  assert.deepEqual(resolveEscalation(hard, "approve"), { action: "run_pipeline", taskId: "t2" });
  const mod = resolveEscalation(hard, "modify");
  assert.equal(mod.action, "degrade_to_desktop");
  assert.equal(mod.action === "degrade_to_desktop" && mod.surface, "surface-04");
  const rej = resolveEscalation(hard, "reject", "not now");
  assert.equal(rej.action, "reject");
});

test("reject requires a mandatory reason (#3 — no silent reject)", () => {
  assert.throws(() => reject(hard, "   "), /mandatory reason/);
  assert.equal(reject(hard, "wrong target").action, "reject");
});

// ── AC-1.RST.003.1 — Restricted content is not auto-injected; an explicit audited reveal is required first ──
test("AC-1.RST.003.1 — approving a Restricted action requires the audited reveal first", () => {
  // not yet revealed → reveal_required, not run_pipeline
  assert.deepEqual(approve(restricted, false), { action: "reveal_required", taskId: "t3" });
  // after the explicit reveal → runs the identical pipeline
  assert.deepEqual(approve(restricted, true), { action: "run_pipeline", taskId: "t3" });
  // a non-restricted action never needs a reveal
  assert.deepEqual(approve(hard, false), { action: "run_pipeline", taskId: "t2" });
});

test("AC-1.RST.003.1 — Approve via escalation on un-revealed Restricted content still requires reveal", () => {
  assert.deepEqual(resolveEscalation(restricted, "approve"), { action: "reveal_required", taskId: "t3" });
});

// ── regression: an escalation-Approve on ALREADY-revealed Restricted content must proceed, not dead-end ──
// Previously resolveEscalation passed `!held.restricted` (always false for Restricted), so a legitimately
// revealed Restricted item looped back to reveal_required forever. The reveal state is now threaded through.
test("resolveEscalation threads the reveal state — revealed Restricted content resumes the pipeline", () => {
  // un-threaded default is fail-safe (still requires reveal)
  assert.deepEqual(resolveEscalation(restricted, "approve"), { action: "reveal_required", taskId: "t3" });
  // explicitly revealed → runs the identical pipeline (no dead-end)
  assert.deepEqual(resolveEscalation(restricted, "approve", undefined, true), { action: "run_pipeline", taskId: "t3" });
  // a non-restricted item ignores the reveal flag entirely
  assert.deepEqual(resolveEscalation(hard, "approve", undefined, false), { action: "run_pipeline", taskId: "t2" });
});
