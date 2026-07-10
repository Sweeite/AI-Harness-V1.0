// ISSUE-026 (C2 ING) — the NO-BACKDOOR invariant (the #2 safety core): AC-2.ING.004.1 (no write without an explicit
// human Include) + AC-2.ING.010.1 (every pipeline write passed relevance + sensitivity + contradiction gates + the
// sole writer). "Ingestion is not a backdoor" (FR-2.ING.010) — enforced structurally in code, not by convention.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStack, taskAuthz } from './testkit.ts';
import { ingestCandidate } from './ingest.ts';
import { assertRoutable, BackdoorError, RecordingWriteGate, type FilterProvenance } from './store.ts';

// ── AC-2.ING.004.1 — flagged content with no human Include writes NOTHING ──────────────────────────────────────
test('AC-2.ING.004.1: flagged content run to completion with NO Include writes nothing', async () => {
  const s = makeStack();
  const financial = { content: 'invoice total $50,000 outstanding', entityRefs: ['e1'], sourceRef: null, targetEntityId: 'e1' };
  const res = await ingestCandidate(financial, { task: taskAuthz() }, s.deps);
  assert.equal(res.kind, 'held');
  // The pipeline ran to completion; the item sits in the queue and NOTHING reached the writer.
  assert.equal(s.gate.routes.length, 0);
  assert.equal((await s.store.listAll())[0]!.state, 'pending');
});

test('AC-2.ING.004.1: only an explicit human Include routes a flagged item to the writer', async () => {
  const s = makeStack();
  const row = await s.queue.holdFlagged({ content: 'personal: home address on file', sourceRef: null, flagReason: 'personal', suggestedTier: 'personal', targetEntityId: 'e1' });
  assert.equal(s.gate.routes.length, 0, 'held, not written');
  await s.queue.include({ queueId: row.id, tier: 'personal', reviewer: 'admin-3', task: taskAuthz() });
  assert.equal(s.gate.routes.length, 1, 'the human Include is the ONLY path that routed it to the writer');
  // and the route carried the explicit-Include provenance stamp.
  assert.equal(s.gate.routes[0]!.provenance.sensitivity, 'included');
  assert.equal(s.gate.routes[0]!.provenance.includedBy, 'admin-3');
});

// ── the gate STRUCTURALLY refuses an un-gated route (the invariant is code) ─────────────────────────────────────
test('the sole-writer gate refuses a route that skipped the filters (no relevance/sensitivity provenance)', async () => {
  assert.throws(() => assertRoutable({ relevance: 'passed' } as unknown as FilterProvenance), BackdoorError);
  assert.throws(() => assertRoutable({ sensitivity: 'clean' } as unknown as FilterProvenance), BackdoorError);
});

test('the gate refuses a FLAGGED item routed without an explicit human Include (includedBy missing)', async () => {
  assert.throws(() => assertRoutable({ relevance: 'passed', sensitivity: 'included' }), BackdoorError);
  const gate = new RecordingWriteGate();
  await assert.rejects(
    () => gate.route({ event: { taskId: 't', summary: 's', sourceEventRef: 'r' }, task: taskAuthz(), provenance: { relevance: 'passed', sensitivity: 'included' } }),
    BackdoorError,
  );
  assert.equal(gate.routes.length, 0, 'the un-gated route never reached the delegate');
});

// ── AC-2.ING.010.1 — every write passed relevance + sensitivity + contradiction gates + the sole writer ─────────
test('AC-2.ING.010.1: a clean pipeline write carries relevance+sensitivity provenance and goes through the sole writer', async () => {
  const s = makeStack();
  const clean = { content: 'The client prefers Slack over email for approvals.', entityRefs: ['e1'], sourceRef: 'slack:msg:1', targetEntityId: 'e1' };
  const res = await ingestCandidate(clean, { task: taskAuthz() }, s.deps);
  assert.equal(res.kind, 'written');
  const route = s.gate.routes[0]!;
  assert.equal(route.provenance.relevance, 'passed'); // Filter 1 passed
  assert.equal(route.provenance.sensitivity, 'clean'); // Filter 2 passed
  // the contradiction gate + the sole-writer serialization live INSIDE the ISSUE-024 writer the gate delegates to —
  // the route is the single governed entry point (no direct insert exists in this package).
  assert.equal(res.outcome.kind, 'committed');
});

test('AC-2.ING.010.1: the IngestionStore exposes NO memory-insert — there is no un-gated path to construct', () => {
  const s = makeStack();
  // The store's surface is queue + entities + audit only. A memory can be produced ONLY via the injected writer gate.
  assert.equal(typeof (s.store as unknown as Record<string, unknown>).insertMemory, 'undefined');
  assert.equal(typeof (s.store as unknown as Record<string, unknown>).commit, 'undefined');
});
