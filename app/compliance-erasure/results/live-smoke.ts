// ISSUE-082 R10 live-adapter smoke (spec/00-foundations/standards/live-adapter-hygiene-sweep.md).
//
// Drives the REAL SupabaseDeletionWorkflowStore + the executeErasure orchestrator against the live silo in ONE
// transaction, ROLLED BACK — nothing persists. Proves the live SQL the offline fake stands in for actually executes
// against the real 0001 schema (deletion_requests + its two-person CHECKs, connector_deletion_flags,
// deployment_settings, access_audit, memories, entities) + migration 0047 (the 7 additive lifecycle event_type
// values). The C2 mechanism is a faithful in-txn stand-in here (ISSUE-029's own adapter is R10-proven in
// app/memory-erasure); this smoke's job is the C10 WORKFLOW's live SQL + the verify-before-done boundary.
//
// Asserts:
//   • createRequest / updateRequest against deletion_requests — and the DB CHECK REJECTS a self-second-authoriser
//     (executor == second) with a live constraint violation (AC-10.DEL.006.2), and status='executed' requires all three.
//   • deterministicMemoryIds ($1 = any(entity_ids)), probabilisticContentMatches (ilike any + exclude), scrubMemory
//     (array_remove de-link + content), hardDeleteEntityRecord.
//   • raiseConnectorFlag idempotency + escalateOverdueConnectorFlags stamping.
//   • readDeploymentFrozenAt.
//   • writeDeletionAudit → access_audit ('individual_deletion', 'user'::actor_type cast, after_value jsonb, NO PII).
//   • emitLifecycle casts EVERY mapped event_type value (incl. the 0047 additive ones) with NO 22P02.
//   • an end-to-end executeErasure over the live adapter reaches done + writes the immutable audit.
//
// Prereq: migration 0047 applied. Run:  source ~/.ai-harness-secrets.env && npx tsx results/live-smoke.ts

import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { SupabaseDeletionWorkflowStore, LIFECYCLE_EVENT_TYPE } from '../src/supabase-store.ts';
import { executeErasure } from '../src/execute.ts';
import { authorizeRequest, secondAuthorizeRequest } from '../src/authorize.ts';
import { ScriptedErasureMechanism, PERM_MEMORY_DELETE, type ConnectorPresencePort, type ErasureReport } from '../src/store.ts';
import { DEFAULT_DELETION_WORKFLOW_CONFIG } from '../src/config.ts';

const results: string[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) throw new Error(`R10 assertion FAILED: ${name} ${detail}`);
}

const NOW = '2026-07-11T00:00:00.000Z';

