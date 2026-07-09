// ISSUE-023 (C2 VEC) — the AF-019 retrieval-session contract tests. FR-2.VEC.001 + NFR-PERF.009 (ef_search dial,
// raise-not-drop). The contract's job: force the HNSW index under the RLS clearance predicate (the ISSUE-002 ~308x
// cliff) + keep recall via iterative scans. AC-NFR-PERF.009.1.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EF_SEARCH_MIN,
  EF_SEARCH_MAX,
  EF_SEARCH_DEFAULT,
  EfSearchRangeError,
  assertEfSearch,
  raiseEfSearch,
  retrievalSessionSql,
  applyRetrievalSession,
} from './retrieval-session.ts';

test('retrievalSessionSql emits the three contract GUCs, all set local, in a stable order', () => {
  const sql = retrievalSessionSql(40);
  assert.deepEqual(sql, [
    'set local hnsw.ef_search = 40',
    `set local hnsw.iterative_scan = 'relaxed_order'`,
    'set local enable_seqscan = off',
  ]);
  // every statement is `set local` — scoped to the retrieval txn, never a global planner change.
  for (const s of sql) assert.match(s, /^set local /);
});

test('retrievalSessionSql defaults ef_search to the CFG default (40)', () => {
  assert.match(retrievalSessionSql()[0]!, /hnsw\.ef_search = 40/);
});

test('the contract forces the index (enable_seqscan=off) AND keeps recall (iterative_scan=relaxed_order)', () => {
  const sql = retrievalSessionSql(80).join('\n');
  assert.match(sql, /enable_seqscan = off/); // planner-forcing: the AF-019 seqscan-cliff fix
  assert.match(sql, /iterative_scan = 'relaxed_order'/); // recall fix: filter applies AFTER the ANN scan
});

test('assertEfSearch enforces the CFG-ef_search range [10, 500]', () => {
  assert.equal(assertEfSearch(EF_SEARCH_MIN), 10);
  assert.equal(assertEfSearch(EF_SEARCH_MAX), 500);
  assert.equal(assertEfSearch(40), 40);
  assert.throws(() => assertEfSearch(9), EfSearchRangeError);
  assert.throws(() => assertEfSearch(501), EfSearchRangeError);
  assert.throws(() => assertEfSearch(40.5), EfSearchRangeError); // must be an integer
});

test('retrievalSessionSql refuses an out-of-range ef_search (a mis-set dial surfaces, never silently clamps)', () => {
  assert.throws(() => retrievalSessionSql(1000), EfSearchRangeError);
});

test('AC-NFR-PERF.009.1 — raiseEfSearch RAISES (never drops the predicate) and clamps at the ceiling', () => {
  assert.equal(raiseEfSearch(40, 40), 80); // thin recall → raise the dial
  assert.equal(raiseEfSearch(480, 100), EF_SEARCH_MAX); // clamps at 500, never past the range
  assert.equal(raiseEfSearch(40, -10), 40); // a negative "raise" is a no-op (cannot lower via this path)
  assert.equal(raiseEfSearch(Number.NaN, 0), EF_SEARCH_DEFAULT); // a broken current falls back to the default
});

test('applyRetrievalSession runs every GUC through the exec seam, in order', async () => {
  const ran: string[] = [];
  await applyRetrievalSession(async (sql) => { ran.push(sql); }, 120);
  assert.deepEqual(ran, retrievalSessionSql(120));
});
