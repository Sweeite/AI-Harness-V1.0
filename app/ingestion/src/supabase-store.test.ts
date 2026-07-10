// ISSUE-026 (C2 ING) — LIVE-adapter seam tests via an injected fake QueryExec (no DB). Pins the SQL/parse contract:
// the queue-exit guard is a DB-level WHERE clause, the human decisions are append-only access_audit inserts, Pipeline 1
// points (entities.external_refs) rather than copies, verification is an UPDATE of an existing memory (never an
// insert), and the observability writes use the right event_type values. The DB-touching truth is the R10 smoke.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SupabaseIngestionStore,
  EVT_INGESTION_FILTERED,
  EVT_QUEUE_STALE,
  type QueryExec,
} from './supabase-store.ts';

interface Call {
  text: string;
  params: unknown[];
}

function fakeExec(answer?: (text: string) => { rows: Record<string, unknown>[] } | undefined): { exec: QueryExec; calls: Call[] } {
  const calls: Call[] = [];
  const exec = (async (text: string, params?: unknown[]) => {
    calls.push({ text, params: params ?? [] });
    const a = answer?.(text);
    return a ?? { rows: [], rowCount: 0 };
  }) as QueryExec;
  return { exec, calls };
}

const QUEUE_ROW = {
  id: 'iq-1',
  content: 'x',
  source_ref: null,
  flag_reason: 'financial',
  suggested_tier: 'confidential',
  target_entity_id: null,
  state: 'pending',
  deferred_until: null,
  reviewed_by: null,
  reviewed_at: null,
  decision_reason: null,
  created_at: new Date(0),
};

// ── transition — the queue-exit invariant is a DB-level guard (AC-2.ING.003.2) ─────────────────────────────────
test('transition emits UPDATE ... where id and state in (pending,deferred) — a terminal row updates 0 rows', async () => {
  const { exec, calls } = fakeExec((t) => (/update .*ingestion_queue/i.test(t) ? { rows: [{ ...QUEUE_ROW, state: 'excluded' }] } : undefined));
  const store = new SupabaseIngestionStore('postgres://x?sslmode=disable', exec);
  await store.transition('iq-1', { state: 'excluded', reviewedBy: 'a1', reviewedAt: '2026-07-10T00:00:00.000Z', decisionReason: 'nope' });
  const upd = calls.find((c) => /update/i.test(c.text) && /ingestion_queue/i.test(c.text))!;
  assert.match(upd.text, /where id = \$1 and state in \('pending','deferred'\)/i);
  assert.match(upd.text, /returning/i);
});

test('transition throws LOUD when it matches 0 rows (row missing or terminal — never a silent no-op, #3)', async () => {
  const { exec } = fakeExec(() => ({ rows: [] }));
  const store = new SupabaseIngestionStore('x?sslmode=disable', exec);
  await assert.rejects(() => store.transition('iq-9', { state: 'included', reviewedBy: 'a', reviewedAt: 'b', decisionReason: null }), /matched 0 rows/);
});

// ── enqueue ─────────────────────────────────────────────────────────────────────────────────────────────────────
test('enqueue inserts into ingestion_queue with content/flag_reason/suggested_tier/state', async () => {
  const { exec, calls } = fakeExec((t) => (/insert into .*ingestion_queue/i.test(t) ? { rows: [QUEUE_ROW] } : undefined));
  const store = new SupabaseIngestionStore('x?sslmode=disable', exec);
  await store.enqueue({ content: 'x', source_ref: null, flag_reason: 'financial', suggested_tier: 'confidential', target_entity_id: null, state: 'pending' });
  const ins = calls.find((c) => /insert into .*ingestion_queue/i.test(c.text))!;
  assert.match(ins.text, /content, source_ref, flag_reason, suggested_tier, target_entity_id, state/i);
  assert.equal(ins.params[5], 'pending');
});

