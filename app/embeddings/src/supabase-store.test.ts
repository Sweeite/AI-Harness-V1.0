// ISSUE-023 (C2 VEC) — LIVE-adapter parity tests via an injected queryExec seam (no DB). Proves the SQL/enum/cast the
// live adapter emits matches the real schema shape, that the destructive contract() promote is ATOMIC + re-adds the
// NOT NULL guard + carries truthful provenance + re-checks the gate (defense-in-depth #1/#2/#3), and that backfill never
// writes an unvalidated/degenerate vector. The DB-touching truth is the R10 live-adapter smoke (results/live-smoke.sql).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SupabaseVectorAdmin,
  EVT_MODEL_CHANGE,
  EMBEDDING_EVENT_TYPES,
} from './supabase-store.ts';
import { ReconcileShortfallError } from './model-change.ts';
import { hnswParamsMatch } from './store.ts';
import type { EmbeddingProvider } from './embed.ts';

type Row = Record<string, unknown>;
interface Canned {
  hnswRows?: Row[];
  liveCount?: number;
  validV2Count?: number;
  nullV2Count?: number; // ALL rows (live or not) with embedding_v2 is null — the contract NOT-NULL coverage check
  v2Exists?: boolean; // whether the embedding_v2 column still exists (default true)
  backfillIds?: string[]; // ids returned by `select id ... where embedding_v2 is null`
}

// A queryExec seam that records every SQL + answers the adapter's known queries from `canned`.
function seam(canned: Canned = {}) {
  const sql: string[] = [];
  const params: unknown[][] = [];
  const exec = async <R extends Row>(text: string, p?: unknown[]): Promise<{ rows: R[]; rowCount?: number | null }> => {
    sql.push(text);
    params.push(p ?? []);
    if (/from pg_index/i.test(text)) return { rows: (canned.hnswRows ?? []) as R[] };
    if (/information_schema\.columns/i.test(text)) return { rows: [{ n: String((canned.v2Exists ?? true) ? 1 : 0) }] as unknown as R[] };
    if (/select id::text as id from memories where embedding_v2 is null/i.test(text)) {
      return { rows: (canned.backfillIds ?? []).map((id) => ({ id })) as unknown as R[] };
    }
    if (/count\(\*\)::text as c from memories/i.test(text)) {
      let n: number;
      if (/embedding_v2 is not null/i.test(text)) n = canned.validV2Count ?? 0;
      else if (/embedding_v2 is null/i.test(text)) n = canned.nullV2Count ?? 0;
      else n = canned.liveCount ?? 0;
      return { rows: [{ c: String(n) }] as unknown as R[] };
    }
    return { rows: [] as R[], rowCount: 0 };
  };
  return { exec, sql, params };
}

const goodVec = (): number[] => { const v = new Array(1536).fill(0.01); v[0] = 0.5; return v; };
const zeroVec = (): number[] => new Array(1536).fill(0);

test('AC-2.VEC.001.1 — hnswIndexInfo parses reloptions + indexdef into the documented params', async () => {
  const { exec } = seam({
    hnswRows: [{
      name: 'memories_embedding_hnsw',
      method: 'hnsw',
      reloptions: ['m=16', 'ef_construction=64'],
      indexdef: 'CREATE INDEX memories_embedding_hnsw ON public.memories USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=64)',
    }],
  });
  const admin = new SupabaseVectorAdmin('postgres://x', { queryExec: exec });
  const info = await admin.hnswIndexInfo();
  assert.equal(info?.m, 16);
  assert.equal(info?.efConstruction, 64);
  assert.equal(info?.column, 'embedding');
  assert.equal(info?.opclass, 'vector_cosine_ops');
  assert.equal(hnswParamsMatch(info), true);
});

test('hnswIndexInfo is deterministic during the expand window (prefers memories_embedding_hnsw / a valid index)', async () => {
  const { exec, sql } = seam({ hnswRows: [] });
  await new SupabaseVectorAdmin('postgres://x', { queryExec: exec }).hnswIndexInfo();
  assert.match(sql[0]!, /order by \(c\.relname = 'memories_embedding_hnsw'\) desc/i); // Finding 6
});

test('hnswIndexInfo surfaces param drift (params would fail hnswParamsMatch)', async () => {
  const { exec } = seam({
    hnswRows: [{ name: 'x', method: 'hnsw', reloptions: ['m=8'], indexdef: 'USING hnsw (embedding vector_cosine_ops)' }],
  });
  const info = await new SupabaseVectorAdmin('postgres://x', { queryExec: exec }).hnswIndexInfo();
  assert.equal(info?.m, 8);
  assert.equal(info?.efConstruction, null);
  assert.equal(hnswParamsMatch(info), false);
});

