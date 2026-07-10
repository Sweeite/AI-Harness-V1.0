// ISSUE-026 (C2 ING) — un-actioned escalation (AC-2.ING.003.3): a queue item un-actioned past review_escalation_days
// is escalated (alert + badge), never silently held.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStack } from './testkit.ts';

// ── AC-2.ING.003.3 — un-actioned past review_escalation_days → escalated, never silently held ───────────────────
test('AC-2.ING.003.3: an item un-actioned past review_escalation_days is escalated (loud signal, not a silent hold)', async () => {
  const s = makeStack({ reviewEscalationDays: 7 });
  await s.queue.holdFlagged({ content: 'financial: $3M', sourceRef: null, flagReason: 'financial', suggestedTier: 'confidential', targetEntityId: 'e1', createdAt: '2026-07-01T00:00:00.000Z' });
  // 8 days later, still un-actioned → escalates.
  const escalated = await s.queue.escalateOverdue('2026-07-09T00:00:00.000Z');
  assert.equal(escalated.length, 1);
  assert.ok(escalated[0]!.ageDays >= 7);
  assert.equal(s.observ.escalations.length, 1, 'a loud escalation signal is emitted (never a silent hold — #3)');
});

test('AC-2.ING.003.3: an item within the cadence is NOT escalated', async () => {
  const s = makeStack({ reviewEscalationDays: 7 });
  await s.queue.holdFlagged({ content: 'legal thing', sourceRef: null, flagReason: 'legal', suggestedTier: 'confidential', targetEntityId: 'e1', createdAt: '2026-07-01T00:00:00.000Z' });
  const escalated = await s.queue.escalateOverdue('2026-07-05T00:00:00.000Z'); // 4 days
  assert.equal(escalated.length, 0);
  assert.equal(s.observ.escalations.length, 0);
});

test('AC-2.ING.003.3: an already-decided item is not escalated (only un-actioned pending/deferred items are)', async () => {
  const s = makeStack({ reviewEscalationDays: 7 });
  const row = await s.queue.holdFlagged({ content: 'legal thing', sourceRef: null, flagReason: 'legal', suggestedTier: 'confidential', targetEntityId: 'e1', createdAt: '2026-07-01T00:00:00.000Z' });
  await s.queue.exclude({ queueId: row.id, reviewer: 'a1', reason: 'handled' });
  const escalated = await s.queue.escalateOverdue('2026-07-20T00:00:00.000Z');
  assert.equal(escalated.length, 0, 'a decided item has left the queue — nothing to escalate');
});

test('AC-2.ING.003.3: a Deferred item still overdue by created_at escalates (a Defer is not a silent forever-hold)', async () => {
  const s = makeStack({ reviewEscalationDays: 7, ingestDeferResurfaceDays: 60 });
  const row = await s.queue.holdFlagged({ content: 'financial', sourceRef: null, flagReason: 'financial', suggestedTier: 'confidential', targetEntityId: 'e1', createdAt: '2026-07-01T00:00:00.000Z' });
  await s.queue.defer({ queueId: row.id, reviewer: 'a1', nowIso: '2026-07-02T00:00:00.000Z' });
  const escalated = await s.queue.escalateOverdue('2026-07-20T00:00:00.000Z');
  assert.equal(escalated.length, 1, 'a long-deferred item past the escalation cadence still surfaces (never silently held)');
});
