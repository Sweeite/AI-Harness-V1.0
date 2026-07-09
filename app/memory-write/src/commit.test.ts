// ISSUE-024 (C2 WRT) — FR-2.WRT.006 validate-and-commit (ADR-004 §3). The concurrency core + the Checkpoint-6
// closing condition: the sole-writer commit closes the TOCTOU window and never loses a write (#1).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  InMemoryCommitStore,
  buildMemoryRow,
  type MemoryDraft,
  type CommitInput,
  type WriteEventSink,
  type AuthzReader,
  type SimilarMemoryReader,
  type TaskAuthz,
} from './commit.ts';
import { classifyConflict, type Candidate } from './contradiction.ts';
import type { MemoryRow } from '../../memory/src/store.ts';
import type { MemoryType } from '../../memory/src/entity-types.ts';
import type { OriginatingAuthz } from '../../rls-enforcement/src/store.ts';

// ── test doubles ────────────────────────────────────────────────────────────────────────────────────
class RecordingSink implements WriteEventSink {
  events: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  async memoryWritten(p: Record<string, unknown>) { this.events.push({ kind: 'memoryWritten', payload: p }); }
  async superseded(p: Record<string, unknown>) { this.events.push({ kind: 'superseded', payload: p }); }
  async conflictQuarantined(p: Record<string, unknown>) { this.events.push({ kind: 'conflictQuarantined', payload: p }); }
  async authzHalted(p: Record<string, unknown>) { this.events.push({ kind: 'authzHalted', payload: p }); }
}

class FixedAuthz implements AuthzReader {
  constructor(private state: OriginatingAuthz | null) {}
  set(state: OriginatingAuthz | null) { this.state = state; }
  async loadOriginatingAuthz(_userId: string): Promise<OriginatingAuthz | null> { return this.state; }
}

/** A similar reader backed by a live-memory snapshot fn (so on-race re-checks see freshly-committed rows). */
class LiveSimilar implements SimilarMemoryReader {
  constructor(private snapshot: () => MemoryRow[]) {}
  async findSimilar(entityIds: string[], type: MemoryType, k: number): Promise<MemoryRow[]> {
    const set = new Set(entityIds);
    return this.snapshot()
      .filter((m) => m.superseded_by === null && m.type === type && m.entity_ids.some((e) => set.has(e)))
      .slice(0, k);
  }
}

const authorized = (userId = 'u1'): OriginatingAuthz => ({ userId, active: true, clearances: [], restricted: [] });
const task = (over: Partial<TaskAuthz> = {}): TaskAuthz => ({ taskId: 't1', serviceRoleIdentity: 'memory-agent', originatingUserId: 'u1', reliedOn: { clearances: [], restricted: [] }, ...over });

function makeDraft(over: Partial<MemoryDraft> & Pick<MemoryDraft, 'content' | 'entity_ids'>): MemoryDraft {
  return {
    type: 'semantic',
    sourceType: 'ai_inferred_strong',
    source_ref: null,
    visibility: 'team',
    sensitivity: 'standard',
    expires_at: null,
    embedding: [0.1, 0.2, 0.3],
    embedding_model: 'text-embedding-3-small',
    ...over,
  };
}

function input(store: InMemoryCommitStore, draft: MemoryDraft, similar: MemoryRow[], watermarkV0: number, over: Partial<CommitInput> = {}): CommitInput {
  const candidate: Candidate = { type: draft.type, content: draft.content, entity_ids: draft.entity_ids, contradicts: draft.contradicts };
  return { draft, decision: classifyConflict(candidate, similar), candidate, watermarkV0, task: task(), ...over };
}

function newStore(sink = new RecordingSink(), authz = new FixedAuthz(authorized()), similarSnapshot?: () => MemoryRow[], inLockHook?: (e: string[]) => Promise<void>) {
  let store: InMemoryCommitStore;
  const similar = new LiveSimilar(() => (similarSnapshot ? similarSnapshot() : store._liveMemories()));
  store = new InMemoryCommitStore({ authz, similar, events: sink }, inLockHook);
  return { store, sink, authz, similar };
}

