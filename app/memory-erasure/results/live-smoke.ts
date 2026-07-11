// ISSUE-029 R10 live-adapter smoke (spec/00-foundations/standards/live-adapter-hygiene-sweep.md).
//
// Drives the REAL SupabaseErasureStore + SupabaseErasureEventSink + the eraseTarget orchestrator against the live
// silo in ONE transaction, ROLLED BACK — nothing persists. Proves the live SQL the offline fake stands in for
// actually executes against the real 0001 schema + migration 0045 (memories.derived_from) + migration 0046 (the two
// additive erasure event_type values):
//   • the OD-204 provenance edge END-TO-END live: ISSUE-027's insertDerivedMemory now WRITES memories.derived_from,
//     and this adapter's findDerivedFrom reads it (derived_from && $1::uuid[]) — the transitive walk's derived-row leg.
//   • resolveTargetMemories ($1 = any(entity_ids) AND sensitivity='personal'), the recursive-CTE supersede walk (both
//     directions), danglingSupersedeRefs, the SOLE destructive `delete from memories … returning id`, countResidual.
//   • the immutable access_audit tombstone ($3::actor_type + $6::uuid + $10::jsonb casts).
//   • both erasure event_type casts (memory_erased / memory_erasure_incomplete ::event_type) with NO 22P02.
//   • the full eraseTarget orchestrator over the LIVE memory-side legs (backup + C7 legs use fakes here — each is
//     R10-proven in its own package: app/backup-dr, app/log-retention).
// The embedding is a FIXED deterministic 1536-vector (embedding QUALITY is AF-002; vector VALUES don't affect SQL shape).
//
// Prereq: migrations 0045 + 0046 applied. Run:  source ~/.ai-harness-secrets.env && npx tsx results/live-smoke.ts

import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { SupabaseErasureStore, SupabaseErasureEventSink } from '../src/supabase-store.ts';
import { eraseTarget, type EraseDeps } from '../src/erase.ts';
import type { BackupPurgePort, ErasureAuthz, ErasureTarget, LogRedactionPort } from '../src/store.ts';
import { SupabaseMaintenanceStore } from '../../memory-maintenance/src/supabase-store.ts';
import { buildMemoryRow, type MemoryDraft } from '../../memory-write/src/commit.ts';

const results: string[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) throw new Error(`R10 assertion FAILED: ${name} ${detail}`);
}

const FIXED_EMBEDDING = new Array(1536).fill(0.0011);
const NOW = '2026-07-11T00:00:00Z';

