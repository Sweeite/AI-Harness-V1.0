import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SupabaseConflictConsolidationStore,
  SupabaseSoleWriter,
  type QueryExec,
  type GovernedMemoryWriter,
  EVT_CONFLICT_RESOLVED,
  EVT_CONSOLIDATION_QUEUED,
  EVT_APPROVAL_STALE,
} from './supabase-store.ts';
import type { MemoryRow } from '../../memory/src/store.ts';

// A recording exec fake — captures every (sql, params) and returns canned rows keyed by a matcher.
function recordingExec(responder: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): { exec: QueryExec; calls: { sql: string; params: unknown[] }[] } {
  const calls: { sql: string; params: unknown[] }[] = [];
  const exec = (async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    const r = responder(sql, params);
    return { rows: r.rows as never[], rowCount: r.rowCount ?? r.rows.length };
  }) as QueryExec;
  return { exec, calls };
}

test('listPendingConflicts — selects state in (pending,escalated), casts ids to text', async () => {
  const { exec, calls } = recordingExec(() => ({ rows: [{ id: 'c1', new_memory: {}, conflicting_memory_ids: ['e1'], suggested_resolution: null, state: 'pending', escalated_at: null, resolved_by: null, resolved_at: null, created_at: '2026-07-01T00:00:00Z' }] }));
  const store = new SupabaseConflictConsolidationStore(exec);
  const rows = await store.listPendingConflicts();
  assert.equal(rows.length, 1);
  assert.match(calls[0]!.sql, /from memory_conflicts where state in \('pending','escalated'\)/);
});

test('getLiveConflictingMemories — filters superseded_by IS NULL (a superseded row cannot be contradicted)', async () => {
  const { exec, calls } = recordingExec(() => ({ rows: [{ id: 'e1', source: 'ai_inferred', confidence: '0.700', created_at: '2026-01-01T00:00:00Z' }] }));
  const store = new SupabaseConflictConsolidationStore(exec);
  const facts = await store.getLiveConflictingMemories(['e1']);
  assert.equal(facts[0]!.confidence, 0.7);
  assert.match(calls[0]!.sql, /from memories where id = any\(\$1::uuid\[\]\) and superseded_by is null/);
});

test('enqueueConsolidation — casts op::consolidation_op + tier::sensitivity_tier', async () => {
  const { exec, calls } = recordingExec(() => ({ rows: [{ id: 'cons-1' }] }));
  const store = new SupabaseConflictConsolidationStore(exec);
  const id = await store.enqueueConsolidation(['s1', 's2'], 'merge', 'personal');
  assert.equal(id, 'cons-1');
  assert.match(calls[0]!.sql, /insert into consolidation_approvals/);
  assert.match(calls[0]!.sql, /\$2::consolidation_op, \$3::sensitivity_tier/);
});

test('closeConflict — CAS on state<>resolved; a 0-row update throws (never a silent no-op)', async () => {
  const { exec } = recordingExec(() => ({ rows: [], rowCount: 0 }));
  const store = new SupabaseConflictConsolidationStore(exec);
  await assert.rejects(() => store.closeConflict('c1', 'u1', { kind: 'keep_new', winnerId: 'x', humanFlagged: false, ruleApplied: 1, note: '' }), /not found or already resolved/);
});

test('escalateOverdueConflicts — the interval predicate mirrors ISSUE-024 (state=pending + created_at <= now()-interval)', async () => {
  const { exec, calls } = recordingExec(() => ({ rows: [{ id: 'c9' }] }));
  const store = new SupabaseConflictConsolidationStore(exec);
  const ids = await store.escalateOverdueConflicts(7);
  assert.deepEqual(ids, ['c9']);
  assert.match(calls[0]!.sql, /update memory_conflicts set state = 'escalated', escalated_at = now\(\)/);
  assert.match(calls[0]!.sql, /created_at <= now\(\) - \(\$1 \|\| ' days'\)::interval/);
});

test('event emits cast $1::event_type — the additive values (0044) + the reused baseline stale value', async () => {
  const seen: string[] = [];
  const { exec } = recordingExec((sql, params) => {
    if (/event_log/.test(sql)) seen.push(String(params[0]));
    return { rows: [] };
  });
  const store = new SupabaseConflictConsolidationStore(exec);
  await store.conflictResolved({ x: 1 });
  await store.consolidationQueued({ x: 1 });
  await store.escalated({ x: 1 });
  assert.deepEqual(seen, [EVT_CONFLICT_RESOLVED, EVT_CONSOLIDATION_QUEUED, EVT_APPROVAL_STALE]);
});

