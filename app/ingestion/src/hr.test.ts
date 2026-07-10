// ISSUE-026 (C2 ING) — HR content off by default (AC-2.ING.005.1/.2) + the NFR-CMP.010 posture (AC-NFR-CMP.010.1/.2):
// HR content is Exclude-by-default; enablement is the legal-review output, never an engineering default.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeStack, taskAuthz } from './testkit.ts';
import { ingestCandidate } from './ingest.ts';
import { QueueDecisionError } from './queue.ts';
import { DEFAULT_INGESTION_CONFIG } from './config.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

const hrEvent = { content: 'termination decision and compensation review for a team member', entityRefs: ['tm-1'], sourceRef: null, targetEntityId: 'tm-1' };

// ── AC-2.ING.005.1 — with the default config, HR content's default reviewer decision is Exclude ────────────────
test('AC-2.ING.005.1: HR content is flagged and its default reviewer decision is Exclude (flag off)', async () => {
  const s = makeStack({ hrContentEnabled: false });
  const res = await ingestCandidate(hrEvent, { task: taskAuthz() }, s.deps);
  assert.equal(res.kind, 'held');
  const row = (await s.store.listAll())[0]!;
  assert.equal(row.flag_reason, 'hr');
  assert.equal(s.queue.defaultReviewerDecision(row), 'exclude'); // default is Exclude, not review
});

test('AC-2.ING.005.1 / NFR-CMP.010: an Include of HR content is REFUSED while hr_content_enabled is off', async () => {
  const s = makeStack({ hrContentEnabled: false });
  const row = await s.queue.holdFlagged({ content: hrEvent.content, sourceRef: null, flagReason: 'hr', suggestedTier: 'personal', targetEntityId: 'tm-1' });
  await assert.rejects(() => s.queue.include({ queueId: row.id, tier: 'personal', reviewer: 'admin-1', task: taskAuthz() }), QueueDecisionError);
  assert.equal(s.gate.routes.length, 0, 'no HR content reaches the writer by default (#2)');
});

// ── AC-2.ING.005.2 — with the flag enabled, HR content is storable and governed by HR-role clearances ──────────
test('AC-2.ING.005.2: with hr_content_enabled ON, HR content can be Included (governed by HR-role clearances downstream)', async () => {
  const s = makeStack({ hrContentEnabled: true });
  const row = await s.queue.holdFlagged({ content: hrEvent.content, sourceRef: null, flagReason: 'hr', suggestedTier: 'personal', targetEntityId: 'tm-1' });
  assert.equal(s.queue.defaultReviewerDecision(row), 'review'); // no longer forced to Exclude
  const { outcome } = await s.queue.include({ queueId: row.id, tier: 'personal', reviewer: 'hr-admin', task: taskAuthz() });
  assert.equal(outcome.kind, 'committed');
  assert.equal(s.gate.routes.length, 1);
  // stored at a personal tier — the C1 sensitivity/HR-role clearance governs who can read it (enforced in retrieval/RLS).
  assert.equal(s.store.audits.find((a) => a.action === 'include')!.tier, 'personal');
});

// ── AC-NFR-CMP.010.1 — HR off at boot ──────────────────────────────────────────────────────────────────────────
test('AC-NFR-CMP.010.1: the shipped default is hr_content_enabled=false (HR off at boot)', () => {
  assert.equal(DEFAULT_INGESTION_CONFIG.hrContentEnabled, false);
});

// ── AC-NFR-CMP.010.2 — enablement is the legal-review output, not an engineering default (registry-verified) ────
test('AC-NFR-CMP.010.2: the registry marks hr_content_enabled BOOT/false with a legal-review gate (not an eng default)', () => {
  const registry = readFileSync(join(HERE, '..', '..', '..', 'spec', '02-config', 'config-registry.md'), 'utf8');
  const row = registry.split('\n').find((l) => /^\|\s*`hr_content_enabled`\s*\|/.test(l))!;
  assert.ok(row, 'hr_content_enabled is a registered config row');
  assert.match(row, /\bBOOT\b/); // not LIVE-flippable at will
  assert.match(row, /false/i); // default off
  assert.match(row, /legal/i); // enablement is a legal-review output
});
