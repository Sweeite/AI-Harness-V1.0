// ISSUE-048 (C5 QUE) — one test per AC in §4 Definition of done. Proved against the InMemoryTaskQueue
// reference model + a mock EventSink (offline; the live REVOKE-delete / state-machine / event_log proof is
// owed at the Stage-3 checkpoint, authored in results/proposed-migration-0008_task_queue.sql +
// supabase-store.ts). Every test has teeth: it asserts the wrong path is REJECTED, not just the happy path.
//
// AC map:
//   AC-5.QUE.001.1 — task_queue is a permanent audit record: no delete path exists for any row
//   AC-5.QUE.002.1 — full typed §6 row schema present + typed; NO client_slug column
//   AC-5.QUE.003.1 — status transitions are state-machine-legal; a null/unknown status is never persisted
//   AC-5.QUE.003.2 — a guardrail hold → `flagged` (distinct from awaiting_approval); leaves only by human
//                    review; work-in-progress (completed-step outputs + envelope) is retained
//   AC-5.QUE.004.1 — priority dequeue: lower number first; the ordering rule is config-tunable
//   AC-5.QUE.005.1 — requires_approval → awaiting_approval blocks execution; approve records approved_by/at
//                    and releases; reject records the outcome and does not execute
//   AC-5.QUE.005.2 — awaiting_approval past the threshold escalates on event_log; never auto-approved,
//                    never silently abandoned
//   AC-5.QUE.006.1 — full per-attempt error history is recoverable; not collapsed to a single last-error

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

import {
  InMemoryTaskQueue,
  DEFAULT_QUEUE_CONFIG,
  ALLOWED_TRANSITIONS,
  TASK_STATUSES,
  isTaskStatus,
  ERR_DELETE_FORBIDDEN,
  ERR_FLAGGED_NOT_C6,
  ERR_APPROVE_NOT_WAITING,
  type EscalationEvent,
  type EventSink,
  type QueueConfig,
  type TaskQueueRow,
  type TaskStatus,
} from './index.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const DAY = 24 * 3600;
const T0 = 1_700_000_000; // fixed "now" (epoch seconds)

/** A capturing mock of the ISSUE-011 event_log sink. */
class CapturingSink implements EventSink {
  readonly events: EscalationEvent[] = [];
  async append(ev: EscalationEvent): Promise<void> {
    this.events.push(ev);
  }
}
/** A sink that BLOWS UP — used to prove no escalation is emitted when nothing is stale. */
class ExplodingSink implements EventSink {
  async append(): Promise<void> {
    throw new Error('sink should not have been called');
  }
}

function fresh(config?: Partial<QueueConfig>) {
  const sink = new CapturingSink();
  const store = new InMemoryTaskQueue(sink, { ...DEFAULT_QUEUE_CONFIG, ...config });
  return { sink, store };
}

