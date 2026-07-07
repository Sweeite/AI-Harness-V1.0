// ISSUE-047 — one test per AC in §4 Definition of done. Proved against the InMemoryTriggerStore reference
// model (offline; the live AF-135 freeze-propagation SPIKE + at-least-once forcing test is the ISSUE-047
// capstone, owed to an operator-present session — see results/AF-135-live-spike-owed.md).
//
// AC map:
//   AC-5.TRG.001.1   — task_queue.type is enum-constrained; no other value is accepted
//   AC-5.TRG.001.2   — each of the four sources fires => exactly one row, matching type + originating payload
//   AC-5.TRG.001.3   — the deployment-freeze gate blocks a firing trigger + logs the block
//   AC-5.TRG.002.1   — a config-defined trigger is active at boot with no code change; a disabled one fires nothing
//   AC-5.TRG.003.1   — an unverified webhook creates no task (rejected at the ingress seam)
//   AC-5.TRG.004.1   — chained B: FRESH envelope + handoff payload + provenance link + B's OWN retrieval
//   AC-5.TRG.004.2   — none of A's above-B-clearance memories appear in B's context
//   AC-5.TRG.005.1   — a verified event whose insert fails => recorded + surfaced ingest-failure, NOT acknowledged
//   AC-5.TRG.005.2   — a delivery watermark makes accept->row at-least-once; a re-delivery de-dups
//   AC-NFR-INF.012.1 — the gate fails closed at the DISPATCH boundary (block+log, not a label)
//   AC-NFR-INF.012.2 — the gate fails closed on a status-resolution AMBIGUITY (unresolvable read => blocked)
//   AF-135 (offline)  — EVERY dispatch path (event / scheduled / manual / chained / queue-run) routes the gate
//                       — the completeness claim; the LIVE spike is owed operator-present (NOT proven here)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  InMemoryTriggerStore,
  TriggerRegistry,
  fireTrigger,
  dispatchQueuedTask,
  ingestVerifiedEvent,
  fireChained,
  evaluateFreeze,
  TriggerError,
  ERR_FROZEN,
  ERR_UNVERIFIED,
  EVT_FROZEN_BLOCKED,
  EVT_INGEST_FAILURE,
  EVT_WATERMARK_FAILURE,
  type ScopedRetrieval,
  type VerifiedEvent,
} from './index.ts';

const FROZEN_AT = '2026-07-05T00:00:00.000Z';

// ── AC-5.TRG.001.1 — type is enum-constrained ──────────────────────────────────────────────────────
test('AC-5.TRG.001.1 — a non-enum task type is rejected; only the four are accepted', async () => {
  const store = new InMemoryTriggerStore();
  // Every valid type is accepted.
  for (const t of ['scheduled', 'event', 'human', 'chained'] as const) {
    const row = await fireTrigger(store, { type: t, task_name: `t-${t}`, payload: {} });
    assert.equal(row.type, t);
  }
  // A bogus type is rejected AND writes no row.
  const before = store._taskCount();
  await assert.rejects(
    // deliberately smuggle a bad value past the type system, as a raw connector payload could
    () => fireTrigger(store, { type: 'webhook' as never, task_name: 'bad', payload: {} }),
    (e: unknown) => e instanceof TriggerError && e.reason === 'bad_task_type',
  );
  assert.equal(store._taskCount(), before, 'a rejected type must create no task row');
});

