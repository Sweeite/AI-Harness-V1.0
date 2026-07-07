// ISSUE-050 (C5 ENV) — one test per AC in §4 Definition of done. Proved against the InMemoryTaskHistoryStore
// reference model (offline; the live UNIQUE-conflict / FK-cascade / retention-lifetime proof is owed at the
// Stage-4 checkpoint, authored in supabase-store.ts to the 0001_baseline task_history DDL). Every test has
// teeth: it asserts the lossy/forbidden path is REJECTED or the original is RECOVERABLE, not just the happy path.
//
// AC map (text authoritative in component-05-harness.md / performance.md):
//   AC-5.ENV.001.1     — a running task's envelope has ALL listed fields; current_step matches the executing step
//   AC-5.ENV.002.1     — step k>1 sees all prior outputs via the envelope (no cold start); on completion its
//                        output is APPENDED to previous_outputs (never overwriting)
//   AC-5.ENV.003.1     — over-threshold chain: older steps summarised in the WORKING envelope, uncompressed
//                        originals remain retrievable from the durable store
//   AC-5.ENV.003.2     — a later step needing earlier detail can reconstruct the exact original (AF-114 fidelity
//                        floor: retained originals are byte-for-byte, offline-provable half of the EVAL)
//   AC-NFR-PERF.008.1  — over-threshold ⇒ originals remain retrievable from the durable store (never dropped)
//   AC-NFR-PERF.008.2  — a compressed chain preserves task-critical state (offline: reconstruction from
//                        originals reproduces the full chain; AF-114 EVAL owed for model-summary equivalence)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ContextEnvelopeManager,
  InMemoryTaskHistoryStore,
  ENVELOPE_FIELDS,
  DEFAULT_ENVELOPE_CONFIG,
  estimateTokens,
  ERR_BAD_THRESHOLD,
  ERR_NO_TASK_ID,
  type ContextEnvelope,
  type StepOutput,
} from './index.ts';

function mkManager(thresholdTokens = DEFAULT_ENVELOPE_CONFIG.compressionThresholdTokens) {
  const history = new InMemoryTaskHistoryStore();
  const mgr = new ContextEnvelopeManager(history, { compressionThresholdTokens: thresholdTokens });
  return { history, mgr };
}

function seed(taskId = 'task-0001'): Parameters<ContextEnvelopeManager['open']>[0] {
  return {
    task_id: taskId,
    original_request: 'summarise Q3 and email the client',
    entities: [{ kind: 'client', id: 'c-1' }],
    memory_retrieved: [{ note: 'prior thread' }],
    execution_plan: [{ step: 'fetch' }, { step: 'summarise' }, { step: 'email' }],
    shared_context: { locale: 'en' },
  };
}

// ── AC-5.ENV.001.1 — envelope field-completeness; current_step reflects the executing step ─────────────────
test('AC-5.ENV.001.1 — envelope carries every mandated field; current_step tracks the executing step', async () => {
  const { mgr } = mkManager();
  const env = mgr.open(seed());

  // every FR-5.ENV.001 field is present on a fresh envelope.
  assert.deepEqual(mgr.missingFields(env), [], 'a fresh envelope must have zero missing fields');
  for (const f of ENVELOPE_FIELDS) {
    assert.ok(f in (env as unknown as Record<string, unknown>), `missing field ${f}`);
  }
  assert.equal(env.current_step, 0, 'a fresh envelope starts at step 0');
  assert.deepEqual(env.previous_outputs, [], 'previous_outputs starts empty');

  // current_step advances to match the executing step as the chain runs.
  const e1 = await mgr.appendStepOutput(env, { r: 'fetched' });
  assert.equal(e1.current_step, 1, 'after step 0 completes, current_step points at step 1 (the next executor)');
  const e2 = await mgr.appendStepOutput(e1, { r: 'summarised' });
  assert.equal(e2.current_step, 2);

  // TEETH: an envelope with a field deleted is reported incomplete (the gate would reject it).
  const broken = { ...env } as Partial<ContextEnvelope>;
  delete broken.shared_context;
  assert.deepEqual(mgr.missingFields(broken as ContextEnvelope), ['shared_context']);

  // TEETH: opening without a task_id fails closed (the envelope is per-task; FR-5.ENV.001).
  assert.throws(() => mgr.open({ task_id: '', original_request: 'x' }), new RegExp(ERR_NO_TASK_ID.slice(0, 30)));
});

