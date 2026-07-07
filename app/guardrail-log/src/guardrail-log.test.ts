// ISSUE-060 — one test per AC in §4 Definition of done. Proved against the InMemory* reference model (offline;
// the live trigger/check-constraint proof is results/issue-060-capstone.sql, owed to the Stage-3 checkpoint).
//
// AC map (§4):
//   AC-6.LOG.001.1 — a row of EACH of the five types writes with the full schema + a valid guardrail_type; an
//                    out-of-set/blank type is rejected, not coerced.
//   AC-6.LOG.001.2 — `approved` is invalid for a hard_limit row — rejected at insert AND via resolution (the check
//                    constraint); hard_limit terminates at the recorded-block state.
//   AC-6.LOG.001.3 — `pending` covers ALL unresolved states, disambiguated by guardrail_type (not by status).
//   AC-6.LOG.002.1 — a delete / content-rewrite of a historical row is rejected; only the forward resolution
//                    transition is permitted, timestamped + attributed.
//   AC-6.LOG.003.1 — a block/flag/quarantine writes EXACTLY one row; the record + safe action are bound together.
//   AC-6.LOG.003.2 — an event lands in EXACTLY one of the three sinks (guardrail_log / access_audit / event_log).
//   AC-6.LOG.003.3 — a guardrail_log write FAILURE does NOT abandon the block; the lost row is escalated
//                    out-of-band (fail-CLOSED, #3).
//   AC-6.LOG.004.1 — an export contains the complete guardrail_log for the period, all five types, no gaps.
//   AC-6.FMM.001.1 — every guardrail-class failure produces a record + a surface (no fail-closed-and-silent path).
//   AC-6.FMM.001.2 — a home-owned failure-map row references its owner + C7 path and is NOT re-detected here.
//   AC-6.FMM.001.3 — a guardrail CHECK that itself errors fails closed — halts + flags + logs, never proceeds.
//   AC-6.OPT.001.1 — a tier-change candidate applies ONLY after explicit admin confirmation (no silent auto).
//   AC-6.OPT.001.2 — an un-actioned candidate persists / re-surfaces rather than silently vanishing.
//   AC-6.OPT.002.1 — a signal threshold may auto-tune, but a gate-altering baseline shift is admin-confirmed.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AppendOnlyViolation,
  buildBaseline,
  buildExport,
  catalogueEntryIsWellFormed,
  classifyThresholdChange,
  detectApprovalPattern,
  GUARDRAIL_TYPES,
  GuardrailWriter,
  HardLimitApprovalForbidden,
  InMemoryDegradedSink,
  InMemoryGuardrailLogStore,
  InMemoryQuarantineStore,
  InvalidGuardrailType,
  LearningLoop,
  reImplementsDetection,
  routeToSink,
  runGuardrailCheck,
  SilentAutoChangeForbidden,
  type FailureMapEntry,
  type GuardrailLogRow,
  type GuardrailType,
  type WriterClock,
} from "./index.ts";

// ── deterministic clock ───────────────────────────────────────────────────────────────────────────────
function fixedClock(startMs = Date.parse("2026-07-05T00:00:00.000Z")): WriterClock & { tick: () => void } {
  let t = startMs;
  let n = 0;
  return {
    now: () => new Date(t),
    newId: () => `id-${(++n).toString().padStart(4, "0")}`,
    tick: () => {
      t += 1000;
    },
  };
}

