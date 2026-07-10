// ISSUE-026 (C2 ING) — the human review queue: Include / Exclude / Defer, all logged; queue-exit-only-via-a-logged-
// decision (AC-2.ING.003.1, AC-2.ING.003.2). Defer resurface + the cadence-unknown guard.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStack, taskAuthz } from './testkit.ts';
import { QueueDecisionError } from './queue.ts';

async function seedFlagged(s: ReturnType<typeof makeStack>, over: Partial<Parameters<typeof s.queue.holdFlagged>[0]> = {}) {
  return s.queue.holdFlagged({ content: 'legal dispute re: vendor contract', sourceRef: null, flagReason: 'legal', suggestedTier: 'confidential', targetEntityId: 'ent-1', ...over });
}

// ── AC-2.ING.003.1 — Exclude discards + logs who/when/why ──────────────────────────────────────────────────────
test('AC-2.ING.003.1: Exclude discards the item and captures who/when/why', async () => {
  const s = makeStack();
  const row = await seedFlagged(s);
  const out = await s.queue.exclude({ queueId: row.id, reviewer: 'admin-7', reason: 'not business-relevant', nowIso: '2026-07-10T00:00:00.000Z' });
  assert.equal(out.state, 'excluded');
  assert.equal(out.reviewed_by, 'admin-7'); // who
  assert.equal(out.reviewed_at, '2026-07-10T00:00:00.000Z'); // when
  assert.equal(out.decision_reason, 'not business-relevant'); // why
  const audit = s.store.audits.find((a) => a.action === 'exclude');
  assert.ok(audit, 'an audit record captures the Exclude');
  assert.equal(audit!.actorIdentity, 'admin-7');
  assert.equal(audit!.reason, 'not business-relevant');
});

test('AC-2.ING.003.1: an Exclude with no reason is refused (a logged decision must carry a why)', async () => {
  const s = makeStack();
  const row = await seedFlagged(s);
  await assert.rejects(() => s.queue.exclude({ queueId: row.id, reviewer: 'admin-7', reason: '  ' }), QueueDecisionError);
});

// ── #1/#3 regression — Include must NOT mark terminal when the sole writer did not commit ──────────────────────
test('Include with a deferred (rate-limited) write does NOT mark the row included — it stays actionable for retry (#1)', async () => {
  const s = makeStack({}, () => ({ kind: 'deferred_rate_limited', reason: 'CFG-rate_limit_memory_writes_per_minute reached' }));
  const row = await seedFlagged(s);
  const { row: after, outcome } = await s.queue.include({ queueId: row.id, tier: 'confidential', reviewer: 'admin-7', task: taskAuthz(), nowIso: '2026-07-10T00:00:00.000Z' });
  assert.equal(outcome.kind, 'deferred_rate_limited', 'the non-commit outcome is surfaced to the caller');
  assert.equal(after.state, 'pending', 'the row is NOT terminal — the candidate is not lost');
  assert.equal(s.store.audits.some((a) => a.action === 'include'), false, 'no include audit was written for a non-commit');
  assert.ok(s.observ.filterDecisions.some((d) => d.verdict === 'include_write_deferred'), 'the deferral is surfaced loudly (#3)');
});

test('Include with an embed-halt write also stays actionable (never silently consumed)', async () => {
  const s = makeStack({}, () => ({ kind: 'halted_embed_failure', reason: 'draft 0 embed failed', failedDraftIndex: 0 }));
  const row = await seedFlagged(s);
  const { row: after } = await s.queue.include({ queueId: row.id, tier: 'confidential', reviewer: 'admin-7', task: taskAuthz() });
  assert.equal(after.state, 'pending');
});

test('Include that COMMITS marks the row included + writes the include audit (the happy path still holds)', async () => {
  const s = makeStack(); // default gate commits
  const row = await seedFlagged(s);
  const { row: after, outcome } = await s.queue.include({ queueId: row.id, tier: 'confidential', reviewer: 'admin-7', task: taskAuthz(), nowIso: '2026-07-10T00:00:00.000Z' });
  assert.equal(outcome.kind, 'committed');
  assert.equal(after.state, 'included');
  assert.ok(s.store.audits.some((a) => a.action === 'include'));
});

// ── AC-2.ING.003.2 — a queued item leaves the queue ONLY via a logged Include/Exclude/Defer ─────────────────────
test('AC-2.ING.003.2: a terminal (excluded) row cannot be silently re-decided — the only exit was the logged decision', async () => {
  const s = makeStack();
  const row = await seedFlagged(s);
  await s.queue.exclude({ queueId: row.id, reviewer: 'admin-7', reason: 'irrelevant' });
  // any further decision must fail — the item already left the queue via a single logged decision.
  await assert.rejects(() => s.queue.exclude({ queueId: row.id, reviewer: 'admin-9', reason: 'again' }), QueueDecisionError);
  await assert.rejects(() => s.queue.defer({ queueId: row.id, reviewer: 'admin-9' }), QueueDecisionError);
  // and the store's transition guard itself forbids re-transitioning a terminal row.
  await assert.rejects(() => s.store.transition(row.id, { state: 'included', reviewedBy: 'x', reviewedAt: 'y', decisionReason: null }));
});

test('AC-2.ING.003.2: every exit path writes an audit record (Include/Exclude/Defer all logged)', async () => {
  const inc = makeStack();
  const incRow = await seedFlagged(inc, { flagReason: 'financial' });
  await inc.queue.include({ queueId: incRow.id, tier: 'confidential', reviewer: 'a1', task: taskAuthz() });
  assert.ok(inc.store.audits.some((a) => a.action === 'include' && a.queueId === incRow.id));

  const def = makeStack();
  const defRow = await seedFlagged(def);
  await def.queue.defer({ queueId: defRow.id, reviewer: 'a2', nowIso: '2026-07-10T00:00:00.000Z' });
  assert.ok(def.store.audits.some((a) => a.action === 'defer' && a.queueId === defRow.id));
});

// ── Defer mechanics: resurface + cadence-unknown guard ──────────────────────────────────────────────────────────
test('Defer sets deferred_until = now + ingest_defer_resurface_days and auto-resurfaces on cadence', async () => {
  const s = makeStack({ ingestDeferResurfaceDays: 14 });
  const row = await seedFlagged(s);
  const deferred = await s.queue.defer({ queueId: row.id, reviewer: 'a1', nowIso: '2026-07-01T00:00:00.000Z' });
  assert.equal(deferred.state, 'deferred');
  assert.equal(deferred.deferred_until, '2026-07-15T00:00:00.000Z');
  // not yet due → no resurface.
  assert.deepEqual(await s.queue.resurface('2026-07-14T00:00:00.000Z'), []);
  // due → resurfaces back to pending (never an indefinite silent hold).
  assert.deepEqual(await s.queue.resurface('2026-07-15T00:00:00.000Z'), [row.id]);
  assert.equal((await s.store.getQueueRow(row.id))!.state, 'pending');
});

test('Defer is refused when the resurface cadence is unknown (#3 — no exit that cannot guarantee its resurface)', async () => {
  const s = makeStack({ ingestDeferResurfaceDays: 0 });
  const row = await seedFlagged(s);
  await assert.rejects(() => s.queue.defer({ queueId: row.id, reviewer: 'a1' }), QueueDecisionError);
  assert.equal((await s.store.getQueueRow(row.id))!.state, 'pending', 'the item stays in the queue, not silently dropped');
});