async function main(): Promise<void> {
  const url = process.env.SILO_DB_URL;
  if (!url) throw new Error('SILO_DB_URL not set (source ~/.ai-harness-secrets.env)');
  const ssl = /sslmode=disable/.test(url) ? undefined : { rejectUnauthorized: false };
  const client = new pg.Client({ connectionString: url, ssl });
  await client.connect();
  const exec = (<R extends pg.QueryResultRow>(t: string, p?: unknown[]) => client.query<R>(t, p as never[])) as <R extends pg.QueryResultRow>(t: string, p?: unknown[]) => Promise<{ rows: R[]; rowCount?: number | null }>;

  await client.query('begin');
  try {
    const store = new SupabaseDeletionWorkflowStore(exec);

    // ── seed: three distinct authoriser profiles (FK auth.users → profiles) + a target entity + memories. ──
    const [reqUser, adminA, adminB, execUser] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    for (const [uid, email] of [[reqUser, 'req'], [adminA, 'a'], [adminB, 'b'], [execUser, 'x']] as [string, string][]) {
      await client.query(`insert into auth.users (id, email) values ($1, $2) on conflict do nothing`, [uid, `${email}-${uid}@r10.test`]);
      await client.query(`insert into profiles (id, email, name) values ($1, $2, $3)`, [uid, `${email}-${uid}@r10.test`, `r10 ${email}`]);
    }
    const target = randomUUID();
    await client.query(`insert into entities (id, type, name) values ($1, 'contact', 'R10 Target')`, [target]);
    const acme = randomUUID();
    await client.query(`insert into entities (id, type, name) values ($1, 'organisation', 'Acme')`, [acme]);
    const FIXED_EMB = `[${new Array(1536).fill(0.001).join(',')}]`;
    const mSolo = randomUUID();
    const mMulti = randomUUID();
    const mBiz = randomUUID();
    for (const [id, ents, sens, content] of [
      [mSolo, [target], 'personal', 'only about the R10 target'],
      [mMulti, [target, acme], 'personal', 'R10 Target and Acme deal notes'],
      [mBiz, [target, acme], 'confidential', 'Contract with Acme, business record referencing R10 Target'],
    ] as [string, string[], string, string][]) {
      await client.query(
        `insert into memories (id, type, content, embedding, embedding_model, entity_ids, source, confidence, visibility, sensitivity, content_hash, idempotency_key)
           values ($1, 'semantic', $2, $3::vector, 'text-embedding-3-small', $4::uuid[], 'ai_inferred', 0.7, 'private', $5::sensitivity_tier, $6, $7)`,
        [id, content, FIXED_EMB, ents, sens, `h-${id}`, `k-${id}`],
      );
    }

    // ── queue: createRequest + the DB two-person distinctness CHECK. ──
    const req = await store.createRequest({ requesterId: reqUser, targetUserId: null, targetEntityId: target, legalBasis: 'gdpr-art-17' });
    check('createRequest → deletion_requests row at received', req.status === 'received' && req.targetEntityId === target);

    // a constraint violation aborts the whole txn — isolate the intentional-failure assertion in a savepoint so the
    // rest of the smoke continues (Postgres 25P02 otherwise poisons every subsequent statement).
    await client.query('savepoint sp_distinct');
    let checkRejected = false;
    try {
      await store.updateRequest(req.id, { authorizedBy: adminA, secondAuthoriserId: adminA });
    } catch {
      checkRejected = true;
      await client.query('rollback to savepoint sp_distinct');
    }
    check('deletion_requests CHECK rejects a self-second-authoriser live (AC-10.DEL.006.2)', checkRejected);
    // prove the NULL-tolerant fix (0048): an all-null intake row + a distinct two-person fill both PASS live.
    await store.updateRequest(req.id, { authorizedBy: adminA, secondAuthoriserId: adminB });
    check('deletion_requests accepts a DISTINCT two-person fill live (0048 null-tolerant CHECK)', true);

    // ── identification reads. ──
    const det = await store.deterministicMemoryIds(target);
    check('deterministicMemoryIds enumerates all 3 rows referencing the target', det.length === 3, `got ${det.length}`);
    const prob = await store.probabilisticContentMatches(['Acme'], det);
    check('probabilisticContentMatches (ilike any + exclude) returns nothing new (all matches are deterministic)', prob.length === 0);

    // ── connector flag idempotency + escalation stamp. ──
    const f1 = await store.raiseConnectorFlag(req.id, 'ghl');
    const f2 = await store.raiseConnectorFlag(req.id, 'ghl');
    check('raiseConnectorFlag is idempotent per (request, connector)', f1.id === f2.id);
    const escalated = await store.escalateOverdueConnectorFlags(0, Date.parse('2026-07-12T00:00:00Z'));
    check('escalateOverdueConnectorFlags stamps the overdue flag once', escalated.length === 1 && escalated[0] === f1.id);

    // ── readDeploymentFrozenAt (seeded singleton row exists; null = not frozen). ──
    const frozen = await store.readDeploymentFrozenAt();
    check('readDeploymentFrozenAt returns the local freeze state', frozen === null || typeof frozen === 'string');

    // ── emitLifecycle casts EVERY mapped event_type value with no 22P02. ──
    for (const logical of Object.keys(LIFECYCLE_EVENT_TYPE)) {
      await store.emitLifecycle(logical, req.id, { r10: true });
    }
    check('emitLifecycle casts all mapped event_type values (incl. 0047 additive) — no 22P02', true);

    // ── writeDeletionAudit → access_audit, actor_type cast, jsonb after_value. ──
    await store.writeDeletionAudit({
      requestId: req.id, requesterId: reqUser, authorizedBy: adminA, secondAuthoriserId: adminB, executorId: execUser,
      actorIdentity: execUser, originatingUserId: execUser, targetEntityId: target, legalBasis: 'gdpr-art-17', executedAt: NOW,
      hardDeletedCount: 1, idRemovedCount: 2, redactedCount: 1, done: true,
    });
    const { rows: auditRows } = await client.query(`select action, actor_type, after_value from access_audit where audit_type='individual_deletion' and target_entity_id=$1`, [target]);
    check('writeDeletionAudit → immutable access_audit row (actor_type cast, jsonb, no PII)', auditRows.length === 1 && auditRows[0].action === 'memory_erasure_complete' && !JSON.stringify(auditRows[0].after_value).includes('content'));

    // ── end-to-end executeErasure over the LIVE adapter (C2 = faithful in-txn stand-in). Two-person handshake first:
    //    admin A authorises, admin B second-authorises (both perm-checked), then executor C runs it. ──
    const req2 = await store.createRequest({ requesterId: reqUser, targetUserId: null, targetEntityId: target, legalBasis: 'gdpr-art-17' });
    await authorizeRequest(store, req2.id, { actorId: adminA, permissions: [PERM_MEMORY_DELETE] });
    await secondAuthorizeRequest(store, req2.id, { actorId: adminB, permissions: [PERM_MEMORY_DELETE] });
    const liveC2 = new ScriptedErasureMechanism(async (t): Promise<ErasureReport> => {
      // mimic C2: hard-delete single-entity Personal (mSolo), retain Personal multi-entity (mMulti) as owed scrub.
      await client.query(`delete from memories where id = $1`, [mSolo]);
      return {
        done: false, target: t.targetEntityId, requestId: t.requestId, escalated: false, hardDeleted: [mSolo],
        retainForScrub: [{ id: mMulti, entity_ids: [target, acme] }],
        legs: [
          { leg: 'memory_hard_delete', status: 'complete', detail: '1 deleted' },
          { leg: 'scrub_pending', status: 'owed', detail: 'owed to C10' },
        ],
      };
    });
    const presence: ConnectorPresencePort = { detect: async () => ['ghl'] };
    const res = await executeErasure(
      { store, mechanism: liveC2, connectorPresence: presence, loadConfig: async () => ({ ...DEFAULT_DELETION_WORKFLOW_CONFIG }), now: () => NOW },
      {
        requestId: req2.id, targetEntityId: target, reason: 'gdpr-art-17',
        subject: { name: 'R10 Target' }, authz: { actorIdentity: execUser, originatingUserId: execUser, isSuperAdmin: true, permissions: [PERM_MEMORY_DELETE], erasureConfirmed: true },
        executorId: execUser, executorPermissions: [PERM_MEMORY_DELETE], confirmedScrubIds: [mMulti, mBiz],
      },
    );
    check('executeErasure over the LIVE adapter reaches done=true (owed scrub fulfilled)', res.done === true, JSON.stringify(res.reasons));
    check('  → single-entity Personal hard-deleted, multi-entity + business record de-linked live', (await store.deterministicMemoryIds(target)).length === 0);
    check('  → entity record hard-deleted', !(await store.entityExists(target)));
    check('  → request marked executed (all three authorisers non-null CHECK satisfied)', (await store.getRequest(req2.id))!.status === 'executed');
    check('  → dispositions recorded', res.dispositions.hardDeleted === 1 && res.dispositions.idRemoved === 2);

    await client.query('rollback');
    console.log(results.join('\n'));
    console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} PASS — ROLLED BACK, nothing persisted.`);
  } catch (e) {
    await client.query('rollback');
    console.error(results.join('\n'));
    throw e;
  } finally {
    await client.end();
  }
}

await main();
