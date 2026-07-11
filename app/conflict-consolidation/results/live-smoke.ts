// ISSUE-028 R10 live-adapter smoke (spec/00-foundations/standards/live-adapter-hygiene-sweep.md).
//
// Drives the REAL SupabaseConflictConsolidationStore + SupabaseSoleWriter against the live silo in ONE transaction,
// ROLLED BACK — nothing persists. Proves the live SQL the offline fake stands in for actually executes against the
// real 0001 schema + the 0044 additive event_type values: the two-queue reads/writes, the escalation interval
// predicate, every ::enum cast (mem_review_state / consolidation_op / sensitivity_tier / event_type / actor_type)
// with NO 22P02, and that Keep-new/consolidation route through ISSUE-027's already-R10-proven governed write
// primitives (insertDerivedMemory ON CONFLICT DO NOTHING + casSupersede WHERE superseded_by IS NULL) — no direct
// insert. The query embedding is a FIXED deterministic 1536-vector (the OpenAI embed source is R10-proven in ISSUE-023;
// vector VALUES do not affect SQL shape, which is all R10 tests here — AF-002 owns embedding quality).
//
// Prereq: migration 0044 applied (the three additive event_type values). Run:
//   source ~/.ai-harness-secrets.env && npx tsx results/live-smoke.ts

import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { SupabaseConflictConsolidationStore, SupabaseSoleWriter } from '../src/supabase-store.ts';
import { SupabaseMaintenanceStore } from '../../memory-maintenance/src/supabase-store.ts';
import { buildMemoryRow, type MemoryDraft } from '../../memory-write/src/commit.ts';
import type { HeldCandidate } from '../src/store.ts';

const results: string[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) throw new Error(`R10 assertion FAILED: ${name} ${detail}`);
}

const FIXED_EMBEDDING = new Array(1536).fill(0.0011);
const NOW = '2026-07-11T00:00:00Z';

function draft(over: Partial<MemoryDraft> = {}): MemoryDraft {
  return {
    type: 'semantic',
    content: 'r10 smoke content',
    entity_ids: [randomUUID()],
    sourceType: 'ai_inferred_weak',
    proposedConfidence: 0.7,
    source_ref: null,
    visibility: 'team',
    sensitivity: 'standard',
    expires_at: null,
    embedding: FIXED_EMBEDDING,
    embedding_model: 'text-embedding-3-small',
    ...over,
  };
}