// ── AC-5.TRG.001.2 — one row per source, matching type + payload ────────────────────────────────────
test('AC-5.TRG.001.2 — each source creates exactly one row with the matching type + originating payload', async () => {
  const store = new InMemoryTriggerStore();
  const cases = [
    { type: 'scheduled' as const, payload: { cron: '0 9 * * *' } },
    { type: 'event' as const, payload: { hook: 'ghl.contact' } },
    { type: 'human' as const, payload: { cmd: '/run' } },
    { type: 'chained' as const, payload: { from: 'parent' } },
  ];
  for (const c of cases) {
    const row = await fireTrigger(store, { type: c.type, task_name: `n-${c.type}`, payload: c.payload });
    assert.equal(row.type, c.type);
    assert.deepEqual(row.payload, c.payload, 'the originating payload is carried onto the row');
  }
  assert.equal(store._taskCount(), 4, 'exactly one row per firing source — no duplicates, no drops');
  // Payload is copied, not aliased — mutating the row must not reach back into caller state and vice versa.
  const src = { k: 1 };
  const r = await fireTrigger(store, { type: 'human', task_name: 'iso', payload: src });
  src.k = 999;
  assert.equal(r.payload.k, 1, 'the stored payload is a copy, not a live alias of the caller object');
});

// ── AC-5.TRG.001.3 / AC-NFR-INF.012.1 — freeze blocks a firing trigger + logs ───────────────────────
test('AC-5.TRG.001.3 / AC-NFR-INF.012.1 — a freeze blocks a firing trigger, creates nothing, and logs the block', async () => {
  const store = new InMemoryTriggerStore();
  store._setFrozen(FROZEN_AT, 'offboarding');
  await assert.rejects(
    () => fireTrigger(store, { type: 'event', task_name: 'x', payload: { a: 1 } }),
    (e: unknown) => e instanceof TriggerError && e.reason === ERR_FROZEN,
  );
  assert.equal(store._taskCount(), 0, 'a frozen deployment creates NO task (fails closed, not a label)');
  const evts = store._events();
  assert.equal(evts.length, 1, 'the block is logged exactly once');
  assert.equal(evts[0]!.event_type, EVT_FROZEN_BLOCKED);
  assert.equal(evts[0]!.payload.path, 'event');
  assert.equal(evts[0]!.payload.reason, 'frozen_at_set');
  assert.ok(evts[0]!.summary.length > 0, 'the block event carries a non-empty summary');
  // And un-freezing restores dispatch (proves the block was the freeze, not a broken path).
  store._setFrozen(null);
  const ok = await fireTrigger(store, { type: 'event', task_name: 'x2', payload: {} });
  assert.ok(ok.id, 'once unfrozen the same path dispatches normally');
});

// ── AC-NFR-INF.012.2 — fails closed on status AMBIGUITY ─────────────────────────────────────────────
test('AC-NFR-INF.012.2 — an unresolvable settings read fails CLOSED (treated as frozen), never open', async () => {
  const store = new InMemoryTriggerStore();
  store._setSettingsUnresolvable(true); // frozen_at is unknown — the read throws
  const verdict = await evaluateFreeze(store);
  assert.equal(verdict.frozen, true, 'ambiguity must resolve to frozen, not to "assume open"');
  assert.equal(verdict.reason, 'settings_unresolvable');
  await assert.rejects(
    () => fireTrigger(store, { type: 'scheduled', task_name: 'x', payload: {} }),
    (e: unknown) => e instanceof TriggerError && e.reason === ERR_FROZEN,
  );
  assert.equal(store._taskCount(), 0, 'no task created while the freeze status is ambiguous');
  const evts = store._events();
  assert.equal(evts[0]!.payload.reason, 'settings_unresolvable', 'the ambiguity block is logged with its reason');
});