// ── insertEntity — Pipeline 1 points (external_refs), never copies ──────────────────────────────────────────────
test('insertEntity writes entities with external_refs (the pointer join key), not a memory row', async () => {
  const { exec, calls } = fakeExec((t) =>
    /insert into .*entities/i.test(t)
      ? { rows: [{ id: 'e1', type: 'Client', name: 'Acme', external_refs: { ghl: 'c/1' }, is_internal_org: false, maturity: null, maturity_updated_at: null, created_at: new Date(0) }] }
      : undefined,
  );
  const store = new SupabaseIngestionStore('x?sslmode=disable', exec);
  const e = await store.insertEntity({ type: 'Client', name: 'Acme', external_refs: { ghl: 'c/1' } });
  assert.deepEqual(e.external_refs, { ghl: 'c/1' });
  const ins = calls.find((c) => /insert into .*entities/i.test(c.text))!;
  assert.match(ins.text, /external_refs/i);
  assert.ok(!/insert into .*memories/i.test(ins.text), 'Pipeline 1 never inserts a memory (no-backdoor)');
});

// ── appendAudit — append-only access_audit with who/action/why ──────────────────────────────────────────────────
test('appendAudit inserts an append-only access_audit row (audit_type/actor/action/reason)', async () => {
  const { exec, calls } = fakeExec();
  const store = new SupabaseIngestionStore('x?sslmode=disable', exec);
  await store.appendAudit({ auditType: 'ingestion_decision', action: 'exclude', actorType: 'user', actorIdentity: 'admin-7', reviewerUserId: 'admin-7', queueId: 'iq-1', targetEntityId: null, reason: 'irrelevant', tier: null });
  const ins = calls.find((c) => /insert into .*access_audit/i.test(c.text))!;
  assert.match(ins.text, /audit_type, actor_identity, actor_type, target_entity_id, action, reason/i);
  assert.ok(!/update|delete/i.test(ins.text), 'access_audit is append-only');
  assert.equal(ins.params[4], 'exclude');
});

// ── observability event_type usage ──────────────────────────────────────────────────────────────────────────────
test('filterDecision + auditRun write event_log with the ingestion_filtered event_type', async () => {
  const { exec, calls } = fakeExec();
  const store = new SupabaseIngestionStore('x?sslmode=disable', exec);
  await store.filterDecision({ filter: 'sensitivity', verdict: 'flag', reason: 'financial', targetEntityId: 'e1' });
  await store.auditRun({ window: 'w', totalDrops: 0, sampledTarget: 0, sampled: 0, reviewed: 0, missed: true });
  for (const c of calls) {
    assert.match(c.text, /insert into .*event_log/i);
    assert.equal(c.params[0], EVT_INGESTION_FILTERED);
  }
});

test('escalation reuses the EXISTING approval_queue_stale event_type (no migration for escalation)', async () => {
  const { exec, calls } = fakeExec();
  const store = new SupabaseIngestionStore('x?sslmode=disable', exec);
  await store.escalation({ queueId: 'iq-1', ageDays: 9, createdAt: '2026-07-01T00:00:00.000Z' });
  assert.equal(calls[0]!.params[0], EVT_QUEUE_STALE);
});

// ── markVerified — an UPDATE of an existing memory, never an insert (AC-2.ING.009.2) ────────────────────────────
test('markVerified UPDATEs an existing memory to confidence 1.0 / human_verified (never an insert)', async () => {
  const { exec, calls } = fakeExec((t) => (/update .*memories/i.test(t) ? { rows: [{ id: 'mem-1', confidence: '1.000', source: 'human_verified' }] } : undefined));
  const store = new SupabaseIngestionStore('x?sslmode=disable', exec);
  const r = await store.markVerified('mem-1', 'founder-1');
  assert.equal(r.confidence, 1.0);
  assert.equal(r.source, 'human_verified');
  const upd = calls.find((c) => /update .*memories/i.test(c.text))!;
  assert.match(upd.text, /set confidence = 1\.0, source = 'human_verified'/i);
  assert.match(upd.text, /where id = \$1/i);
  assert.ok(!calls.some((c) => /insert into .*memories/i.test(c.text)), 'verification never inserts a memory (sole-writer boundary)');
});

test('markVerified throws LOUD when the memory does not exist (0 rows) — cannot confirm a non-existent memory', async () => {
  const { exec } = fakeExec(() => ({ rows: [] }));
  const store = new SupabaseIngestionStore('x?sslmode=disable', exec);
  await assert.rejects(() => store.markVerified('nope', 'f1'), /matched 0 rows/);
});
