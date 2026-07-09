// ISSUE-024 (C2 WRT) — the sole-writer orchestration (FR-2.WRT.001/003/004/005/007 + NFR-COST.008 / CMP.002).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeMemories, type SourceEvent, type WriterDeps, type MemoryWriterModel, type WriterDraft } from './writer.ts';
import { InMemoryCommitStore, buildMemoryRow, type WriteEventSink, type AuthzReader, type MemoryDraft } from './commit.ts';
import type { OriginatingAuthz } from '../../rls-enforcement/src/store.ts';
import type { EmbeddingProvider } from '../../embeddings/src/embed.ts';
import type { MemoryType, MemorySource } from '../../memory/src/entity-types.ts';
import type { MemoryRow } from '../../memory/src/store.ts';

const validVec = () => new Array(1536).fill(0.01);
const authorized = (): OriginatingAuthz => ({ userId: 'u1', active: true, clearances: [], restricted: [] });

class Sink implements WriteEventSink {
  events: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  async memoryWritten(p: Record<string, unknown>) { this.events.push({ kind: 'memoryWritten', payload: p }); }
  async superseded(p: Record<string, unknown>) { this.events.push({ kind: 'superseded', payload: p }); }
  async conflictQuarantined(p: Record<string, unknown>) { this.events.push({ kind: 'conflictQuarantined', payload: p }); }
  async authzHalted(p: Record<string, unknown>) { this.events.push({ kind: 'authzHalted', payload: p }); }
}
class Authz implements AuthzReader { async loadOriginatingAuthz() { return authorized(); } }
class EmptySimilar { async findSimilar() { return [] as MemoryRow[]; } async findSimilarForContext() { return [] as MemoryRow[]; } }

/** Returns a seeded prior for BOTH the context read and the per-draft read (M1 wiring proof). */
class PriorSimilar {
  constructor(private prior: MemoryRow[]) {}
  async findSimilar() { return this.prior; }
  async findSimilarForContext() { return this.prior; }
}

class FakeModel implements MemoryWriterModel {
  calls = 0;
  constructor(private drafts: WriterDraft[]) {}
  async draft() { this.calls++; return { drafts: this.drafts }; }
}
class FakeEmbedder implements EmbeddingProvider {
  constructor(private mode: 'ok' | 'throw' | 'degenerate' = 'ok') {}
  async embed(): Promise<number[]> {
    if (this.mode === 'throw') throw new Error('provider timeout');
    if (this.mode === 'degenerate') return new Array(1536).fill(0); // zero vector → EmbeddingError degenerate
    return validVec();
  }
}

function deps(model: MemoryWriterModel, embedder: EmbeddingProvider, over: Partial<WriterDeps> = {}): { deps: WriterDeps; sink: Sink; store: InMemoryCommitStore; enqueued: string[] } {
  const sink = new Sink();
  const store = new InMemoryCommitStore({ authz: new Authz(), similar: new EmptySimilar(), events: sink });
  const enqueued: string[] = [];
  const d: WriterDeps = {
    model,
    resolver: { resolve: async (m) => `ent-${m.name}` },
    similar: new EmptySimilar(),
    commit: store,
    embedder,
    events: sink,
    failureQueue: { enqueue: async (_e, reason) => { enqueued.push(reason); } },
    rateLimiter: { tryAcquire: () => true },
    ...over,
  };
  return { deps: d, sink, store, enqueued };
}

const event = (): SourceEvent => ({ taskId: 't1', summary: 'a GHL contact was updated', sourceEventRef: 'evt:1' });
const taskAuthz = { taskId: 't1', serviceRoleIdentity: 'memory-agent', originatingUserId: 'u1', reliedOn: { clearances: [], restricted: [] } };

function draft(over: Partial<WriterDraft> & Pick<WriterDraft, 'content'>): WriterDraft {
  return {
    type: 'semantic' as MemoryType,
    entities: [{ name: 'Acme', type: 'Client' }],
    sourceType: 'ai_inferred_strong',
    source_ref: null,
    visibility: 'team',
    sensitivity: 'standard',
    expires_at: null,
    ...over,
  };
}

