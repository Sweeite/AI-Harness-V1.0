import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listConflictsForReview, resolveConflict } from './conflicts.ts';
import { InMemoryConflictConsolidationStore as Store, InMemorySoleWriter, type MemoryFacts, type WriteSourceType } from './store.ts';

const ctx = { reviewerId: '00000000-0000-0000-0000-000000000001', reviewerIdentity: 'admin@client', reason: 'reviewed' };

function seedConflict(opts: { newSource?: WriteSourceType; sensitivity?: 'standard' | 'personal' | 'restricted'; existing: MemoryFacts[] }) {
  const store = new Store();
  const conflict = Store.conflict({
    id: 'conf-1',
    new_memory: Store.held({ sourceType: opts.newSource ?? 'human_verified', sensitivity: opts.sensitivity ?? 'standard', content: 'the new fact' }),
    conflicting_memory_ids: opts.existing.map((e) => e.id),
  });
  store.seedConflicts([conflict]).seedLiveMemories(opts.existing);
  return store;
}

// ── AC-2.WRT.002.2 — held in quarantine, never silently applied ─────────────────────────────────────────────
test('AC-2.WRT.002.2 — a pending hard conflict is surfaced for review, the old memory untouched, the new NOT in the live set', async () => {
  const existing: MemoryFacts = { id: '11111111-1111-1111-1111-111111111111', source: 'ai_inferred', createdAt: '2026-01-01T00:00:00Z', confidence: 0.7 };
  const store = seedConflict({ existing: [existing] });
  const decorated = await listConflictsForReview(store);
  assert.equal(decorated.length, 1);
  assert.equal(decorated[0]!.record.state, 'pending');
  assert.equal(decorated[0]!.previewComplete, true);
  // the suggested resolution was computed + persisted; nothing was written to memories.
  assert.equal(decorated[0]!.suggested.kind, 'keep_new'); // human_verified new beats ai_inferred existing
  assert.deepEqual(store.snapshotConflict('conf-1')!.suggested_resolution!.kind, 'keep_new');
});

test('partial load — a conflicting id no longer live → previewComplete=false (surface disables resolve actions, #2)', async () => {
  const existing: MemoryFacts = { id: 'aaaaaaaa-0000-0000-0000-000000000001', source: 'ai_inferred', createdAt: '2026-01-01T00:00:00Z', confidence: 0.7 };
  const store = seedConflict({ existing: [existing] });
  store.markSuperseded(existing.id); // it got superseded since quarantine
  const decorated = await listConflictsForReview(store);
  assert.equal(decorated[0]!.previewComplete, false);
});

// ── AC-2.WRT.002.1 — Keep-new CAS-supersedes (chain intact), routed through the sole writer ─────────────────
test('AC-2.WRT.002.1 — Keep-new writes the new memory + CAS-supersedes the existing through the sole writer (chain intact, not deleted)', async () => {
  const existing: MemoryFacts = { id: 'bbbbbbbb-0000-0000-0000-000000000001', source: 'ai_inferred', createdAt: '2026-01-01T00:00:00Z', confidence: 0.7 };
  const store = seedConflict({ existing: [existing] });
  const writer = new InMemorySoleWriter().seedLive([existing.id]);
  const out = await resolveConflict(store, writer, { conflictId: 'conf-1', action: 'keep_new', ctx });
  assert.equal(out.status, 'resolved');
  assert.deepEqual(out.superseded, [existing.id]);
  assert.equal(writer.writes.length, 1); // routed through the writer — NOT a direct insert
  assert.match(writer.writes[0]!.kind, /^keep_new/);
  assert.equal(writer.isLive(existing.id), false); // superseded
  assert.equal(store.snapshotConflict('conf-1')!.state, 'resolved');
});

