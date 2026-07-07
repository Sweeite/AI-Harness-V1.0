// ISSUE-049 (C5 GRP) — offline proof of EVERY §4 AC against the in-memory reference model. Deterministic:
// a logical `now` (epoch seconds) is supplied; no Date.now()/random. Each test names the AC it proves.
//
// AC coverage map (§4 Definition of done):
//   AC-5.GRP.001.1  — graph runs in dependency order (not array order); no ad-hoc improvisation.
//   AC-5.GRP.001.2  — a type with NO registered graph fails LOUDLY + records at dequeue (never silent pending).
//   AC-5.GRP.002.1  — an edit creates a NEW version (prior retained) with non-empty change_reason; empty rejected.
//   AC-5.GRP.003.1  — stable idempotency key per task + per step; a retried completed step dedups (no re-fire).
//   AC-5.GRP.003.2  — crash-window: key committed BEFORE side effect; a crash between them → no double-fire.
//   AC-5.GRP.003.3  — collision-resistance: distinct side effects → distinct keys; identical retry → same key.
//   AC-5.GRP.004.1  — resume from first incomplete step; steps 1..k-1 reused (not re-executed).
//   AC-NFR-PERF.007.1 — over-limit graph is a VISIBLE reject (or logged trim), never a silent truncation.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ADMITTED_EVENT_TYPES,
  CONFIG_ERROR_EVENT_TYPE,
  CrashWindowError,
  DEFAULT_GRAPH_CONFIG,
  EnumCheckingConfigErrorSink,
  ERR_CYCLE,
  ERR_DUP_STEP_ID,
  ERR_EMPTY_CHANGE_REASON,
  ERR_NO_GRAPH,
  ERR_OVER_LIMIT,
  ERR_UNKNOWN_DEP,
  eventTypeForKind,
  GraphExecutor,
  InMemoryGraphStore,
  InMemoryHistoryStore,
  InMemoryIdempotencyLedger,
  LEDGER_CONNECTOR,
  resolveDependencyOrder,
  stepIdempotencyKey,
  taskIdempotencyKey,
  validateSteps,
  type ConfigErrorEvent,
  type ConfigErrorSink,
  type GraphStep,
  type RunStep,
} from './index.ts';

// ── a collecting ConfigErrorSink so a test can assert a config error was RECORDED (not swallowed). ────────
class CollectingSink implements ConfigErrorSink {
  readonly events: ConfigErrorEvent[] = [];
  async record(ev: ConfigErrorEvent): Promise<void> {
    this.events.push(ev);
  }
}

const NOW = 1_700_000_000; // fixed logical epoch seconds

function linearSteps(n: number): GraphStep[] {
  // step-0 has no deps; step-i depends on step-(i-1) → a strict chain of length n.
  return Array.from({ length: n }, (_, i) => ({
    step_id: `s${i}`,
    kind: 'tool_call' as const,
    depends_on: i === 0 ? [] : [`s${i - 1}`],
    failure_mode: 'retry' as const,
    payload: { i },
  }));
}

// ── AC-5.GRP.001.1 — graph runs in DEPENDENCY order, not array order. ──────────────────────────────────
test('AC-5.GRP.001.1 — executes steps in dependency order (topological), not array order', async () => {
  const graphs = new InMemoryGraphStore();
  // Array order is [c, a, b] but deps force a → b → c. Executor must run a,b,c.
  const steps: GraphStep[] = [
    { step_id: 'c', kind: 'tool_write', depends_on: ['b'], failure_mode: 'halt' },
    { step_id: 'a', kind: 'memory_read', depends_on: [], failure_mode: 'retry' },
    { step_id: 'b', kind: 'ai_call', depends_on: ['a'], failure_mode: 'retry' },
  ];
  await graphs.putVersion({ task_type_name: 'summarise', steps, change_reason: 'initial' }, NOW);

  const order = resolveDependencyOrder(steps).map((s) => s.step_id);
  assert.deepEqual(order, ['a', 'b', 'c'], 'topological order overrides array order');

  const exec = new GraphExecutor(graphs, new InMemoryHistoryStore(), new InMemoryIdempotencyLedger(), new CollectingSink());
  const fired: string[] = [];
  const run: RunStep = async (step) => {
    fired.push(step.step_id);
    return { done: step.step_id };
  };
  const res = await exec.execute('summarise', 'task-1', run, NOW);
  assert.deepEqual(fired, ['a', 'b', 'c'], 'side effects fire in dependency order');
  assert.deepEqual(res.results.map((r) => r.step_id), ['a', 'b', 'c']);
  assert.deepEqual(res.reused, [], 'a fresh run reuses nothing');
});