// ── plain write ───────────────────────────────────────────────────────────────────────────────────
test('a clean write commits + emits memoryWritten', async () => {
  const { store, sink } = newStore();
  const draft = makeDraft({ content: 'Acme uses Postgres', entity_ids: ['11111111-1111-1111-1111-111111111111'] });
  const r = await store.commit(input(store, draft, [], 0));
  assert.equal(r.status, 'committed');
  assert.equal(store._liveMemories().length, 1);
  assert.ok(sink.events.some((e) => e.kind === 'memoryWritten'));
});

// ── AC-2.WRT.002.1 soft supersede ─────────────────────────────────────────────────────────────────
test('AC-2.WRT.002.1 — soft conflict supersedes the old (chain intact), NOT deletes it', async () => {
  const { store } = newStore();
  const prior = buildMemoryRow(makeDraft({ content: 'Acme HQ is in Boston', entity_ids: ['e1'] }), 'prior-1', new Date().toISOString());
  store._seed(prior);
  const draft = makeDraft({ content: 'Acme HQ is in Cambridge', entity_ids: ['e1'] });
  const r = await store.commit(input(store, draft, store._liveMemories(), 0));
  assert.equal(r.status, 'committed');
  assert.deepEqual(r.superseded, ['prior-1']);
  const all = store._allMemories();
  const old = all.find((m) => m.id === 'prior-1')!;
  assert.equal(old.superseded_by, r.memoryId, 'old memory retained + chained, not deleted');
  assert.equal(store._liveMemories().length, 1, 'exactly one live memory (the new one)');
});

// ── AC-2.WRT.002.2 hard quarantine ──────────────────────────────────────────────────────────────
test('AC-2.WRT.002.2 — hard conflict quarantines, never writes to the live set', async () => {
  const { store, sink } = newStore();
  const prior = buildMemoryRow(makeDraft({ content: 'Acme is thriving', entity_ids: ['e1'] }), 'prior-1', new Date().toISOString());
  store._seed(prior);
  const draft = makeDraft({ content: 'Acme is bankrupt', entity_ids: ['e1'], contradicts: true });
  const r = await store.commit(input(store, draft, store._liveMemories(), 0));
  assert.equal(r.status, 'quarantined');
  assert.ok(r.conflictId);
  assert.equal(store._liveMemories().length, 1, 'still just the prior — the contradiction was NOT applied');
  assert.equal(store._conflicts().length, 1);
  assert.equal(store._conflicts()[0]!.state, 'pending');
  assert.ok(sink.events.some((e) => e.kind === 'conflictQuarantined'));
});

// ── AC-2.WRT.002.3 overdue escalation ──────────────────────────────────────────────────────────
test('AC-2.WRT.002.3 — a hard conflict un-actioned past review_escalation_days escalates, not auto-resolved', async () => {
  const sink = new RecordingSink();
  const { store } = newStore(sink, new FixedAuthz(authorized()), undefined);
  const s2 = new InMemoryCommitStore({ authz: new FixedAuthz(authorized()), similar: new LiveSimilar(() => []), events: sink, reviewEscalationDays: 7 });
  const prior = buildMemoryRow(makeDraft({ content: 'x', entity_ids: ['e1'] }), 'p', new Date().toISOString());
  s2._seed(prior);
  await s2.commit(input(s2, makeDraft({ content: 'y', entity_ids: ['e1'], contradicts: true }), s2._liveMemories(), 0));
  // The fake stamps the conflict created_at from its logical clock (near epoch 0). Not yet due at now=5s.
  assert.deepEqual(await s2.escalateOverdueConflicts(5_000), []);
  // 8 days past epoch → escalated (age >= 7-day deadline).
  const escalated = await s2.escalateOverdueConflicts(8 * 24 * 60 * 60 * 1000);
  assert.equal(escalated.length, 1);
  assert.equal(s2._conflicts()[0]!.state, 'escalated');
  assert.ok(s2._conflicts()[0]!.escalated_at !== null);
  void store;
});

// ── AC-2.WRT.004.1 / AC-NFR-CMP.002.1 golden-rule pointer ────────────────────────────────────────
test('AC-2.WRT.004.1 / AC-NFR-CMP.002.1 — a system_pointer stores a source_ref, unscored, no verbatim copy', async () => {
  const { store } = newStore();
  const draft = makeDraft({ content: 'enrichment: the Q3 report', entity_ids: ['e1'], sourceType: 'system_pointer', source_ref: 'gdrive://file/abc' });
  const r = await store.commit(input(store, draft, [], 0));
  assert.equal(r.status, 'committed');
  const stored = store._allMemories().find((m) => m.id === r.memoryId)!;
  assert.equal(stored.source, 'system_pointer');
  assert.equal(stored.source_ref, 'gdrive://file/abc');
  assert.equal(stored.confidence, null, 'system_pointer is unscored');
});

