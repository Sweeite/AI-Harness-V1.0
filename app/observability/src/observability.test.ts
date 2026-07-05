// ISSUE-011 §4 Definition of done — one test per AC (text read in the FR/NFR, Rule 0). Plus the explicit
// fault-injection tests that constitute the AF-118 / AF-119 / AF-120 build-time evidence (§9). All offline:
// the InMemory* stores re-implement the DB append-only-trigger semantics faithfully; the live pg adapter
// (supabase-store.ts) is authored to the DDL but proven at integration time.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  COST_UNKNOWN,
  EVENT_TYPES,
  isEventType,
  isTerminalEventType,
  type EventLogRow,
  type GuardrailLogRow,
  type TaskTerminalRow,
} from "./types.ts";
import {
  AppendOnlyViolation,
  InvalidEventType,
  InMemoryDegradedSink,
  InMemoryEventLogStore,
  InMemoryGuardrailLogStore,
  InMemoryHealthBitChannel,
  InMemoryNotificationStore,
  InMemoryTaskQueueStore,
} from "./store.ts";
import { EmptySummary, EventWriter, resolveCost } from "./event-writer.ts";
import { redactPayload, redactSummary, containsCredential, containsSecretValue } from "./redact.ts";
import {
  detectSilentFailures,
  reconcileSinks,
  terminalEventInvariantViolations,
} from "./detector.ts";
import { runRetention, applyComplianceErasure } from "./retention.ts";
import { DEFAULT_OBSERVABILITY_CONFIG, validateObservabilityConfig } from "./config.ts";
import { AlertEngineHeartbeat, AlertEngineWatchdog, watchdogSelfStalled } from "./watchdog.ts";
import { checkSchemaPresence } from "./schema-presence.ts";
import { TestClock } from "./test-clock.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE_SQL = join(HERE, "..", "..", "silo", "migrations", "0001_baseline.sql");
const DAY_MS = 24 * 60 * 60 * 1000;

// A ready-made writer wired to fresh in-memory sinks.
function makeWriter() {
  const store = new InMemoryEventLogStore();
  const degraded = new InMemoryDegradedSink();
  const health = new InMemoryHealthBitChannel();
  const clock = new TestClock();
  const writer = new EventWriter({ store, degraded, health, clock });
  return { store, degraded, health, clock, writer };
}

// ─────────────────────────────────────────────────────────────────────────────
// FR-7.LOG.001 — append-only event_log timeline
// ─────────────────────────────────────────────────────────────────────────────

test("AC-7.LOG.001.1 — an UPDATE/DELETE of an existing event_log row (outside retention) is rejected", async () => {
  const { store, writer } = makeWriter();
  const r = await writer.write({ event_type: "task_started", summary: "Task started", cost: 0 });
  assert.ok(r.ok && r.row);
  // Re-appending the same id models an in-place update → the append-only trigger rejects it.
  await assert.rejects(() => store.append(r.row!), AppendOnlyViolation);
  // DELETE outside the retention path: prune() is the ONLY removal path; no public UPDATE path exists.
  // (The redaction-tombstone is the sole whitelisted mutation — proven in AC-7.LOG.006.3.)
});

test("AC-7.LOG.001.2 — an out-of-enum event_type is rejected, not silently coerced", async () => {
  const { store, writer } = makeWriter();
  await assert.rejects(
    () => writer.write({ event_type: "not_a_real_event" as never, summary: "x", cost: 0 }),
    InvalidEventType,
  );
  // And at the store layer directly (the DB enum guard analog).
  const bad: EventLogRow = {
    id: "x",
    task_id: null,
    event_type: "bogus" as never,
    entity_ids: null,
    summary: "x",
    payload: null,
    duration_ms: null,
    cost_tokens: 0,
    cost_unknown: false,
    answer_mode: null,
    redacted_at: null,
    created_at: new Date().toISOString(),
  };
  await assert.rejects(() => store.append(bad), InvalidEventType);
  // The enum guard covers every DDL value (incl. the OD-170 additions) and rejects everything else.
  assert.equal(isEventType("authz_revoked_midtask"), true);
  assert.equal(isEventType("rls_harness_divergence"), true);
  assert.equal(isEventType("nope"), false);
});