test('hnswIndexInfo returns null when no hnsw index exists', async () => {
  const { exec } = seam({ hnswRows: [] });
  assert.equal(await new SupabaseVectorAdmin('postgres://x', { queryExec: exec }).hnswIndexInfo(), null);
});

test('reconcile counts use the LIVE predicate; validV2 additionally requires embedding_v2 not null', async () => {
  const { exec, sql } = seam({ liveCount: 50, validV2Count: 50 });
  const admin = new SupabaseVectorAdmin('postgres://x', { queryExec: exec });
  assert.equal(await admin.liveRowCount(), 50);
  assert.equal(await admin.validV2Count(), 50);
  const liveSql = sql.find((s) => /count/.test(s) && !/embedding_v2/.test(s))!;
  const v2Sql = sql.find((s) => /embedding_v2 is not null/.test(s))!;
  assert.match(liveSql, /superseded_by is null/);
  assert.match(liveSql, /expires_at is null or expires_at > now\(\)/);
  assert.match(v2Sql, /superseded_by is null/);
});

test('explainRetrieval (seam mode) emits the three AF-019 contract GUCs through the seam', async () => {
  const { exec, sql } = seam();
  await new SupabaseVectorAdmin('postgres://x', { queryExec: exec }).explainRetrieval(80);
  const joined = sql.join('\n');
  assert.match(joined, /set local hnsw\.ef_search = 80/);
  assert.match(joined, /iterative_scan = 'relaxed_order'/);
  assert.match(joined, /enable_seqscan = off/);
});

// ── backfill (Finding 1 + coverage) ──────────────────────────────────────────────────────────────────────────────
test('BLOCKER-fix — backfill VALIDATES each re-embed and never writes a degenerate v2 (leaves it null → gate blocks)', async () => {
  const { exec, sql, params } = seam({ backfillIds: ['id-good', 'id-degenerate'] });
  const provider: EmbeddingProvider = { async embed(_c, _m) { return _c === 'content:id-degenerate' ? zeroVec() : goodVec(); } };
  const admin = new SupabaseVectorAdmin('postgres://x', {
    queryExec: exec,
    reEmbed: provider,
    contentOf: async (id) => `content:${id}`,
  });
  const { embedded } = await admin.backfill('m2');
  assert.equal(embedded, 1, 'only the valid row is written');
  const updates = sql.filter((s) => /update memories set embedding_v2/i.test(s));
  assert.equal(updates.length, 1);
  // the degenerate row got a LOUD skip event, and its v2 stays null (so the reconcile gate will block contract)
  const skipEvent = params.find((p) => typeof p[1] === 'string' && /re-embed skipped for memory id-degenerate/.test(p[1] as string));
  assert.ok(skipEvent, 'a loud reembed_progress event is written for the degenerate row');
});

test('backfill covers ALL rows lacking v2 (live AND superseded) so the contract NOT-NULL promote can hold', async () => {
  const { exec, sql } = seam({ backfillIds: [] });
  await new SupabaseVectorAdmin('postgres://x', { queryExec: exec, reEmbed: { async embed() { return goodVec(); } }, contentOf: async () => 'x' }).backfill('m2');
  const select = sql.find((s) => /select id::text as id from memories where embedding_v2 is null/i.test(s))!;
  assert.ok(select, 'backfill selects every row lacking v2');
  assert.ok(!/superseded_by/i.test(select), 'NOT scoped to live rows — the promote needs the whole corpus covered');
});

test('backfill THROWS when the re-embed provider is un-wired (never a fake-done backfill)', async () => {
  const { exec } = seam({ backfillIds: ['a'] });
  await assert.rejects(() => new SupabaseVectorAdmin('postgres://x', { queryExec: exec }).backfill('m2'), /requires an injected reEmbed/);
});

// ── expand (Finding 5) ───────────────────────────────────────────────────────────────────────────────────────────
test('expand drops an INVALID leftover v2 index before the CONCURRENTLY rebuild (CIC-IF-NOT-EXISTS footgun)', async () => {
  const { exec, sql } = seam();
  await new SupabaseVectorAdmin('postgres://x', { queryExec: exec }).expand('m2');
  const joined = sql.join('\n');
  assert.match(joined, /add column if not exists embedding_v2 vector\(1536\)/i);
  assert.match(joined, /indisvalid/i); // the invalid-index guard
  assert.match(joined, /create index concurrently if not exists memories_embedding_v2_hnsw/i);
});