test('resolveDependencyOrder rejects unknown deps, duplicate ids, and cycles (FR-5.GRP.001 gates)', () => {
  assert.throws(
    () => resolveDependencyOrder([{ step_id: 'x', kind: 'tool_call', depends_on: ['nope'], failure_mode: 'retry' }]),
    new RegExp(ERR_UNKNOWN_DEP('x', 'nope').slice(0, 30).replace(/[()]/g, '.')),
  );
  assert.throws(
    () =>
      resolveDependencyOrder([
        { step_id: 'x', kind: 'tool_call', depends_on: [], failure_mode: 'retry' },
        { step_id: 'x', kind: 'tool_call', depends_on: [], failure_mode: 'retry' },
      ]),
    (e: Error) => e.message === ERR_DUP_STEP_ID('x'),
  );
  assert.throws(
    () =>
      resolveDependencyOrder([
        { step_id: 'a', kind: 'tool_call', depends_on: ['b'], failure_mode: 'retry' },
        { step_id: 'b', kind: 'tool_call', depends_on: ['a'], failure_mode: 'retry' },
      ]),
    (e: Error) => e.message.startsWith('task_graph: dependency cycle'),
  );
  // sanity: the cycle message renders both nodes
  assert.ok(ERR_CYCLE(['a', 'b']).includes('a → b'));
});

// ── AC-5.GRP.001.2 — a graph-less type fails LOUDLY + records, never silently pending. ─────────────────
test('AC-5.GRP.001.2 — graph-less task type fails loudly with a recorded error at dequeue', async () => {
  const graphs = new InMemoryGraphStore();
  const sink = new CollectingSink();
  const exec = new GraphExecutor(graphs, new InMemoryHistoryStore(), new InMemoryIdempotencyLedger(), sink);

  await assert.rejects(
    () => exec.resolveGraph('unregistered_type', 'task-9'),
    (e: Error) => e.message === ERR_NO_GRAPH('unregistered_type'),
    'resolving a graph-less type throws (loud fail, not silent pending)',
  );
  // #3: the failure is RECORDED, not swallowed.
  assert.equal(sink.events.length, 1);
  assert.equal(sink.events[0]!.kind, 'no_graph');
  assert.equal(sink.events[0]!.task_id, 'task-9');
  assert.ok(sink.events[0]!.summary.length > 0, 'recorded error has a plain-English summary (#3)');

  // and execute() (the dequeue path) also loud-fails for a graph-less type.
  await assert.rejects(() => exec.execute('unregistered_type', 'task-9', async () => ({}), NOW));
});

