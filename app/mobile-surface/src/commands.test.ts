// ISSUE-079 — NFR-SEC.013 no-back-door + FR-9.CMD.002/003/004/005 + FR-9.MODE.003.
import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryMobileSurfaceStore } from "./store.ts";
import { dispatchCommand, quickTapMenu, nodePermitted, type CommandDef, type CallerContext, type Invocation } from "./commands.ts";

const safeCmd: CommandDef = { slug: "status", node: "PERM-dashboard.workspace", destructive: false, auditCritical: false, common: true };
const destructiveCmd: CommandDef = { slug: "disable-agent", node: "PERM-agent.manage", destructive: true, auditCritical: true, common: true };
const noNodeCmd: CommandDef = { slug: "mystery", node: null, destructive: false, auditCritical: false, common: true };

function caller(nodes: string[]): CallerContext {
  return { userId: "u1", heldNodes: new Set(nodes) };
}
const noop = async () => {};

// ── AC-9.CMD.002.1 — a permitted caller passes the per-command node gate and runs ──
test("AC-9.CMD.002.1 — a caller holding the mapped node runs the command", async () => {
  const store = new InMemoryMobileSurfaceStore();
  const r = await dispatchCommand(store, safeCmd, caller(["PERM-dashboard.workspace"]), "typed_slash", { runSideEffect: noop });
  assert.equal(r.outcome, "ran");
});

// ── AC-9.CMD.002.3 — a command with NO mapped node is denied ──
test("AC-9.CMD.002.3 — a command with no mapped node is denied (never an implicit allow)", async () => {
  const store = new InMemoryMobileSurfaceStore();
  const r = await dispatchCommand(store, noNodeCmd, caller(["PERM-dashboard.workspace"]), "typed_slash", { runSideEffect: noop });
  assert.equal(r.outcome, "denied");
  assert.equal(nodePermitted(noNodeCmd, caller(["anything"])), false);
});

// ── AC-9.CMD.003.3 / AC-NFR-SEC.013.2 — the gate runs BEFORE the confirm; a denied caller never sees confirm ──
test("AC-9.CMD.003.3 / AC-NFR-SEC.013.2 — an unauthorised destructive command is denied BEFORE the confirm dialog", async () => {
  const store = new InMemoryMobileSurfaceStore();
  let ran = false;
  const r = await dispatchCommand(store, destructiveCmd, caller(["PERM-dashboard.workspace"]), "typed_slash", {
    confirmed: true, // even a (spoofed) confirm can't get past the gate
    runSideEffect: async () => { ran = true; },
  });
  assert.equal(r.outcome, "denied");
  assert.equal(ran, false, "the side effect must never run for a denied caller");
});

test("a permitted destructive command needs confirm (gate first, then confirm — not instead of)", async () => {
  const store = new InMemoryMobileSurfaceStore();
  const authed = caller(["PERM-agent.manage"]);
  const needs = await dispatchCommand(store, destructiveCmd, authed, "typed_slash", { runSideEffect: noop });
  assert.equal(needs.outcome, "needs_confirm");
  const done = await dispatchCommand(store, destructiveCmd, authed, "typed_slash", { confirmed: true, runSideEffect: noop });
  assert.equal(done.outcome, "ran");
});

// ── AC-9.CMD.004.3 — an audit-critical command fails CLOSED when the event_log write fails ──
test("AC-9.CMD.004.3 — an audit-critical command fails closed when the audit log write fails (side effect NOT run)", async () => {
  const store = new InMemoryMobileSurfaceStore();
  store.failEventLog = true;
  let ran = false;
  const r = await dispatchCommand(store, destructiveCmd, caller(["PERM-agent.manage"]), "typed_slash", {
    confirmed: true,
    runSideEffect: async () => { ran = true; },
  });
  assert.equal(r.outcome, "failed_closed");
  assert.equal(ran, false, "act-then-fail-to-record is a #3 violation — the side effect must not run");
});

// ── AC-9.CMD.005.1 — the quick-tap menu shows only the node-permitted common commands ──
test("AC-9.CMD.005.1 — the quick-tap menu shows only node-permitted common commands", () => {
  const catalog = [safeCmd, destructiveCmd, noNodeCmd, { ...safeCmd, slug: "rare", common: false }];
  const menu = quickTapMenu(catalog, caller(["PERM-dashboard.workspace"]));
  assert.deepEqual(menu.map((c) => c.slug), ["status"]); // destructive lacks node, noNode denied, rare not common
});

// ── AC-9.MODE.003.1 — proactive/act traverses the SAME C6 pipeline (same gate for every invocation type) ──
test("AC-9.MODE.003.1 / AC-NFR-SEC.013.1 — typed_slash, quick_tap, inline_suggestion run the IDENTICAL gate", async () => {
  const invocations: Invocation[] = ["typed_slash", "quick_tap", "inline_suggestion"];
  for (const inv of invocations) {
    const store = new InMemoryMobileSurfaceStore();
    // unauthorised → denied identically regardless of entry point (no quick-tap/suggestion bypass, #2)
    const denied = await dispatchCommand(store, safeCmd, caller([]), inv, { runSideEffect: noop });
    assert.equal(denied.outcome, "denied", `${inv} must be gated identically`);
    // authorised → runs identically
    const ran = await dispatchCommand(store, safeCmd, caller(["PERM-dashboard.workspace"]), inv, { runSideEffect: noop });
    assert.equal(ran.outcome, "ran", `${inv} must run once permitted`);
  }
});

// ── AC-9.MODE.003.2 — a hard-limit halt in the C6 pipeline stops the act path (mobile is not exempt) ──
test("AC-9.MODE.003.2 — a hard-limit halt raised by the C6 pipeline stops the mobile act path (no false 'ran')", async () => {
  const store = new InMemoryMobileSurfaceStore();
  await assert.rejects(
    dispatchCommand(store, { ...safeCmd, slug: "act" }, caller(["PERM-dashboard.workspace"]), "inline_suggestion", {
      runSideEffect: async () => { throw new Error("C6 hard-limit halt"); },
    }),
    /hard-limit halt/,
  );
});
