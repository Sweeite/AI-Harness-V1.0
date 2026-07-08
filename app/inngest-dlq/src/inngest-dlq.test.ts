// ISSUE-052 (C5 JOB) — the AC suite. One test per AC-5.JOB.* + the two AC-NFR-INF.011.*, plus the build-time
// single-authority invariant (a retry is NEVER issued by the task_queue path) and a computeBackoff unit test.
// Deterministic: a logical `now` (epoch seconds) is injected; no wall clock.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  InMemoryProjectionSink,
  InMemoryEventSink,
  InMemoryDlqStore,
  computeBackoffSeconds,
  resolveRetryPolicy,
  DEFAULT_ENGINE_CONFIG,
  DEFAULT_RETRY_POLICY,
  INNGEST_STEP_CAP_SECONDS,
  EVT_DLQ_HEARTBEAT,
  EVT_JOB_COMPLETED,
  EVT_JOB_FAILED,
  EMITTED_EVENT_TYPES,
  ERR_SELF_HOSTED,
  ERR_STEP_CAP_EXCEEDED,
  ERR_SCHEDULE_RETRY_FORBIDDEN,
  ERR_DLQ_HUMAN_REQUIRED,
  ERR_PROJECTION_HISTORY_SHRINK,
  type EngineConfig,
  type StepSpec,
  type JobInvocation,
} from './store.ts';
import { InngestEngine, type FanOutChild } from './engine.ts';
import { check } from './index.ts';

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────────────────
function makeEngine(configOverride: Partial<EngineConfig> = {}) {
  const projection = new InMemoryProjectionSink();
  const events = new InMemoryEventSink();
  const dlq = new InMemoryDlqStore();
  const config: EngineConfig = { ...DEFAULT_ENGINE_CONFIG, ...configOverride };
  const engine = new InngestEngine(config, projection, events, dlq);
  return { engine, projection, events, dlq, config };
}

/** a step that succeeds after `failFirst` failures, incrementing a shared side-effect counter ONLY on success. */
function flakyStep(step_id: string, failFirst: number, sideEffects: { count: number }): StepSpec {
  let calls = 0;
  return {
    step_id,
    idempotencyKey: `key:${step_id}`,
    run: async () => {
      calls += 1;
      if (calls <= failFirst) throw new Error(`${step_id} transient failure #${calls}`);
      sideEffects.count += 1;
      return { step_id, calls };
    },
  };
}

function okStep(step_id: string): StepSpec {
  return { step_id, idempotencyKey: `key:${step_id}`, run: async () => ({ step_id, ok: true }) };
}

function job(taskType: string, taskId: string, eventId: string, steps: StepSpec[]): JobInvocation {
  return { taskId, taskType, eventId, steps };
}

// ── AC-5.JOB.001.1 — a job exceeding Edge-Function limits completes on Inngest without a platform timeout. ──────
test('AC-5.JOB.001.1: a long multi-step job completes with no total execution-time limit; over-cap step rejected loudly (AF-018)', async () => {
  const { engine } = makeEngine();
  engine.registerFunction('consolidation');
  // A 50-step "500-memory consolidation"-shaped job — far beyond any Edge-Function budget — completes.
  const steps = Array.from({ length: 50 }, (_, i) => okStep(`s${i}`));
  const res = await engine.execute(job('consolidation', 't1', 'e1', steps), 1000);
  assert.equal(res.outcome, 'completed');
  assert.equal(Object.keys(res.stepRunCounts).length, 50);
  // no total execution-time limit is imposed (AF-018) — the provisioning posture reports null.
  assert.equal(engine.provisioningPosture().jobExecutionTimeLimitSeconds, null);

  // A step declaring > the 2h per-step cap is rejected LOUDLY before running (AF-018), never dispatched to fail.
  engine.registerFunction('bad');
  const overCap: StepSpec = { ...okStep('huge'), maxDurationSeconds: INNGEST_STEP_CAP_SECONDS + 1 };
  await assert.rejects(
    () => engine.execute(job('bad', 't-cap', 'e-cap', [overCap]), 1000),
    (e: Error) => e.message === ERR_STEP_CAP_EXCEEDED('huge', INNGEST_STEP_CAP_SECONDS + 1, INNGEST_STEP_CAP_SECONDS),
  );
});