// ── AC-5.GRP.002.1 — versioned append-only + mandatory change_reason. ──────────────────────────────────
test('AC-5.GRP.002.1 — editing a graph creates a NEW version (prior retained) with mandatory change_reason', async () => {
  const graphs = new InMemoryGraphStore();
  const v1 = await graphs.putVersion(
    { task_type_name: 'triage', steps: linearSteps(2), change_reason: 'initial graph' },
    NOW,
  );
  assert.equal(v1.version, 1);
  assert.equal(v1.previous_version_id, null);

  // an EDIT → a NEW version row; prior retained; previous_version_id links back.
  const v2 = await graphs.putVersion(
    { task_type_name: 'triage', steps: linearSteps(3), change_reason: 'added an enrichment step' },
    NOW + 60,
  );
  assert.equal(v2.version, 2, 'edit creates version 2, not an overwrite');
  assert.equal(v2.previous_version_id, v1.id, 'links back to the retained prior version');

  const current = await graphs.getCurrent('triage');
  assert.equal(current!.version, 2, 'current is the latest version');
  const all = await graphs.listVersions('triage');
  assert.deepEqual(all.map((r) => r.version), [1, 2], 'BOTH versions retained (append-only, #1)');
  assert.equal(all[0]!.steps.length, 2, 'prior version body is UNCHANGED — never overwritten');

  // a save WITHOUT a reason is rejected — before any row is created.
  await assert.rejects(
    () => graphs.putVersion({ task_type_name: 'triage', steps: linearSteps(2), change_reason: '' }, NOW),
    (e: Error) => e.message === ERR_EMPTY_CHANGE_REASON,
  );
  await assert.rejects(
    () => graphs.putVersion({ task_type_name: 'triage', steps: linearSteps(2), change_reason: '   ' }, NOW),
    (e: Error) => e.message === ERR_EMPTY_CHANGE_REASON,
    'whitespace-only reason is rejected too',
  );
  // the rejected edits added NO rows.
  assert.equal((await graphs.listVersions('triage')).length, 2, 'rejected saves do not append');
});

// ── logic-sweep regression (store.ts:354) — concurrent edits must NOT produce duplicate versions. ────────
// Two putVersion() calls for the same type fired without awaiting between them used to both observe the same
// prior (the old `await this.getCurrent(...)` yielded to the microtask queue), each computing prior+1 → a
// DUPLICATE version, violating unique(task_type_name, version). The DB path holds a `for update` row lock; the
// in-memory reference model must uphold the same invariant so a concurrency test proves the DDL contract.
test('logic-sweep: concurrent putVersion for the same type yields distinct monotone versions (no dup)', async () => {
  const graphs = new InMemoryGraphStore();
  await graphs.putVersion({ task_type_name: 'concur', steps: linearSteps(2), change_reason: 'init' }, NOW);

  // fire two edits concurrently — no await between them — then settle both.
  const pA = graphs.putVersion({ task_type_name: 'concur', steps: linearSteps(3), change_reason: 'edit A' }, NOW + 1);
  const pB = graphs.putVersion({ task_type_name: 'concur', steps: linearSteps(4), change_reason: 'edit B' }, NOW + 2);
  await Promise.all([pA, pB]);

  const versions = (await graphs.listVersions('concur')).map((r) => r.version);
  assert.deepEqual(versions, [1, 2, 3], 'three versions, strictly monotone — no duplicate version');
  assert.equal(new Set(versions).size, versions.length, 'unique(task_type_name, version) upheld under concurrency');
});

// ── AC-5.GRP.003.1 — stable per-task/per-step key; a retried completed step dedups (no re-fire). ────────
test('AC-5.GRP.003.1 — stable idempotency keys; a retried completed step is a no-op (dedup)', async () => {
  // stability: same inputs → same key across calls.
  const k1 = stepIdempotencyKey('task-1', 's0', { a: 1, b: 2 });
  const k2 = stepIdempotencyKey('task-1', 's0', { b: 2, a: 1 }); // key ORDER must not matter
  assert.equal(k1, k2, 'canonicalised payload → stable key regardless of key order');
  const tk = taskIdempotencyKey('task-1', ['s0', 's1']);
  assert.ok(tk.startsWith('tsk_') && tk !== k1, 'task-level key is distinct from a step key');

  // dedup: a completed step, retried, does NOT re-fire its side effect.
  const graphs = new InMemoryGraphStore();
  await graphs.putVersion({ task_type_name: 'send', steps: linearSteps(2), change_reason: 'init' }, NOW);
  const history = new InMemoryHistoryStore();
  const ledger = new InMemoryIdempotencyLedger();
  const exec = new GraphExecutor(graphs, history, ledger, new CollectingSink());

  let fireCount = 0;
  const run: RunStep = async (step) => {
    fireCount += 1;
    return { fired: step.step_id };
  };
  await exec.execute('send', 'task-1', run, NOW);
  assert.equal(fireCount, 2, 'first run fires both steps once');

  // retry with NO history seeded — the LEDGER (completed keys) must dedup so nothing re-fires.
  const res2 = await exec.execute('send', 'task-1', run, NOW + 1);
  assert.equal(fireCount, 2, 'a retry of an all-completed task fires NOTHING again (dedup via ledger)');
  assert.deepEqual(res2.reused, [0, 1], 'both steps reused from the ledger');
});

