// ⚠️ TEMPORARY — OD-173 Wait-for-CI live spike (ISSUE-080 capstone). This test DELIBERATELY FAILS to
// turn the service job RED, so we can prove Railway's "Wait for CI" gate BLOCKS the canary deploy of a
// build whose own suite is red (the #3 hazard: a broken build must never silently roll forward). This
// file is reverted immediately after the block is observed — it must not survive the spike.
import { test } from "node:test";
import assert from "node:assert/strict";

test("SPIKE (intentional failure) — a red own-suite must block the canary deploy", () => {
  assert.equal("this-build-is-broken", "ok", "intentional spike failure — see file header");
});
