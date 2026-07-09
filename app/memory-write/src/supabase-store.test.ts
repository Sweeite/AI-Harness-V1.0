// ISSUE-024 (C2 WRT) — the LIVE pg adapter's SQL/params, exercised against an injected exec seam (no DB). This
// proves the query CONSTRUCTION offline (advisory locks, ON CONFLICT, CAS, event_log ::event_type, memory_conflicts);
// the R10 live-adapter smoke (results/live-smoke.sql) proves it against the REAL schema (the fake-passes-offline /
// live-throws class R10 catches).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseCommitStore, type QueryExec } from './supabase-store.ts';
import { buildMemoryRow, type CommitInput, type MemoryDraft, type AuthzReader } from './commit.ts';
import { classifyConflict, type Candidate } from './contradiction.ts';
import type { OriginatingAuthz } from '../../rls-enforcement/src/store.ts';

const authorized = (): OriginatingAuthz => ({ userId: 'u1', active: true, clearances: [], restricted: [] });
class Authz implements AuthzReader {
  constructor(private s: OriginatingAuthz | null) {}
  async loadOriginatingAuthz() { return this.s; }
}

/** A recording exec seam: dispatches canned rows by SQL fragment + records every statement. */
function recorder(opts: { watermark?: number; insertRowCount?: number; casIds?: string[] } = {}) {
  const log: Array<{ text: string; params: unknown[] }> = [];
  const exec: QueryExec = async (text, params = []) => {
    log.push({ text: text.replace(/\s+/g, ' ').trim(), params });
    const t = text.toLowerCase();
    if (t.startsWith('select coalesce(extract(epoch')) return { rows: [{ w: String(opts.watermark ?? 0) }] } as any;
    if (t.includes('pg_advisory_xact_lock')) return { rows: [{ pg_advisory_xact_lock: '' }] } as any;
    if (t.startsWith('insert into memories')) return { rows: opts.insertRowCount === 0 ? [] : [{ id: 'new-mem-uuid' }], rowCount: opts.insertRowCount ?? 1 } as any;
    if (t.startsWith('select id::text as id from memories where idempotency_key')) return { rows: [{ id: 'existing-mem' }] } as any;
    if (t.startsWith('update memories set superseded_by')) return { rows: (opts.casIds ?? []).map((id) => ({ id })), rowCount: (opts.casIds ?? []).length } as any;
    if (t.startsWith('insert into memory_conflicts')) return { rows: [{ id: 'conflict-uuid' }] } as any;
    if (t.includes('from memories') && t.includes('order by updated_at desc')) return { rows: [] } as any; // similar reader
    return { rows: [], rowCount: 0 } as any;
  };
  return { exec, log };
}

function makeDraft(over: Partial<MemoryDraft> & Pick<MemoryDraft, 'content' | 'entity_ids'>): MemoryDraft {
  return {
    type: 'semantic', sourceType: 'ai_inferred_strong', source_ref: null, visibility: 'team', sensitivity: 'standard',
    expires_at: null, embedding: [0.1, 0.2], embedding_model: 'text-embedding-3-small', ...over,
  };
}
const task = { taskId: 't1', serviceRoleIdentity: 'memory-agent', originatingUserId: 'u1', reliedOn: { clearances: [], restricted: [] } };
function input(draft: MemoryDraft, similar: any[] = [], watermarkV0 = 0): CommitInput {
  const candidate: Candidate = { type: draft.type, content: draft.content, entity_ids: draft.entity_ids, contradicts: draft.contradicts };
  return { draft, decision: classifyConflict(candidate, similar), candidate, watermarkV0, task };
}

test('commit() acquires SORTED per-entity advisory locks then inserts idempotency-keyed inside one txn', async () => {
  const { exec, log } = recorder();
  const store = new SupabaseCommitStore('', { authz: new Authz(authorized()) }, exec);
  const r = await store.commit(input(makeDraft({ content: 'x', entity_ids: ['bbb', 'aaa'] })));
  assert.equal(r.status, 'committed');
  const texts = log.map((l) => l.text.toLowerCase());
  assert.equal(texts[0], 'begin');
  // advisory locks acquired in SORTED order (aaa before bbb) — deadlock-free
  const lockStmts = log.filter((l) => l.text.includes('pg_advisory_xact_lock'));
  assert.equal(lockStmts.length, 2);
  assert.deepEqual(lockStmts.map((l) => l.params[0]), ['aaa', 'bbb']);
  assert.ok(texts.some((t) => t.includes('on conflict (idempotency_key) do nothing')), 'idempotent insert');
  assert.ok(texts.some((t) => t.includes("$1::event_type")), 'event_log write casts ::event_type');
  assert.equal(texts[texts.length - 1], 'commit');
});