// ── AC-5.GRP.003.2 — crash-window: key committed BEFORE side effect → a crash between them → no double-fire.
test('AC-5.GRP.003.2 — crash after side effect but before completion: key already committed, retry does not double-fire', async () => {
  const graphs = new InMemoryGraphStore();
  await graphs.putVersion({ task_type_name: 'charge', steps: linearSteps(3), change_reason: 'init' }, NOW);
  const history = new InMemoryHistoryStore();
  const ledger = new InMemoryIdempotencyLedger();
  const exec = new GraphExecutor(graphs, history, ledger, new CollectingSink());

  // Count REAL side effects. Step 1 (index 1) crashes AFTER its side effect fires but BEFORE completion.
  const sideEffects: number[] = [];
  const run: RunStep = async (step) => {
    sideEffects.push(Number(step.step_id.slice(1)));
    return { charged: step.step_id };
  };
  const crashAfter = (idx: number) => idx === 1;

  await assert.rejects(
    () => exec.execute('charge', 'task-1', run, NOW, crashAfter),
    (e: Error) => e instanceof CrashWindowError && (e as CrashWindowError).stepIndex === 1,
  );
  assert.deepEqual(sideEffects, [0, 1], 'step 0 completed; step 1 side effect FIRED then crashed');

  // The crash-window invariant: step 1's key was COMMITTED (reserved) before the side effect — so it survives
  // the crash even though completion was never recorded.
  const key1 = stepIdempotencyKey('task-1', 's1', { i: 1 });
  const entry = await ledger.get(key1);
  assert.ok(entry, 'the key was committed BEFORE the side effect (survives the crash)');
  assert.equal(entry!.completed, false, 'and it is reserved-but-not-completed (the crash window)');

  // RECONCILE: the orchestrator restart records the durable original for the step that DID land (task_history
  // is the durable-originals source of truth — ISSUE-050 owns it; here we seed what a recovery would persist).
  history.put({ task_id: 'task-1', step_index: 0, full_output: { charged: 's0' } });
  history.put({ task_id: 'task-1', step_index: 1, full_output: { charged: 's1' } });

  // Retry (no crash). Steps 0 and 1 must NOT re-fire (their side effects already landed); only step 2 fires.
  const before = sideEffects.length;
  const res = await exec.execute('charge', 'task-1', run, NOW + 5);
  const refired = sideEffects.slice(before);
  assert.deepEqual(refired, [2], 'ONLY step 2 fires on retry — steps 0,1 never double-fire (#2)');
  assert.deepEqual(res.reused, [0, 1], 'steps 0,1 reused from preserved output');
  assert.equal(res.results.length, 3, 'the full graph completes with no lost output (#1)');
});