test("AC-7.LOG.001.3 — no event_log row carries a client_slug column within a silo (OD-067)", async () => {
  const { writer } = makeWriter();
  const r = await writer.write({ event_type: "task_started", summary: "Task started", cost: 0 });
  assert.ok(r.row);
  assert.ok(!("client_slug" in (r.row as object)), "event_log row must not carry client_slug intra-silo");
  // The persisted schema likewise has no client_slug column on event_log.
  const baseline = readFileSync(BASELINE_SQL, "utf8");
  const eventLogBlock = baseline.match(/create table event_log\b[\s\S]*?\);/)?.[0] ?? "";
  assert.ok(!/client_slug/.test(eventLogBlock), "event_log DDL must not declare client_slug (OD-067)");
});

// ─────────────────────────────────────────────────────────────────────────────
// FR-7.LOG.002 — log intent, not just action
// ─────────────────────────────────────────────────────────────────────────────

test("AC-7.LOG.002.1 — a tool_called summary names the intent/trigger, not only the tool", async () => {
  const { writer } = makeWriter();
  const r = await writer.write({
    event_type: "tool_called",
    summary:
      "Updating deal stage because memory indicates client confirmed budget in last call, triggered by scheduled morning review",
    payload: { tool: "ghl_update_deal", stage: "won" },
    cost: 120,
  });
  assert.ok(r.row);
  // No summary is solely "Tool called: <name>".
  assert.doesNotMatch(r.row.summary, /^Tool called:\s*\S+$/);
  assert.match(r.row.summary, /because|triggered by/); // carries intent/trigger
});

test("AC-7.LOG.002.2 — payload carries the machine detail; summary is never empty for any event type", async () => {
  const { writer } = makeWriter();
  // Empty / whitespace-only summary is rejected for every event type.
  for (const et of EVENT_TYPES) {
    await assert.rejects(() => writer.write({ event_type: et, summary: "   ", cost: 0 }), EmptySummary);
  }
  const r = await writer.write({
    event_type: "memory_written",
    summary: "Wrote contact preference to memory after confirmation",
    payload: { entity: "contact:123", field: "pref" },
    cost: 5,
  });
  assert.ok(r.row);
  assert.notEqual(r.row.summary.trim(), "");
  assert.deepEqual(r.row.payload, { entity: "contact:123", field: "pref" });
});

// ─────────────────────────────────────────────────────────────────────────────
// FR-7.LOG.003 — completeness: silent-failure detector + out-of-band + cross-sink
// ─────────────────────────────────────────────────────────────────────────────

test("AC-7.LOG.003.1 / AC-NFR-OBS.001.1 — exactly one terminal event per task_id", async () => {
  const { writer, store } = makeWriter();
  await writer.write({ task_id: "t1", event_type: "task_started", summary: "start t1", cost: 0 });
  await writer.write({ task_id: "t1", event_type: "task_completed", summary: "done t1", cost: 0 });
  const events = await store.all();
  const t1Terminal = events.filter((e) => e.task_id === "t1" && isTerminalEventType(e.event_type));
  assert.equal(t1Terminal.length, 1);
  assert.deepEqual(terminalEventInvariantViolations(events), []); // invariant holds
});

test("AC-NFR-OBS.001.2 — a terminal task with NO terminal event is flagged as a detectable gap (AF-118)", async () => {
  const { writer, store } = makeWriter();
  // t2 reaches terminal task_queue status but emits no terminal event (abrupt termination — silent failure).
  await writer.write({ task_id: "t2", event_type: "task_started", summary: "start t2", cost: 0 });
  const terminalTasks: TaskTerminalRow[] = [{ task_id: "t2", status: "failed" }];
  const findings = detectSilentFailures(terminalTasks, await store.all());
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.kind, "missing_terminal_event");
  assert.equal(findings[0]!.task_id, "t2");
});

