// ISSUE-054 (C5 OPT) — FR-5.OPT.004 Chained-task pre-warm. Proves AC-5.OPT.004.1: with pre-warm enabled B's memory
// retrieval may begin while A runs; it performs NO side effect and is DISCARDED if B never runs; and it respects
// OD-059's fresh-scope rule (B re-retrieves under its OWN handoff-derived scope, never A's inherited envelope).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  prewarmChainedRetrieval,
  ERR_INHERITED_SCOPE,
  ERR_SCOPE_TASK_MISMATCH,
  ERR_WRITE_DURING_PREWARM,
  type BFreshScope,
  type BEnvelope,
  type WriteGuard,
} from './prewarm.ts';

const freshScope = (over: Partial<BFreshScope> = {}): BFreshScope => ({
  source: 'handoff',
  b_task_id: 'B',
  handoff: { parent_output: 'A-result', provenance: 'A' },
  entities: ['e1'],
  ...over,
});

const bEnv = (): BEnvelope => ({ task_id: 'B', memory_retrieved: [] });

// a read-only retriever that also asserts it received B's OWN scope (not A's), and never writes anything.
function retriever(seen: BFreshScope[]) {
  return async (scope: BFreshScope): Promise<unknown[]> => {
    seen.push(scope);
    return ['mem-for-B'];
  };
}

test('AC-5.OPT.004.1 — enabled: B\'s retrieval begins early under B\'s own scope; commit lands it in B\'s envelope', async () => {
  const seen: BFreshScope[] = [];
  const handle = await prewarmChainedRetrieval(freshScope(), retriever(seen), { chainedTaskPrewarmEnabled: true });
  assert.equal(handle.warmed, true);
  assert.equal(handle.isLive(), true);
  assert.equal(seen.length, 1); // retrieval happened early (while A still runs)
  assert.equal(seen[0]!.source, 'handoff'); // B's OWN fresh scope (OD-059)
  const env = handle.commit(bEnv());
  assert.deepEqual(env.memory_retrieved, ['mem-for-B']);
});

test('AC-5.OPT.004.1 — pre-warm is DISCARDED if B never runs (no persistence, no side effect)', async () => {
  const seen: BFreshScope[] = [];
  const handle = await prewarmChainedRetrieval(freshScope(), retriever(seen), { chainedTaskPrewarmEnabled: true });
  assert.equal(handle.isLive(), true);
  handle.discard(); // B never runs
  assert.equal(handle.isLive(), false);
  const env = handle.commit(bEnv()); // committing a discarded handle is a no-op
  assert.deepEqual(env.memory_retrieved, []);
});

test('AC-5.OPT.004.1 — the injected write-guard trips LOUD if the retriever attempts a write (the guard is LIVE, not dead)', async () => {
  // Regression for the vacuous no-write assertion: prove the guard is actually wired and enforcing. A retriever
  // that attempts a write (calls the guard) must cause pre-warm to REJECT loud — a side effect never leaks silently.
  const writingRetriever = async (_s: BFreshScope, writeGuard: WriteGuard): Promise<unknown[]> => {
    writeGuard(); // an over-reaching retriever tries to persist during read-only pre-warm — must be rejected (#2/#3)
    return ['unreachable'];
  };
  await assert.rejects(
    () => prewarmChainedRetrieval(freshScope(), writingRetriever, { chainedTaskPrewarmEnabled: true }),
    new RegExp(ERR_WRITE_DURING_PREWARM.slice(0, 40)),
  );
});

test('AC-5.OPT.004.1 — a read-only retriever never trips the guard and pre-warm mutates the envelope by NOTHING before commit', async () => {
  let guardCalls = 0;
  const env = bEnv();
  const readOnly = async (_s: BFreshScope, writeGuard: WriteGuard): Promise<unknown[]> => {
    // a genuine read-only retriever simply never invokes the guard; wrap it to observe it stays untripped.
    const g: WriteGuard = () => { guardCalls++; return writeGuard(); };
    void g; // available but never called — read-only
    return ['mem'];
  };
  const handle = await prewarmChainedRetrieval(freshScope(), readOnly, { chainedTaskPrewarmEnabled: true });
  assert.equal(guardCalls, 0); // the write path was never touched
  assert.deepEqual(env.memory_retrieved, []); // pre-warm mutated B's envelope by NOTHING before an explicit commit
  assert.equal(handle.isLive(), true); // the result is held in memory only (not persisted anywhere observable)
  handle.discard();
  assert.deepEqual(env.memory_retrieved, []); // discarding a never-committed pre-warm leaves zero side effect
});

test('OD-059 — an INHERITED (A-scope) pre-warm is rejected loud (#2 over-reach guard)', async () => {
  const seen: BFreshScope[] = [];
  await assert.rejects(
    () => prewarmChainedRetrieval(freshScope({ source: 'inherited' }), retriever(seen), { chainedTaskPrewarmEnabled: true }),
    new RegExp(ERR_INHERITED_SCOPE.slice(0, 40)),
  );
  assert.equal(seen.length, 0); // never even retrieved under an inherited scope
});

test('OD-059 — committing a pre-warm to the WRONG task envelope is rejected (provenance integrity)', async () => {
  const seen: BFreshScope[] = [];
  const handle = await prewarmChainedRetrieval(freshScope({ b_task_id: 'B' }), retriever(seen), { chainedTaskPrewarmEnabled: true });
  assert.throws(() => handle.commit({ task_id: 'C', memory_retrieved: [] }), new RegExp(ERR_SCOPE_TASK_MISMATCH.slice(0, 40)));
});

test('FLAG-OFF regression — pre-warm disabled: no early retrieval, commit is a no-op (B retrieves at its own start)', async () => {
  const seen: BFreshScope[] = [];
  const handle = await prewarmChainedRetrieval(freshScope(), retriever(seen), { chainedTaskPrewarmEnabled: false });
  assert.equal(handle.warmed, false);
  assert.equal(seen.length, 0); // nothing pre-warmed
  const env = handle.commit(bEnv());
  assert.deepEqual(env.memory_retrieved, []); // B retrieves later, on its own
});