// ── AC-5.GRP.003.3 — collision-resistance: distinct side effects → distinct keys; identical retry → same key.
test('AC-5.GRP.003.3 — key derivation is collision-resistant (distinct→distinct, identical→same)', () => {
  // identical retried action → same key (dedup holds, #2)
  assert.equal(
    stepIdempotencyKey('t1', 's1', { amount: 100 }),
    stepIdempotencyKey('t1', 's1', { amount: 100 }),
  );
  // genuinely-distinct side effects → distinct keys (no false-duplicate suppression, #1)
  const keys = new Set<string>();
  keys.add(stepIdempotencyKey('t1', 's1', { amount: 100 }));
  keys.add(stepIdempotencyKey('t1', 's1', { amount: 101 })); // different payload
  keys.add(stepIdempotencyKey('t1', 's2', { amount: 100 })); // different step
  keys.add(stepIdempotencyKey('t2', 's1', { amount: 100 })); // different task
  assert.equal(keys.size, 4, 'all four distinct actions produce distinct keys');

  // boundary/domain-separation: ('ab','c') must NOT collide with ('a','bc') — the \x1f separators prevent it.
  assert.notEqual(
    stepIdempotencyKey('ab', 'c', {}),
    stepIdempotencyKey('a', 'bc', {}),
    'concatenation-boundary collision is prevented by domain separators',
  );

  // property-style sweep: 500 distinct (task,step,payload) triples → 500 distinct keys (collision-resistance
  // posture for AF-112 — the offline portion; at-scale dedup remains a LOAD/EVAL owed to live).
  const bulk = new Set<string>();
  let n = 0;
  for (let t = 0; t < 10; t++) {
    for (let s = 0; s < 10; s++) {
      for (let p = 0; p < 5; p++) {
        bulk.add(stepIdempotencyKey(`task-${t}`, `s${s}`, { p, nonce: `${t}:${s}:${p}` }));
        n++;
      }
    }
  }
  assert.equal(bulk.size, n, `no collisions across ${n} distinct keys (offline collision-resistance posture)`);
});

// ── AC-5.GRP.004.1 — resume from first incomplete step; 1..k-1 reused, not re-executed. ────────────────
test('AC-5.GRP.004.1 — resume from the first incomplete step, reusing preserved outputs of completed steps', async () => {
  const graphs = new InMemoryGraphStore();
  await graphs.putVersion({ task_type_name: 'pipeline', steps: linearSteps(5), change_reason: 'init' }, NOW);
  const history = new InMemoryHistoryStore();
  const ledger = new InMemoryIdempotencyLedger();
  const exec = new GraphExecutor(graphs, history, ledger, new CollectingSink());

  // Steps 0,1,2 completed on a prior run → their outputs preserved in the durable originals (task_history).
  // Step 3 is where it failed. Resume must reuse 0,1,2 and start at 3.
  history.put({ task_id: 'task-1', step_index: 0, full_output: { r: 'zero' } });
  history.put({ task_id: 'task-1', step_index: 1, full_output: { r: 'one' } });
  history.put({ task_id: 'task-1', step_index: 2, full_output: { r: 'two' } });

  const fired: number[] = [];
  const run: RunStep = async (step) => {
    const i = Number(step.step_id.slice(1));
    fired.push(i);
    return { r: `fresh-${i}` };
  };
  const res = await exec.execute('pipeline', 'task-1', run, NOW);

  assert.deepEqual(fired, [3, 4], 'ONLY steps 3,4 execute — 0,1,2 are NOT re-executed (#1)');
  assert.deepEqual(res.reused, [0, 1, 2], 'steps 0,1,2 reused from preserved output');
  // the reused steps return their PRESERVED output, not a fresh re-computation.
  assert.deepEqual(res.results[0]!.output, { r: 'zero' });
  assert.deepEqual(res.results[2]!.output, { r: 'two' });
  assert.deepEqual(res.results[3]!.output, { r: 'fresh-3' }, 'step 3 is freshly executed');
  assert.equal(res.results.length, 5, 'the whole graph is accounted for');
});