// ── AC-5.JOB.002.1 — only the failing step retries; completed steps are not re-run + outputs preserved. ─────────
test('AC-5.JOB.002.1: a step fails and retries; already-completed steps are not re-run', async () => {
  const { engine } = makeEngine();
  engine.registerFunction('graph');
  const se = { count: 0 };
  const s0 = okStep('s0');
  const s1 = flakyStep('s1', 2, se); // fails twice, succeeds on the 3rd attempt
  const s2 = okStep('s2');
  const res = await engine.execute(job('graph', 't2', 'e2', [s0, s1, s2]), 1000);
  assert.equal(res.outcome, 'completed');
  // s0 ran exactly once; s1 ran 3 times (2 fails + 1 success); s2 ran exactly once — the retry was ISOLATED to s1.
  assert.equal(res.stepRunCounts['s0'], 1);
  assert.equal(res.stepRunCounts['s1'], 3);
  assert.equal(res.stepRunCounts['s2'], 1);
});

// ── AC-5.JOB.003.1 — exponential backoff per policy + unique-event-id de-dup. ───────────────────────────────────
test('AC-5.JOB.003.1: retries back off exponentially per the job policy; a duplicate event id does not re-execute', async () => {
  const { engine } = makeEngine();
  engine.registerFunction('graph');
  const se = { count: 0 };
  const res = await engine.execute(job('graph', 't3', 'e3', [flakyStep('s', 2, se)]), 1000);
  assert.equal(res.outcome, 'completed');
  // base=10, factor=2 -> [10, 20] for the two retries (AC-5.JOB.003.1 backoff leg).
  assert.deepEqual(res.scheduledBackoffs, [10, 20]);

  // Duplicate event delivery: same eventId -> NOT executed again (dedup leg).
  let calls = 0;
  const counting: StepSpec = { step_id: 'x', idempotencyKey: 'key:dup', run: async () => { calls += 1; return 1; } };
  const first = await engine.execute(job('graph', 't3b', 'edup', [counting]), 2000);
  assert.equal(first.outcome, 'completed');
  assert.equal(calls, 1);
  const second = await engine.execute(job('graph', 't3b', 'edup', [counting]), 2000);
  assert.equal(second.outcome, 'deduplicated');
  assert.equal(calls, 1); // the re-delivered event did not execute a second time
});

// ── AC-5.JOB.004.1 / AC-NFR-INF.011.1 — task_queue mirrors Inngest; it never schedules its own retry. ───────────
test('AC-5.JOB.004.1 / AC-NFR-INF.011.1: task_queue.attempts/status mirror Inngest; the task_queue path cannot schedule a retry', async () => {
  const { engine, projection } = makeEngine();
  engine.registerFunction('graph');
  const se = { count: 0 };
  await engine.execute(job('graph', 't4', 'e4', [flakyStep('s', 1, se)]), 1000);
  const proj = await projection.read('t4');
  assert.ok(proj);
  // the projection MIRRORS Inngest's reported lifecycle: 2 attempts recorded, terminal status completed.
  assert.equal(proj!.attempts, 2);
  assert.equal(proj!.status, 'completed');
  // a running-lifecycle mirror was written mid-flight (a next_retry_at was projected on the failed attempt).
  assert.ok(projection.history.some((h) => h.taskId === 't4' && h.projection.next_retry_at !== null));

  // OD-058 / #2: the task_queue path has NO retry scheduler — the forbidden hook proves it (exactly one retry loop).
  assert.throws(() => projection.attemptScheduleRetry('t4'), (e: Error) => e.message === ERR_SCHEDULE_RETRY_FORBIDDEN);
});

