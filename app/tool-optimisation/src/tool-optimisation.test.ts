// ISSUE-036 (C3 OPT) — one test per AC in §4 Definition of done. Proved against the pure OPT functions +
// the InMemoryOptEventSink reference model (offline; the live event_log INSERT — which additionally needs
// the additive event_type enum delta — is authored in supabase-store.ts + owed at the Stage-4 checkpoint).
// Every test has TEETH: it asserts the WRONG path is rejected, not just the happy path.
//
// AC map:
//   AC-3.OPT.001.1 — below-threshold confidence → ASK (not call); the ask is logged (never silent)
//   AC-3.OPT.002.1 — a repeated identical read is served from cache with NO second connector call
//   AC-3.OPT.002.2 — a write is NEVER cached or served from cache (structurally ineligible)
//   AC-3.OPT.003.1 — a batch-capable connector groups reads WITHIN the documented limit; over-limit rejected
//   AC-3.OPT.004.1 — a missing tool → doable part completes; no hard fail; no SILENT partial
//   AC-3.OPT.004.2 — the gap is a STRUCTURED mandatory-to-read field, asserted by a consumer-side read

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  confidenceGate,
  RunReadCache,
  WriteNotCacheableError,
  planBatches,
  assertWithinLimit,
  clampBatch,
  OverLimitBatchError,
  degrade,
  isComplete,
  hasUnacknowledgedGap,
  acknowledgeGap,
  assertConsumable,
  UnreadGapError,
  InMemoryOptEventSink,
  DEFAULT_OPT_CONFIG,
  type ToolRow,
  type Degradation,
} from './index.ts';

