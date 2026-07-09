// ISSUE-023 (C2 VEC) — LIVE-adapter parity tests via an injected queryExec seam (no DB). Proves the SQL/enum/cast the
// live adapter emits matches the real schema shape + that the destructive contract step re-checks the reconcile gate
// (defense-in-depth #1). The DB-touching truth is the R10 live-adapter smoke (results/live-smoke.sql); this asserts the
// adapter AGREES with the in-memory reference model's contract.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SupabaseVectorAdmin,
  EVT_MODEL_CHANGE,
  EMBEDDING_EVENT_TYPES,
} from './supabase-store.ts';
import { ReconcileShortfallError } from './model-change.ts';
import { hnswParamsMatch } from './store.ts';

type Row = Record<string, unknown>;
interface Canned {
  hnswRows?: Row[];
  liveCount?: number;
  validV2Count?: number;
}

// A queryExec seam that records every SQL + answers the adapter's known queries from `canned`.
function seam(canned: Canned = {}) {
  const sql: string[] = [];
  const params: unknown[][] = [];
  const exec = async <R extends Row>(text: string, p?: unknown[]): Promise<{ rows: R[]; rowCount?: number | null }> => {
    sql.push(text);
    params.push(p ?? []);
    if (/from pg_index/i.test(text)) return { rows: (canned.hnswRows ?? []) as R[] };
    if (/count\(\*\)::text as c from memories/i.test(text)) {
      const n = /embedding_v2 is not null/i.test(text) ? canned.validV2Count ?? 0 : canned.liveCount ?? 0;
      return { rows: [{ c: String(n) }] as unknown as R[] };
    }
    return { rows: [] as R[], rowCount: 0 };
  };
  return { exec, sql, params };
}

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

test('DEFENSE IN DEPTH — contract() BLOCKS + throws on an incomplete reconcile and emits NO drop/rename DDL', async () => {
  const { exec, sql } = seam({ liveCount: 10, validV2Count: 7 }); // a 3-row shortfall
  const admin = new SupabaseVectorAdmin('postgres://x', { queryExec: exec });
  await assert.rejects(() => admin.contract('m2'), ReconcileShortfallError);
  const joined = sql.join('\n');
  assert.ok(!/drop column embedding/i.test(joined), 'must not drop the old column on a shortfall');
  assert.ok(!/rename column embedding_v2/i.test(joined), 'must not promote v2 on a shortfall');
  // and it wrote a loud reconcile-blocked event
  assert.match(joined, /insert into event_log/i);
  assert.match(joined, /::event_type/);
});

test('contract() runs the promote DDL only when the gate is complete', async () => {
  const { exec, sql } = seam({ liveCount: 10, validV2Count: 10 });
  await new SupabaseVectorAdmin('postgres://x', { queryExec: exec }).contract('m2');
  const joined = sql.join('\n');
  assert.match(joined, /drop column embedding/i);
  assert.match(joined, /rename column embedding_v2 to embedding/i);
  assert.match(joined, /rename to memories_embedding_hnsw/i);
});

test('backfill THROWS when the re-embed provider is un-wired (never a fake-done backfill)', async () => {
  const { exec } = seam();
  await assert.rejects(() => new SupabaseVectorAdmin('postgres://x', { queryExec: exec }).backfill('m2'), /requires an injected reEmbed/);
});

test('switchReads writes a loud event with a LISTED event_type (0038) + the ::event_type cast', async () => {
  const { exec, sql, params } = seam();
  await new SupabaseVectorAdmin('postgres://x', { queryExec: exec }).switchReads('m2');
  const insert = sql.find((s) => /insert into event_log/i.test(s))!;
  assert.match(insert, /\$1::event_type/);
  assert.equal(params[sql.indexOf(insert)]![0], EVT_MODEL_CHANGE);
  assert.ok(EMBEDDING_EVENT_TYPES.includes(EVT_MODEL_CHANGE));
});