// ── AC-5.JOB.004.2 — a consequential side-effecting step is executed by exactly one engine, never twice. ─────────
test('AC-5.JOB.004.2: a consequential step is executed exactly once for one failure (no double side effect)', async () => {
  const { engine } = makeEngine();
  engine.registerFunction('graph');
  const se = { count: 0 };
  const res = await engine.execute(job('graph', 't5', 'e5', [flakyStep('pay', 1, se)]), 1000);
  assert.equal(res.outcome, 'completed');
  assert.equal(res.stepRunCounts['pay'], 2); // 1 failed attempt + 1 successful attempt
  assert.equal(se.count, 1); // ...but the side effect committed EXACTLY once (never twice for one failure)

  // idempotency memo: the same idempotency key across a re-delivery reuses the committed output, no re-execution.
  let calls = 0;
  const committed: StepSpec = { step_id: 'pay2', idempotencyKey: 'key:committed', run: async () => { calls += 1; return 'done'; } };
  await engine.execute(job('graph', 't5a', 'e5a', [committed]), 1000);
  const res2 = await engine.execute(job('graph', 't5b', 'e5b', [committed]), 1000); // different event, SAME step key
  assert.equal(calls, 1);
  assert.deepEqual(res2.reusedSteps, ['pay2']);
});

// ── AC-5.JOB.005.1 — fan-out dispatches multiple child jobs concurrently, each its own tracked task. ────────────
test('AC-5.JOB.005.1: a fan-out event dispatches multiple child jobs, each tracked', async () => {
  const { engine } = makeEngine();
  const children: FanOutChild[] = [
    { childTaskId: 'c-research', taskType: 'research', eventId: 'ce1', idempotencyKey: 'ck1' },
    { childTaskId: 'c-memory', taskType: 'memory_write', eventId: 'ce2', idempotencyKey: 'ck2' },
    { childTaskId: 'c-crm', taskType: 'crm', eventId: 'ce3', idempotencyKey: 'ck3' },
  ];
  const dispatched: string[] = [];
  const res = await engine.fanOut('parent-lead', children, async (c) => { dispatched.push(c.childTaskId); }, 1000);
  assert.equal(res.partial, false);
  assert.deepEqual(res.created.sort(), ['c-crm', 'c-memory', 'c-research']);
  assert.equal(res.failed.length, 0);
  assert.deepEqual(dispatched.sort(), ['c-crm', 'c-memory', 'c-research']); // each child dispatched as its own task
});

// ── AC-5.JOB.005.2 — a partial fan-out is detected + surfaced loudly + reconciled under idempotency. ────────────
test('AC-5.JOB.005.2: a partial fan-out is detected, surfaced loudly, and reconciled under idempotency (never silent)', async () => {
  const { engine, events } = makeEngine();
  const children: FanOutChild[] = [
    { childTaskId: 'c1', taskType: 'research', eventId: 'ce1', idempotencyKey: 'ck1' },
    { childTaskId: 'c2', taskType: 'memory_write', eventId: 'ce2', idempotencyKey: 'ck2' },
    { childTaskId: 'c3', taskType: 'crm', eventId: 'ce3', idempotencyKey: 'ck3' },
  ];
  // c2 fails to dispatch on the first pass.
  const dispatch1 = async (c: FanOutChild) => { if (c.childTaskId === 'c2') throw new Error('dispatch failed'); };
  const res1 = await engine.fanOut('parent', children, dispatch1, 1000);
  assert.equal(res1.partial, true);
  assert.deepEqual(res1.created.sort(), ['c1', 'c3']);
  assert.deepEqual(res1.failed.map((f) => f.childTaskId), ['c2']); // the parent RECORDS which children weren't created
  // ...and it is surfaced LOUDLY on event_log (never silently partial, #3).
  const loud = events.events.find((e) => e.summary.includes('fan-out') && e.summary.includes('PARTIAL'));
  assert.ok(loud, 'a loud partial-fan-out event must be emitted');
  assert.equal(loud!.event_type, EVT_JOB_FAILED);

  // Reconcile as a unit under idempotency: only the missing child (c2) is actually (re)dispatched; c1/c3 are no-ops.
  const reDispatched: string[] = [];
  const dispatch2 = async (c: FanOutChild) => { reDispatched.push(c.childTaskId); };
  const res2 = await engine.reconcileFanOut('parent', children, dispatch2, 1100);
  assert.equal(res2.partial, false);
  assert.deepEqual(reDispatched, ['c2']); // c1/c3 already created -> not re-dispatched (no duplicate, #1)
  assert.deepEqual(res2.created.sort(), ['c1', 'c2', 'c3']);
});

