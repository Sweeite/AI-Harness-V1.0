// ISSUE-020 — FR-1.RLS.008 divergence signal (AC-1.RLS.008.1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryRlsEnforcementStore, EVT_RLS_HARNESS_DIVERGENCE } from "./store.ts";
import { isDivergent, checkAndLogDivergence } from "./divergence.ts";

// ── AC-1.RLS.008.1 — harness permitted but RLS returned zero rows → a divergence event is logged ──
test("AC-1.RLS.008.1 — a harness-permitted read that RLS returns as zero rows logs an rls_harness_divergence event", async () => {
  const store = new InMemoryRlsEnforcementStore();
  const res = await checkAndLogDivergence(store, {
    harnessPermitted: true,
    rlsRowCount: 0,
    resource: "memories",
    actingUserId: "user-1",
  });
  assert.equal(res.divergent, true);
  assert.equal(store.events.length, 1);
  assert.equal(store.events[0]!.eventType, EVT_RLS_HARNESS_DIVERGENCE);
  assert.equal(store.events[0]!.payload.resource, "memories");
});

test("no divergence when harness and RLS agree (permitted + rows returned)", async () => {
  const store = new InMemoryRlsEnforcementStore();
  const res = await checkAndLogDivergence(store, { harnessPermitted: true, rlsRowCount: 5, resource: "memories", actingUserId: "u" });
  assert.equal(res.divergent, false);
  assert.equal(store.events.length, 0); // the empty-vs-nonempty distinction is honest — no false signal
});

test("no divergence when the harness itself denied (RLS zero rows agrees with the deny)", async () => {
  const store = new InMemoryRlsEnforcementStore();
  const res = await checkAndLogDivergence(store, { harnessPermitted: false, rlsRowCount: 0, resource: "memories", actingUserId: "u" });
  assert.equal(res.divergent, false);
  assert.equal(store.events.length, 0);
});

test("isDivergent is the pure predicate — only permitted+zero is divergent", () => {
  assert.equal(isDivergent({ harnessPermitted: true, rlsRowCount: 0 }), true);
  assert.equal(isDivergent({ harnessPermitted: true, rlsRowCount: 1 }), false);
  assert.equal(isDivergent({ harnessPermitted: false, rlsRowCount: 0 }), false);
});