function draft(entityIds: string[], over: Partial<MemoryDraft> = {}): MemoryDraft {
  return {
    type: 'semantic',
    content: 'r10 erasure content',
    entity_ids: entityIds,
    sourceType: 'ai_inferred_weak',
    proposedConfidence: 0.7,
    source_ref: null,
    visibility: 'private',
    sensitivity: 'personal',
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

    const store = new SupabaseErasureStore(exec);
    const events = new SupabaseErasureEventSink(exec);
    const maint = new SupabaseMaintenanceStore(exec); // ISSUE-027 governed writer — seeds rows + writes derived_from

    // originating_user_id on the tombstone is a FK profiles(id) → auth.users(id); seed the chain in-txn (rolled back).
    const au = await client.query<{ id: string }>(`insert into auth.users (id) values (gen_random_uuid()) returning id::text as id`);
    const saUserId = au.rows[0]!.id;
    await client.query(`insert into profiles (id, email) values ($1, 'r10-erasure-sa@smoke.local')`, [saUserId]);

    const T = randomUUID(); // the erasure target entity
    const O = randomUUID(); // a co-occurring entity

    // [1] seed the target's Personal SOURCE row through the governed writer (::vector + ::enum casts, no 22P02).
    const srcSeed = await maint.insertDerivedMemory(buildMemoryRow(draft([T], { content: 'target source fact' }), randomUUID(), NOW), []);
    check('[1] insertDerivedMemory seeds a live Personal memory (governed insert)', srcSeed.inserted, `id=${srcSeed.id}`);

    // [2] seed a DERIVED row (a summary) FROM that source — proves ISSUE-027 now WRITES memories.derived_from (OD-204).
    const derSeed = await maint.insertDerivedMemory(buildMemoryRow(draft([O], { content: 'summary re-tagged to other', sensitivity: 'standard' }), randomUUID(), NOW), [srcSeed.id]);
    check('[2] insertDerivedMemory seeds a derived row + WRITES derived_from (OD-204 write side, live)', derSeed.inserted, `derived=${derSeed.id}`);
    const dfChk = await client.query<{ derived_from: string[] | null }>(`select derived_from::text[] as derived_from from memories where id = $1`, [derSeed.id]);
    check('[2b] memories.derived_from is persisted queryably (not null, contains the source id)', (dfChk.rows[0]!.derived_from ?? []).includes(srcSeed.id), JSON.stringify(dfChk.rows[0]!.derived_from));

    // [3] findDerivedFrom reads the edge back (derived_from && $1::uuid[]) — the OD-204 READ side + the walk's derived leg.
    const derivedRows = await store.findDerivedFrom([srcSeed.id]);
    check('[3] findDerivedFrom reaches the re-tagged derived row via the provenance edge (the KEY OD-204 live proof)', derivedRows.some((r) => r.id === derSeed.id));

    // [4] seed an OLDER version + link the supersede chain (old.superseded_by = src) via the governed CAS.
    const oldSeed = await maint.insertDerivedMemory(buildMemoryRow(draft([T], { content: 'older superseded version' }), randomUUID(), NOW), []);
    const won = await maint.casSupersede(oldSeed.id, srcSeed.id);
    check('[4] casSupersede links the chain old→src (superseded_by set)', won);

    // [5] resolveTargetMemories — the Personal rows referencing T (source + old; the re-tagged Standard summary is out).
    const targetRows = await store.resolveTargetMemories(T);
    const tIds = new Set(targetRows.map((r) => r.id));
    check('[5] resolveTargetMemories returns the target Personal rows ($1 = any(entity_ids) AND personal)', tIds.has(srcSeed.id) && tIds.has(oldSeed.id) && !tIds.has(derSeed.id));

    // [6] walkSupersededChain — the recursive CTE reaches BOTH the source and its older superseded version.
    const chain = await store.walkSupersededChain([srcSeed.id]);
    const cIds = new Set(chain.map((r) => r.id));
    check('[6] walkSupersededChain (recursive CTE, both directions) reaches src + the older version', cIds.has(srcSeed.id) && cIds.has(oldSeed.id));

    // [7] danglingSupersedeRefs — a row OUTSIDE a delete set pointing INTO it is detected (FK-safety pre-check).
    const dangle = await store.danglingSupersedeRefs([srcSeed.id]);
    check('[7] danglingSupersedeRefs detects old→src (old references the delete-target)', dangle.includes(oldSeed.id));

    // [8] the FULL orchestrator over the live memory-side legs. backup + C7 use fakes (R10-proven in their packages);
    //     the memory delete + residual re-read + tombstone + event emit all execute against the live silo.
    const fakeBackup: BackupPurgePort = { async raisePurgeFlag() { return { raised: true, new: true }; } };
    const fakeRedaction: LogRedactionPort = { async redactSubject() { return { event_log: { sink: 'event_log', redacted: [], already_tombstoned: [] }, guardrail_log: { sink: 'guardrail_log', redacted: [], already_tombstoned: [] } }; }, async countUnredactedMatches() { return 0; } };
    const deps: EraseDeps = { store, backupPurge: fakeBackup, logRedaction: fakeRedaction, events, now: () => NOW, genFlagId: () => `r10-flag-${randomUUID()}` };
    const target: ErasureTarget = { targetEntityId: T, requestId: randomUUID(), reason: 'r10 lawful erasure' };
    const authz: ErasureAuthz = { actorIdentity: 'r10-sa', originatingUserId: saUserId, isSuperAdmin: true, permissions: ['PERM-memory.delete'], erasureConfirmed: true };

    const rep = await eraseTarget(deps, target, authz);
    check('[8] eraseTarget reports done over the live memory legs', rep.done, JSON.stringify(rep.legs.map((l) => `${l.leg}:${l.status}`)));
    check('[8b] the hard delete removed the target rows + the derived row (chain + derived + embeddings, live)', rep.hardDeleted.length >= 3);

    // [9] completeness re-read live — no residual target rows remain.
    const residual = await store.countResidual([srcSeed.id, oldSeed.id, derSeed.id]);
    check('[9] countResidual === 0 live (delete from memories … verified complete)', residual === 0, `residual=${residual}`);

    // [10] the immutable access_audit tombstone was written ($3::actor_type + $6::uuid + $10::jsonb, no 22P02).
    const tomb = await client.query<{ n: string }>(`select count(*)::text as n from access_audit where audit_type = 'compliance_erasure' and target_entity_id = $1`, [T]);
    check('[10] the erasure tombstone is in access_audit (immutable, live insert casts valid)', Number(tomb.rows[0]!.n) === 1);

    // [11] both erasure event_type values cast into the live enum (migration 0046) with NO 22P02.
    await events.erasureCompleted({ target: T, request_id: 'r10' });
    await events.erasureIncomplete({ target: T, request_id: 'r10' });
    check('[11] event_log emits memory_erased / memory_erasure_incomplete (::event_type, no 22P02 — migration 0046 live)', true);

    // [12] the BLOCKER fix live — a consolidation shared-supersede (S_alice, S_bob → D). Erasing ALICE must delete
    //      S_alice + D but RESTORE bob's source live (clearSupersededByRefs), never delete it (#1 no over-erasure).
    const ALICE = randomUUID();
    const BOB = randomUUID();
    const sAlice = await maint.insertDerivedMemory(buildMemoryRow(draft([ALICE], { content: 'alice source' }), randomUUID(), NOW), []);
    const sBob = await maint.insertDerivedMemory(buildMemoryRow(draft([BOB], { content: 'bob source' }), randomUUID(), NOW), []);
    const merge = await maint.insertDerivedMemory(buildMemoryRow(draft([ALICE, BOB], { content: 'merged alice+bob' }), randomUUID(), NOW), [sAlice.id, sBob.id]);
    await maint.casSupersede(sAlice.id, merge.id);
    await maint.casSupersede(sBob.id, merge.id);
    const aliceTarget: ErasureTarget = { targetEntityId: ALICE, requestId: randomUUID(), reason: 'r10 blocker scenario' };
    const repAlice = await eraseTarget(deps, aliceTarget, authz);
    check('[12] erasing alice completes done over the live legs (bob preserved)', repAlice.done, JSON.stringify(repAlice.legs.map((l) => `${l.leg}:${l.status}`)));
    const survivors = await client.query<{ id: string; superseded_by: string | null }>(`select id::text as id, superseded_by::text as superseded_by from memories where id = any($1::uuid[])`, [[sAlice.id, sBob.id, merge.id]]);
    const byId = new Map(survivors.rows.map((r) => [r.id, r]));
    check('[12b] alice source + the merge are hard-deleted, BOB\'S SOURCE SURVIVES (no over-erasure of another subject, live)', !byId.has(sAlice.id) && !byId.has(merge.id) && byId.has(sBob.id));
    check('[12c] bob\'s source was RESTORED LIVE (superseded_by nulled by clearSupersededByRefs, live SQL valid)', byId.get(sBob.id)!.superseded_by === null);

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