test('an idempotent retry (insert affects 0 rows) returns noop with the existing id — no duplicate', async () => {
  const { exec } = recorder({ insertRowCount: 0 });
  const store = new SupabaseCommitStore('', { authz: new Authz(authorized()) }, exec);
  const r = await store.commit(input(makeDraft({ content: 'x', entity_ids: ['e1'] })));
  assert.equal(r.status, 'noop');
  assert.equal(r.memoryId, 'existing-mem');
});

test('a soft decision CAS-supersedes WHERE superseded_by IS NULL + emits the superseded event', async () => {
  const { exec, log } = recorder({ casIds: ['old-1'] });
  const store = new SupabaseCommitStore('', { authz: new Authz(authorized()) }, exec);
  // force a soft decision by handing a same-slot differing similar row
  const prior = buildMemoryRow(makeDraft({ content: 'HQ Boston', entity_ids: ['e1'] }), '11111111-1111-1111-1111-111111111111', new Date().toISOString());
  const r = await store.commit(input(makeDraft({ content: 'HQ Cambridge', entity_ids: ['e1'] }), [prior]));
  assert.equal(r.status, 'committed');
  assert.deepEqual(r.superseded, ['old-1']);
  const cas = log.find((l) => l.text.toLowerCase().startsWith('update memories set superseded_by'))!;
  assert.ok(cas.text.toLowerCase().includes('superseded_by is null'), 'CAS guard present');
});

test('AC-2.WRT.002.2 — a hard decision inserts a memory_conflicts quarantine row, NOT a memory', async () => {
  const { exec, log } = recorder();
  const store = new SupabaseCommitStore('', { authz: new Authz(authorized()) }, exec);
  const prior = buildMemoryRow(makeDraft({ content: 'thriving', entity_ids: ['e1'] }), '22222222-2222-2222-2222-222222222222', new Date().toISOString());
  const r = await store.commit(input(makeDraft({ content: 'bankrupt', entity_ids: ['e1'], contradicts: true }), [prior]));
  assert.equal(r.status, 'quarantined');
  assert.equal(r.conflictId, 'conflict-uuid');
  const texts = log.map((l) => l.text.toLowerCase());
  assert.ok(texts.some((t) => t.startsWith('insert into memory_conflicts')), 'quarantine row inserted');
  assert.ok(!texts.some((t) => t.startsWith('insert into memories')), 'NO memory written to the live set');
});

test('AC-2.WRT.006.3 — mid-task deactivation halts: quarantine + authz event + access_audit, no memory insert', async () => {
  const { exec, log } = recorder();
  const store = new SupabaseCommitStore('', { authz: new Authz({ userId: 'u1', active: false, clearances: [], restricted: [] }) }, exec);
  const r = await store.commit(input(makeDraft({ content: 'x', entity_ids: ['e1'] })));
  assert.equal(r.status, 'halted');
  const texts = log.map((l) => l.text.toLowerCase());
  assert.ok(texts.some((t) => t.startsWith('insert into memory_conflicts')), 'pending write quarantined');
  assert.ok(texts.some((t) => t.includes('authz_revoked_midtask') || (t.startsWith('insert into event_log') )), 'loud authz event');
  assert.ok(texts.some((t) => t.startsWith('insert into access_audit')), 'access_audit stop row');
  assert.ok(!texts.some((t) => t.startsWith('insert into memories')), 'nothing committed on a revoked snapshot');
});

test('M4 — a halt on a DELETED originating user audits with a NULL originating_user_id (no FK throw)', async () => {
  const { exec, log } = recorder();
  // authz reader returns null → the user profile is gone (deleted, not merely deactivated).
  const store = new SupabaseCommitStore('', { authz: new Authz(null) }, exec);
  const r = await store.commit(input(makeDraft({ content: 'x', entity_ids: ['e1'] })));
  assert.equal(r.status, 'halted');
  const audit = log.find((l) => l.text.toLowerCase().startsWith('insert into access_audit'))!;
  assert.equal(audit.params[3], null, 'originating_user_id is NULL when the profile is gone (avoids the FK throw that would roll back the quarantine)');
});

test('a Personal-sensitivity write emits an agent-path access_audit row (FR-1.AUD.001)', async () => {
  const { exec, log } = recorder();
  const store = new SupabaseCommitStore('', { authz: new Authz(authorized()) }, exec);
  await store.commit(input(makeDraft({ content: 'x', entity_ids: ['e1'], sensitivity: 'personal' })));
  assert.ok(log.some((l) => l.text.toLowerCase().startsWith('insert into access_audit')), 'personal write audited');
});

test('readWatermark uses the entity-overlap predicate + epoch of max(updated_at)', async () => {
  const { exec, log } = recorder({ watermark: 123 });
  const store = new SupabaseCommitStore('', { authz: new Authz(authorized()) }, exec);
  const w = await store.readWatermark(['e1']);
  assert.equal(w, 123);
  assert.ok(log[0]!.text.toLowerCase().includes('entity_ids && $1::uuid[]'));
});