async function main(): Promise<void> {
  const url = process.env.SILO_DB_URL;
  if (!url) throw new Error('SILO_DB_URL not set (source ~/.ai-harness-secrets.env)');
  const ssl = /sslmode=disable/.test(url) ? undefined : { rejectUnauthorized: false };
  const client = new pg.Client({ connectionString: url, ssl });
  await client.connect();
  const exec = ((t: string, p?: unknown[]) => client.query(t, p as never[])) as never;

  try {
    await client.query('begin');

    const store = new SupabaseConflictConsolidationStore(exec);
    const maint = new SupabaseMaintenanceStore(exec);
    const soleWriter = new SupabaseSoleWriter(
      maint,
      async () => FIXED_EMBEDDING,
      async (ids) => buildMemoryRow(draft({ content: `merged of ${ids.length} sources`, entity_ids: [randomUUID()] }), randomUUID(), NOW),
      randomUUID,
      () => NOW,
    );

    const entityId = randomUUID();
    // resolved_by / originating_user_id are FKs to profiles(id) → auth.users(id); seed the chain in-txn (rolled back).
    const au = await client.query<{ id: string }>(`insert into auth.users (id) values (gen_random_uuid()) returning id::text as id`);
    const reviewerId = au.rows[0]!.id;
    await client.query(`insert into profiles (id, email) values ($1, 'r10-reviewer@smoke.local')`, [reviewerId]);
    const ctx = { reviewerId, reviewerIdentity: 'r10-reviewer', reason: 'r10 smoke' };

    // [1] seed an existing LIVE memory through the governed writer (ISSUE-027 primitive). insertDerivedMemory
    // assigns the id via gen_random_uuid() and RETURNS it — use that returned id downstream (not the draft's).
    const existingRow = buildMemoryRow(draft({ entity_ids: [entityId], content: 'the older fact' }), randomUUID(), NOW);
    const seeded = await maint.insertDerivedMemory(existingRow, []);
    const existingId = seeded.id;
    check('[1] insertDerivedMemory seeds a live memory (governed insert, ::vector + ::enum casts, no 22P02)', seeded.inserted, `id=${existingId}`);

    // [2] getLiveConflictingMemories reads it (superseded_by IS NULL filter).
    const facts = await store.getLiveConflictingMemories([existingId]);
    check('[2] getLiveConflictingMemories returns the live row', facts.length === 1 && facts[0]!.id === existingId);

    // [3] seed a hard-conflict quarantine row (mirrors ISSUE-024's quarantine insert).
    const held: HeldCandidate = {
      type: 'semantic',
      content: 'the newer conflicting fact',
      entity_ids: [entityId],
      sourceType: 'human_verified',
      proposedConfidence: 0.97,
      source_ref: null,
      visibility: 'team',
      sensitivity: 'personal',
      expires_at: null,
      embedding_model: 'text-embedding-3-small',
    };
    const cq = await client.query<{ id: string }>(
      `insert into memory_conflicts (new_memory, conflicting_memory_ids, state) values ($1::jsonb, $2::uuid[], 'pending') returning id::text as id`,
      [JSON.stringify(held), [existingId]],
    );
    const conflictId = cq.rows[0]!.id;
    check('[3] memory_conflicts quarantine insert (::jsonb + ::uuid[] casts)', !!conflictId, `conflict=${conflictId}`);

    // [4] listPendingConflicts returns it.
    const pendingConf = await store.listPendingConflicts();
    check('[4] listPendingConflicts returns the pending quarantine row', pendingConf.some((c) => c.id === conflictId));

    // [5] attachSuggestedResolution updates the jsonb column.
    await store.attachSuggestedResolution(conflictId, { kind: 'keep_new', winnerId: 'held', humanFlagged: false, ruleApplied: 1, note: 'human_verified wins' });
    check('[5] attachSuggestedResolution updates suggested_resolution::jsonb', true);

    // [6] Keep-new through the sole writer — inserts the new memory + CAS-supersedes the existing.
    const kn = await soleWriter.keepNew(held, [existingId], ctx);
    check('[6] keepNew routes through governed insert + CAS-supersede (no direct insert)', kn.committed && kn.superseded.includes(existingId), `new=${kn.memoryId}`);
    const supChk = await client.query<{ superseded_by: string | null }>(`select superseded_by::text as superseded_by from memories where id = $1`, [existingId]);
    check('[6b] the existing row is now CAS-superseded (chain intact, not deleted)', supChk.rows[0]!.superseded_by === kn.memoryId);

    // [7] closeConflict → state resolved.
    await store.closeConflict(conflictId, ctx.reviewerId, { kind: 'keep_new', winnerId: kn.memoryId, humanFlagged: false, ruleApplied: 1, note: 'resolved' });
    const closed = await client.query<{ state: string }>(`select state::text as state from memory_conflicts where id = $1`, [conflictId]);
    check('[7] closeConflict sets state=resolved + resolved_by/at', closed.rows[0]!.state === 'resolved');

    // [8] enqueueConsolidation → consolidation_approvals insert (op::consolidation_op + tier::sensitivity_tier).
    const consId = await store.enqueueConsolidation([existingId], 'merge', 'personal');
    check('[8] enqueueConsolidation inserts (op::consolidation_op + tier::sensitivity_tier, no 22P02)', !!consId, `approval=${consId}`);

    // [9] listPendingConsolidations + getConsolidationSources.
    const pendingCons = await store.listPendingConsolidations();
    check('[9] listPendingConsolidations returns the queued approval', pendingCons.some((c) => c.id === consId));

    // [10] approve consolidation through the sole writer (governed derive + supersede), then close.
    const ac = await soleWriter.applyConsolidation({ candidateIds: [existingId], op: 'merge' }, ctx);
    check('[10] applyConsolidation derives + supersedes through the governed writer', ac.committed, `derived=${ac.derivedId}`);
    await store.closeConsolidation(consId, ctx.reviewerId, 'approved');
    const consClosed = await client.query<{ state: string }>(`select state::text as state from consolidation_approvals where id = $1`, [consId]);
    check('[10b] closeConsolidation sets state=resolved', consClosed.rows[0]!.state === 'resolved');

    // [11] escalation interval predicates run on both queues (no rows overdue in-txn → empty, but the SQL executes).
    const escC = await store.escalateOverdueConflicts(7);
    const escS = await store.escalateOverdueConsolidations(7);
    check('[11] escalateOverdue{Conflicts,Consolidations} interval predicate executes', Array.isArray(escC) && Array.isArray(escS));

    // [12] every event_type cast (the 3 additive 0044 values + the baseline reused stale value) — no 22P02.
    await store.conflictResolved({ conflict_id: conflictId, action: 'keep_new' });
    await store.consolidationQueued({ approval_id: consId, op: 'merge' });
    await store.consolidationResolved({ approval_id: consId, decision: 'approved' });
    await store.escalated({ queue: 'conflicts', record_id: conflictId });
    check('[12] event_log emits: memory_conflict_resolved / _consolidation_queued / _consolidation_resolved / approval_queue_stale (::event_type, no 22P02)', true);

    // [13] audit insert (actor_type + originating_user_id casts).
    await store.audit({ auditType: 'personal_consolidation_review', actorIdentity: ctx.reviewerIdentity, actorType: 'user', action: 'consolidation_approved:merge', targetType: 'consolidation_approval', reason: 'r10', pathContext: 'surface-03/consolidation', originatingUserId: ctx.reviewerId });
    check('[13] access_audit insert ($3::actor_type + $8::uuid casts)', true);

    await client.query('rollback');
    console.log('\n' + results.join('\n'));
    console.log('\n✓ ALL R10 assertions PASSED — rolled back, nothing persisted.');
  } catch (e) {
    await client.query('rollback').catch(() => {});
    console.error('\n' + results.join('\n'));
    console.error('\n✗ R10 smoke FAILED:', (e as Error).message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

await main();
