import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gateConsolidation, resolveConsolidation } from './consolidation.ts';
import { InMemoryConflictConsolidationStore as Store, InMemorySoleWriter, type MemoryFacts } from './store.ts';

const ctx = { reviewerId: '00000000-0000-0000-0000-0000000000aa', reviewerIdentity: 'sa@client', reason: null };
const liveSrc = (id: string): MemoryFacts => ({ id, source: 'ai_inferred', createdAt: '2026-01-01T00:00:00Z', confidence: 0.7 });

// ── AC-2.MNT.014.1 — Personal-tier not auto-consolidated ────────────────────────────────────────────────────
test('AC-2.MNT.014.1 — a Personal-tier candidate is skipped from auto-consolidation and queued (never auto-folded)', async () => {
  const store = new Store();
  const out = await gateConsolidation(store, { candidateMemoryIds: ['m1', 'm2'], op: 'merge', tiers: ['personal'] });
  assert.equal(out.skipped, true);
  assert.ok(out.approvalId);
  const queued = await store.listPendingConsolidations();
  assert.equal(queued.length, 1);
  assert.equal(queued[0]!.op, 'merge');
  assert.equal(queued[0]!.tier, 'personal');
  assert.equal(store.queuedEvents.length, 1); // loud (#3)
});

test('AC-2.MNT.014.1 (boundary) — a standard-tier candidate is NOT gated here (027 may auto-consolidate)', async () => {
  const store = new Store();
  const out = await gateConsolidation(store, { candidateMemoryIds: ['m1', 'm2'], op: 'summarise', tiers: ['standard'] });
  assert.equal(out.skipped, false);
  assert.equal(out.approvalId, null);
  assert.equal((await store.listPendingConsolidations()).length, 0);
});

// ── Finding-1 fix — the gate sees the FULL tier set (a max-reduction cannot slip a Personal member past) ──────
test('Finding-1 — a MIXED {standard, personal} set is gated (a personal member cannot slip past)', async () => {
  const store = new Store();
  const out = await gateConsolidation(store, { candidateMemoryIds: ['m1', 'm2'], op: 'merge', tiers: ['standard', 'personal'] });
  assert.equal(out.skipped, true);
  assert.equal((await store.listPendingConsolidations())[0]!.tier, 'personal'); // highest tier stored
});

test('Finding-1 — a MIXED {personal, restricted} set is gated + stored at the HIGHEST tier (restricted clearance to review)', async () => {
  const store = new Store();
  const out = await gateConsolidation(store, { candidateMemoryIds: ['m1', 'm2'], op: 'merge', tiers: ['personal', 'restricted'] });
  assert.equal(out.skipped, true);
  assert.equal((await store.listPendingConsolidations())[0]!.tier, 'restricted');
});

test('#2 defense — a pure Restricted set is gated too (never silently broaden the most sensitive tier)', async () => {
  const store = new Store();
  const out = await gateConsolidation(store, { candidateMemoryIds: ['m1'], op: 'summarise', tiers: ['restricted'] });
  assert.equal(out.skipped, true);
});

test('a confidential-only set is NOT gated (out of FR-2.MNT.014 scope; 027 decides)', async () => {
  const store = new Store();
  const out = await gateConsolidation(store, { candidateMemoryIds: ['m1'], op: 'merge', tiers: ['confidential', 'standard'] });
  assert.equal(out.skipped, false);
});

// ── approve / reject route through the sole writer ──────────────────────────────────────────────────────────
test('Approve — routes the merge/summarise through the sole writer, supersedes the sources, closes the record, audited', async () => {
  const store = new Store().seedLiveMemories([liveSrc('s1'), liveSrc('s2')]);
  const { approvalId } = await gateConsolidation(store, { candidateMemoryIds: ['s1', 's2'], op: 'merge', tiers: ['personal'] });
  const writer = new InMemorySoleWriter().seedLive(['s1', 's2']);
  const out = await resolveConsolidation(store, writer, { approvalId: approvalId!, decision: 'approve', ctx });
  assert.equal(out.status, 'approved');
  assert.deepEqual(out.superseded!.sort(), ['s1', 's2']);
  assert.equal(writer.writes.length, 1);
  assert.match(writer.writes[0]!.kind, /^consolidate:merge/);
  assert.equal(store.snapshotConsolidation(approvalId!)!.state, 'resolved');
  assert.equal(store.audits.length, 1); // Personal resolution audited
  assert.equal(store.audits[0]!.auditType, 'personal_consolidation_review');
});

test('Reject — keeps sources separate, no writer call, reason logged, audited', async () => {
  const store = new Store().seedLiveMemories([liveSrc('s1'), liveSrc('s2')]);
  const { approvalId } = await gateConsolidation(store, { candidateMemoryIds: ['s1', 's2'], op: 'summarise', tiers: ['personal'] });
  const writer = new InMemorySoleWriter().seedLive(['s1', 's2']);
  const out = await resolveConsolidation(store, writer, { approvalId: approvalId!, decision: 'reject', ctx });
  assert.equal(out.status, 'rejected');
  assert.equal(writer.writes.length, 0);
  assert.equal(writer.isLive('s1'), true);
  assert.equal(writer.isLive('s2'), true);
  assert.equal(store.snapshotConsolidation(approvalId!)!.state, 'resolved');
});

// ── Finding-4 fix — approve blocked when the candidate sources can't be fully resolved (#2 partial guard) ─────
test('Finding-4 — Approve is BLOCKED when a candidate source is no longer live (partial preview) → write_incomplete, actionable', async () => {
  const store = new Store().seedLiveMemories([liveSrc('s1'), liveSrc('s2')]);
  const { approvalId } = await gateConsolidation(store, { candidateMemoryIds: ['s1', 's2'], op: 'merge', tiers: ['personal'] });
  store.markSuperseded('s2'); // a source got superseded since queuing → set no longer fully resolvable
  const writer = new InMemorySoleWriter().seedLive(['s1', 's2']);
  const out = await resolveConsolidation(store, writer, { approvalId: approvalId!, decision: 'approve', ctx });
  assert.equal(out.status, 'write_incomplete');
  assert.equal(writer.writes.length, 0); // never folded a partial set
  assert.equal(store.snapshotConsolidation(approvalId!)!.state, 'pending'); // still actionable
});

// ── #3 — a writer-side non-commit surfaces loudly, never falsely closes ─────────────────────────────────────
test('#3 — Approve when the governed consolidation does NOT commit → write_incomplete, record stays actionable', async () => {
  const store = new Store().seedLiveMemories([liveSrc('s1'), liveSrc('s2')]);
  const { approvalId } = await gateConsolidation(store, { candidateMemoryIds: ['s1', 's2'], op: 'merge', tiers: ['personal'] });
  const writer = new InMemorySoleWriter().seedLive(['s1', 's2']);
  writer.failNext = true;
  const out = await resolveConsolidation(store, writer, { approvalId: approvalId!, decision: 'approve', ctx });
  assert.equal(out.status, 'write_incomplete');
  assert.equal(store.snapshotConsolidation(approvalId!)!.state, 'pending');
  assert.equal(writer.isLive('s1'), true); // sources untouched
});

test('resolving a non-existent approval throws (not a silent no-op)', async () => {
  const store = new Store();
  const writer = new InMemorySoleWriter();
  await assert.rejects(() => resolveConsolidation(store, writer, { approvalId: 'nope', decision: 'reject', ctx }), /not a pending/);
});