// ── AC-5.TRG.002.1 — config-defined registry; disabled fires nothing ────────────────────────────────
test('AC-5.TRG.002.1 — a config-defined trigger is active at boot; a disabled one creates no tasks', async () => {
  const store = new InMemoryTriggerStore();
  const registry = TriggerRegistry.fromConfig([
    { key: 'ghl-new-contact', type: 'event', enabled: true },
    { key: 'nightly-digest', type: 'scheduled', enabled: false },
  ]);
  // Enabled trigger is active with no code change.
  assert.equal(registry.isActive('ghl-new-contact'), true);
  const row = await fireTrigger(store, {
    type: 'event',
    task_name: 'contact',
    payload: {},
    trigger_key: 'ghl-new-contact',
    registry,
  });
  assert.ok(row.id);
  // Disabled trigger fires nothing.
  assert.equal(registry.isActive('nightly-digest'), false);
  await assert.rejects(
    () => fireTrigger(store, { type: 'scheduled', task_name: 'digest', payload: {}, trigger_key: 'nightly-digest', registry }),
    (e: unknown) => e instanceof TriggerError && e.reason === 'trigger_disabled',
  );
  // An UNKNOWN trigger key is also inert (not silently allowed).
  await assert.rejects(
    () => fireTrigger(store, { type: 'event', task_name: 'ghost', payload: {}, trigger_key: 'does-not-exist', registry }),
    (e: unknown) => e instanceof TriggerError && e.reason === 'trigger_disabled',
  );
  assert.equal(store._taskCount(), 1, 'only the one enabled trigger produced a task');
});

// ── AC-5.TRG.003.1 — unverified webhook creates no task ─────────────────────────────────────────────
test('AC-5.TRG.003.1 — an unverified event is rejected at the ingress seam; no task is created', async () => {
  const store = new InMemoryTriggerStore();
  const unverified: VerifiedEvent = { delivery_id: 'd1', verified: false, task_name: 'evt', payload: {} };
  await assert.rejects(
    () => ingestVerifiedEvent(store, unverified),
    (e: unknown) => e instanceof TriggerError && e.reason === ERR_UNVERIFIED,
  );
  assert.equal(store._taskCount(), 0, 'an unverified event never becomes a task');
  // A verified event on the SAME seam does create one — proving the reject was the verification, not a dead path.
  const verified: VerifiedEvent = { delivery_id: 'd2', verified: true, task_name: 'evt', payload: { ok: true } };
  const res = await ingestVerifiedEvent(store, verified);
  assert.equal(res.ok, true);
  assert.equal(store._taskCount(), 1);
});

// ── AC-5.TRG.004.1 — chained B: fresh envelope + provenance + own retrieval ─────────────────────────
test('AC-5.TRG.004.1 — a chained successor gets a FRESH envelope, handoff payload, provenance link, and its OWN memories', async () => {
  const store = new InMemoryTriggerStore();
  const parent = {
    id: 'parent-1',
    task_name: 'A',
    output: { result: 42 },
    memory_retrieved: [{ id: 'mA', clearance: 'standard' }],
  };
  const bMems = [{ id: 'mB', clearance: 'standard' }];
  const retrieve: ScopedRetrieval = async () => bMems;
  const chained = await fireChained(store, parent, { successor_name: 'B', handoff: { seed: parent.output.result } }, retrieve);

  assert.equal(chained.task.type, 'chained');
  assert.equal(chained.task.parent_task_id, 'parent-1', 'provenance link to A is set');
  assert.deepEqual(chained.envelope.handoff, { seed: 42 }, 'B carries the explicit handoff payload, not A\'s whole envelope');
  assert.deepEqual(chained.envelope.provenance, { parent_task_id: 'parent-1', parent_task_name: 'A' });
  assert.deepEqual(chained.envelope.memory_retrieved, bMems, 'B\'s memories come from B\'s OWN retrieval');
  // TEETH: B's memory set must be exactly B's retrieval, never A's — even the ids must differ.
  const bIds = chained.envelope.memory_retrieved.map((m) => m.id);
  assert.ok(!bIds.includes('mA'), 'A\'s retrieved memory must NOT appear in B (no envelope inheritance)');
});