// ── AC-NFR-PERF.007.1 — chain-depth over-limit is a VISIBLE reject (or logged trim), never silent. ─────
test('AC-NFR-PERF.007.1 — a graph exceeding chain_depth_limit is rejected loudly, never silently truncated', async () => {
  const graphs = new InMemoryGraphStore();
  const sink = new CollectingSink();
  // default limit 6; register a 7-step chain.
  await graphs.putVersion({ task_type_name: 'deep', steps: linearSteps(7), change_reason: 'init' }, NOW);

  const execReject = new GraphExecutor(graphs, new InMemoryHistoryStore(), new InMemoryIdempotencyLedger(), sink, {
    ...DEFAULT_GRAPH_CONFIG, // chainDepthLimit 6, overLimitPolicy 'reject'
  });
  await assert.rejects(
    () => execReject.resolveGraph('deep', 'task-1'),
    (e: Error) => e.message === ERR_OVER_LIMIT(7, 6),
    'over-limit graph is REJECTED (fail-closed), not run truncated',
  );
  // #3: the reject is RECORDED with the resolved depth + limit.
  const rec = sink.events.find((e) => e.kind === 'chain_depth_over_limit');
  assert.ok(rec, 'the over-limit outcome is recorded, not silent');
  assert.equal(rec!.payload.outcome, 'rejected');
  assert.equal(rec!.payload.resolved_depth, 7);
  assert.equal(rec!.payload.limit, 6);

  // the TRIM policy is ALSO visible + logged (never a silent cut).
  const sink2 = new CollectingSink();
  const execTrim = new GraphExecutor(graphs, new InMemoryHistoryStore(), new InMemoryIdempotencyLedger(), sink2, {
    chainDepthLimit: 6,
    overLimitPolicy: 'trim',
  });
  const resolved = await execTrim.resolveGraph('deep', 'task-1');
  assert.equal(resolved.order.length, 6, 'trimmed to the limit');
  assert.equal(resolved.depthOutcome!.outcome, 'trimmed');
  const trimRec = sink2.events.find((e) => e.kind === 'chain_depth_over_limit');
  assert.ok(trimRec && trimRec.payload.outcome === 'trimmed', 'trim outcome is recorded (visible, #3)');

  // a graph AT the limit (6) resolves cleanly with no outcome recorded.
  await graphs.putVersion({ task_type_name: 'atlimit', steps: linearSteps(6), change_reason: 'init' }, NOW);
  const sink3 = new CollectingSink();
  const execOk = new GraphExecutor(graphs, new InMemoryHistoryStore(), new InMemoryIdempotencyLedger(), sink3);
  const okRes = await execOk.resolveGraph('atlimit', 'task-2');
  assert.equal(okRes.order.length, 6);
  assert.equal(okRes.depthOutcome, null, 'a graph at the limit is not flagged');
  assert.equal(sink3.events.length, 0);
});

// ── house-discipline guard: validateSteps rejects a malformed graph before it is ever versioned. ─────────
test('validateSteps rejects empty graphs, blank ids, unknown kinds, and bad failure modes (FR-5.GRP.001)', () => {
  assert.throws(() => validateSteps([]), /at least one step/);
  assert.throws(
    () => validateSteps([{ step_id: '', kind: 'tool_call', depends_on: [], failure_mode: 'retry' }]),
    /non-empty step_id/,
  );
  assert.throws(
    () => validateSteps([{ step_id: 'x', kind: 'nope' as never, depends_on: [], failure_mode: 'retry' }]),
    /unknown step kind/,
  );
  assert.throws(
    () => validateSteps([{ step_id: 'x', kind: 'tool_call', depends_on: [], failure_mode: 'boom' as never }]),
    /unknown failure_mode/,
  );
  // a valid single-step graph passes.
  validateSteps([{ step_id: 'x', kind: 'tool_call', depends_on: [], failure_mode: 'retry' }]);
});