// ── AC-5.ENV.002.1 — no cold start: step k>1 sees all prior outputs; its output is appended, never overwritten ─
test('AC-5.ENV.002.1 — every step reads the full envelope and appends (no cold start, no overwrite)', async () => {
  const { mgr } = mkManager();
  let env = mgr.open(seed());

  env = await mgr.appendStepOutput(env, { step: 0, data: 'alpha' });
  env = await mgr.appendStepOutput(env, { step: 1, data: 'beta' });
  const before = await mgr.appendStepOutput(env, { step: 2, data: 'gamma' });

  // step k=3 (the next step) would read `before` in full: all three prior outputs are visible.
  assert.equal(before.previous_outputs.length, 3, 'step 3 sees all 3 prior outputs — not a cold start');
  assert.deepEqual(
    before.previous_outputs.map((o) => (o.output as { data: string }).data),
    ['alpha', 'beta', 'gamma'],
    'prior outputs are all present and in order',
  );
  // each entry is indexed by the step that produced it.
  assert.deepEqual(before.previous_outputs.map((o) => o.step_index), [0, 1, 2]);

  // TEETH: appending is additive — the earlier entries are UNCHANGED (never overwritten, #1). Append a 4th and
  // confirm the first three entries are byte-identical to before.
  const after = await mgr.appendStepOutput(before, { step: 3, data: 'delta' });
  assert.equal(after.previous_outputs.length, 4);
  assert.deepEqual(after.previous_outputs.slice(0, 3), before.previous_outputs);

  // TEETH: the manager returns a NEW envelope; the caller's prior reference is not mutated out from under it
  // (immutability keeps the per-step pass-forward honest).
  assert.equal(before.previous_outputs.length, 3, 'the pre-append envelope is not mutated');
});

// ── AC-5.ENV.003.1 / AC-NFR-PERF.008.1 — over threshold: older steps summarised in the working envelope; the
//    uncompressed originals remain retrievable from the durable store (never dropped) ──────────────────────
test('AC-5.ENV.003.1 / AC-NFR-PERF.008.1 — compression summarises the working envelope but retains originals', async () => {
  // Tiny threshold so a few sizeable outputs cross it deterministically.
  const { history, mgr } = mkManager(1000);
  let env = mgr.open(seed());

  // Three big outputs — each ~2000 chars ⇒ ~500 tokens each; three ⇒ ~1500 tokens > 1000 threshold.
  const big = (tag: string) => ({ tag, blob: 'x'.repeat(2000) });
  env = await mgr.appendStepOutput(env, big('s0'));
  env = await mgr.appendStepOutput(env, big('s1'));
  env = await mgr.appendStepOutput(env, big('s2'));

  // Working envelope: the OLDER entries (0,1) are summarised; the newest (2) is kept full.
  assert.ok(estimateTokens(env.previous_outputs.map((o) => ({ ...o })) as StepOutput[]) >= 0);
  assert.equal(env.previous_outputs[0]!.compressed, true, 'oldest working entry is compressed');
  assert.equal(env.previous_outputs[1]!.compressed, true, 'second working entry is compressed');
  assert.equal(env.previous_outputs[2]!.compressed, false, 'newest working entry stays full (next step needs it)');
  // a compressed working entry is a summary marker, NOT the original blob.
  assert.notDeepEqual(env.previous_outputs[0]!.output, big('s0'), 'working entry 0 is a summary, not the original');

  // #1 GUARD: the uncompressed originals are ALL retrievable from the durable store — nothing dropped.
  assert.deepEqual(await history.getOriginal('task-0001', 0), big('s0'));
  assert.deepEqual(await history.getOriginal('task-0001', 1), big('s1'));
  assert.deepEqual(await history.getOriginal('task-0001', 2), big('s2'));

  // TEETH: even the summarised steps' originals survive verbatim — economy is lossless at source (OD-055).
  const all = await mgr.reconstructOriginals('task-0001');
  assert.deepEqual(all.map((r) => r.step_index), [0, 1, 2]);
  assert.deepEqual(all.map((r) => r.full_output), [big('s0'), big('s1'), big('s2')]);
});

// ── AC-5.ENV.003.2 / AC-NFR-PERF.008.2 — a later step needing earlier detail reconstructs the exact original
//    from the durable store, not from the lossy summary (the offline, byte-exact floor under AF-114) ────────
test('AC-5.ENV.003.2 / AC-NFR-PERF.008.2 — later step recovers exact earlier detail from retained originals', async () => {
  const { history, mgr } = mkManager(1000);
  let env = mgr.open(seed());

  // A task-critical field (`approval_code`) placed deliberately past the summary's 120-char preview window, so
  // it is provably absent from the lossy working summary yet perfectly recoverable from the durable original.
  const detailed = {
    invoice: { total: 4213.55, lines: [{ sku: 'A', qty: 3 }, { sku: 'B', qty: 1 }] },
    padding: 'z'.repeat(200),
    approval_code: 'CRITICAL-9F3A',
  };
  env = await mgr.appendStepOutput(env, detailed);           // step 0 — the detail a later step will need
  env = await mgr.appendStepOutput(env, { note: 'x'.repeat(3000) }); // step 1 — pushes chain over threshold
  env = await mgr.appendStepOutput(env, { note: 'y'.repeat(3000) }); // step 2

  // step 0 is now compressed in the WORKING envelope (its working output is a lossy summary).
  assert.equal(env.previous_outputs[0]!.compressed, true);
  assert.notDeepEqual(env.previous_outputs[0]!.output, detailed);

  // AC-5.ENV.003.2: a later step that needs the earlier detail reconstructs the EXACT original from the durable
  // store — the precise invoice total + line items, not the summary. This is the offline half of AF-114
  // (compression preserved task-critical state because the source was never lost); the model-summary
  // equivalence half remains an owed EVAL.
  const original = await history.getOriginal('task-0001', 0);
  assert.deepEqual(original, detailed, 'the exact earlier detail is recoverable for the later step');
  assert.equal((original as typeof detailed).invoice.total, 4213.55);
  assert.equal((original as typeof detailed).approval_code, 'CRITICAL-9F3A');

  // TEETH: prove the summary alone would have LOST the task-critical field — the working entry does NOT contain
  // approval_code (it fell past the summary's truncation window). Only the durable original preserves it.
  assert.ok(
    !JSON.stringify(env.previous_outputs[0]!.output).includes('CRITICAL-9F3A'),
    'the working summary is genuinely lossy — hence the durable original is what preserves task-critical state',
  );
});