// ── contract (Findings 2, 3, 4, 7 + defense-in-depth) ────────────────────────────────────────────────────────────
test('DEFENSE IN DEPTH — contract() BLOCKS + throws on an incomplete LIVE reconcile and emits NO drop/rename DDL', async () => {
  const { exec, sql } = seam({ liveCount: 10, validV2Count: 7, nullV2Count: 3, v2Exists: true });
  const admin = new SupabaseVectorAdmin('postgres://x', { queryExec: exec });
  await assert.rejects(() => admin.contract('m2'), ReconcileShortfallError);
  const joined = sql.join('\n');
  assert.ok(!/drop column embedding/i.test(joined), 'must not drop the old column on a shortfall');
  assert.ok(!/rename column embedding_v2/i.test(joined), 'must not promote v2 on a shortfall');
  assert.match(joined, /insert into event_log/i);
  assert.match(joined, /::event_type/);
});

test('contract() BLOCKS when a NON-LIVE row lacks v2 (the NOT-NULL promote would fail) even if the live gate passes', async () => {
  const { exec, sql } = seam({ liveCount: 5, validV2Count: 5, nullV2Count: 2, v2Exists: true }); // live complete, but 2 rows null overall
  await assert.rejects(() => new SupabaseVectorAdmin('postgres://x', { queryExec: exec }).contract('m2'), /still lack embedding_v2/);
  assert.ok(!/drop column embedding/i.test(sql.join('\n')));
});

test('AC-2.VEC.003.1 — contract() promotes ATOMICALLY: re-adds NOT NULL, fixes provenance, renames index, in one txn', async () => {
  const { exec, sql, params } = seam({ liveCount: 10, validV2Count: 10, nullV2Count: 0, v2Exists: true });
  await new SupabaseVectorAdmin('postgres://x', { queryExec: exec }).contract('m2');
  const idx = (re: RegExp) => sql.findIndex((s) => re.test(s));
  const begin = idx(/^begin$/i);
  const commit = idx(/^commit$/i);
  assert.ok(begin >= 0 && commit > begin, 'the promote is wrapped in a single begin…commit (atomic, Finding 4)');
  const between = (re: RegExp) => { const i = idx(re); return i > begin && i < commit; };
  assert.ok(between(/drop column embedding/i), 'drops the old column inside the txn');
  assert.ok(between(/rename column embedding_v2 to embedding/i), 'promotes v2 inside the txn');
  assert.ok(between(/alter column embedding set not null/i), 're-adds the NOT NULL guard (Finding 3)');
  assert.ok(between(/update memories set embedding_model/i), 'fixes the provenance stamp (Finding 2)');
  assert.ok(between(/rename to memories_embedding_hnsw/i), 'renames the v2 index to the canonical name');
  // the provenance update targets the new model
  const upd = params[idx(/update memories set embedding_model/i)]!;
  assert.equal(upd[0], 'm2');
});

test('contract() is an idempotent no-op when embedding_v2 is already gone (Finding 7 — no 42703 on retry)', async () => {
  const { exec, sql, params } = seam({ v2Exists: false });
  await new SupabaseVectorAdmin('postgres://x', { queryExec: exec }).contract('m2'); // must NOT throw
  assert.ok(!/drop column embedding/i.test(sql.join('\n')), 'no destructive DDL on an already-contracted table');
  // the no-op is announced via a loud event (summary + already_done payload), not silently
  const summaries = params.map((p) => (typeof p[1] === 'string' ? (p[1] as string) : '')).join('\n');
  const payloads = params.map((p) => (typeof p[2] === 'string' ? (p[2] as string) : '')).join('\n');
  assert.match(summaries + payloads, /already_done|already promoted/i);
});

test('switchReads writes a loud event with a LISTED event_type (0038) + the ::event_type cast', async () => {
  const { exec, sql, params } = seam();
  await new SupabaseVectorAdmin('postgres://x', { queryExec: exec }).switchReads('m2');
  const insert = sql.find((s) => /insert into event_log/i.test(s))!;
  assert.match(insert, /\$1::event_type/);
  assert.equal(params[sql.indexOf(insert)]![0], EVT_MODEL_CHANGE);
  assert.ok(EMBEDDING_EVENT_TYPES.includes(EVT_MODEL_CHANGE));
});