// ── AC-5.JOB.006.1 — exceed retry count -> DLQ with full error history; no auto-retry; human-only recovery. ─────
test('AC-5.JOB.006.1: exceeding the retry count dead-letters with full history; no auto-retry; human-only requeue/discard', async () => {
  const { engine, projection, dlq } = makeEngine({
    perJobTypeRetryPolicy: { flaky: { ...DEFAULT_RETRY_POLICY, maxAttempts: 3 } },
  });
  engine.registerFunction('flaky');
  const alwaysFails: StepSpec = { step_id: 'boom', idempotencyKey: 'key:boom', run: async () => { throw new Error('permanent boom'); } };
  const res = await engine.execute(job('flaky', 't6', 'e6', [alwaysFails]), 1000);
  assert.equal(res.outcome, 'dead_lettered');

  const entry = await dlq.get('t6');
  assert.ok(entry);
  assert.equal(entry!.resolution, 'resident');
  assert.equal(entry!.error_history.length, 3); // FULL per-attempt history (#1), never collapsed
  assert.match(entry!.final_reason, /exhausted 3 attempts/);
  // projection: failed, no scheduled retry.
  const proj = await projection.read('t6');
  assert.equal(proj!.status, 'failed');
  assert.equal(proj!.next_retry_at, null);

  // NO auto-retry: a re-delivery of the same event is deduped, never silently re-run.
  const again = await engine.execute(job('flaky', 't6', 'e6', [alwaysFails]), 2000);
  assert.equal(again.outcome, 'deduplicated');

  // human-only recovery: an empty actor is refused (#2); an explicit human requeues.
  await assert.rejects(() => engine.requeueFromDlq('t6', '', 3000), (e: Error) => e.message === ERR_DLQ_HUMAN_REQUIRED);
  const requeued = await engine.requeueFromDlq('t6', 'alice@ops', 3000);
  assert.equal(requeued.resolution, 'requeued');
  assert.equal(requeued.resolved_by, 'alice@ops');
  // discard is likewise human-only (prove on a second dead-lettered task).
  engine.registerFunction('flaky2');
  await engine.execute(job('flaky2', 't6b', 'e6b', [{ step_id: 'b', idempotencyKey: 'key:b', run: async () => { throw new Error('x'); } }]), 1000);
  const discarded = await engine.discardFromDlq('t6b', 'bob@ops', 'not worth retrying', 3000);
  assert.equal(discarded.resolution, 'discarded');
});

// ── AC-5.JOB.006.2 — a DLQ entry resident past a configurable age trips an escalating, recorded heartbeat. ───────
test('AC-5.JOB.006.2: a DLQ entry past the age threshold emits an escalating, recorded liveness heartbeat (never silent)', async () => {
  const { engine, events } = makeEngine({ dlqAgeThresholdSeconds: 100 });
  engine.registerFunction('flaky');
  await engine.execute(job('flaky', 't7', 'e7', [{ step_id: 'b', idempotencyKey: 'key:b7', run: async () => { throw new Error('boom'); } }]), 1000);

  // before the threshold: no escalation.
  const early = await engine.sweepDlq(1050); // age 50 <= 100
  assert.deepEqual(early, []);

  // past the threshold: escalate + record a queue_backup heartbeat on event_log.
  const late = await engine.sweepDlq(1200); // age 200 > 100
  assert.deepEqual(late, ['t7']);
  const hb = events.events.filter((e) => e.event_type === EVT_DLQ_HEARTBEAT);
  assert.equal(hb.length, 1);
  assert.match(hb[0]!.summary, /resident/);

  // ESCALATING (not one-shot): still resident on the next sweep -> it fires AGAIN.
  const later = await engine.sweepDlq(1300);
  assert.deepEqual(later, ['t7']);
  assert.equal(events.events.filter((e) => e.event_type === EVT_DLQ_HEARTBEAT).length, 2);
});

