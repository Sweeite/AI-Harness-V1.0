// app/retrieval — LIVE-ADAPTER SMOKE (ISSUE-025, C2 RET). R10 live-adapter hygiene sweep for src/supabase-store.ts
// (SupabaseRetrievalStore). Drives the REAL adapter code (not hand-copied SQL) against the live silo, in ONE txn,
// ROLLED BACK — nothing persists. This catches the fake-passes-offline / live-throws class (a missing column, an enum
// 22P02, a cast/operator error) that a green offline suite cannot see.
//
// WHAT IT PROVES (each adapter method's real query path against the baseline 0001 schema + 0031 policy):
//   [1] resolutionSnapshot — reads entities (id/type/name/external_refs/maturity) back.
//   [2] keywordArm         — the RAW entity_ids && overlap query runs + maps the row (numeric confidence, pgvector).
//   [3] vectorArm          — the ISSUE-023 retrieval-session GUCs (set local ef_search/iterative_scan/enable_seqscan)
//                            apply with NO error, then `order by embedding <=> $probe limit k` returns rows + similarity.
//   [4] similarityOf       — `1 - (embedding <=> $probe)` by id returns a cosine in [-1,1].
//   [5] entityTypes/Maturity— read the entity type map + the primary entity's stored maturity.
//   [6] appendReadEvent    — inserts event_type 'memory_read'::event_type with NO 22P02.
//   [7] appendSensitiveAudit— inserts audit_type 'sensitive_view' + actor_type 'user'::actor_type with NO 22P02, FK ok.
//   [8] 0031 policy present — the live memories_clearance_read RLS policy EXISTS (the policy clearance.ts realises in code).
//
// CONNECTS AS: postgres via SILO_DB_URL. SAFETY: BEGIN … ROLLBACK on ONE client; the real memories table is empty and
// the only real entity (Internal Org) is untouched. Run: source ~/.ai-harness-secrets.env && npx tsx results/live-smoke.ts

import pg from 'pg';
import { SupabaseRetrievalStore } from '../src/supabase-store.ts';
import { retrieve } from '../src/retrieve.ts';
import { fullClearanceHuman } from '../src/testkit.ts';

const U = '11111111-1111-1111-1111-111111111111';
function vec(axis: number): string {
  const a = new Array(1536).fill(0);
  a[axis] = 1;
  return `[${a.join(',')}]`;
}
const results: string[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) throw new Error(`R10 assertion FAILED: ${name} ${detail}`);
}

