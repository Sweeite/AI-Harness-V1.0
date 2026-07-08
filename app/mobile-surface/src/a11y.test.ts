// ISSUE-079 — NFR-A11Y.001 the accessibility baseline (the logic-testable part: no colour-only status).
import { test } from "node:test";
import assert from "node:assert/strict";
import { statusToken, allStatusesLabelled, type StatusKind } from "./a11y.ts";

const KINDS: StatusKind[] = ["live", "reconnecting", "polling", "offline", "healthy", "cant_confirm", "critical", "unread"];

// ── AC-NFR-A11Y.001.2 — no status is conveyed by colour alone (every status has a label + a shape) ──
test("AC-NFR-A11Y.001.2 — every status carries a non-empty text label AND a non-colour shape token", () => {
  for (const k of KINDS) {
    const t = statusToken(k);
    assert.ok(t.label.trim().length > 0, `status '${k}' has no label`);
    assert.ok(t.shape.trim().length > 0, `status '${k}' has no shape (would be colour-only)`);
  }
  assert.equal(allStatusesLabelled(), true);
});

// ── AC-NFR-A11Y.001.1 — labelled controls: an unknown status throws rather than render colour-only chrome ──
test("AC-NFR-A11Y.001.1 — an unknown status token throws (never silently colour-only)", () => {
  assert.throws(() => statusToken("nope" as StatusKind), /never be colour-only|no a11y token/);
});

test("critical/offline statuses use an assertive aria-live (announced to a screen reader)", () => {
  assert.equal(statusToken("critical").ariaLive, "assertive");
  assert.equal(statusToken("offline").ariaLive, "assertive");
});