// ── AC-5.TRG.004.2 — no above-B-clearance memory of A's leaks into B ────────────────────────────────
test('AC-5.TRG.004.2 — A\'s above-B-clearance memories never appear in B\'s context', async () => {
  const store = new InMemoryTriggerStore();
  // A held a 'confidential' memory above B's clearance. B is a 'standard'-clearance task.
  const parent = {
    id: 'parent-2',
    task_name: 'A',
    output: {},
    memory_retrieved: [
      { id: 'secret-A', clearance: 'confidential' },
      { id: 'ok-A', clearance: 'standard' },
    ],
  };
  // B re-runs its OWN retrieval under its OWN (standard) clearance — the retrieval function returns only what
  // B is cleared for. It is NEVER handed A's memory_retrieved.
  const retrieve: ScopedRetrieval = async () => [{ id: 'b-own', clearance: 'standard' }];
  const chained = await fireChained(store, parent, { successor_name: 'B', handoff: {} }, retrieve);

  const bIds = chained.envelope.memory_retrieved.map((m) => m.id);
  assert.ok(!bIds.includes('secret-A'), 'A\'s above-clearance memory must NOT be in B');
  assert.ok(!bIds.includes('ok-A'), 'even A\'s same-clearance memory is not inherited — B retrieved independently');
  assert.deepEqual(bIds, ['b-own'], 'B\'s context is exactly its own retrieval');
});

// ── AC-5.TRG.005.1 — insert failure => recorded ingest-failure, NOT acknowledged ────────────────────
test('AC-5.TRG.005.1 — a verified event whose insert fails is recorded + surfaced and NOT acknowledged', async () => {
  const store = new InMemoryTriggerStore();
  store._failNextInsert(); // model an engine-unreachable insert failure
  const evt: VerifiedEvent = { delivery_id: 'd-fail', verified: true, task_name: 'e', payload: {} };
  const res = await ingestVerifiedEvent(store, evt);

  assert.equal(res.ok, false);
  assert.equal(res.ingest_failure, true);
  assert.equal(store._taskCount(), 0, 'no task row was created');
  const evts = store._events();
  assert.equal(evts.length, 1);
  assert.equal(evts[0]!.event_type, EVT_INGEST_FAILURE, 'the failure is loudly recorded to the C7 sink');
  // NOT acknowledged: the watermark was not set, so a RE-DELIVERY retries (and now succeeds).
  assert.equal(await store.isDelivered('d-fail'), false, 'a failed ingest is NOT watermarked (not acknowledged)');
  const retry = await ingestVerifiedEvent(store, evt);
  assert.equal(retry.ok, true, 're-delivery after the failure produces the row — no silent loss');
  assert.equal(store._taskCount(), 1);
});

// ── logic-sweep (triggers.ts:177) — a POST-commit watermark failure must NOT be reported as "no task row" ──
test('logic-sweep — insert commits then markDelivered fails: distinct watermark-failure event, committed row preserved, NOT a false lost-ingest', async () => {
  const store = new InMemoryTriggerStore();
  store._failNextMark(); // insert commits, then the watermark write throws (post-commit contention/outage)
  const evt: VerifiedEvent = { delivery_id: 'd-mark-fail', verified: true, task_name: 'e', payload: { n: 7 } };
  const res = await ingestVerifiedEvent(store, evt);

  // The row WAS committed — the audit trail and return value must not claim otherwise (#3: no lying event_log).
  assert.equal(store._taskCount(), 1, 'the committed task row is NOT lost when only the watermark fails');
  assert.notEqual(res.ingest_failure, true, 'a committed row is NOT a "produced no task row" ingest-failure');

  const evts = store._events();
  assert.equal(evts.length, 1, 'the watermark failure is loudly recorded');
  assert.equal(
    evts[0]!.event_type,
    EVT_WATERMARK_FAILURE,
    'a post-commit watermark failure is a DISTINCT event, not EVT_INGEST_FAILURE',
  );
  assert.notEqual(evts[0]!.event_type, EVT_INGEST_FAILURE, 'must not claim the event produced no task row');

  // Still un-acknowledged: no watermark => a re-delivery is a CONTROLLED at-least-once duplicate, not a lost event.
  assert.equal(await store.isDelivered('d-mark-fail'), false, 'a failed watermark leaves the delivery un-acknowledged');
  const retry = await ingestVerifiedEvent(store, evt);
  assert.equal(retry.ok, true, 're-delivery succeeds (at-least-once); no silent loss');
  assert.equal(store._taskCount(), 2, 'the un-acknowledged delivery yields a controlled duplicate on retry, not a phantom loss');
});