// ── minimal ToolRow builders (only the fields OPT touches) ─────────────────────────────
function readTool(name: string, connector = 'gmail'): ToolRow {
  return tool(name, 'read', connector);
}
function writeTool(name: string, connector = 'gmail'): ToolRow {
  return tool(name, 'write', connector);
}
function tool(name: string, category: 'read' | 'write', connector: string): ToolRow {
  return {
    id: `tool-${name}`,
    name,
    description: `${name} description`,
    category,
    risk_level: category === 'write' ? 'high' : null,
    requires_approval: category === 'write',
    connector,
    scopes: null,
    config: {},
    enabled: true,
    version: 1,
    previous_version_id: null,
    change_reason: 'seed',
    created_at: '2026-07-06T00:00:00.000Z',
    updated_at: '2026-07-06T00:00:00.000Z',
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────
// AC-3.OPT.001.1 — below threshold → ask, not call; the ask is LOGGED.
// ─────────────────────────────────────────────────────────────────────────────────────
test('AC-3.OPT.001.1 below-threshold confidence asks instead of calling, and logs the ask', async () => {
  const sink = new InMemoryOptEventSink();
  const cand = readTool('search_email');

  // Below the 0.7 default → ASK.
  const below = await confidenceGate({ candidate: cand, confidence: 0.5 }, DEFAULT_OPT_CONFIG, sink);
  assert.equal(below.kind, 'ask', 'confidence below threshold must ASK, never call a possibly-wrong tool');
  // …and the avoided-call is NOT silent (#3): a tool_selection_ask event was logged.
  assert.equal(sink.of('tool_selection_ask').length, 1, 'the below-threshold ask must be logged to event_log');

  // At/above the threshold → CALL (the happy path is genuinely reachable — not an always-ask stub).
  const at = await confidenceGate({ candidate: cand, confidence: 0.7 }, DEFAULT_OPT_CONFIG, sink);
  assert.equal(at.kind, 'call', 'confidence at/above threshold must call');
  assert.equal(sink.of('tool_selection_ask').length, 1, 'a normal call must NOT emit an ask event');

  // TEETH: a high-risk write that is ambiguous ASKS even with a borderline-OK score (#2 — a wrong write
  // is the worst outcome), and is logged.
  const write = writeTool('send_email');
  const w = await confidenceGate(
    { candidate: write, confidence: 0.9, highRiskWriteAmbiguous: true },
    DEFAULT_OPT_CONFIG,
    sink,
  );
  assert.equal(w.kind, 'ask', 'an ambiguous high-risk write must ask even above threshold');
  assert.equal(sink.of('tool_selection_ask').length, 2);

  // TEETH: no candidate → ask (never fabricate a call), logged.
  const none = await confidenceGate({ candidate: undefined, confidence: 0 }, DEFAULT_OPT_CONFIG, sink);
  assert.equal(none.kind, 'ask');
  assert.equal(sink.of('tool_selection_ask').length, 3);
});

// ─────────────────────────────────────────────────────────────────────────────────────
// AC-3.OPT.002.1 — a repeated identical read is served from cache; NO second connector call.
// ─────────────────────────────────────────────────────────────────────────────────────
test('AC-3.OPT.002.1 a repeated identical read is served from cache with no second connector call', async () => {
  const cache = new RunReadCache();
  const t = readTool('get_thread');
  let calls = 0;
  const fetch = async () => {
    calls += 1;
    return { thread: 'abc', n: calls };
  };

  const first = await cache.readThrough(t, { id: 'T1' }, fetch);
  const second = await cache.readThrough(t, { id: 'T1' }, fetch);

  assert.equal(calls, 1, 'the second identical read must NOT call the connector again');
  assert.deepEqual(second, first, 'the cached value is returned unchanged');
  assert.equal(cache.stats.hits, 1);
  assert.equal(cache.stats.misses, 1);

  // Key identity is order-independent: {id,box} == {box,id} → still a hit, still one call.
  await cache.readThrough(t, { id: 'T2', box: 'inbox' }, fetch); // miss → 2 calls
  await cache.readThrough(t, { box: 'inbox', id: 'T2' }, fetch); // reordered args → HIT, no new call
  assert.equal(calls, 2, 'reordered-but-identical args hit the same cache entry');

  // TEETH: a DIFFERENT read is a genuine miss (the cache is not a global always-hit).
  await cache.readThrough(t, { id: 'DIFFERENT' }, fetch);
  assert.equal(calls, 3, 'a distinct read must miss and call the connector');

  // TEETH: the cache is run-scoped — after dispose() it may not be used (no cross-run reuse).
  cache.dispose();
  await assert.rejects(() => cache.readThrough(t, { id: 'T1' }, fetch), /after dispose/);
});

// ─────────────────────────────────────────────────────────────────────────────────────
// AC-3.OPT.002.2 — a write is NEVER cached or served from cache.
// ─────────────────────────────────────────────────────────────────────────────────────
test('AC-3.OPT.002.2 a write is never cached or served from cache', async () => {
  const cache = new RunReadCache();
  const w = writeTool('send_email');

  // Routing a write THROUGH the read cache is a structural error — the category branch rejects it.
  await assert.rejects(
    () => cache.readThrough(w, { to: 'x@y.z' }, async () => 'sent'),
    WriteNotCacheableError,
    'a write must never be served through the read cache',
  );

  // The write path's explicit guard records the rejection and NEVER populates the cache.
  cache.assertWriteUncacheable(w);
  assert.equal(cache.stats.writesRejected, 1);
  assert.equal(cache.size, 0, 'a write must never create a cache entry');
  assert.equal(cache.has(w.connector, w.name, { to: 'x@y.z' }), false, 'a write is never cached');

  // TEETH: even after a write with identical args to a later READ of the same name, the write left NO
  // entry — the read is a genuine miss (a write can never be SERVED as if it were a cached read).
  const r = readTool('send_email'); // same name, but a read tool
  let calls = 0;
  await cache.readThrough(r, { to: 'x@y.z' }, async () => {
    calls += 1;
    return 'read-result';
  });
  assert.equal(calls, 1, 'the read must actually call — the prior write left nothing to serve');

  // TEETH: assertWriteUncacheable on a READ tool is itself a programming error (guard is write-only).
  assert.throws(() => cache.assertWriteUncacheable(readTool('get_thread')), /read/);
});

// ─────────────────────────────────────────────────────────────────────────────────────
// AC-3.OPT.003.1 — batch-capable connector groups reads within the documented limit; over-limit rejected.
// ─────────────────────────────────────────────────────────────────────────────────────
test('AC-3.OPT.003.1 batch-capable connector groups reads within the documented limit; over-limit rejected', () => {
  // Gmail per-API batch, recommend ≤50 (google-gmail.md §4). 120 reads @ limit 50 → 50 + 50 + 20.
  const plan = planBatches(120, { batchable: true, limit: 50 });
  assert.equal(plan.mode, 'batched');
  if (plan.mode !== 'batched') throw new Error('unreachable');
  assert.deepEqual(plan.groups.map((g) => g.length), [50, 50, 20]);
  for (const g of plan.groups) {
    assert.ok(g.length <= 50, 'no group may exceed the documented limit (no over-large batch)');
  }
  // Every read index appears exactly once (no dropped/duplicated reads).
  assert.deepEqual(plan.groups.flat(), Array.from({ length: 120 }, (_, i) => i));

  // A non-batching connector falls through to INDIVIDUAL calls (FR-3.OPT.003 branch → rate tiers).
  const indiv = planBatches(7, { batchable: false, limit: 0 });
  assert.equal(indiv.mode, 'individual');
  if (indiv.mode !== 'individual') throw new Error('unreachable');
  assert.equal(indiv.count, 7);

  // TEETH: an over-limit batch is REJECTED outright (no over-large batch — AC-3.OPT.003.1 edge).
  assert.throws(() => assertWithinLimit(51, { batchable: true, limit: 50 }), OverLimitBatchError);
  assert.doesNotThrow(() => assertWithinLimit(50, { batchable: true, limit: 50 }));

  // TEETH: batching a non-batchable connector is rejected (never silently batch what can't batch).
  assert.throws(() => assertWithinLimit(2, { batchable: false, limit: 0 }), OverLimitBatchError);

  // clampBatch splits an over-limit set rather than sending it whole.
  const reads = Array.from({ length: 130 }, (_, i) => `r${i}`);
  const { accepted, overflow } = clampBatch(reads, { batchable: true, limit: 50 });
  assert.equal(accepted.length, 50);
  assert.equal(overflow.length, 80);
});

// ─────────────────────────────────────────────────────────────────────────────────────
// AC-3.OPT.004.1 — missing tool → doable part completes; no hard fail; no silent partial.
// ─────────────────────────────────────────────────────────────────────────────────────
test('AC-3.OPT.004.1 a missing tool completes the doable part and flags the gap (no hard fail, no silent partial)', async () => {
  const sink = new InMemoryOptEventSink();

  // The doable part produced a real (partial) output; ONE tool was missing, non-blocking.
  const deg: Degradation[] = [
    { missing_tool: 'crm_lookup', reason: 'disconnected', skipped: ['enrich contact from CRM'], blocking: false },
  ];
  const result = await degrade({ summary: 'drafted reply from email thread' }, deg, sink);

  // No throw — the task did NOT hard-fail; the doable part is present.
  assert.deepEqual(result.output, { summary: 'drafted reply from email thread' });
  assert.equal(result.paused, false, 'a non-blocking missing tool does NOT pause the task');

  // The gap is LOGGED (never silent — #3): a tool_unavailable event exists.
  assert.equal(sink.of('tool_unavailable').length, 1);

  // NO SILENT PARTIAL: the result reports itself as NOT complete, and consuming it as complete THROWS.
  assert.equal(isComplete(result), false, 'a result with a gap is not complete');
  assert.throws(() => assertConsumable(result), UnreadGapError, 'a partial cannot be presented as complete');

  // TEETH: a fully-blocking dependency PAUSES (recoverable, handed to DSC) — never a hard fail.
  const sink2 = new InMemoryOptEventSink();
  const blocking = await degrade({ summary: 'nothing doable' }, [
    { missing_tool: 'calendar', reason: 'unscoped', skipped: ['everything'], blocking: true },
  ], sink2);
  assert.equal(blocking.paused, true, 'a blocking dependency pauses (recoverable), not hard-fails');
  assert.equal(isComplete(blocking), false);
  assert.throws(() => assertConsumable(blocking), UnreadGapError);
  assert.equal(sink2.of('tool_unavailable').length, 1, 'the blocking gap is logged too');

  // TEETH: a result with NO degradations IS complete + consumable (the guarantee is not always-fail).
  const clean = await degrade({ summary: 'all done' }, [], sink);
  assert.equal(isComplete(clean), true);
  assert.doesNotThrow(() => assertConsumable(clean));
});

// ─────────────────────────────────────────────────────────────────────────────────────
// AC-3.OPT.004.2 — the gap is a STRUCTURED mandatory-to-read field, asserted by a consumer-side read.
// ─────────────────────────────────────────────────────────────────────────────────────
test('AC-3.OPT.004.2 the gap is a structured, mandatory-to-read field a consumer must read', async () => {
  const sink = new InMemoryOptEventSink();
  const result = await degrade({ rows: [1, 2, 3] }, [
    { missing_tool: 'slack_post', reason: 'disabled', skipped: ['notify #ops'], blocking: false },
  ], sink);

  // The gap is STRUCTURED (typed fields), NOT advisory free-text: a consumer reads machine-readable
  // fields, not prose.
  assert.equal(result.gaps.length, 1);
  const gap = result.gaps[0]!;
  assert.equal(gap.missing_tool, 'slack_post');
  assert.equal(gap.reason, 'disabled'); // enum, not prose
  assert.deepEqual(gap.skipped, ['notify #ops']);
  assert.equal(gap.acknowledged, false, 'a fresh gap is unacknowledged — it MUST be read');
  assert.equal(typeof gap.reason, 'string');

  // MANDATORY-TO-READ: before a consumer acknowledges, the result cannot be presented as complete.
  assert.equal(hasUnacknowledgedGap(result), true);
  assert.throws(() => assertConsumable(result), UnreadGapError);

  // CONSUMER-SIDE READ (the AC is asserted by a consumer reading the field): the consumer reads the gap,
  // acknowledges it, and only THEN may proceed on the partial.
  acknowledgeGap(gap);
  assert.equal(hasUnacknowledgedGap(result), false);
  assert.doesNotThrow(() => assertConsumable(result), 'after the consumer reads+acks the gap, it may proceed');

  // TEETH: acknowledging ONE of TWO gaps still blocks (every gap is mandatory-to-read).
  const sink2 = new InMemoryOptEventSink();
  const two = await degrade({ rows: [] }, [
    { missing_tool: 'a', reason: 'disconnected', skipped: ['x'], blocking: false },
    { missing_tool: 'b', reason: 'unscoped', skipped: ['y'], blocking: false },
  ], sink2);
  acknowledgeGap(two.gaps[0]!);
  assert.throws(() => assertConsumable(two), UnreadGapError, 'an unread second gap still blocks presentation');
  acknowledgeGap(two.gaps[1]!);
  assert.doesNotThrow(() => assertConsumable(two));
});

// ─────────────────────────────────────────────────────────────────────────────────────
// Fake-vs-live discipline: the sink rejects an event the live enum would reject (not silently accept).
// ─────────────────────────────────────────────────────────────────────────────────────
test('the event sink rejects a bad event_type and an empty summary (mirrors the live DDL constraints)', async () => {
  const sink = new InMemoryOptEventSink();
  await assert.rejects(
    // @ts-expect-error — an event_type outside the OPT-admitted set is a compile error AND a runtime reject.
    () => sink.append({ event_type: 'not_a_real_type', summary: 'x', payload: {}, task_id: null }),
    /not in the OPT-admitted set/,
  );
  await assert.rejects(
    () => sink.append({ event_type: 'tool_unavailable', summary: '   ', payload: {}, task_id: null }),
    /summary must be non-empty/,
  );
});