// ── AC-5.JOB.007.1 / AC-NFR-INF.011.2 — v1 is Inngest cloud-hosted, single retry/DLQ authority; self-host refused. ─
test('AC-5.JOB.007.1 / AC-NFR-INF.011.2: v1 is Inngest cloud-hosted single retry/DLQ authority; self-hosting is refused', async () => {
  const { engine } = makeEngine();
  const posture = engine.provisioningPosture();
  assert.equal(posture.hosting, 'cloud');
  assert.equal(posture.retryDlqAuthority, 'inngest'); // single authority (OD-058 / NFR-INF.011)
  assert.equal(posture.jobExecutionTimeLimitSeconds, null);
  assert.equal(posture.stepCapSeconds, INNGEST_STEP_CAP_SECONDS);

  // self-hosted is OOS-028 (post-v1) — the engine refuses to construct rather than pretend to provision it (#3).
  assert.throws(
    () => makeEngine({ hosting: 'self_hosted' }),
    (e: Error) => e.message === ERR_SELF_HOSTED,
  );
});

// ── build-time invariant + unit checks ─────────────────────────────────────────────────────────────────────────
test('computeBackoffSeconds: exponential, capped at maxBackoffSeconds', () => {
  const p = { maxAttempts: 10, baseBackoffSeconds: 5, backoffFactor: 3, maxBackoffSeconds: 100 };
  assert.equal(computeBackoffSeconds(p, 1), 5);
  assert.equal(computeBackoffSeconds(p, 2), 15);
  assert.equal(computeBackoffSeconds(p, 3), 45);
  assert.equal(computeBackoffSeconds(p, 4), 100); // 135 capped to 100
  assert.throws(() => computeBackoffSeconds(p, 0));
});

test('resolveRetryPolicy: per-job-type override wins, else the default', () => {
  const cfg: EngineConfig = { ...DEFAULT_ENGINE_CONFIG, perJobTypeRetryPolicy: { special: { ...DEFAULT_RETRY_POLICY, maxAttempts: 9 } } };
  assert.equal(resolveRetryPolicy(cfg, 'special').maxAttempts, 9);
  assert.equal(resolveRetryPolicy(cfg, 'other').maxAttempts, DEFAULT_RETRY_POLICY.maxAttempts);
});

test('#1: the projection error history is append-only — a sync that would shrink it is refused', async () => {
  const p = new InMemoryProjectionSink();
  await p.sync('t', { attempts: 2, next_retry_at: null, status: 'running', error: [{ attempt: 1, message: 'a', at: 'x' }, { attempt: 2, message: 'b', at: 'y' }] });
  await assert.rejects(
    () => p.sync('t', { attempts: 1, next_retry_at: null, status: 'running', error: [{ attempt: 1, message: 'a', at: 'x' }] }),
    (e: Error) => e.message === ERR_PROJECTION_HISTORY_SHRINK('t', 2, 1),
  );
});

test('check: every emitted event_type constant is present in the baseline event_type enum (no drift)', () => {
  assert.equal(EMITTED_EVENT_TYPES.length, 3);
  assert.doesNotThrow(() => check()); // reads app/silo/migrations/0001_baseline.sql
});

test('a graph-less task type is refused loudly (no ad-hoc run)', async () => {
  const { engine } = makeEngine();
  await assert.rejects(() => engine.execute(job('unregistered', 't', 'e', [okStep('s')]), 1000));
});

// keep EVT_JOB_COMPLETED referenced (run-completion record) — asserted implicitly in AC-001.1 flow.
test('a clean run emits a task_completed run-record on event_log', async () => {
  const { engine, events } = makeEngine();
  engine.registerFunction('graph');
  await engine.execute(job('graph', 'tc', 'ec', [okStep('s')]), 1000);
  assert.ok(events.events.some((e) => e.event_type === EVT_JOB_COMPLETED && e.task_id === 'tc'));
});
