// ISSUE-079 — FR-9.SUG.004 / FR-9.SUG.005 proactive suggestions on mobile.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isDeliveredTo, inlineSuggestionsFor, dismissSuggestion, type Suggestion } from "./suggestions.ts";

const mine: Suggestion = { id: "s1", recipientId: "u1", isFloor: false, riskType: null };
const theirs: Suggestion = { id: "s2", recipientId: "u2", isFloor: false, riskType: null };
const floor: Suggestion = { id: "s3", recipientId: "u1", isFloor: true, riskType: "hard_limit" };

// ── AC-9.SUG.004.1 — a suggestion is delivered/routed to the correct owner (incl. mobile) ──
test("AC-9.SUG.004.1 — a suggestion reaches only its resolved owner on mobile", () => {
  assert.equal(isDeliveredTo(mine, "u1"), true);
  assert.equal(isDeliveredTo(theirs, "u1"), false);
  assert.deepEqual(inlineSuggestionsFor([mine, theirs, floor], "u1").map((s) => s.id), ["s1", "s3"]);
});

// ── AC-9.SUG.005.3 — dismissal never drives a hard-risk class below the floor ──
test("AC-9.SUG.005.3 — a safety-floor suggestion cannot be dismissed away on mobile", () => {
  const refused = dismissSuggestion(floor);
  assert.equal(refused.dismissed, false);
  assert.ok(refused.dismissed === false && /floor/i.test(refused.reason));

  const ok = dismissSuggestion(mine);
  assert.equal(ok.dismissed, true);
});