// ─────────────────────────────────────────────────────────────────────────────
// AC-5.QUE.001.1 — permanent audit record: no delete path exists for any row.
// ─────────────────────────────────────────────────────────────────────────────
test('AC-5.QUE.001.1 — no task_queue row is ever deletable (permanent audit record)', async () => {
  const { store } = fresh();
  const t = await store.enqueue({ type: 'scheduled', task_name: 'nightly-sync' }, T0);
  await store.transition(t.id, 'running', T0);
  await store.transition(t.id, 'failed', T0 + 10); // completed/failed/dead-lettered — the retention target

  // TEETH: the port exposes NO delete method, and the sole test hook that reaches the (forbidden) delete
  // path THROWS the exact rejection the live REVOKE produces. A "retention/cleanup job" cannot remove it.
  assert.equal(typeof (store as unknown as { delete?: unknown }).delete, 'undefined', 'the port must expose no delete method');
  assert.throws(() => store.attemptDelete(t.id), new RegExp('DELETE forbidden'), 'a delete attempt must be rejected');
  assert.match(ERR_DELETE_FORBIDDEN, /permanent audit record/);

  // The row still persists after the "cleanup" — readable, in its terminal state.
  const still = await store.get(t.id);
  assert.ok(still, 'the row must survive a retention/cleanup pass');
  assert.equal(still!.status, 'failed');

  // The authored DDL must carry the audit-record contract: revoke delete + no cascade onto this table.
  const ddl = readFileSync(join(HERE, '..', 'results', 'proposed-migration-0008_task_queue.sql'), 'utf8');
  assert.match(ddl, /revoke delete on task_queue/i, 'migration must revoke DELETE on task_queue');
  assert.doesNotMatch(ddl, /references\s+task_queue[^;]*on delete cascade/i, 'no ON DELETE CASCADE onto task_queue');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-5.QUE.002.1 — full typed §6 row schema present; NO client_slug (OD-096).
// ─────────────────────────────────────────────────────────────────────────────
test('AC-5.QUE.002.1 — a task row carries the full typed §6 schema and NO client_slug', async () => {
  const { store } = fresh();
  const row = await store.enqueue(
    { type: 'human', task_name: 'approve-refund', payload: { amount: 50 }, priority: 5, requires_approval: true, originating_user_id: 'user-7', action_payload: { tool: 'refund', target: 'ord-1' } },
    T0,
  );
  const expected: Array<keyof TaskQueueRow> = [
    'id', 'type', 'task_name', 'payload', 'status', 'priority', 'requires_approval', 'approved_by',
    'approved_at', 'originating_user_id', 'action_payload', 'attempts', 'next_retry_at', 'error',
    'completed_at', 'created_at',
  ];
  for (const k of expected) assert.ok(k in row, `column ${k} must be present`);

  // TEETH on TYPES + DEFAULTS (a shape check that would catch a wrong default or a stringified field).
  assert.equal(row.status, 'pending'); // schema default
  assert.equal(row.priority, 5);
  assert.equal(row.requires_approval, true);
  assert.equal(row.attempts, 0); // schema default
  assert.deepEqual(row.error, []); // array, never a scalar last-error
  assert.equal(row.originating_user_id, 'user-7'); // net-new column
  assert.deepEqual(row.action_payload, { tool: 'refund', target: 'ord-1' }); // net-new column
  assert.equal(row.completed_at, null);
  assert.equal(typeof row.created_at, 'string');

  // OD-096 / FR-10.ISO.001: there is NO client_slug column — not on the row, not in the authored DDL.
  assert.equal('client_slug' in row, false, 'client_slug must not exist on the row (OD-096)');
  const ddl = readFileSync(join(HERE, '..', 'results', 'proposed-migration-0008_task_queue.sql'), 'utf8');
  assert.doesNotMatch(ddl, /^\s*client_slug\b/im, 'the migration must not declare a client_slug column');
  // Both net-new columns must be authored into the DDL.
  assert.match(ddl, /originating_user_id\s+uuid\s+references profiles\(id\)/i);
  assert.match(ddl, /action_payload\s+jsonb/i);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-5.QUE.003.1 — transitions are state-machine-legal; null/unknown never persists.
// ─────────────────────────────────────────────────────────────────────────────
test('AC-5.QUE.003.1 — status transitions are legal and no undefined status ever persists', async () => {
  const { store } = fresh();
  const t = await store.enqueue({ type: 'scheduled', task_name: 'sync' }, T0);

  // A LEGAL edge is accepted.
  const running = await store.transition(t.id, 'running', T0);
  assert.equal(running.status, 'running');

  // TEETH #1 — an ILLEGAL edge is rejected (pending is not reachable from running).
  await assert.rejects(() => store.transition(t.id, 'pending', T0), /illegal status transition/, 'running → pending is illegal');

  // TEETH #2 — a NULL / UNKNOWN target is rejected (never persisted, #3).
  await assert.rejects(() => store.transition(t.id, 'in_flight' as unknown as TaskStatus, T0), /undefined\/blank status/);
  await assert.rejects(() => store.transition(t.id, null as unknown as TaskStatus, T0), /undefined\/blank status/);
  // The row is UNCHANGED after the rejected writes — still a defined enum member.
  const after = await store.get(t.id);
  assert.equal(after!.status, 'running');
  assert.ok(isTaskStatus(after!.status));

  // TEETH #3 — a terminal state is terminal: no edge leaves completed/failed.
  await store.transition(t.id, 'completed', T0 + 1);
  await assert.rejects(() => store.transition(t.id, 'running', T0 + 2), /illegal status transition/);
  assert.deepEqual(ALLOWED_TRANSITIONS.completed, []);
  assert.deepEqual(ALLOWED_TRANSITIONS.failed, []);

  // Every enum member the state machine references is a real task_status (no phantom states).
  for (const from of Object.keys(ALLOWED_TRANSITIONS) as TaskStatus[]) {
    assert.ok((TASK_STATUSES as readonly string[]).includes(from));
    for (const to of ALLOWED_TRANSITIONS[from]) assert.ok((TASK_STATUSES as readonly string[]).includes(to));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-5.QUE.003.2 — guardrail hold → flagged (distinct); WIP retained; human-only exit.
// ─────────────────────────────────────────────────────────────────────────────
test('AC-5.QUE.003.2 — a guardrail hold is `flagged` (not awaiting_approval), retains WIP, exits only by human review', async () => {
  const { store } = fresh();
  const t = await store.enqueue({ type: 'event', task_name: 'send-email' }, T0);
  await store.transition(t.id, 'running', T0);

  // TEETH #1 — C5 execution may NOT set flagged via the generic transition (OD-054: flagged is C6-set).
  await assert.rejects(() => store.transition(t.id, 'flagged', T0), new RegExp(ERR_FLAGGED_NOT_C6.slice(0, 30)));

  // C6 sets flagged and hands over the work-in-progress; it must be RETAINED (#1).
  const wip = { completed_step_outputs: [{ step: 0, out: 'drafted' }], envelope_ref: 'env-123' };
  const held = await store.setFlagged(t.id, wip, T0 + 5);
  assert.equal(held.status, 'flagged');
  assert.notEqual(held.status, 'awaiting_approval'); // TEETH: distinct from a routine approval wait

  const retained = store.heldWork.get(t.id);
  assert.deepEqual(retained, { completed_step_outputs: [{ step: 0, out: 'drafted' }], envelope_ref: 'env-123' });
  // TEETH — mutating the caller's WIP object must NOT change the retained copy (defensive retention).
  wip.completed_step_outputs.push({ step: 1, out: 'leaked' });
  assert.equal(store.heldWork.get(t.id)!.completed_step_outputs.length, 1, 'retained WIP must be an isolated copy');

  // TEETH — flagged leaves ONLY by an explicit human review edge (requeue / discard / approve). It never
  // auto-completes: completed is not a legal exit from flagged.
  assert.deepEqual([...ALLOWED_TRANSITIONS.flagged].sort(), ['failed', 'pending', 'running']);
  await assert.rejects(() => store.transition(t.id, 'completed', T0 + 6), /illegal status transition/);
  const requeued = await store.transition(t.id, 'pending', T0 + 7); // human "requeue"
  assert.equal(requeued.status, 'pending');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-5.QUE.004.1 — priority dequeue: lower first; ordering rule config-tunable.
// ─────────────────────────────────────────────────────────────────────────────
test('AC-5.QUE.004.1 — the lower-priority-number task is dequeued first, and the rule is config-tunable', async () => {
  const { store } = fresh(); // default asc: lower = higher priority
  const low = await store.enqueue({ type: 'scheduled', task_name: 'low-prio', priority: 100 }, T0);
  const high = await store.enqueue({ type: 'scheduled', task_name: 'high-prio', priority: 5 }, T0 + 1);
  const mid = await store.enqueue({ type: 'scheduled', task_name: 'mid-prio', priority: 50 }, T0 + 2);

  // TEETH — drain order must be by priority ascending (5, 50, 100), NOT insertion order.
  const d1 = await store.dequeue(T0 + 3);
  assert.equal(d1!.id, high.id, 'priority 5 must be selected before 100/50');
  const d2 = await store.dequeue(T0 + 4);
  assert.equal(d2!.id, mid.id);
  const d3 = await store.dequeue(T0 + 5);
  assert.equal(d3!.id, low.id);
  assert.equal(await store.dequeue(T0 + 6), null);

  // Config-tunable: flip the ordering rule and the SAME priorities dequeue in the opposite order.
  const { store: desc } = fresh({ priorityOrder: 'desc' });
  await desc.enqueue({ type: 'scheduled', task_name: 'a', priority: 5 }, T0);
  const bigger = await desc.enqueue({ type: 'scheduled', task_name: 'b', priority: 100 }, T0 + 1);
  const first = await desc.dequeue(T0 + 2);
  assert.equal(first!.id, bigger.id, 'with desc ordering, priority 100 is drained first — the rule is tunable');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-5.QUE.005.1 — approval blocks execution; approve records + releases; reject records + no-execute.
// ─────────────────────────────────────────────────────────────────────────────
test('AC-5.QUE.005.1 — requires_approval blocks execution; approve records approved_by/at; reject records + never executes', async () => {
  const { store } = fresh();
  const gated = await store.enqueue({ type: 'human', task_name: 'wire-transfer', requires_approval: true }, T0);
  const other = await store.enqueue({ type: 'scheduled', task_name: 'plain', priority: 200 }, T0 + 1);

  // On dequeue an approval-gated task moves to awaiting_approval and does NOT run.
  const parked = await store.dequeue(T0 + 2);
  assert.equal(parked!.id, gated.id);
  assert.equal(parked!.status, 'awaiting_approval', 'no execution step runs — it is blocked');
  assert.equal(parked!.approved_by, null);

  // TEETH — you cannot approve a task that is not awaiting_approval (the plain task, still pending).
  await assert.rejects(() => store.approve(other.id, 'boss', T0 + 3), new RegExp(ERR_APPROVE_NOT_WAITING.slice(0, 20)));

  // Approve: records approved_by + approved_at and RELEASES to running (execution may now proceed).
  const approved = await store.approve(gated.id, 'boss', T0 + 4);
  assert.equal(approved.status, 'running');
  assert.equal(approved.approved_by, 'boss');
  assert.equal(approved.approved_at, new Date((T0 + 4) * 1000).toISOString());

  // Reject path (a second gated task): records the outcome and does NOT execute.
  const gated2 = await store.enqueue({ type: 'human', task_name: 'delete-account', requires_approval: true, priority: 1 }, T0 + 5);
  await store.dequeue(T0 + 6); // → awaiting_approval
  const rejected = await store.reject(gated2.id, 'boss', 'too risky', T0 + 7);
  assert.equal(rejected.status, 'failed', 'a rejected task does not execute');
  assert.equal(rejected.approved_by, 'boss');
  // TEETH — the rejection reason is recorded (never a silent drop).
  assert.equal(rejected.error.at(-1)!.message, 'approval rejected: too risky');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-5.QUE.005.2 — staleness escalation: emits on event_log; never auto-approves/abandons.
// ─────────────────────────────────────────────────────────────────────────────
test('AC-5.QUE.005.2 — a stale awaiting_approval task escalates on event_log and stays pending (never auto-approved/abandoned)', async () => {
  const { sink, store } = fresh({ approvalStalenessThresholdSeconds: DAY });
  const gated = await store.enqueue({ type: 'human', task_name: 'sign-off', requires_approval: true }, T0);
  await store.dequeue(T0 + 1); // → awaiting_approval, created_at = T0

  // TEETH #1 — BEFORE the threshold, NO escalation is emitted (a fresh wait is not an escalation).
  {
    const noEscalateStore = new InMemoryTaskQueue(new ExplodingSink(), { ...DEFAULT_QUEUE_CONFIG, approvalStalenessThresholdSeconds: DAY });
    const g = await noEscalateStore.enqueue({ type: 'human', task_name: 'fresh', requires_approval: true }, T0);
    await noEscalateStore.dequeue(T0 + 1);
    const none = await noEscalateStore.escalateStaleApprovals(T0 + 100); // well under a day
    assert.deepEqual(none, [], 'nothing stale yet → no escalation (ExplodingSink would have thrown)');
    const gLive = await noEscalateStore.get(g.id);
    assert.equal(gLive!.status, 'awaiting_approval'); // parked, not escalated
  }

  // AFTER the threshold — exactly one escalation event fires, of the right type, for this task.
  const escalated = await store.escalateStaleApprovals(T0 + DAY + 60);
  assert.equal(escalated.length, 1);
  assert.equal(escalated[0]!.id, gated.id);
  assert.equal(sink.events.length, 1);
  assert.equal(sink.events[0]!.event_type, 'approval_queue_stale');
  assert.equal(sink.events[0]!.task_id, gated.id);
  assert.ok(sink.events[0]!.summary.length > 0, 'the escalation summary is never empty');

  // TEETH — never AUTO-APPROVED (#2): status is still awaiting_approval, approved_by still null.
  const afterEscalate = await store.get(gated.id);
  assert.equal(afterEscalate!.status, 'awaiting_approval', 'escalation must NOT auto-approve');
  assert.equal(afterEscalate!.approved_by, null);
  // TEETH — never ABANDONED (#3): the row is still present and visibly pending.
  assert.ok(afterEscalate, 'the task must remain, visibly pending');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-5.QUE.006.1 — full per-attempt error history is recoverable (not collapsed).
// ─────────────────────────────────────────────────────────────────────────────
test('AC-5.QUE.006.1 — every attempt error is preserved; history is never collapsed to a single last-error', async () => {
  const { store } = fresh();
  const t = await store.enqueue({ type: 'chained', task_name: 'flaky' }, T0);

  await store.recordError(t.id, 'ECONNRESET', T0 + 1);
  await store.recordError(t.id, 'HTTP 500', T0 + 2);
  const third = await store.recordError(t.id, 'timeout', T0 + 3);

  // TEETH — ALL THREE attempts are recoverable, in order, distinctly (not overwritten to just "timeout").
  assert.equal(third.error.length, 3, 'history must retain every attempt, not collapse to one');
  assert.deepEqual(third.error.map((e) => e.message), ['ECONNRESET', 'HTTP 500', 'timeout']);
  assert.deepEqual(third.error.map((e) => e.attempt), [1, 2, 3]);
  assert.equal(third.attempts, 3, 'attempts count tracks the number of recorded failures');

  // A re-read still shows the full history (persistence, not a transient accumulator).
  const reread = await store.get(t.id);
  assert.equal(reread!.error.length, 3);
  assert.equal(reread!.error[0]!.message, 'ECONNRESET', 'the FIRST error is still recoverable after later ones');

  // TEETH — the caller cannot mutate the stored history through the returned copy (defensive).
  reread!.error.push({ attempt: 99, message: 'injected', at: '' });
  const reread2 = await store.get(t.id);
  assert.equal(reread2!.error.length, 3, 'returned error array must be a copy, not the live store array');
});