// ── Retain discipline: an original is NEVER overwritten (UNIQUE(task_id, step_index) first-write-wins), and a
//    bad config fails closed. Guards the #1/#3 invariants the live DDL enforces. ───────────────────────────
test('retain is idempotent (never overwrites a retained original) and bad config fails closed', async () => {
  const { history } = mkManager();
  await history.retain('t', 0, { v: 'first' });
  await history.retain('t', 0, { v: 'SECOND — must be ignored' }); // on conflict do nothing
  assert.deepEqual(await history.getOriginal('t', 0), { v: 'first' }, 'first write wins; original never overwritten (#1)');

  // a jsonb-value copy: mutating the caller's object after retain does not retro-alter the stored original.
  const obj = { v: 'live' };
  await history.retain('t', 1, obj);
  obj.v = 'mutated';
  assert.deepEqual(await history.getOriginal('t', 1), { v: 'live' }, 'stored original is a value copy, not a reference');

  // TEETH: an out-of-range compression threshold is REJECTED, never silently clamped (#3).
  assert.throws(
    () => new ContextEnvelopeManager(new InMemoryTaskHistoryStore(), { compressionThresholdTokens: 500 }),
    new RegExp(ERR_BAD_THRESHOLD.slice(0, 30)),
  );
  assert.throws(
    () => new ContextEnvelopeManager(new InMemoryTaskHistoryStore(), { compressionThresholdTokens: 8000.5 }),
    new RegExp(ERR_BAD_THRESHOLD.slice(0, 30)),
  );
});

// ── AC-NFR-PERF.008.1 (null-output regression) — a step whose output is a VALID null must not be misread as
//    "never retained" when it later becomes an older/compressed entry. `null` is a legitimate JSON output
//    (a no-op step, a delete result, an empty tool response); the retention layer must distinguish "row exists
//    with value null" from "no row". Before the logic-sweep fix, compressIfOverThreshold gated on
//    getOriginal(...) === null and crashed the whole chain (ERR_SUMMARISE_WITHOUT_RETAIN) even though the null
//    original was durably retained and recoverable. ───────────────────────────────────────────────────────
test('AC-NFR-PERF.008.1 (regression) — a retained null-output older step does not crash compression', async () => {
  const { history, mgr } = mkManager(1000);
  let env = mgr.open(seed());

  // step 0 legitimately outputs null (a no-op / empty result) — retained durably as null.
  env = await mgr.appendStepOutput(env, null);
  assert.deepEqual(await history.getOriginal('task-0001', 0), null, 'null step 0 IS durably retained (row exists)');

  // step 1 pushes the chain over threshold so step 0 becomes an OLDER entry that compression will visit.
  // This must NOT throw ERR_SUMMARISE_WITHOUT_RETAIN — the null original was retained and is recoverable.
  env = await mgr.appendStepOutput(env, { big: 'x'.repeat(8000) });

  // step 0 is compressed in the WORKING envelope (its original was durably kept), the newest stays full.
  assert.equal(env.previous_outputs[0]!.compressed, true, 'the null older step is summarised, not crashed on');
  assert.equal(env.previous_outputs[1]!.compressed, false, 'newest entry stays full');

  // #1 GUARD: the null original is still recoverable verbatim from the durable store — nothing lost.
  assert.deepEqual(await history.getOriginal('task-0001', 0), null, 'null original recoverable after compression');
  const all = await mgr.reconstructOriginals('task-0001');
  assert.deepEqual(all.map((r) => r.step_index), [0, 1]);
  assert.deepEqual(all[0]!.full_output, null, 'reconstructed step 0 is the exact null original');
});

// ── No-compression path: a short chain under threshold keeps every working entry FULL (economy only kicks in
//    when needed) — while STILL retaining every original durably. ────────────────────────────────────────
test('short chain under threshold: no compression, but originals still retained', async () => {
  const { history, mgr } = mkManager(8000);
  let env = mgr.open(seed());
  env = await mgr.appendStepOutput(env, { small: 'a' });
  env = await mgr.appendStepOutput(env, { small: 'b' });

  assert.ok(env.previous_outputs.every((o) => o.compressed === false), 'no entry compressed under threshold');
  // originals retained regardless of compression — task_history is the authoritative tail (AF-115).
  assert.equal((await mgr.reconstructOriginals('task-0001')).length, 2);
});