// ── AC-5.TRG.005.2 — watermark at-least-once + re-delivery dedup ─────────────────────────────────────
test('AC-5.TRG.005.2 — the delivery watermark makes accept->row at-least-once and de-dups a re-delivery', async () => {
  const store = new InMemoryTriggerStore();
  const evt: VerifiedEvent = { delivery_id: 'd-dup', verified: true, task_name: 'e', payload: { n: 1 } };
  const first = await ingestVerifiedEvent(store, evt);
  assert.equal(first.ok, true);
  assert.ok(first.task, 'first delivery produces a row');
  assert.equal(await store.isDelivered('d-dup'), true, 'the delivery is watermarked after the committed row');

  // A re-delivery of the same id de-dups — no second row.
  const second = await ingestVerifiedEvent(store, evt);
  assert.equal(second.deduped, true, 'a re-delivered event is de-duplicated');
  assert.equal(second.task, undefined, 'no second task row is created');
  assert.equal(store._taskCount(), 1, 'exactly one row survives an at-least-once double delivery');
});

// ── AF-135 (offline completeness) — EVERY dispatch path routes the freeze gate ──────────────────────
test('AF-135 (offline) — every dispatch path (event/scheduled/human/chained/queue-run) is blocked + logged under a freeze', async () => {
  const retrieve: ScopedRetrieval = async () => [];

  // Each entry is a distinct dispatch path; under a freeze it MUST throw ERR_FROZEN, create no row, and log.
  const paths: Array<{ label: string; run: (s: InMemoryTriggerStore) => Promise<unknown> }> = [
    { label: 'event-trigger', run: (s) => fireTrigger(s, { type: 'event', task_name: 'e', payload: {} }) },
    { label: 'scheduled-loop', run: (s) => fireTrigger(s, { type: 'scheduled', task_name: 's', payload: {} }) },
    { label: 'manual-task', run: (s) => fireTrigger(s, { type: 'human', task_name: 'h', payload: {} }) },
    {
      label: 'chained-successor',
      run: (s) => fireChained(s, { id: 'p', task_name: 'A', output: {} }, { successor_name: 'B', handoff: {} }, retrieve),
    },
    { label: 'ingest-verified-event', run: (s) => ingestVerifiedEvent(s, { delivery_id: 'x', verified: true, task_name: 'e', payload: {} }) },
    { label: 'queue-dispatch-to-run', run: (s) => dispatchQueuedTask(s, 'task-xyz') },
  ];

  for (const p of paths) {
    const store = new InMemoryTriggerStore();
    store._setFrozen(FROZEN_AT);
    await assert.rejects(
      () => p.run(store),
      (e: unknown) => e instanceof TriggerError && e.reason === ERR_FROZEN,
      `path '${p.label}' MUST be blocked by the freeze gate`,
    );
    assert.equal(store._taskCount(), 0, `path '${p.label}' created a task despite the freeze`);
    const evts = store._events();
    assert.equal(evts.length, 1, `path '${p.label}' did not log exactly one freeze-block`);
    assert.equal(evts[0]!.event_type, EVT_FROZEN_BLOCKED, `path '${p.label}' logged the wrong event type`);
  }

  // TEETH — negative control: the SAME six paths all succeed when NOT frozen, proving the block is the freeze,
  // not a universally-dead path (a tautology guard).
  for (const p of paths) {
    const store = new InMemoryTriggerStore();
    await p.run(store); // must NOT throw
  }
});