test('AC-2.WRT.003.1 — one Sonnet call emits MULTIPLE typed, entity-linked memories (single call)', async () => {
  const model = new FakeModel([
    draft({ content: 'Acme uses Postgres', type: 'semantic' }),
    draft({ content: 'we met Acme on Tuesday', type: 'episodic' }),
    draft({ content: 'onboard via the checklist', type: 'procedural' }),
  ]);
  const { deps: d, store } = deps(model, new FakeEmbedder('ok'));
  const out = await writeMemories(event(), taskAuthz, d);
  assert.equal(out.kind, 'committed');
  assert.equal(model.calls, 1, 'exactly ONE Sonnet writer call for the whole event (cost shape)');
  assert.equal(store._liveMemories().length, 3, 'three typed memories committed');
  const types = store._liveMemories().map((m) => m.type).sort();
  assert.deepEqual(types, ['episodic', 'procedural', 'semantic']);
});

test('AC-2.WRT.004.1 / AC-NFR-CMP.002.1 — a system_pointer draft stores source_ref + enrichment, no copy', async () => {
  const model = new FakeModel([draft({ content: 'enrichment note', sourceType: 'system_pointer', source_ref: 'ghl://contact/42' })]);
  const { deps: d, store } = deps(model, new FakeEmbedder('ok'));
  await writeMemories(event(), taskAuthz, d);
  const m = store._liveMemories()[0]!;
  assert.equal(m.source, 'system_pointer');
  assert.equal(m.source_ref, 'ghl://contact/42');
  assert.equal(m.confidence, null);
});

test('AC-2.WRT.005.1 — the stored confidence lands in the source-type band (human_verified 0.95–1.0)', async () => {
  const model = new FakeModel([draft({ content: 'the CEO confirmed the renewal', sourceType: 'human_verified' })]);
  const { deps: d, store } = deps(model, new FakeEmbedder('ok'));
  await writeMemories(event(), taskAuthz, d);
  const c = store._liveMemories()[0]!.confidence!;
  assert.ok(c >= 0.95 && c <= 1.0, `got ${c}`);
});

test('AC-2.WRT.007.1 — an embedding failure HALTS the write, enqueues the source event, alerts, commits nothing', async () => {
  const model = new FakeModel([draft({ content: 'x' })]);
  const { deps: d, store, sink, enqueued } = deps(model, new FakeEmbedder('throw'));
  const out = await writeMemories(event(), taskAuthz, d);
  assert.equal(out.kind, 'halted_embed_failure');
  assert.equal(store._liveMemories().length, 0, 'no memory committed on an embed failure');
  assert.equal(enqueued.length, 1, 'the source event was enqueued for retry (never lost)');
  assert.ok(sink.events.some((e) => e.kind === 'memoryWritten' && e.payload.embed_failed === true), 'a loud embed-failure event fired');
});

test('AC-2.WRT.007.2 — a degenerate (zero) embedding is rejected (never stored with a bad vector)', async () => {
  const model = new FakeModel([draft({ content: 'x' })]);
  const { deps: d, store, enqueued } = deps(model, new FakeEmbedder('degenerate'));
  const out = await writeMemories(event(), taskAuthz, d);
  assert.equal(out.kind, 'halted_embed_failure');
  assert.match((out as { reason: string }).reason, /degenerate|zero/i);
  assert.equal(store._liveMemories().length, 0);
  assert.equal(enqueued.length, 1);
});

test('AC-NFR-COST.008.2 — the per-minute rate cap DEFERS (never runs unlimited); no Sonnet call, source enqueued', async () => {
  const model = new FakeModel([draft({ content: 'x' })]);
  const { deps: d, enqueued } = deps(model, new FakeEmbedder('ok'), { rateLimiter: { tryAcquire: () => false } });
  const out = await writeMemories(event(), taskAuthz, d);
  assert.equal(out.kind, 'deferred_rate_limited');
  assert.equal(model.calls, 0, 'the Sonnet writer was NOT called when the cap was hit (never unlimited)');
  assert.equal(enqueued.length, 1, 'the deferred event was enqueued, not dropped (#1)');
});

