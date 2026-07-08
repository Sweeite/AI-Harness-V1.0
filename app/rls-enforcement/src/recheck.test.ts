// ISSUE-020 — FR-1.RLS.007 / NFR-SEC.012 mid-task authorization re-check, one test per AC.
import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryRlsEnforcementStore, EVT_AUTHZ_REVOKED_MIDTASK } from "./store.ts";
import { reevaluate, guardBoundary, type ReliedOn, type TaskContext, type Boundary } from "./recheck.ts";

const RELIED_ON: ReliedOn = {
  clearances: [{ tier: "confidential", entityTypeScope: "finance" }],
  restricted: [{ entityId: "ent-1", entityType: null }],
};

function task(overrides: Partial<TaskContext> = {}): TaskContext {
  return {
    taskId: "task-1",
    serviceRoleIdentity: "memory-agent",
    originatingUserId: "user-1",
    reliedOn: RELIED_ON,
    ...overrides,
  };
}

const CONSEQUENTIAL: Boundary = { consequential: true, describe: "send external email" };
const BENIGN: Boundary = { consequential: false, describe: "internal reasoning step" };

function activeUser(store: InMemoryRlsEnforcementStore) {
  store.setUser({
    userId: "user-1",
    active: true,
    clearances: [{ tier: "confidential", entityTypeScope: "finance" }],
    restricted: [{ entityId: "ent-1", entityType: null }],
  });
}

// ── AC-1.RLS.007.1 — deactivation mid-run halts + quarantines at the next consequential boundary ──
test("AC-1.RLS.007.1 — a deactivated originating user is halted + quarantined before the consequential side effect", async () => {
  const store = new InMemoryRlsEnforcementStore();
  activeUser(store);
  store.setUser({ userId: "user-1", active: false, clearances: RELIED_ON.clearances, restricted: RELIED_ON.restricted });

  const out = await guardBoundary(store, task(), CONSEQUENTIAL);
  assert.equal(out.action, "halt_and_quarantine");
  assert.equal(out.reeval.stopReason, "deactivated");
  // both loud sinks written (#3) — the side effect never ran (#1: quarantined, not dropped).
  assert.equal(store.events.length, 1);
  assert.equal(store.events[0]!.eventType, EVT_AUTHZ_REVOKED_MIDTASK);
  assert.equal(store.audits.length, 1);
  assert.equal(store.audits[0]!.originatingUserId, "user-1");
});

// ── AC-1.RLS.007.2 — a revoked relied-on clearance stops the task acting on now-forbidden content ──
test("AC-1.RLS.007.2 — a revoked relied-on clearance halts before the task acts on the forbidden content", async () => {
  const store = new InMemoryRlsEnforcementStore();
  // still active, but the confidential/finance clearance the task relies on is gone.
  store.setUser({ userId: "user-1", active: true, clearances: [], restricted: RELIED_ON.restricted });

  const out = await guardBoundary(store, task(), CONSEQUENTIAL);
  assert.equal(out.action, "halt_and_quarantine");
  assert.equal(out.reeval.stopReason, "clearance_revoked");
  assert.equal(store.events[0]!.eventType, EVT_AUTHZ_REVOKED_MIDTASK);
});

test("a revoked Restricted grant halts the task (restricted_revoked)", async () => {
  const store = new InMemoryRlsEnforcementStore();
  store.setUser({ userId: "user-1", active: true, clearances: RELIED_ON.clearances, restricted: [] });
  const out = await guardBoundary(store, task(), CONSEQUENTIAL);
  assert.equal(out.action, "halt_and_quarantine");
  assert.equal(out.reeval.stopReason, "restricted_revoked");
});

// ── AC-1.RLS.007.3 / NFR-SEC.012.2 — a benign session expiry continues (expiry ≠ revocation) ──
test("AC-1.RLS.007.3 — a merely-expired session (still active + grants held) continues", async () => {
  const store = new InMemoryRlsEnforcementStore();
  activeUser(store); // authorization DATA unchanged — expiry does not touch it
  const out = await guardBoundary(store, task(), CONSEQUENTIAL);
  assert.equal(out.action, "proceed");
  assert.equal(out.reeval.authorized, true);
  assert.equal(store.events.length, 0); // nothing logged — it was authorized
});

// ── NFR-SEC.012.1 — the stop happens BEFORE the side effect; a non-consequential boundary defers ──
test("NFR-SEC.012.1 — an unauthorized task at a NON-consequential boundary proceeds (stop deferred to the next consequential one), so no side effect leaks", async () => {
  const store = new InMemoryRlsEnforcementStore();
  store.setUser({ userId: "user-1", active: false, clearances: [], restricted: [] });

  const benign = await guardBoundary(store, task(), BENIGN);
  assert.equal(benign.action, "proceed"); // no side effect at a benign boundary
  assert.equal(benign.reeval.authorized, false); // ...but the loss of authorization is visible
  assert.equal(store.events.length, 0); // not quarantined yet — no consequential effect attempted

  const consequential = await guardBoundary(store, task(), CONSEQUENTIAL);
  assert.equal(consequential.action, "halt_and_quarantine"); // stopped at the consequential boundary
  assert.equal(store.events.length, 1);
});

// ── fail-closed (#2): an unknown / unreadable user is treated as deactivated ──
test("fail-closed — an unknown originating user re-evaluates as NOT authorized", () => {
  const r = reevaluate(null, RELIED_ON);
  assert.equal(r.authorized, false);
  assert.equal(r.stopReason, "deactivated");
});

// ── the pure rule: a Global-scoped clearance subsumes a relied-on entity-type-scoped need ──
test("reevaluate — a Global (null-scope) clearance hold covers a scoped relied-on clearance", () => {
  const r = reevaluate(
    { userId: "u", active: true, clearances: [{ tier: "confidential", entityTypeScope: null }], restricted: [{ entityId: "ent-1", entityType: null }] },
    RELIED_ON,
  );
  assert.equal(r.authorized, true);
});

test("reevaluate — a narrower held scope does NOT cover a different relied-on scope", () => {
  const r = reevaluate(
    { userId: "u", active: true, clearances: [{ tier: "confidential", entityTypeScope: "hr" }], restricted: RELIED_ON.restricted },
    RELIED_ON,
  );
  assert.equal(r.authorized, false);
  assert.equal(r.stopReason, "clearance_revoked");
});