test("AF-118 (detector) — a two-terminal-event invariant break is flagged, not ignored", async () => {
  const { writer, store } = makeWriter();
  await writer.write({ task_id: "t3", event_type: "task_completed", summary: "done", cost: 0 });
  await writer.write({ task_id: "t3", event_type: "task_failed", summary: "also failed?!", cost: 0 });
  const findings = detectSilentFailures([{ task_id: "t3", status: "completed" }], await store.all());
  assert.equal(findings[0]!.kind, "multiple_terminal_events");
  assert.deepEqual(terminalEventInvariantViolations(await store.all()), ["t3"]);
});

test("AC-7.LOG.003.2 / AC-NFR-OBS.002.1 — a failed event_log write records out-of-band, never silent (AF-119)", async () => {
  const { writer, store, degraded, health } = makeWriter();
  store.induceWriteFailure("DB unreachable"); // fault injection: the silo DB is down
  const r = await writer.write({ task_id: "t4", event_type: "task_failed", summary: "task blew up", cost: 0 });
  assert.equal(r.ok, false);
  assert.equal(r.degraded, true);
  // The failure landed on the out-of-band sink (stderr/file analog) — NOT the DB that just failed.
  const drained = degraded.drain();
  assert.equal(drained.length, 1);
  assert.match(drained[0]!.reason, /DB unreachable/);
  // And the DB genuinely holds no row for this write (it was not silently "half-written").
  assert.equal((await store.all()).length, 0);
  // The health bit is set for the mgmt-plane push (AC-NFR-OBS.002.2).
  assert.equal(health.snapshot().log_write_failing, true);
});

test("AC-NFR-OBS.002.2 — the log-write-failing bit is carried on the mgmt-plane push even with the silo DB down (AF-119)", async () => {
  const { writer, store, health } = makeWriter();
  store.induceWriteFailure();
  await writer.write({ event_type: "task_completed", summary: "done", cost: 0 });
  // The push (ISSUE-012) reads this channel; the Super Admin grid sees the failure without the down silo DB.
  const snap = health.snapshot();
  assert.equal(snap.log_write_failing, true);
});

test("AC-7.LOG.003.3 / AC-NFR-OBS.003.1 — cross-sink reconciliation flags a one-sided row", async () => {
  const { writer, store } = makeWriter();
  // A guardrail_log row for t5, but NO event_log guardrail_hit event → completeness gap.
  await writer.write({ task_id: "t5", event_type: "task_started", summary: "start t5", cost: 0 });
  const guardrailRows: GuardrailLogRow[] = [{ id: "g1", task_id: "t5", created_at: new Date().toISOString() }];
  let findings = reconcileSinks(await store.all(), guardrailRows);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.side, "guardrail_without_event");

  // The reverse: an event_log guardrail_hit with no guardrail_log row.
  await writer.write({ task_id: "t6", event_type: "guardrail_hit", summary: "hit on t6", cost: 0 });
  findings = reconcileSinks(await store.all(), guardrailRows);
  assert.ok(findings.some((f) => f.side === "event_without_guardrail" && f.task_id === "t6"));

  // A matched pair reconciles clean (no finding).
  const matched: GuardrailLogRow[] = [{ id: "g2", task_id: "t6", created_at: new Date().toISOString() }];
  const clean = reconcileSinks(
    [{ ...(await store.all()).find((e) => e.task_id === "t6")! }],
    matched,
  );
  assert.deepEqual(clean, []);
});

// ─────────────────────────────────────────────────────────────────────────────
// FR-7.LOG.004 — per-event duration + cost; cost_unknown ≠ 0
// ─────────────────────────────────────────────────────────────────────────────

test("AC-7.LOG.004.1 / AC-NFR-OBS.013.1 — an un-computable cost records cost_unknown, distinct from a genuine 0", async () => {
  const { writer } = makeWriter();
  const free = await writer.write({ event_type: "memory_read", summary: "cheap read", cost: 0 });
  assert.equal(free.row!.cost_tokens, 0);
  assert.equal(free.row!.cost_unknown, false); // genuinely costless

  const dark = await writer.write({ event_type: "tool_called", summary: "cost could not be computed", cost: COST_UNKNOWN });
  assert.equal(dark.row!.cost_tokens, null);
  assert.equal(dark.row!.cost_unknown, true); // NEVER a silent 0

  // resolveCost contract directly: a NaN/negative is un-computable → cost_unknown, not 0.
  assert.deepEqual(resolveCost(COST_UNKNOWN), { cost_tokens: null, cost_unknown: true });
  assert.deepEqual(resolveCost(Number.NaN), { cost_tokens: null, cost_unknown: true });
  assert.deepEqual(resolveCost(-5), { cost_tokens: null, cost_unknown: true });
  assert.deepEqual(resolveCost(0), { cost_tokens: 0, cost_unknown: false });
  // Estimate-grade, rounded UP (ADR-003).
  assert.deepEqual(resolveCost(12.1), { cost_tokens: 13, cost_unknown: false });
});