async function main(): Promise<void> {
  const url = process.env.SILO_DB_URL;
  if (!url) throw new Error('SILO_DB_URL not set (source ~/.ai-harness-secrets.env)');
  const ssl = /sslmode=disable/.test(url) ? undefined : { rejectUnauthorized: false };
  const client = new pg.Client({ connectionString: url, ssl });
  await client.connect();
  try {
    await client.query('begin');

    // ── seed isolated fixture (rolled back) ──────────────────────────────────────────────────────────────
    await client.query(`insert into auth.users (id, email) values ($1,$2)`, [U, 'r10-retrieval@example.com']);
    await client.query(`insert into profiles (id, email) values ($1,$2)`, [U, 'r10-retrieval@example.com']);
    const e1 = (await client.query(`insert into entities (type, name, external_refs, maturity) values ('client','R10 Acme','{"ghl":"r10-acme"}',0.42) returning id`)).rows[0].id;
    const e2 = (await client.query(`insert into entities (type, name) values ('client','R10 Globex') returning id`)).rows[0].id;
    // memories: on-axis match (cosine 1), off-axis (cosine 0), a superseded one, a personal (sensitive) one.
    let mseq = 0;
    const mk = async (axis: number, over: Record<string, string> = {}) => {
      const cols = { type: 'semantic', content: `r10 mem ${axis}`, source: 'ai_inferred', confidence: '0.90', visibility: 'global', sensitivity: 'standard', ...over };
      const uniq = ++mseq; // unique per memory so the idempotency_key/content_hash never collide
      const r = await client.query(
        `insert into memories (type, content, embedding, embedding_model, entity_ids, source, confidence, visibility, sensitivity, content_hash, idempotency_key)
         values ($1,$2,$3::vector,'text-embedding-3-small',$4,$5,$6,$7,$8,$9,$10) returning id`,
        [cols.type, cols.content, vec(axis), [e1], cols.source, cols.confidence === 'null' ? null : cols.confidence, cols.visibility, cols.sensitivity, `h-r10-${uniq}`, `k-r10-${uniq}`],
      );
      return r.rows[0].id;
    };
    const mMatch = await mk(0);
    await mk(5); // off-axis (won't match the probe well)
    const mSup = await mk(0, { content: 'r10 superseded' });
    await client.query(`update memories set superseded_by=$1 where id=$2`, [mMatch, mSup]);
    const mPersonal = await mk(0, { sensitivity: 'personal', content: 'r10 personal' });

    // ── drive the real adapter, bound to THIS txn client ─────────────────────────────────────────────────
    const store = new SupabaseRetrievalStore('unused', (t, p) => client.query(t as string, p) as any);

    const snap = await store.resolutionSnapshot();
    check('[1] resolutionSnapshot reads entities', snap.some((e) => e.id === e1 && e.name === 'R10 Acme'), `${snap.length} entities`);

    const kw = await store.keywordArm({ entityIds: [e1], queryEmbedding: [], vectorTopK: 20, efSearch: 40 });
    check('[2] keywordArm RAW overlap returns rows (incl. superseded — pipeline filters)', kw.length >= 3 && kw.some((m) => m.id === mSup), `${kw.length} rows`);
    check('[2] keywordArm maps numeric confidence + pgvector', kw.every((m) => typeof m.confidence === 'number' && Array.isArray(m.embedding) && m.embedding.length === 1536));

    const vec0 = new Array(1536).fill(0);
    vec0[0] = 1;
    const va = await store.vectorArm({ entityIds: [e1], queryEmbedding: vec0, vectorTopK: 20, efSearch: 40 });
    check('[3] vectorArm applies retrieval-session GUCs + returns top-k with similarity', va.length >= 1 && va.every((r) => r.similarity >= -1.0001 && r.similarity <= 1.0001));
    check('[3] vectorArm ranks the on-axis match at cosine≈1', Math.abs(va[0]!.similarity - 1) < 0.01, `top sim=${va[0]!.similarity.toFixed(4)}`);

    const sims = await store.similarityOf([mMatch, mPersonal], vec0);
    check('[4] similarityOf returns cosines by id', Math.abs((sims.get(mMatch) ?? -9) - 1) < 0.01);

    const types = await store.entityTypes([e1, e2]);
    check('[5] entityTypes maps id→type', types.get(e1) === 'client' && types.get(e2) === 'client');
    const mat = await store.entityMaturity(e1);
    check('[5] entityMaturity reads the stored value', Math.abs((mat ?? -9) - 0.42) < 1e-6, `maturity=${mat}`);

    await store.appendReadEvent({ entityIds: [e1], summary: 'r10 retrieval smoke', payload: { verdict: 'sufficient' } });
    const evt = await client.query(`select event_type from event_log where summary='r10 retrieval smoke'`);
    check('[6] appendReadEvent inserts memory_read (no 22P02)', evt.rows[0]?.event_type === 'memory_read');

    await store.appendSensitiveAudit({ actorType: 'user', actorIdentity: 'human:r10', originatingUserId: U, memoryId: mPersonal, entityIds: [e1], sensitivity: 'personal', pathContext: 'r10' });
    const aud = await client.query(`select audit_type, actor_type from access_audit where path_context='r10'`);
    check('[7] appendSensitiveAudit inserts sensitive_view + actor_type user (no 22P02, FK ok)', aud.rows[0]?.audit_type === 'sensitive_view' && aud.rows[0]?.actor_type === 'user');

    const pol = await client.query(`select 1 from pg_policies where schemaname='public' and tablename='memories' and policyname='memories_clearance_read'`);
    check('[8] the live 0031 memories_clearance_read policy EXISTS (clearance.ts realises it in code)', pol.rowCount === 1);

    // ── end-to-end: the whole pipeline over the live adapter (clearance-before-ranking, real vector arm) ──
    const res = await retrieve(store, {
      mentions: [{ name: 'R10 Acme', type: 'client' }],
      queryEmbedding: vec0,
      requester: fullClearanceHuman(),
      nowIso: new Date().toISOString(),
      actorIdentity: 'human:r10',
      originatingUserId: U,
      pathContext: 'r10-e2e',
    });
    check('[E2E] retrieve() over the live adapter injects the cleared match, drops the superseded', res.context.provenanceIds.includes(mMatch) && !res.context.provenanceIds.includes(mSup), `injected=${res.context.provenanceIds.length}`);
    check('[E2E] the personal candidate was audited (sensitive access)', res.counts.sensitiveAudited >= 1);

    await client.query('rollback');
    console.log('\n' + results.join('\n'));
    console.log('\n✓ ALL R10 assertions PASSED — rolled back, nothing persisted.');
  } catch (e) {
    await client.query('rollback').catch(() => {});
    console.log('\n' + results.join('\n'));
    console.error('\n✗ R10 smoke FAILED:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

await main();
