// ISSUE-026 (C2 ING) — the three pipelines: AC-2.ING.006.1 (structured, external_refs, no copy), AC-2.ING.007.1
// (documents chunked + both filters + stored via the writer), AC-2.ING.008.1 (interview memories verified before 1.0).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStack, taskAuthz, committedWith } from './testkit.ts';
import { chunkText, runPipeline1, runPipeline2, runPipeline3, type StructuredRecord } from './pipelines.ts';

// ── AC-2.ING.006.1 — Pipeline 1 creates entities with external_refs and copies no source record wholesale ──────
test('AC-2.ING.006.1: Pipeline 1 creates entities WITH external_refs and never copies a source record wholesale', async () => {
  const s = makeStack();
  const records: StructuredRecord[] = [
    { entityType: 'Client', name: 'Acme Co', externalRefs: { ghl: 'contact/abc' }, summary: 'Acme is a retainer client on the growth plan.', sourceRef: 'ghl:contact/abc' },
    { entityType: 'Deal', name: 'Acme Q3', externalRefs: { ghl: 'deal/42' }, summary: 'Acme Q3 deal is in negotiation.', sourceRef: 'ghl:deal/42' },
  ];
  const report = await runPipeline1(records, { task: taskAuthz() }, s.deps);
  assert.equal(report.entitiesCreated.length, 2);
  for (const e of report.entitiesCreated) {
    assert.ok(Object.keys(e.external_refs).length > 0, 'each entity carries external_refs (the resolution join key / pointer)');
  }
  assert.equal(report.copiedWholesale, false);
  // The memory routed carries the source_ref pointer + the SUMMARY (enrichment), never the raw record.
  assert.equal(report.memoriesRouted, 2);
  for (const route of s.gate.routes) {
    assert.ok(route.event.sourceEventRef.startsWith('ghl:'), 'the write points at the system of record (source_ref), not a copy');
  }
});

// ── AC-2.ING.007.1 — Pipeline 2 chunks at the configured size, passes both filters, stores via the writer ──────
test('chunkText splits at the configured size with overlap', () => {
  const text = Array.from({ length: 25 }, (_, i) => `w${i}`).join(' ');
  const chunks = chunkText(text, 10, 2);
  assert.ok(chunks.length >= 3);
  assert.equal(chunks[0]!.split(' ').length, 10, 'first chunk is the configured size');
});

test('AC-2.ING.007.1: Pipeline 2 chunks at chunk_size_tokens, passes both filters, and stores clean chunks via the writer', async () => {
  const s = makeStack({ chunkSizeTokens: 10 });
  const text = Array.from({ length: 40 }, () => 'the client prefers weekly reports and approvals via slack').join(' ');
  const report = await runPipeline2({ text, sourceRef: 'drive:sop/1', targetEntityId: 'e1', entityRefs: ['e1'] }, { task: taskAuthz() }, s.deps);
  assert.equal(report.chunkSizeTokens, 10);
  assert.ok(report.chunks > 1, 'the document was chunked');
  assert.equal(report.written, report.chunks, 'each clean chunk was stored via the sole writer');
  assert.equal(s.gate.routes.length, report.chunks);
  assert.equal(report.verificationPassRun, true);
});

test('AC-2.ING.007.1: a flagged chunk is held (both filters applied), not auto-written', async () => {
  const s = makeStack({ chunkSizeTokens: 50 });
  const report = await runPipeline2({ text: 'the vendor lawsuit and settlement terms are confidential', sourceRef: 'drive:doc/2', targetEntityId: 'e1', entityRefs: ['e1'] }, { task: taskAuthz() }, s.deps);
  assert.equal(report.held, 1, 'the legal chunk was flagged by Filter 2 and held');
  assert.equal(report.written, 0);
});

// ── AC-2.ING.008.1 — Pipeline 3 interview memories are surfaced for verification before confidence 1.0 ─────────
test('AC-2.ING.008.1: interview memories are created and surfaced for verification BEFORE reaching confidence 1.0', async () => {
  // The writer commits two memories; the pipeline surfaces them awaiting verification (it does NOT verify them).
  const s = makeStack({}, committedWith(['mem-a', 'mem-b']));
  const report = await runPipeline3(
    {
      sessionNo: 2,
      statements: [{ content: 'We run a weekly ops standup every Monday.', entityRefs: ['org'], targetEntityId: 'org' }],
      contextEntities: [{ name: 'Internal Org', type: 'Internal Org' }],
    },
    { task: taskAuthz() },
    s.deps,
  );
  assert.equal(report.memoriesCreated, 2);
  assert.deepEqual(report.awaitingVerification, ['mem-a', 'mem-b']);
  // crucial: the pipeline did NOT bump anything to confidence 1.0 — verification is a later, human step.
  assert.equal(s.verifier.verified.length, 0, 'interview memories are not auto-trusted; verification happens separately');
});
