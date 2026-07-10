// ISSUE-026 (C2 ING) — Filter 1 (relevance) + Filter 2 (sensitivity): AC-2.ING.001.1/.2/.3, AC-2.ING.002.1.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStack, taskAuthz } from './testkit.ts';
import { ingestCandidate, runSampledDropAudit } from './ingest.ts';
import type { CandidateEvent } from './filters.ts';

const banter: CandidateEvent = { content: 'lol thanks!', entityRefs: [], sourceRef: null };
const saveWorthy: CandidateEvent = { content: 'The client approved the Q3 campaign and prefers weekly status reports.', entityRefs: ['ent-client-1'], sourceRef: null, targetEntityId: 'ent-client-1' };

// ── AC-2.ING.001.1 — casual banter with no entity link is discarded, no Sonnet writer call ──────────────────────
test('AC-2.ING.001.1: banter with no entity link is dropped and NEVER reaches the writer (no Sonnet cost)', async () => {
  // Trust window OFF so a drop is a true live-discard (not a shadow-retain).
  const s = makeStack({ filter1TrustWindowActive: false });
  const res = await ingestCandidate(banter, { task: taskAuthz() }, s.deps);
  assert.equal(res.kind, 'dropped');
  assert.equal(s.gate.routes.length, 0, 'a dropped item must never route to the sole writer (no Sonnet call)');
  // and it must never have been held in the queue either.
  assert.equal((await s.store.listAll()).length, 0);
});

test('AC-2.ING.001.1: an event with no possible entity link is dropped even if the text looks substantive', async () => {
  const s = makeStack({ filter1TrustWindowActive: false });
  const res = await ingestCandidate({ content: 'A detailed note about nothing in particular here.', entityRefs: [], sourceRef: null }, { task: taskAuthz() }, s.deps);
  assert.equal(res.kind, 'dropped'); // there is no entity-less memory (design L1583)
  assert.equal(s.gate.routes.length, 0);
});

// ── AC-2.ING.001.2 — trust window active: a would-drop is SHADOW-RETAINED, not lost ─────────────────────────────
test('AC-2.ING.001.2: with the trust window active, a Filter-1 would-drop is retained (state=shadow_dropped), not lost', async () => {
  const s = makeStack({ filter1TrustWindowActive: true });
  const res = await ingestCandidate(banter, { task: taskAuthz() }, s.deps);
  assert.equal(res.kind, 'shadow_retained');
  const all = await s.store.listAll();
  assert.equal(all.length, 1);
  assert.equal(all[0]!.state, 'shadow_dropped'); // retained for audit, never silently discarded
  assert.equal(s.gate.routes.length, 0, 'a shadow-retained would-drop still never reaches the writer');
});

// ── AC-2.ING.001.3 — post-graduation sampled audit: >=5% / min-20 weekly, logged as a reviewed run ──────────────
test('AC-2.ING.001.3: >=5% of drops (min 20/week) are sampled and the audit run is logged', async () => {
  const s = makeStack();
  const drops = Array.from({ length: 1000 }, (_, i) => ({ content: `drop ${i}`, targetEntityId: null }));
  const run = await runSampledDropAudit({ drops, window: '2026-W28' }, s.deps);
  assert.equal(run.totalDrops, 1000);
  assert.ok(run.sampled >= 50, '5% of 1000 = 50 minimum sampled'); // >=5%
  assert.equal(run.reviewed, run.sampled);
  assert.equal(run.missed, false);
  assert.equal(s.observ.auditRuns.length, 1, 'the audit run is logged');
});

test('AC-2.ING.001.3: with few drops the min-20 floor applies (but never more than exist)', async () => {
  const s = makeStack();
  const run = await runSampledDropAudit({ drops: Array.from({ length: 12 }, () => ({ content: 'd', targetEntityId: null })), window: 'w' }, s.deps);
  assert.equal(run.sampled, 12, 'cannot sample more than exist; all 12 reviewed');
  assert.equal(run.missed, false);
});

test('AC-2.ING.001.3 / AC-2.MNT.015.3: a zero-drop week STILL logs a run, flagged missed (never silently skipped)', async () => {
  const s = makeStack();
  const run = await runSampledDropAudit({ drops: [], window: 'w-empty' }, s.deps);
  assert.equal(run.totalDrops, 0);
  assert.equal(run.missed, true, 'an empty/zero-reviewed run is flagged, not silently dropped (#3)');
  assert.equal(s.observ.auditRuns.length, 1);
});

// ── AC-2.ING.002.1 — Filter 2 holds sensitive content for a human decision, never auto-written ──────────────────
test('AC-2.ING.002.1: content with financial specifics is HELD for a human decision, not auto-written', async () => {
  const s = makeStack();
  const financial: CandidateEvent = { content: 'Q3 revenue was $2.4M and payroll runs $180k/month.', entityRefs: ['ent-org'], sourceRef: 'ghl:deal:9', targetEntityId: 'ent-org' };
  const res = await ingestCandidate(financial, { task: taskAuthz() }, s.deps);
  assert.equal(res.kind, 'held');
  assert.equal(s.gate.routes.length, 0, 'a flagged item is never auto-written');
  const all = await s.store.listAll();
  assert.equal(all[0]!.state, 'pending');
  assert.equal(all[0]!.flag_reason, 'financial');
  assert.equal(all[0]!.suggested_tier, 'confidential');
});

test('clean standard content passes both filters and routes to the sole writer', async () => {
  const s = makeStack();
  const res = await ingestCandidate(saveWorthy, { task: taskAuthz() }, s.deps);
  assert.equal(res.kind, 'written');
  assert.equal(s.gate.routes.length, 1);
  assert.equal(s.gate.routes[0]!.provenance.sensitivity, 'clean');
  assert.equal(s.gate.routes[0]!.provenance.relevance, 'passed');
});