test("AC-7.LOG.004.2 — duration_ms is captured for every event with a measurable span", async () => {
  const { writer } = makeWriter();
  const r = await writer.write({ event_type: "tool_called", summary: "ran a tool", duration_ms: 250, cost: 3 });
  assert.equal(r.row!.duration_ms, 250);
});

// ─────────────────────────────────────────────────────────────────────────────
// FR-7.LOG.005 — tokens/secrets never in the log
// ─────────────────────────────────────────────────────────────────────────────

test("AC-7.LOG.005.1 — a payload with a token/secret is redacted before write; no credential survives", async () => {
  const { writer, store } = makeWriter();
  await writer.write({
    event_type: "tool_called",
    summary: "Called GHL API to update a deal",
    payload: {
      tool: "ghl_update_deal",
      // NB: these are SYNTHETIC test fixtures — credential-SHAPED strings fed through redaction to prove
      // it scrubs them. The literals are split via concatenation so the contiguous secret pattern never
      // appears in the source text (avoids a false-positive from GitHub push-protection); the runtime
      // value is byte-identical to a real-shaped token, so the redaction + the assertions below are unchanged.
      access_token: "xoxb-" + "1234567890-abcdefghijklmnop",
      nested: { api_key: "sk_" + "live_ABCDEFGHIJKLMNOPQRSTUV250", note: "safe text" },
      bearer: "Bearer eyJ" + "hbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payloadpart.sigpart",
    },
    cost: 10,
  });
  // Sample-audit the whole log: no credential VALUE survives anywhere (a redacted secret-named key is fine).
  for (const row of await store.all()) {
    assert.equal(containsSecretValue(row.payload), false, "no credential value in payload");
    assert.equal(containsSecretValue(row.summary), false, "no credential value in summary");
    // The ORIGINAL payload DID contain credentials — proving the audit would have caught an un-redacted write.
    const blob = JSON.stringify(row.payload);
    assert.doesNotMatch(blob, /xoxb-\d/, "raw slack token must be gone");
    assert.doesNotMatch(blob, /sk_live_[A-Z]/, "raw stripe-style key must be gone");
    assert.doesNotMatch(blob, /eyJhbGc/, "raw JWT must be gone");
    assert.match(blob, /safe text/, "innocent text is preserved");
  }
  // redactPayload/redactSummary unit contract.
  const red = redactPayload({ password: "hunter2", ok: "fine" }) as Record<string, unknown>;
  assert.equal(red.password, "[REDACTED]");
  assert.equal(red.ok, "fine");
  assert.equal(redactSummary("token is xoxb-9999999999-zzz"), "token is [REDACTED]");
  // The audit tool itself is proven: an un-redacted payload is detected (a secret-named key OR a secret value).
  assert.equal(containsCredential({ access_token: "anything" }), true);
  assert.equal(containsCredential({ note: "xoxb-1234567890-abc" }), true);
  assert.equal(containsCredential({ note: "just a normal note" }), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// FR-7.LOG.006 — retention + redaction-tombstone
// ─────────────────────────────────────────────────────────────────────────────

test("AC-7.LOG.006.1 / AC-NFR-OBS.010.2 — a prune skips a still-referenced expired row and records why", async () => {
  const clock = new TestClock();
  const store = new InMemoryEventLogStore();
  const degraded = new InMemoryDegradedSink();
  const health = new InMemoryHealthBitChannel();
  const writer = new EventWriter({ store, degraded, health, clock });

  // Two old rows (older than the 365d window): one referenced (an open task), one not.
  clock.set(clock.nowMs() - 400 * DAY_MS);
  const oldReferenced = await writer.write({ task_id: "open", event_type: "task_started", summary: "old + open", cost: 0 });
  const oldUnreferenced = await writer.write({ task_id: "closed", event_type: "task_completed", summary: "old + closed", cost: 0 });
  clock.set(1_800_000_000_000); // back to "now"
  const fresh = await writer.write({ event_type: "task_started", summary: "fresh", cost: 0 });

  const referencedIds = new Set(["open"]);
  const result = await runRetention({
    store,
    config: DEFAULT_OBSERVABILITY_CONFIG,
    now: () => clock.now(),
    isReferenced: (row) => row.task_id !== null && referencedIds.has(row.task_id),
    writer,
  });

  assert.deepEqual(result.pruned, [oldUnreferenced.row!.id]); // only the old, unreferenced row
  assert.deepEqual(result.skipped_referenced, [oldReferenced.row!.id]); // referenced row skipped
  const ids = (await store.all()).map((r) => r.id);
  assert.ok(ids.includes(oldReferenced.row!.id), "referenced row retained");
  assert.ok(ids.includes(fresh.row!.id), "fresh row retained");
  assert.ok(!ids.includes(oldUnreferenced.row!.id), "unreferenced expired row pruned");
});

test("AC-7.LOG.006.2 — every pruning run records a summary event (count, window) — never silent", async () => {
  const { store, writer, clock } = makeWriter();
  await writer.write({ event_type: "task_started", summary: "seed", cost: 0 });
  const before = (await store.all()).length;
  await runRetention({
    store,
    config: DEFAULT_OBSERVABILITY_CONFIG,
    now: () => clock.now(),
    isReferenced: () => false,
    writer,
  });
  const events = await store.all();
  assert.equal(events.length, before + 1, "the prune run itself wrote one summary event");
  const summaryEvent = events.find((e) => e.summary.startsWith("event_log retention run:"));
  assert.ok(summaryEvent, "a retention-run summary event exists");
  assert.equal((summaryEvent!.payload as { op: string }).op, "retention_prune");
  assert.equal((summaryEvent!.payload as { window_days: number }).window_days, 365);
});

test("AC-7.LOG.006.3 — compliance erasure tombstones PII in place but retains row + audit metadata", async () => {
  const { store, writer, clock } = makeWriter();
  const target = await writer.write({
    task_id: "task-erase",
    event_type: "memory_written",
    summary: "Recorded that Jane Doe (jane@example.com) confirmed the deal",
    entity_ids: ["11111111-1111-1111-1111-111111111111"],
    payload: { subject: "jane" },
    cost: 2,
  });
  const originalCreatedAt = target.row!.created_at;

  const result = await applyComplianceErasure(
    { store, now: () => clock.now(), writer },
    (row) => row.task_id === "task-erase",
  );
  assert.deepEqual(result.redacted, [target.row!.id]);

  const after = (await store.all()).find((r) => r.id === target.row!.id)!;
  // PII scrubbed:
  assert.equal(after.summary, "[redacted]");
  assert.equal(after.entity_ids, null);
  assert.equal(after.payload, null);
  assert.notEqual(after.redacted_at, null);
  // Audit metadata retained (the row still exists — "an event happened here"):
  assert.equal(after.event_type, "memory_written");
  assert.equal(after.task_id, "task-erase");
  assert.equal(after.created_at, originalCreatedAt);
  // The erasure is itself logged, and its own log row carries no PII.
  const erasureLog = (await store.all()).find((e) => e.summary.startsWith("compliance erasure applied:"));
  assert.ok(erasureLog);
  assert.doesNotMatch(JSON.stringify(erasureLog!.payload), /jane|Jane/);
});

test("AC-7.LOG.006.3 (trigger whitelist) — the redaction-tombstone is the ONLY in-place mutation allowed", async () => {
  const { store, writer, clock } = makeWriter();
  const r = await writer.write({ event_type: "task_started", summary: "keep me", cost: 0 });
  // The tombstone path is allowed (null→non-null redacted_at); re-appending the same id is NOT (append-only).
  await store.redactTombstone(r.row!.id, clock.now().toISOString());
  await assert.rejects(() => store.append(r.row!), AppendOnlyViolation);
  // A second tombstone is idempotent/no-op (one-way), never a second mutation.
  const before = (await store.all()).find((x) => x.id === r.row!.id)!.redacted_at;
  await store.redactTombstone(r.row!.id, "2099-01-01T00:00:00.000Z");
  const afterTwice = (await store.all()).find((x) => x.id === r.row!.id)!.redacted_at;
  assert.equal(before, afterTwice);
});

// ─────────────────────────────────────────────────────────────────────────────
// FR-7.ALR.008 — the alert-engine watchdog (the watcher is watched)
// ─────────────────────────────────────────────────────────────────────────────

function makeWatchdog(startMs = 1_800_000_000_000) {
  const heartbeat = new AlertEngineHeartbeat();
  const notifications = new InMemoryNotificationStore();
  const health = new InMemoryHealthBitChannel();
  let nowMs = startMs;
  let idSeq = 0;
  const watchdog = new AlertEngineWatchdog({
    heartbeat,
    notifications,
    health,
    stallAfterMs: DEFAULT_OBSERVABILITY_CONFIG.alert_engine_stall_after_ms,
    now: () => nowMs,
    newId: () => `notif-${++idSeq}`,
  });
  return {
    heartbeat,
    notifications,
    health,
    watchdog,
    advance: (d: number) => (nowMs += d),
    setNow: (m: number) => (nowMs = m),
  };
}

test("AC-7.ALR.008.1 / AC-NFR-OBS.004.1 — a live engine beats; an independent watchdog observes them", async () => {
  const w = makeWatchdog();
  w.heartbeat.beat(1_800_000_000_000); // engine beats
  const v = await w.watchdog.evaluate(); // independent watchdog observes (a separate object, not the engine)
  assert.equal(v.stalled, false);
  assert.equal((await w.notifications.all()).length, 0); // no alert while live
});

test("AC-7.ALR.008.2 / AC-NFR-OBS.004.2 — a stalled engine raises a critical alert via the watchdog + sets the push bit (AF-118)", async () => {
  const w = makeWatchdog();
  w.heartbeat.beat(1_800_000_000_000);
  w.advance(DEFAULT_OBSERVABILITY_CONFIG.alert_engine_stall_after_ms + 1); // engine goes quiet past the threshold
  const v = await w.watchdog.evaluate();
  assert.equal(v.stalled, true);
  assert.ok(v.raised);
  assert.equal(v.raised!.type, "alert_engine_stalled");
  assert.equal(v.raised!.severity, "critical");
  // The critical alert landed in notifications.
  const notes = await w.notifications.all();
  assert.equal(notes.length, 1);
  assert.equal(notes[0]!.severity, "critical");
  assert.equal(notes[0]!.read_state, "unread"); // unread-until-actioned
  // The mgmt-plane push carries the stalled condition (fully-down silo still surfaces on the grid).
  assert.equal(w.health.snapshot().alert_engine_stalled, true);
});

test("AF-118 (watchdog self-liveness) — a never-started engine is itself a stall, and the watchdog does not re-spam", async () => {
  const w = makeWatchdog();
  // Engine never beat at all → the strongest silent-failure signal; watchdog fires once.
  const first = await w.watchdog.evaluate();
  assert.equal(first.stalled, true);
  assert.ok(first.raised);
  // Latched: a second evaluation while still stalled does NOT raise a duplicate.
  const second = await w.watchdog.evaluate();
  assert.equal(second.stalled, true);
  assert.equal(second.raised, undefined);
  assert.equal((await w.notifications.all()).length, 1);
  // Recovery: the engine beats again → the latch + health bit clear (recovery is surfaced).
  w.heartbeat.beat(w.watchdog.isLatched() ? 1_800_000_000_000 : 0);
  w.setNow(1_800_000_000_000);
  const recovered = await w.watchdog.evaluate();
  assert.equal(recovered.stalled, false);
  assert.equal(w.health.snapshot().alert_engine_stalled, false);
});

test("AF-118 (watchdog cannot itself silently stall) — its own evaluation cadence going quiet is detectable", () => {
  // The meta-#3: if the watchdog's driver stops calling evaluate(), watchdogSelfStalled surfaces it.
  const now = 1_800_000_000_000;
  assert.equal(watchdogSelfStalled(null, now, 60_000), true); // never evaluated
  assert.equal(watchdogSelfStalled(now - 10_000, now, 60_000), false); // recently evaluated → alive
  assert.equal(watchdogSelfStalled(now - 120_000, now, 60_000), true); // driver went quiet → self-stalled
});

// ─────────────────────────────────────────────────────────────────────────────
// AF-120 — cross-deployment clock-sync / receiver-side window anchoring
// ─────────────────────────────────────────────────────────────────────────────

test("AF-120 — event created_at is stamped from the SERVER clock, never a caller-asserted time", async () => {
  const { writer, clock } = makeWriter();
  clock.set(1_800_000_000_000);
  // A caller cannot inject created_at (the input type has no such field); the writer stamps it.
  const r = await writer.write({ event_type: "task_started", summary: "start", cost: 0 });
  assert.equal(r.row!.created_at, new Date(1_800_000_000_000).toISOString());
});

test("AF-120 — retention window is anchored on the receiver-side server clock, not any row-asserted clock", async () => {
  const store = new InMemoryEventLogStore();
  const degraded = new InMemoryDegradedSink();
  const health = new InMemoryHealthBitChannel();
  const clock = new TestClock();
  const writer = new EventWriter({ store, degraded, health, clock });

  // Write a row, then move the SERVER clock far forward. Whether the row is pruned depends only on the
  // server-side cutoff math — a skewed reporter clock cannot change eligibility.
  const r = await writer.write({ event_type: "task_started", summary: "aged", cost: 0 });
  const rowTime = Date.parse(r.row!.created_at);
  clock.set(rowTime + 400 * DAY_MS); // server clock now 400d past the row
  const result = await runRetention({
    store,
    config: DEFAULT_OBSERVABILITY_CONFIG,
    now: () => clock.now(),
    isReferenced: () => false,
    writer,
  });
  assert.ok(result.pruned.includes(r.row!.id), "the row is prune-eligible by server-side window math");
  assert.equal(Date.parse(result.cutoff), clock.now().getTime() - 365 * DAY_MS);
});

test("AF-120 — the watchdog stall math uses the server clock (skew can't make a dead engine look fresh)", async () => {
  const w = makeWatchdog();
  // The engine's last beat is recorded in server-time; the watchdog compares against server-now. A beat that
  // CLAIMS to be recent but is server-old still trips the stall (the math is receiver-anchored).
  w.heartbeat.beat(1_800_000_000_000);
  w.setNow(1_800_000_000_000 + DEFAULT_OBSERVABILITY_CONFIG.alert_engine_stall_after_ms + 1);
  const v = await w.watchdog.evaluate();
  assert.equal(v.stalled, true, "server-anchored math detects the stall regardless of any reporter clock");
});

// ─────────────────────────────────────────────────────────────────────────────
// Config + schema-presence gates (§8 step 1)
// ─────────────────────────────────────────────────────────────────────────────

test("config — retention window below the audit floor is rejected loudly (OD-072), never silently clamped", () => {
  assert.doesNotThrow(() => validateObservabilityConfig(DEFAULT_OBSERVABILITY_CONFIG));
  assert.throws(
    () => validateObservabilityConfig({ ...DEFAULT_OBSERVABILITY_CONFIG, event_log_retention_days: 10 }),
    /below the audit floor/,
  );
  assert.throws(
    () =>
      validateObservabilityConfig({
        ...DEFAULT_OBSERVABILITY_CONFIG,
        alert_engine_stall_after_ms: DEFAULT_OBSERVABILITY_CONFIG.alert_engine_heartbeat_interval_ms,
      }),
    /must exceed the heartbeat interval/,
  );
});

test("§8 step 1 — the ISSUE-008 0001_baseline schema this slice depends on is present (verify, not re-create)", () => {
  const baseline = readFileSync(BASELINE_SQL, "utf8");
  const checks = checkSchemaPresence(baseline);
  const missing = checks.filter((c) => !c.ok);
  assert.deepEqual(missing, [], `all required schema present; missing: ${missing.map((m) => m.name).join(", ")}`);
});