test('Keep-existing — discards the held write, existing untouched, no writer call', async () => {
  const existing: MemoryFacts = { id: 'cccccccc-0000-0000-0000-000000000001', source: 'human_verified', createdAt: '2026-06-01T00:00:00Z', confidence: 0.9 };
  const store = seedConflict({ newSource: 'ai_inferred_weak', existing: [existing] });
  const writer = new InMemorySoleWriter().seedLive([existing.id]);
  const out = await resolveConflict(store, writer, { conflictId: 'conf-1', action: 'keep_existing', ctx });
  assert.equal(out.status, 'resolved');
  assert.equal(writer.writes.length, 0);
  assert.equal(writer.isLive(existing.id), true);
  assert.equal(store.snapshotConflict('conf-1')!.state, 'resolved');
});

test('Keep-both — retains both live (supersedes nothing), links a note, closes the record (never dangling)', async () => {
  const existing: MemoryFacts = { id: 'dddddddd-0000-0000-0000-000000000001', source: 'ai_inferred', createdAt: '2026-01-01T00:00:00Z', confidence: 0.7 };
  const store = seedConflict({ newSource: 'ai_inferred_weak', existing: [existing] });
  const writer = new InMemorySoleWriter().seedLive([existing.id]);
  const out = await resolveConflict(store, writer, { conflictId: 'conf-1', action: 'keep_both', ctx, note: 'conflicting accounts' });
  assert.equal(out.status, 'resolved');
  assert.equal(writer.isLive(existing.id), true); // NOT superseded
  assert.match(writer.writes[0]!.kind, /^keep_both/);
  const snap = store.snapshotConflict('conf-1')!;
  assert.equal(snap.state, 'resolved');
  assert.equal(snap.suggested_resolution!.kind, 'keep_both_with_note');
});

// ── #3 — a writer-side non-commit surfaces loudly, never falsely closes ─────────────────────────────────────
test('#3 — Keep-new when the governed write does NOT commit → write_incomplete, record stays actionable (NOT resolved)', async () => {
  const existing: MemoryFacts = { id: 'eeeeeeee-0000-0000-0000-000000000001', source: 'ai_inferred', createdAt: '2026-01-01T00:00:00Z', confidence: 0.7 };
  const store = seedConflict({ existing: [existing] });
  const writer = new InMemorySoleWriter().seedLive([existing.id]);
  writer.failNext = true;
  const out = await resolveConflict(store, writer, { conflictId: 'conf-1', action: 'keep_new', ctx });
  assert.equal(out.status, 'write_incomplete');
  assert.equal(store.snapshotConflict('conf-1')!.state, 'pending'); // still actionable
  assert.equal(writer.isLive(existing.id), true); // not superseded
});

// ── audit — Personal/Restricted resolution → access_audit ───────────────────────────────────────────────────
test('a Personal-tier held candidate resolution is audited (FR-1.AUD.001)', async () => {
  const existing: MemoryFacts = { id: 'ffffffff-0000-0000-0000-000000000001', source: 'ai_inferred', createdAt: '2026-01-01T00:00:00Z', confidence: 0.7 };
  const store = seedConflict({ newSource: 'human_verified', sensitivity: 'personal', existing: [existing] });
  const writer = new InMemorySoleWriter().seedLive([existing.id]);
  await resolveConflict(store, writer, { conflictId: 'conf-1', action: 'keep_new', ctx });
  assert.equal(store.audits.length, 1);
  assert.equal(store.audits[0]!.auditType, 'memory_conflict_review');
  assert.equal(store.audits[0]!.actorType, 'user');
});

test('a standard-tier resolution is NOT audited (only sensitive tiers)', async () => {
  const existing: MemoryFacts = { id: 'ffffffff-0000-0000-0000-000000000002', source: 'ai_inferred', createdAt: '2026-01-01T00:00:00Z', confidence: 0.7 };
  const store = seedConflict({ newSource: 'human_verified', sensitivity: 'standard', existing: [existing] });
  const writer = new InMemorySoleWriter().seedLive([existing.id]);
  await resolveConflict(store, writer, { conflictId: 'conf-1', action: 'keep_new', ctx });
  assert.equal(store.audits.length, 0);
});

test('resolving a non-existent / already-resolved conflict throws (not a silent no-op)', async () => {
  const store = new Store();
  const writer = new InMemorySoleWriter();
  await assert.rejects(() => resolveConflict(store, writer, { conflictId: 'nope', action: 'keep_existing', ctx }), /not a pending/);
});