test('AC-NFR-COST.008.1 — the write path issues exactly one Sonnet call for a multi-memory event', async () => {
  const model = new FakeModel([draft({ content: 'a' }), draft({ content: 'b' })]);
  const { deps: d } = deps(model, new FakeEmbedder('ok'));
  await writeMemories(event(), taskAuthz, d);
  assert.equal(model.calls, 1);
});

// ── M1 regression: the Sonnet writer MUST receive the prior context so it can judge contradiction ──────────
class RecordingModel implements MemoryWriterModel {
  seenSimilar: MemoryRow[] | null = null;
  constructor(private out: WriterDraft[], private setContradictsIfPriors = false) {}
  async draft(_e: SourceEvent, similar: MemoryRow[]) {
    this.seenSimilar = similar;
    const contradicts = this.setContradictsIfPriors && similar.some((m) => m.type === 'semantic');
    return { drafts: this.out.map((d) => ({ ...d, contradicts })) };
  }
}

function priorRow(content: string, entity_ids: string[]): MemoryRow {
  const d: MemoryDraft = {
    type: 'semantic', content, entity_ids, sourceType: 'ai_inferred_strong', source_ref: null,
    visibility: 'team', sensitivity: 'standard', expires_at: null, embedding: [0.1], embedding_model: 'm',
  };
  return buildMemoryRow(d, `prior-${content}`, new Date().toISOString());
}

test('M1 — the writer feeds the resolved context priors into the ONE Sonnet call (not an empty set)', async () => {
  const model = new RecordingModel([draft({ content: 'Acme HQ is in Cambridge' })]);
  const prior = priorRow('Acme HQ is in Boston', ['ent-Acme']);
  const { deps: d } = deps(model, new FakeEmbedder('ok'), { similar: new PriorSimilar([prior]) });
  const ev: SourceEvent = { ...event(), contextEntities: [{ name: 'Acme', type: 'Client' }] };
  await writeMemories(ev, taskAuthz, d);
  assert.ok(model.seenSimilar && model.seenSimilar.length === 1, 'the model saw the prior context memory (M1 wiring)');
  assert.equal(model.seenSimilar![0]!.content, 'Acme HQ is in Boston');
});

test('M1 — a model-flagged contradiction against a real prior QUARANTINES end-to-end (WRT.002 hard path live)', async () => {
  const model = new RecordingModel([draft({ content: 'Acme is bankrupt', entities: [{ name: 'Acme', type: 'Client' }] })], /*setContradictsIfPriors*/ true);
  const prior = priorRow('Acme is thriving', ['ent-Acme']);
  const { deps: d, store } = deps(model, new FakeEmbedder('ok'), { similar: new PriorSimilar([prior]) });
  // seed the same prior into the commit store so the per-draft classify sees it live
  store._seed(prior);
  const ev: SourceEvent = { ...event(), contextEntities: [{ name: 'Acme', type: 'Client' }] };
  const out = await writeMemories(ev, taskAuthz, d);
  assert.equal(out.kind, 'committed'); // the outcome envelope is 'committed' (the batch ran); the per-draft result is quarantined
  const results = (out as { kind: 'committed'; results: any[] }).results;
  assert.equal(results[0].status, 'quarantined', 'the flagged contradiction was quarantined, not auto-superseded');
  assert.equal(store._conflicts().length, 1);
});

test('a writer that decides nothing is worth storing commits zero memories (a valid outcome)', async () => {
  const model = new FakeModel([]);
  const { deps: d, store } = deps(model, new FakeEmbedder('ok'));
  const out = await writeMemories(event(), taskAuthz, d);
  assert.equal(out.kind, 'committed');
  assert.equal(store._liveMemories().length, 0);
});
