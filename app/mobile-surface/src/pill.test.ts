// ISSUE-079 — AC-7.VIEW.002.2 / FR-4.CID.006 the answer-mode pill.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePill, PILL_UNRESOLVED } from "./pill.ts";

// ── AC-7.VIEW.002.2 — the pill on every AI output; an unresolved pill reads "mode unknown", never "Cited" ──
test("AC-7.VIEW.002.2 — each stored answer_mode resolves to its label", () => {
  assert.deepEqual(resolvePill("cited"), { label: "Cited", resolved: true });
  assert.deepEqual(resolvePill("inferred"), { label: "Inferred", resolved: true });
  assert.deepEqual(resolvePill("unknown"), { label: "Unknown", resolved: true });
  assert.deepEqual(resolvePill("building"), { label: "Building", resolved: true });
});

test("AC-7.VIEW.002.2 — an unresolved pill (null/absent/garbage) reads 'mode unknown', never silently 'Cited' (#3)", () => {
  for (const bad of [null, undefined, "", "citedd", "true"]) {
    const r = resolvePill(bad as string | null | undefined);
    assert.equal(r.label, PILL_UNRESOLVED);
    assert.equal(r.resolved, false);
    assert.notEqual(r.label, "Cited");
  }
});