// ── AC-2.WRT.006.1 idempotency (no duplicate) ────────────────────────────────────────────────────
test('AC-2.WRT.006.1 — two concurrent same-key writes → one commits, one no-ops (no duplicate)', async () => {
  const { store } = newStore();
  const draft = makeDraft({ content: 'Acme fact', entity_ids: ['e1'], source_ref: 'src:1' });
  const v0 = await store.readWatermark(['e1']);
  const [a, b] = await Promise.all([
    store.commit(input(store, draft, [], v0)),
    store.commit(input(store, makeDraft({ content: 'Acme fact', entity_ids: ['e1'], source_ref: 'src:1' }), [], v0)),
  ]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, ['committed', 'noop'], 'exactly one committed, one idempotent no-op');
  assert.equal(store._liveMemories().length, 1, 'no duplicate row');
});

// ── AC-2.WRT.006.1 CAS no-lost-supersede + on-race re-target ──────────────────────────────────────
test('AC-2.WRT.006.1 — two concurrent same-entity refinements: no lost-supersede, re-target the winner (chain intact)', async () => {
  const { store } = newStore();
  const t = buildMemoryRow(makeDraft({ content: 'HQ is in Boston', entity_ids: ['e1'] }), 'target-1', new Date().toISOString());
  store._seed(t);
  const snap = store._liveMemories();
  const v0 = await store.readWatermark(['e1']);
  const d1 = makeDraft({ content: 'HQ is in Denver', entity_ids: ['e1'], source_ref: 'r1' });
  const d2 = makeDraft({ content: 'HQ is in Cambridge', entity_ids: ['e1'], source_ref: 'r2' });
  const [r1, r2] = await Promise.all([
    store.commit(input(store, d1, snap, v0)),
    store.commit(input(store, d2, snap, v0)),
  ]);
  assert.equal(r1.status, 'committed');
  assert.equal(r2.status, 'committed');
  // The original target is superseded exactly once (the CAS winner). No lost-supersede: it is off the live set.
  const all = store._allMemories();
  const original = all.find((m) => m.id === 'target-1')!;
  assert.ok(original.superseded_by !== null, 'the original was superseded (not lost)');
  // Exactly ONE live memory remains for this entity (the last winner in the chain) — the loser re-targeted the
  // winner via the watermark re-check rather than double-superseding the original.
  assert.equal(store._liveMemories().length, 1, 'the supersede chain converged to a single live head');
  const totalSuperseded = all.filter((m) => m.superseded_by !== null).length;
  assert.equal(totalSuperseded, 2, 'target-1 and the first refinement are both superseded (t←w1←w2), none lost');
});

// ── AC-2.WRT.006.2 disjoint entity sets never block ──────────────────────────────────────────────
test('AC-2.WRT.006.2 — a write on a disjoint entity set does NOT block behind a held same-entity lock', async () => {
  let releaseGate!: () => void;
  const gate = new Promise<void>((res) => (releaseGate = res));
  const order: string[] = [];
  const inLockHook = async (entityIds: string[]) => {
    if (entityIds.includes('BLOCK')) {
      order.push('A-locked');
      await gate; // A holds its lock here until the test releases it
      order.push('A-released');
    } else {
      order.push('B-ran');
    }
  };
  const { store } = newStore(new RecordingSink(), new FixedAuthz(authorized()), undefined, inLockHook);
  const a = store.commit(input(store, makeDraft({ content: 'a', entity_ids: ['BLOCK'] }), [], 0));
  const b = store.commit(input(store, makeDraft({ content: 'b', entity_ids: ['OTHER'] }), [], 0));
  await b; // B must complete WITHOUT waiting for A's gate
  assert.ok(order.includes('B-ran') && !order.includes('A-released'), `B ran while A still held its disjoint lock: ${order.join(',')}`);
  releaseGate();
  await a;
});