function makeWriter() {
  const store = new InMemoryGuardrailLogStore();
  const degraded = new InMemoryDegradedSink();
  const clock = fixedClock();
  const writer = new GuardrailWriter({ store, degraded, clock });
  return { store, degraded, clock, writer };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-6.LOG.001.1 — a row of each of the five types writes with the full schema + a valid guardrail_type
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("AC-6.LOG.001.1 — each of the five types writes a full-schema row; a blank/unknown type is rejected", async () => {
  const { store, writer } = makeWriter();
  assert.equal(GUARDRAIL_TYPES.length, 5, "there must be exactly five guardrail types");

  for (const t of GUARDRAIL_TYPES) {
    const res = await writer.record({ guardrail_type: t, description: `${t} fired`, action_blocked: true });
    assert.equal(res.logged, true);
    const row = res.row!;
    // Full schema present + server-owned fields correct.
    assert.equal(row.guardrail_type, t);
    assert.equal(row.status, "pending"); // every event begins unresolved
    assert.equal(row.reviewed_by, null);
    assert.equal(row.reviewed_at, null);
    assert.equal(row.escalated_at, null);
    assert.ok(row.id && row.created_at, "id + created_at are server-stamped");
  }
  const rows = await store.all();
  assert.equal(rows.length, 5);
  assert.deepEqual(new Set(rows.map((r) => r.guardrail_type)), new Set(GUARDRAIL_TYPES));

  // A blank/unknown type is REJECTED, not silently coerced to a valid one.
  const bogus: GuardrailLogRow = {
    id: "x",
    task_id: null,
    guardrail_type: "not_a_type" as GuardrailType,
    description: "d",
    action_blocked: true,
    status: "pending",
    reviewed_by: null,
    reviewed_at: null,
    escalated_at: null,
    created_at: "2026-07-05T00:00:00.000Z",
  };
  await assert.rejects(() => store.append(bogus), InvalidGuardrailType);
  // ...and the writer refuses a blank type before touching the store (loud, not coerced).
  await assert.rejects(
    () => writer.record({ guardrail_type: "" as GuardrailType, description: "d", action_blocked: true }),
    /invalid guardrail_type/,
  );
  assert.equal((await store.all()).length, 5, "no malformed row was written");
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-6.LOG.001.2 — `approved` is invalid for a hard_limit row (the check constraint), at insert AND resolve
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("AC-6.LOG.001.2 — a hard_limit row can never reach status=approved (insert or resolution)", async () => {
  const store = new InMemoryGuardrailLogStore();
  const base = {
    id: "hl-1",
    task_id: null,
    guardrail_type: "hard_limit" as GuardrailType,
    description: "spend cap hit",
    action_blocked: true,
    reviewed_by: null,
    reviewed_at: null,
    escalated_at: null,
    created_at: "2026-07-05T00:00:00.000Z",
  };
  // Direct insert with approved is rejected by the check constraint.
  await assert.rejects(
    () => store.append({ ...base, status: "approved" }),
    HardLimitApprovalForbidden,
  );
  // A hard_limit row inserted as pending cannot then be RESOLVED to approved either.
  await store.append({ ...base, status: "pending" });
  await assert.rejects(
    () => store.resolve("hl-1", { status: "approved", reviewed_by: "admin", reviewed_at: "2026-07-05T01:00:00.000Z" }),
    HardLimitApprovalForbidden,
  );
  // Control: an approval_gate row CAN be approved (proves the guard is type-specific, not blanket).
  await store.append({ ...base, id: "ag-1", guardrail_type: "approval_gate", status: "pending" });
  await store.resolve("ag-1", { status: "approved", reviewed_by: "admin", reviewed_at: "2026-07-05T01:00:00.000Z" });
  const ag = (await store.all()).find((r) => r.id === "ag-1")!;
  assert.equal(ag.status, "approved");
  // The hard_limit row terminated at its recorded-block state (still pending, still blocked).
  const hl = (await store.all()).find((r) => r.id === "hl-1")!;
  assert.equal(hl.status, "pending");
  assert.equal(hl.action_blocked, true);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-6.LOG.001.3 — `pending` covers ALL unresolved states, disambiguated by guardrail_type
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("AC-6.LOG.001.3 — pending is shared across types; the reviewer reads the TYPE to disambiguate", async () => {
  const { writer, store } = makeWriter();
  // Three different unresolved review states, all `pending`, told apart only by guardrail_type.
  await writer.record({ guardrail_type: "approval_gate", description: "approval wait", action_blocked: false });
  await writer.record({ guardrail_type: "prompt_injection", description: "quarantine wait", action_blocked: true });
  await writer.record({ guardrail_type: "anomaly", description: "anomaly review", action_blocked: false });
  const rows = await store.all();
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.status === "pending"), "all three unresolved states are `pending`");
  // The disambiguator is the TYPE, not the status — the three are distinguishable despite identical status.
  const types = new Set(rows.map((r) => r.guardrail_type));
  assert.equal(types.size, 3, "the three pending rows are distinguishable by guardrail_type");
  assert.ok(types.has("approval_gate") && types.has("prompt_injection") && types.has("anomaly"));
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-6.LOG.002.1 — delete / content-rewrite rejected; only the forward resolution transition permitted
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("AC-6.LOG.002.1 — historical rows are append-only; only a timestamped/attributed forward resolution is allowed", async () => {
  const store = new InMemoryGuardrailLogStore();
  const row: GuardrailLogRow = {
    id: "g-1",
    task_id: "task-9",
    guardrail_type: "approval_gate",
    description: "original description",
    action_blocked: false,
    status: "pending",
    reviewed_by: null,
    reviewed_at: null,
    escalated_at: null,
    created_at: "2026-07-05T00:00:00.000Z",
  };
  await store.append(row);

  // Delete rejected.
  await assert.rejects(() => store.delete("g-1"), AppendOnlyViolation);
  // Content rewrite rejected.
  await assert.rejects(() => store.rewriteContent("g-1", "tampered"), AppendOnlyViolation);
  // A clobber-insert (same id) is rejected as an in-place update.
  await assert.rejects(() => store.append(row), AppendOnlyViolation);

  // The ONE permitted mutation: pending -> resolved, timestamped + attributed, description/task_id UNCHANGED.
  await store.resolve("g-1", { status: "rejected", reviewed_by: "admin-7", reviewed_at: "2026-07-05T02:00:00.000Z" });
  const resolved = (await store.all()).find((r) => r.id === "g-1")!;
  assert.equal(resolved.status, "rejected");
  assert.equal(resolved.reviewed_by, "admin-7");
  assert.equal(resolved.reviewed_at, "2026-07-05T02:00:00.000Z");
  assert.equal(resolved.description, "original description", "history is not rewritten by a resolution");
  assert.equal(resolved.task_id, "task-9");

  // A SECOND resolution (resolved -> resolved) is not a permitted forward transition — rejected.
  await assert.rejects(
    () => store.resolve("g-1", { status: "approved", reviewed_by: "admin-7", reviewed_at: "2026-07-05T03:00:00.000Z" }),
    AppendOnlyViolation,
  );
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-6.LOG.003.1 — a block/flag/quarantine writes EXACTLY one row; record + safe action bound together
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("AC-6.LOG.003.1 — each guardrail action writes exactly one row (no block-without-record, no double-write)", async () => {
  const { writer, store } = makeWriter();
  await writer.record({ guardrail_type: "rate_limit", description: "429 throttle", action_blocked: true });
  assert.equal((await store.all()).length, 1, "one action -> exactly one row");
  await writer.record({ guardrail_type: "hard_limit", description: "cap hit", action_blocked: true });
  assert.equal((await store.all()).length, 2, "a second action -> exactly one more row (no dup, no skip)");
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-6.LOG.003.2 — an event lands in EXACTLY one of the three sinks
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("AC-6.LOG.003.2 — each event class routes to exactly one sink; the routing is total + disjoint", () => {
  assert.equal(routeToSink("guardrail"), "guardrail_log");
  assert.equal(routeToSink("access"), "access_audit");
  assert.equal(routeToSink("telemetry"), "event_log");
  // Disjoint: the three classes map to three DISTINCT sinks (no event double-writes / falls between).
  const sinks = new Set([routeToSink("guardrail"), routeToSink("access"), routeToSink("telemetry")]);
  assert.equal(sinks.size, 3);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-6.LOG.003.3 — a write FAILURE does NOT abandon the block; the lost row is escalated out-of-band
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("AC-6.LOG.003.3 — fail-CLOSED: a store failure holds the block and escalates the lost row out-of-band", async () => {
  const { writer, store, degraded } = makeWriter();
  store.induceWriteFailure("silo DB unreachable");
  const res = await writer.record({
    guardrail_type: "hard_limit",
    description: "spend cap hit while store down",
    action_blocked: true,
  });
  // The block HELD even though the row did not land — record() did NOT throw into the caller.
  assert.equal(res.logged, false, "the row did not land");
  assert.equal(res.actionHeld, true, "the safe action held regardless (#2: no dangerous proceed)");
  assert.equal(res.degraded, true, "the failure took the out-of-band path (#3: not silent)");
  // No row in the sink, but the lost row IS captured out-of-band with its details (not swallowed).
  assert.equal((await store.all()).length, 0);
  const oob = degraded.drain();
  assert.equal(oob.length, 1);
  assert.equal(oob[0]!.guardrail_type, "hard_limit");
  assert.equal(oob[0]!.action_blocked, true);
  assert.match(oob[0]!.reason, /unreachable/);
  // Recovery: a subsequent write (store healthy again) lands normally — the failure was transient, not fatal.
  const ok = await writer.record({ guardrail_type: "anomaly", description: "later event", action_blocked: false });
  assert.equal(ok.logged, true);
  assert.equal((await store.all()).length, 1);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-6.LOG.004.1 — an export contains the complete guardrail_log for the period, all five types, no gaps
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("AC-6.LOG.004.1 — export is window-complete, reports all five types, and surfaces a gap explicitly", async () => {
  const { writer, store, clock } = makeWriter();
  for (const t of GUARDRAIL_TYPES) {
    await writer.record({ guardrail_type: t, description: `${t} evt`, action_blocked: true });
    clock.tick();
  }
  const rows = await store.all();
  const full = buildExport(rows, { from: "2026-07-05T00:00:00.000Z", to: "2026-07-06T00:00:00.000Z" });
  assert.equal(full.rows.length, 5);
  assert.equal(full.complete, true, "every in-window row is present");
  assert.deepEqual(new Set(full.typesPresent), new Set(GUARDRAIL_TYPES));
  assert.deepEqual(full.typesMissing, [], "all five types represented — no gaps");

  // A narrow window that excludes some types reports the missing ones EXPLICITLY (a gap is visible, not silent).
  const first = rows.sort((a, b) => (a.created_at < b.created_at ? -1 : 1))[0]!;
  const narrow = buildExport(rows, { from: first.created_at, to: first.created_at });
  assert.equal(narrow.rows.length, 1);
  assert.equal(narrow.complete, true, "the narrow slice is itself complete — no out-of-window row leaked in");
  assert.ok(
    narrow.rows.every((r) => r.created_at === first.created_at),
    "only the in-window row is exported (the other four are correctly excluded, not leaked)",
  );
  assert.equal(narrow.typesMissing.length, 4, "the four absent types are reported, not silently dropped");
  assert.ok(narrow.typesPresent.includes(first.guardrail_type));
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-6.FMM.001.1 — every guardrail-class failure produces a record + a surface
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("AC-6.FMM.001.1 — a guardrail-class failure is always detected -> recorded -> surfaced (never closed-and-silent)", async () => {
  const { writer, store } = makeWriter();
  // A clean block decision is recorded (surfaced via the persisted row).
  const outcome = await runGuardrailCheck(
    writer,
    "anomaly",
    { score: 0.99 },
    (s: { score: number }) => s.score > 0.9, // blocks
    () => "anomaly score above threshold",
  );
  assert.equal(outcome.blocked, true);
  assert.equal(outcome.checkErrored, false);
  assert.equal(outcome.write.logged, true, "the block was recorded");
  assert.equal((await store.all()).length, 1);
  // A check that PERMITS the action writes no guardrail row (there is no guardrail event) — proves the record
  // is tied to an actual guardrail-class failure, not emitted unconditionally.
  const permit = await runGuardrailCheck(
    writer,
    "anomaly",
    { score: 0.1 },
    (s: { score: number }) => s.score > 0.9,
    () => "should not be called",
  );
  assert.equal(permit.blocked, false);
  assert.equal((await store.all()).length, 1, "a permitted action writes no guardrail row");
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-6.FMM.001.2 — a home-owned failure-map row references its owner + C7 path and is NOT re-detected here
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("AC-6.FMM.001.2 — home-owned catalogue rows are referenced (owner + C7 path), not re-detected by C6", () => {
  const homeOwned: FailureMapEntry = {
    id: "fm-conn-auth",
    homeComponent: "C3",
    description: "connector auth expiry",
    guardrailClassOwnedByC6: false,
    c7AlertPath: "C7 notifications -> credential_state degraded alert",
  };
  const c6Owned: FailureMapEntry = {
    id: "fm-hard-limit",
    homeComponent: "C6",
    description: "hard limit hit",
    guardrailClassOwnedByC6: true,
    c7AlertPath: "C7 notifications -> hard_limit_hit alert",
  };
  // C6 does NOT re-implement detection for a home-owned row; it DOES for its own guardrail-class row.
  assert.equal(reImplementsDetection(homeOwned), false);
  assert.equal(reImplementsDetection(c6Owned), true);
  // Every catalogue row must still name its home owner + a C7 alert path (referenced, not orphaned).
  assert.equal(catalogueEntryIsWellFormed(homeOwned), true);
  assert.equal(catalogueEntryIsWellFormed(c6Owned), true);
  const missingPath: FailureMapEntry = { ...homeOwned, c7AlertPath: "" };
  assert.equal(catalogueEntryIsWellFormed(missingPath), false, "a row with no C7 alert path is malformed");
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-6.FMM.001.3 — a guardrail CHECK that itself errors fails closed — halts + flags + logs, never proceeds
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("AC-6.FMM.001.3 — a check that throws fails CLOSED: it halts, flags, and records the check error", async () => {
  const { writer, store } = makeWriter();
  const outcome = await runGuardrailCheck(
    writer,
    "prompt_injection",
    { text: "…" },
    () => {
      throw new Error("embedding engine timed out");
    },
    (r) => `injection check errored (${r.errored}) — failing closed`,
  );
  // The step HALTED (blocked) despite the check being unable to decide — never proceeds unchecked (#2/#3).
  assert.equal(outcome.blocked, true, "a check error must halt the step, not permit it");
  assert.equal(outcome.checkErrored, true, "the error is flagged as a check error (not a clean decision)");
  // The check error is itself recorded + surfaced.
  assert.equal(outcome.write.logged, true);
  const rows = await store.all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.action_blocked, true);
  assert.match(rows[0]!.description, /errored \(true\)/);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-6.FMM.001.3 (record()-throws hardening) — the wrapper NEVER rethrows the caller into proceeding.
// record() validates BEFORE its own try/catch, so an empty describe() (EmptyDescription) or an out-of-set
// guardrail_type throws UNCAUGHT out of record(). If that escaped runGuardrailCheck, a non-defensive caller
// (try/catch-and-proceed) would proceed UNCHECKED — the exact hole the AC forbids. Both cases below must still
// yield blocked:true and escalate the lost event out-of-band.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("AC-6.FMM.001.3 — an EMPTY describe() cannot unwind the block: record() throw is caught, block still holds", async () => {
  const { writer, store, degraded } = makeWriter();
  // A blocking check whose describe() returns "" — record() will throw EmptyDescription (validation before store).
  const outcome = await runGuardrailCheck(
    writer,
    "anomaly",
    { score: 0.99 },
    () => true, // blocks
    () => "   ", // whitespace-only -> EmptyDescription inside record()
  );
  // The block HELD despite record() throwing — the wrapper did NOT rethrow the caller into proceeding (#2/#3).
  assert.equal(outcome.blocked, true, "an empty-description record() throw must NOT unwind the block");
  assert.equal(outcome.recordEscalated, true, "the record() throw took the out-of-band escalation path");
  assert.equal(outcome.write.logged, false, "no row landed (record() threw before persisting)");
  assert.equal(outcome.write.degraded, true, "the lost event was escalated, not swallowed");
  // No malformed row was written to the sink; the loss IS captured out-of-band with a non-empty reason.
  assert.equal((await store.all()).length, 0, "no row was persisted for the failed record()");
  const oob = degraded.drain();
  assert.equal(oob.length, 1, "the lost event landed on the out-of-band sink");
  assert.equal(oob[0]!.guardrail_type, "anomaly");
  assert.equal(oob[0]!.action_blocked, true);
  assert.ok(oob[0]!.description.trim().length > 0, "the out-of-band entry is never itself blank");
  assert.match(oob[0]!.reason, /record\(\) threw/);
});

test("AC-6.FMM.001.3 — a FAILING store underneath the wrapper still holds the block (record() never unwinds the caller)", async () => {
  const { writer, store, degraded } = makeWriter();
  store.induceWriteFailure("silo DB unreachable mid-check");
  // A clean blocking decision, but the store append fails. record() handles this internally (does not throw),
  // yet we assert the WRAPPER's contract: blocked stays true, the loss is surfaced, the caller never proceeds.
  const outcome = await runGuardrailCheck(
    writer,
    "prompt_injection",
    { text: "…" },
    () => true, // blocks
    () => "injection blocked while store down",
  );
  assert.equal(outcome.blocked, true, "a store failure under the wrapper must NOT let the step proceed");
  assert.equal(outcome.write.logged, false, "the row did not land");
  assert.equal(outcome.write.actionHeld, true, "the safe action held regardless");
  assert.equal(outcome.write.degraded, true, "the lost row took the out-of-band path");
  assert.equal((await store.all()).length, 0, "no row persisted");
  assert.equal(degraded.drain().length, 1, "the lost row was escalated out-of-band");
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-6.LOG.003.1 (no-event marker) — a clean PERMIT returns a distinct `noEvent` marker, NOT logged:true, so a
// caller can tell "a row landed" from "nothing fired, nothing written".
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("AC-6.LOG.003.1 — a clean permit reports noEvent (not logged:true) so 'row landed' is distinguishable", async () => {
  const { writer, store } = makeWriter();
  const permit = await runGuardrailCheck(
    writer,
    "anomaly",
    { score: 0.1 },
    (s: { score: number }) => s.score > 0.9, // permits
    () => "should not be called",
  );
  assert.equal(permit.blocked, false);
  assert.equal(permit.write.logged, false, "a clean permit did NOT log a row");
  assert.equal(permit.write.noEvent, true, "…and says so via the distinct noEvent marker");
  assert.equal(permit.write.actionHeld, true);
  assert.equal((await store.all()).length, 0, "nothing was written for a permit");

  // Contrast: a real block that lands a row reports logged:true and NO noEvent marker.
  const block = await runGuardrailCheck(
    writer,
    "anomaly",
    { score: 0.99 },
    (s: { score: number }) => s.score > 0.9, // blocks
    () => "anomaly over threshold",
  );
  assert.equal(block.write.logged, true, "a landed block row reports logged:true");
  assert.equal(block.write.noEvent, undefined, "a fired event never carries the noEvent marker");
  assert.equal((await store.all()).length, 1);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-6.OPT.001.1 — a tier-change candidate applies ONLY after explicit admin confirmation
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("AC-6.OPT.001.1 — a gate/tier change never auto-applies; it requires explicit admin confirmation", () => {
  const loop = new LearningLoop();
  loop.surface({
    id: "cand-1",
    kind: "approval_tier",
    subject: "send_email",
    impact: "gate",
    proposal: "auto-approve send_email (always approved by a human)",
    at: "2026-07-05T00:00:00.000Z",
  });
  // Before confirmation, applying the GATE change is refused (no silent auto-retiering — #2).
  assert.throws(() => loop.applyIfPermitted("cand-1"), SilentAutoChangeForbidden);
  // After explicit admin confirmation, and only then, it applies.
  loop.confirm("cand-1", "admin-3", "2026-07-05T01:00:00.000Z");
  const applied = loop.applyIfPermitted("cand-1");
  assert.equal(applied.applied, true);
  const c = loop.get("cand-1")!;
  assert.equal(c.state, "confirmed");
  assert.equal(c.actionedBy, "admin-3");

  // A detected approval PATTERN only surfaces a candidate — it never applies one on its own.
  const history: GuardrailLogRow[] = Array.from({ length: 4 }, (_, i) => ({
    id: `h-${i}`,
    task_id: null,
    guardrail_type: "approval_gate",
    description: "refund under $10",
    action_blocked: false,
    status: "approved",
    reviewed_by: "admin",
    reviewed_at: "2026-07-05T00:00:00.000Z",
    escalated_at: null,
    created_at: "2026-07-05T00:00:00.000Z",
  }));
  const subjects = detectApprovalPattern(history, 3);
  assert.deepEqual(subjects, ["refund under $10"]);
  // A history with a rejection breaks the "always approved" pattern — no candidate.
  history[0]!.status = "rejected";
  assert.deepEqual(detectApprovalPattern(history, 3), [], "a single rejection breaks the pattern");
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-6.OPT.001.2 — an un-actioned candidate persists / re-surfaces rather than silently vanishing
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("AC-6.OPT.001.2 — an un-actioned candidate persists and re-surfaces (never silently disappears)", () => {
  const loop = new LearningLoop();
  loop.surface({
    id: "cand-9",
    kind: "anomaly_baseline",
    subject: "latency_p99",
    impact: "gate",
    proposal: "loosen latency gate",
    at: "2026-07-05T00:00:00.000Z",
  });
  // The admin neither confirms nor rejects; the dashboard re-scans twice.
  const first = loop.reScan();
  const second = loop.reScan();
  assert.equal(first.length, 1, "the un-actioned candidate is still open on the first re-scan");
  assert.equal(second.length, 1, "…and on the second — it did not vanish");
  const c = loop.get("cand-9")!;
  assert.ok(c.resurfacedCount >= 2, "re-surfacing is recorded (persisted, not dropped)");
  assert.equal(c.state, "surfaced");
  // Surfacing the same (kind,subject) again does NOT create a duplicate — it re-surfaces the existing one.
  loop.surface({
    id: "cand-9-dup",
    kind: "anomaly_baseline",
    subject: "latency_p99",
    impact: "gate",
    proposal: "loosen latency gate",
    at: "2026-07-05T02:00:00.000Z",
  });
  assert.equal(loop.get("cand-9-dup"), undefined, "no duplicate candidate is created");
  // Once actioned (rejected), it no longer re-surfaces — the gate stays strict, the state is resolved.
  loop.reject("cand-9", "admin-1", "2026-07-05T03:00:00.000Z");
  assert.equal(loop.reScan().length, 0, "an actioned candidate stops re-surfacing");
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// AC-6.OPT.002.1 — a signal threshold may auto-tune, but a gate-altering baseline shift is admin-confirmed
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("AC-6.OPT.002.1 — signal thresholds auto-tune; a gate-altering baseline shift needs admin confirmation", () => {
  // The reusable baseline mechanism (ISSUE-057 consumes it) computes mean + stdev.
  const b = buildBaseline([10, 12, 14, 16, 18]);
  assert.equal(b.samples, 5);
  assert.equal(b.mean, 14);
  assert.ok(Math.abs(b.stdev - Math.sqrt(8)) < 1e-9);

  const loop = new LearningLoop();
  // A signal-only change may auto-apply (no gate decision altered).
  assert.equal(classifyThresholdChange(false), "signal");
  loop.surface({
    id: "sig-1",
    kind: "anomaly_baseline",
    subject: "score_sensitivity",
    impact: classifyThresholdChange(false),
    proposal: "tighten sensitivity",
    at: "2026-07-05T00:00:00.000Z",
  });
  assert.equal(loop.applyIfPermitted("sig-1").applied, true, "a signal tune auto-applies");

  // A gate-altering change may NOT auto-apply — it is refused until confirmed.
  assert.equal(classifyThresholdChange(true), "gate");
  loop.surface({
    id: "gate-1",
    kind: "anomaly_baseline",
    subject: "block_threshold",
    impact: classifyThresholdChange(true),
    proposal: "raise the block threshold (would let more through)",
    at: "2026-07-05T00:00:00.000Z",
  });
  assert.throws(() => loop.applyIfPermitted("gate-1"), SilentAutoChangeForbidden);
  loop.confirm("gate-1", "admin-2", "2026-07-05T01:00:00.000Z");
  assert.equal(loop.applyIfPermitted("gate-1").applied, true, "…and applies once an admin confirms");
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// logic-sweep regression — a signal candidate an admin REJECTED must NOT auto-apply (state-machine hole)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("logic-sweep — a REJECTED signal candidate does not auto-apply (admin rejection is honoured)", () => {
  const loop = new LearningLoop();
  loop.surface({
    id: "sig-rej",
    kind: "anomaly_baseline",
    subject: "score_sensitivity",
    impact: classifyThresholdChange(false), // signal
    proposal: "tighten sensitivity",
    at: "2026-07-05T00:00:00.000Z",
  });
  // The admin explicitly rejects the signal candidate — it is actioned; the tune must NOT apply.
  loop.reject("sig-rej", "admin-9", "2026-07-05T01:00:00.000Z");
  const result = loop.applyIfPermitted("sig-rej");
  assert.equal(result.applied, false, "a rejected signal candidate must not auto-apply (#2)");
  assert.equal(loop.get("sig-rej")!.state, "rejected", "the rejection stands — apply did not change it");
});