// ── event_type admitted-set guard — the durable regression guard for the missing-enum-value defect. The live
// SupabaseConfigErrorSink INSERTs event_type onto event_log; both values it writes MUST be admitted enum
// members (0001_baseline L60 + migration 0011). This proves the offline fake now REJECTS a non-admitted value
// so the drift that was hidden behind the never-instantiated live adapter can no longer pass a green suite. ──
test('config-error event_type values are admitted; a non-admitted event_type is rejected loudly (#3)', async () => {
  // both kinds this slice writes resolve to admitted event_type values.
  assert.equal(CONFIG_ERROR_EVENT_TYPE.no_graph, 'task_graph_missing');
  assert.equal(CONFIG_ERROR_EVENT_TYPE.chain_depth_over_limit, 'task_graph_chain_depth_over_limit');
  assert.ok(ADMITTED_EVENT_TYPES.has('task_graph_missing'));
  assert.ok(ADMITTED_EVENT_TYPES.has('task_graph_chain_depth_over_limit'));
  assert.equal(eventTypeForKind('no_graph'), 'task_graph_missing');
  assert.equal(eventTypeForKind('chain_depth_over_limit'), 'task_graph_chain_depth_over_limit');

  // the enum-checking sink records real events AND validates the event_type exactly as the live adapter does.
  const graphs = new InMemoryGraphStore();
  const sink = new EnumCheckingConfigErrorSink();
  const exec = new GraphExecutor(graphs, new InMemoryHistoryStore(), new InMemoryIdempotencyLedger(), sink);
  await assert.rejects(() => exec.resolveGraph('unregistered_type', 'task-1'), (e: Error) =>
    e.message === ERR_NO_GRAPH('unregistered_type'),
  );
  assert.deepEqual(sink.eventTypes, ['task_graph_missing'], 'the no_graph config error resolved to an admitted event_type');

  // over-limit path also resolves to an admitted event_type through the same sink.
  await graphs.putVersion({ task_type_name: 'deep', steps: linearSteps(7), change_reason: 'init' }, NOW);
  await assert.rejects(() => exec.resolveGraph('deep', 'task-2'), (e: Error) => e.message === ERR_OVER_LIMIT(7, 6));
  assert.ok(sink.eventTypes.includes('task_graph_chain_depth_over_limit'));

  // DRIFT GUARD: a kind mapped to a value NOT in the admitted enum set throws (offline) — this is exactly the
  // failure a live INSERT of an unknown event_type would have raised, now caught without a live DB.
  const original = CONFIG_ERROR_EVENT_TYPE.no_graph;
  try {
    (CONFIG_ERROR_EVENT_TYPE as Record<string, string>).no_graph = 'task_graph_not_in_enum';
    assert.throws(() => eventTypeForKind('no_graph'), /not an admitted event_type/);
  } finally {
    (CONFIG_ERROR_EVENT_TYPE as Record<string, string>).no_graph = original;
  }
});

// ── idempotency ledger maps onto the BASELINE idempotency_ledger shape (fix for the schema-collision defect).
// The fake now mirrors the baseline columns (idempotency_key / connector / result / created_at) + its 0008
// write-once trigger, under the sentinel connector. This proves the reserved-vs-completed distinction rides
// the `result` column and that completed-with-null-output stays distinguishable from merely-reserved. ───────
test('idempotency ledger reuses the baseline shape: sentinel connector, result-null=reserved, write-once', async () => {
  const ledger = new InMemoryIdempotencyLedger();
  const key = stepIdempotencyKey('task-1', 's0', { a: 1 });

  // reserve → a row under the sentinel connector, result NULL = reserved (crash window), not completed.
  const reserved = await ledger.reserve(key, NOW);
  assert.equal(reserved.completed, false, 'a reserved key is not yet completed (result is null)');
  assert.equal(reserved.output, null);
  const row = ledger.rows.get(key)!;
  assert.equal(row.connector, LEDGER_CONNECTOR, 'reserved under the stable sentinel connector (connector NOT NULL)');
  assert.equal(row.result, null, 'result column is SQL-NULL while merely reserved');

  // a re-reserve is a no-op (ON CONFLICT DO NOTHING) — the surviving row is returned unchanged.
  await ledger.reserve(key, NOW + 1);
  assert.equal(ledger.rows.size, 1, 'ON CONFLICT DO NOTHING — no second row');

  // complete → result filled once; now completed with its output.
  await ledger.complete(key, { charged: true }, NOW + 2);
  const done = await ledger.get(key);
  assert.equal(done!.completed, true, 'result is not null ⇒ completed');
  assert.deepEqual(done!.output, { charged: true });

  // write-once: a second complete does NOT overwrite the recorded outcome (mirrors the 0008 trigger, #1).
  await ledger.complete(key, { charged: false }, NOW + 3);
  assert.deepEqual((await ledger.get(key))!.output, { charged: true }, 'recorded outcome is immutable (write-once)');

  // completed-with-null-output stays distinguishable from merely-reserved (a step legitimately returning null
  // is still marked completed — result holds the JSON null token, not SQL-NULL).
  const nullKey = stepIdempotencyKey('task-2', 's0', { a: 2 });
  await ledger.reserve(nullKey, NOW);
  await ledger.complete(nullKey, null, NOW + 1);
  const nullDone = await ledger.get(nullKey);
  assert.equal(nullDone!.completed, true, 'a step that returns null is COMPLETED, not stuck reserved (#1)');
  assert.equal(nullDone!.output, null);
});