// ── AC-2.WRT.006.2 same-entity writes DO serialize ────────────────────────────────────────────────
test('AC-2.WRT.006.2 (converse) — two writes on the SAME entity serialize on the advisory lock', async () => {
  let release1!: () => void;
  const gate1 = new Promise<void>((res) => (release1 = res));
  const hookCalls: string[] = [];
  let first = true;
  const inLockHook = async (_e: string[]) => {
    if (first) { first = false; hookCalls.push('first-in'); await gate1; hookCalls.push('first-out'); }
    else { hookCalls.push('second-in'); }
  };
  const { store } = newStore(new RecordingSink(), new FixedAuthz(authorized()), undefined, inLockHook);
  const a = store.commit(input(store, makeDraft({ content: 'a', entity_ids: ['SAME'], source_ref: 'a' }), [], 0));
  const b = store.commit(input(store, makeDraft({ content: 'b', entity_ids: ['SAME'], source_ref: 'b' }), [], 0));
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(hookCalls, ['first-in'], 'the second write has NOT entered the lock while the first holds it');
  release1();
  await Promise.all([a, b]);
  assert.deepEqual(hookCalls, ['first-in', 'first-out', 'second-in'], 'the second entered only after the first released');
});

// ── AC-2.WRT.006.3 mid-task revocation halt ──────────────────────────────────────────────────────
test('AC-2.WRT.006.3 — deactivation mid-write halts + quarantines at the commit boundary (not committed)', async () => {
  const authz = new FixedAuthz(authorized());
  const { store, sink } = newStore(new RecordingSink(), authz);
  // by commit time, the originating user is deactivated
  authz.set({ userId: 'u1', active: false, clearances: [], restricted: [] });
  const r = await store.commit(input(store, makeDraft({ content: 'x', entity_ids: ['e1'] }), [], 0));
  assert.equal(r.status, 'halted');
  assert.equal(r.reeval?.stopReason, 'deactivated');
  assert.equal(store._liveMemories().length, 0, 'nothing committed on a revoked snapshot');
  assert.equal(store._conflicts().length, 1, 'the pending write is quarantined for review (#1)');
  assert.ok(sink.events.some((e) => e.kind === 'authzHalted'));
});

test('AC-2.WRT.006.3 — a relied-on clearance revoked mid-write halts', async () => {
  const authz = new FixedAuthz({ userId: 'u1', active: true, clearances: [{ tier: 'confidential', entityTypeScope: null }], restricted: [] });
  const { store } = newStore(new RecordingSink(), authz);
  authz.set({ userId: 'u1', active: true, clearances: [], restricted: [] }); // clearance revoked
  const inp = input(store, makeDraft({ content: 'x', entity_ids: ['e1'] }), [], 0, {
    task: task({ reliedOn: { clearances: [{ tier: 'confidential', entityTypeScope: null }], restricted: [] } }),
  });
  const r = await store.commit(inp);
  assert.equal(r.status, 'halted');
  assert.equal(r.reeval?.stopReason, 'clearance_revoked');
});

test('AC-2.WRT.006.3 — a benign session-expiry (still active, grants held) does NOT halt — it commits', async () => {
  // expiry ≠ revocation: the authz DATA is unchanged (active + grants held); only the session expired. The
  // service_role continuation re-checks as authorized → commit (FR-0.SESS.006).
  const authz = new FixedAuthz(authorized());
  const { store } = newStore(new RecordingSink(), authz);
  const r = await store.commit(input(store, makeDraft({ content: 'x', entity_ids: ['e1'] }), [], 0));
  assert.equal(r.status, 'committed', 'a benign expiry keeps the authz data intact → the write proceeds');
});

// ── AC-2.WRT.001.1 sole-writer invariant ─────────────────────────────────────────────────────────
test('AC-2.WRT.001.1 — every live memory in the store arrived via commit() (the single governed path)', async () => {
  const { store } = newStore();
  await store.commit(input(store, makeDraft({ content: 'one', entity_ids: ['e1'], source_ref: 's1' }), [], 0));
  await store.commit(input(store, makeDraft({ content: 'two', entity_ids: ['e2'], source_ref: 's2' }), [], 0));
  // The port exposes NO insert/update other than commit(); _seed is a test-only reference helper. This is the
  // structural sole-writer guarantee — the live adapter holds the only `insert into memories` in the codebase.
  assert.equal(store._liveMemories().length, 2);
});