test('audit — casts actor_type + originating_user_id', async () => {
  const { exec, calls } = recordingExec(() => ({ rows: [] }));
  const store = new SupabaseConflictConsolidationStore(exec);
  await store.audit({ auditType: 'memory_conflict_review', actorIdentity: 'a', actorType: 'user', action: 'keep_new', targetType: 'memory_conflict', reason: null, pathContext: 'p', originatingUserId: 'u1' });
  assert.match(calls[0]!.sql, /insert into access_audit/);
  assert.match(calls[0]!.sql, /\$3::actor_type/);
  assert.match(calls[0]!.sql, /\$8::uuid/);
});

// ── SupabaseSoleWriter routes through the governed primitives — NEVER a direct insert ───────────────────────
function fakeGoverned(): GovernedMemoryWriter & { inserts: MemoryRow[]; cas: [string, string][] } {
  const inserts: MemoryRow[] = [];
  const cas: [string, string][] = [];
  return {
    inserts,
    cas,
    async insertDerivedMemory(row, _derivedFrom) {
      inserts.push(row);
      return { inserted: true, id: 'new-mem-id' };
    },
    async casSupersede(oldId, newId) {
      cas.push([oldId, newId]);
      return true;
    },
  };
}

test('SupabaseSoleWriter.keepNew — re-embeds the held content + routes insert/CAS through the governed writer (no direct insert)', async () => {
  const g = fakeGoverned();
  let embedded = '';
  const writer = new SupabaseSoleWriter(
    g,
    async (content) => {
      embedded = content;
      return new Array(1536).fill(0.001);
    },
    async () => ({}) as MemoryRow,
    () => '00000000-0000-0000-0000-0000000000ff',
    () => '2026-07-11T00:00:00Z',
  );
  const held = { type: 'semantic', content: 'the new fact', entity_ids: ['e1'], sourceType: 'human_verified' as const, proposedConfidence: 0.9, source_ref: null, visibility: 'team', sensitivity: 'standard' as const, expires_at: null, embedding_model: 'text-embedding-3-small' };
  const out = await writer.keepNew(held, ['old1'], { reviewerId: 'u1', reviewerIdentity: 'a' });
  assert.equal(out.committed, true);
  assert.equal(embedded, 'the new fact'); // re-embedded on approve
  assert.equal(g.inserts.length, 1); // governed insert, not a direct insert
  assert.deepEqual(g.cas, [['old1', 'new-mem-id']]); // CAS-supersede through the governed primitive
  assert.deepEqual(out.superseded, ['old1']);
});

test('SupabaseSoleWriter.keepNew — an idempotent no-op (inserted=false) returns committed=false + no CAS (#3)', async () => {
  const g = fakeGoverned();
  g.insertDerivedMemory = async () => ({ inserted: false, id: 'dup' });
  const writer = new SupabaseSoleWriter(g, async () => new Array(1536).fill(0.001), async () => ({}) as MemoryRow, () => 'id', () => 'ts');
  const held = { type: 'semantic', content: 'x', entity_ids: ['e1'], sourceType: 'ai_inferred_weak' as const, proposedConfidence: 0.7, source_ref: null, visibility: 'team', sensitivity: 'standard' as const, expires_at: null, embedding_model: 'm' };
  const out = await writer.keepNew(held, ['old1'], { reviewerId: 'u1', reviewerIdentity: 'a' });
  assert.equal(out.committed, false);
  assert.deepEqual(g.cas, []); // no supersede when the new memory did not commit
});

test('SupabaseSoleWriter.applyConsolidation — derives via the injected consolidator + supersedes sources through CAS', async () => {
  const g = fakeGoverned();
  const writer = new SupabaseSoleWriter(g, async () => new Array(1536).fill(0.001), async (ids, op) => ({ content: `${op} of ${ids.join(',')}` }) as unknown as MemoryRow, () => 'id', () => 'ts');
  const out = await writer.applyConsolidation({ candidateIds: ['s1', 's2'], op: 'merge' }, { reviewerId: 'u1', reviewerIdentity: 'a' });
  assert.equal(out.committed, true);
  assert.deepEqual(out.superseded, ['s1', 's2']);
  assert.equal(g.inserts.length, 1);
  assert.equal(g.cas.length, 2);
});