// ── resume with a NON-LINEAR DAG — guards the step_index ordering seam (defect 3). Resume reads task_history
// by the RESOLVED TOPOLOGICAL-order index; ISSUE-050/052 MUST write step_index by that same order. This test
// uses a graph whose array order != topo order and seeds preserved outputs by the RESOLVED index, proving
// resume reuses the correct step's output and re-runs exactly the incomplete tail. ──────────────────────────
test('AC-5.GRP.004.1 (seam) — resume indexes task_history by resolved topo order, not array order', async () => {
  const graphs = new InMemoryGraphStore();
  // Array order is [c, a, b]; deps force topo order a → b → c (array order != topo order).
  const steps: GraphStep[] = [
    { step_id: 'c', kind: 'tool_write', depends_on: ['b'], failure_mode: 'halt', payload: { s: 'c' } },
    { step_id: 'a', kind: 'memory_read', depends_on: [], failure_mode: 'retry', payload: { s: 'a' } },
    { step_id: 'b', kind: 'ai_call', depends_on: ['a'], failure_mode: 'retry', payload: { s: 'b' } },
  ];
  await graphs.putVersion({ task_type_name: 'dag', steps, change_reason: 'init' }, NOW);

  // sanity: the resolved order is a,b,c → resolved indices 0=a, 1=b, 2=c.
  const resolved = resolveDependencyOrder(steps).map((s) => s.step_id);
  assert.deepEqual(resolved, ['a', 'b', 'c']);

  const history = new InMemoryHistoryStore();
  // a and b completed on a prior run → seed their preserved outputs BY RESOLVED INDEX (0=a, 1=b), the index
  // ISSUE-050/052 must write. If resume indexed by array order it would mis-map (array 0 = c) and reuse wrong.
  history.put({ task_id: 'task-1', step_index: 0, full_output: { was: 'a' } });
  history.put({ task_id: 'task-1', step_index: 1, full_output: { was: 'b' } });

  const fired: string[] = [];
  const run: RunStep = async (step) => {
    fired.push(step.step_id);
    return { fresh: step.step_id };
  };
  const exec = new GraphExecutor(graphs, history, new InMemoryIdempotencyLedger(), new EnumCheckingConfigErrorSink());
  const res = await exec.execute('dag', 'task-1', run, NOW);

  assert.deepEqual(fired, ['c'], 'ONLY the incomplete tail (c) fires; a,b reused by resolved index — not array order');
  assert.deepEqual(res.reused, [0, 1], 'resolved indices 0(a),1(b) reused');
  assert.deepEqual(res.results[0]!.output, { was: 'a' }, 'resolved index 0 correctly reused a\'s preserved output');
  assert.deepEqual(res.results[1]!.output, { was: 'b' }, 'resolved index 1 correctly reused b\'s preserved output');
  assert.deepEqual(res.results[2]!.output, { fresh: 'c' }, 'c freshly executed');
});
