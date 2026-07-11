// ISSUE-082 — the orchestrator + the verify-before-done ALLOWLIST gate (FR-10.DEL.003/005, AC-10.DEL.003.*, .004.*,
// .005.*, .006.*, .007.1). Crux tests: an empty/failed/blocked C2 report BLOCKS the done-audit; an `owed` scrub leg is
// FULFILLED not blocked; a failed observability emit does NOT strand a done erasure; an audit-write failure fails closed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeErasure, type ExecuteErasureDeps, type ExecuteErasureInput } from './execute.ts';
import { authorizeRequest, secondAuthorizeRequest } from './authorize.ts';
import { DEFAULT_DELETION_WORKFLOW_CONFIG } from './config.ts';
import { DeploymentFrozenError } from './freeze.ts';
import {
  InMemoryDeletionWorkflowStore,
  ScriptedErasureMechanism,
  PERM_MEMORY_DELETE,
  type ConnectorPresencePort,
  type ErasureAuthz,
  type ErasureReport,
  type ErasureMechanismPort,
} from './store.ts';

const PERMS = [PERM_MEMORY_DELETE];
const AUTHZ: ErasureAuthz = { actorIdentity: 'exec', originatingUserId: 'exec', isSuperAdmin: true, permissions: PERMS, erasureConfirmed: true };

/** seed a request + persist BOTH authorisers via their perm-checked steps (the real two-person handshake). */
async function setup(store: InMemoryDeletionWorkflowStore): Promise<string> {
  const req = await store.createRequest({ requesterId: 'the-requester', targetUserId: null, targetEntityId: 'target', legalBasis: 'gdpr-art-17' });
  await authorizeRequest(store, req.id, { actorId: 'admin-a', permissions: PERMS });
  await secondAuthorizeRequest(store, req.id, { actorId: 'admin-b', permissions: PERMS });
  return req.id;
}

function baseInput(requestId: string, over: Partial<ExecuteErasureInput> = {}): ExecuteErasureInput {
  return {
    requestId,
    targetEntityId: 'target',
    reason: 'gdpr-art-17',
    subject: { name: 'John Smith', identifiers: ['john@acme.com'] },
    authz: AUTHZ,
    executorId: 'exec',
    executorPermissions: PERMS,
    confirmedScrubIds: [],
    ...over,
  };
}

/** faithful stand-in for the ISSUE-029 C2 mechanism against the workflow store. */
function fakeC2(store: InMemoryDeletionWorkflowStore, legMutator?: (r: ErasureReport) => ErasureReport): ErasureMechanismPort {
  return new ScriptedErasureMechanism(async (target) => {
    const t = target.targetEntityId;
    const rows = [...store.memories.values()].filter((m) => m.entity_ids.includes(t) && m.sensitivity === 'personal');
    const hardDeleted: string[] = [];
    const retainForScrub: { id: string; entity_ids: string[] }[] = [];
    for (const m of rows) {
      if (m.entity_ids.length === 1) {
        store.memories.delete(m.id);
        hardDeleted.push(m.id);
      } else {
        retainForScrub.push({ id: m.id, entity_ids: [...m.entity_ids] });
      }
    }
    const legs = [
      { leg: 'memory_hard_delete', status: 'complete' as const, detail: `${hardDeleted.length} deleted` },
      { leg: 'log_sink_redaction', status: 'complete' as const, detail: 'C7 triggered' },
      { leg: 'backup_purge_flag', status: 'complete' as const, detail: 'raised' },
      { leg: 'audit_tombstone', status: 'complete' as const, detail: 'C2 tombstone written' },
      ...(retainForScrub.length ? [{ leg: 'scrub_pending', status: 'owed' as const, detail: 'owed to C10' }] : []),
    ];
    const done = legs.length > 0 && legs.every((l) => l.status === 'complete');
    const report: ErasureReport = { done, target: t, requestId: target.requestId, legs, hardDeleted, retainForScrub, escalated: !done };
    return legMutator ? legMutator(report) : report;
  });
}

function deps(store: InMemoryDeletionWorkflowStore, mechanism: ErasureMechanismPort, over: Partial<ExecuteErasureDeps> = {}): ExecuteErasureDeps {
  return {
    store,
    mechanism,
    connectorPresence: { detect: async () => [] },
    loadConfig: async () => ({ ...DEFAULT_DELETION_WORKFLOW_CONFIG }),
    now: () => '2026-07-11T12:00:00.000Z',
    ...over,
  };
}

test('happy path: single-entity Personal deleted, multi-entity + non-Personal de-linked, entity deleted, audit written, executed (AC-10.DEL.003.1/.2, .005.1)', async () => {
  const store = new InMemoryDeletionWorkflowStore();
  store.putEntity('target');
  store.putMemory({ id: 'm-solo', content: 'only about John Smith', entity_ids: ['target'], sensitivity: 'personal' });
  store.putMemory({ id: 'm-multi', content: 'John Smith and Acme deal', entity_ids: ['target', 'acme'], sensitivity: 'personal' });
  store.putMemory({ id: 'm-biz', content: 'Contract signed by John Smith, business record', entity_ids: ['target', 'acme'], sensitivity: 'confidential' });
  const rid = await setup(store);

  const res = await executeErasure(deps(store, fakeC2(store)), baseInput(rid, { confirmedScrubIds: ['m-multi', 'm-biz'] }));

  assert.equal(res.done, true);
  assert.equal(res.status, 'executed');
  assert.equal(store.memories.has('m-solo'), false, 'single-entity Personal hard-deleted by C2');
  assert.deepEqual((await store.getMemory('m-multi'))!.entity_ids, ['acme'], 'multi-entity Personal de-linked');
  assert.deepEqual((await store.getMemory('m-biz'))!.entity_ids, ['acme'], 'non-Personal business record de-linked, retained');
  assert.match((await store.getMemory('m-biz'))!.content, /\[REDACTED\]/, 'confirmed content scrubbed (full name matched)');
  assert.equal(await store.entityExists('target'), false, 'entity record hard-deleted');
  assert.deepEqual([res.dispositions.hardDeleted, res.dispositions.idRemoved, res.dispositions.redacted], [1, 2, 2]);
  // the immutable audit records the REAL requester (not the executor) + done + the disposition split
  assert.equal(store.audits.length, 1);
  assert.equal(store.audits[0]!.requesterId, 'the-requester');
  assert.equal(store.audits[0]!.done, true);
});

test('narrow redaction: a THIRD-party "John" in a confirmed retained row is NOT nuked (verify M1 fix)', async () => {
  const store = new InMemoryDeletionWorkflowStore();
  store.putEntity('target');
  store.putMemory({ id: 'm', content: 'John Smith met John Doe at Acme', entity_ids: ['target', 'acme'], sensitivity: 'personal' });
  const rid = await setup(store);
  await executeErasure(deps(store, fakeC2(store)), baseInput(rid, { confirmedScrubIds: ['m'] }));
  const after = (await store.getMemory('m'))!.content;
  assert.match(after, /\[REDACTED\] met John Doe at Acme/, 'only the full-name target is redacted; John Doe survives');
});

test('VERIFY-BEFORE-DONE: a failed C2 leg blocks the done-audit, holds, escalates (AC-10.DEL.003.4)', async () => {
  const store = new InMemoryDeletionWorkflowStore();
  store.putEntity('target');
  store.putMemory({ id: 'm-solo', content: 'x', entity_ids: ['target'], sensitivity: 'personal' });
  const rid = await setup(store);
  const mech = fakeC2(store, (r) => ({ ...r, legs: [...r.legs, { leg: 'residue_reread', status: 'failed', detail: '1 present', residual: 1 }], done: false, escalated: true }));
  const res = await executeErasure(deps(store, mech), baseInput(rid));
  assert.equal(res.status, 'held');
  assert.ok(res.reasons.some((r) => r.includes('c2_incomplete')));
  assert.equal(store.audits.length, 0);
  assert.notEqual((await store.getRequest(rid))!.status, 'executed');
});

test('ALLOWLIST: an EMPTY C2 leg report is treated as indeterminate → held (verify BLOCKER-1)', async () => {
  const store = new InMemoryDeletionWorkflowStore();
  store.putEntity('target');
  const rid = await setup(store);
  const emptyMech: ErasureMechanismPort = new ScriptedErasureMechanism(async (t) => ({ done: false, target: t.targetEntityId, requestId: t.requestId, legs: [], hardDeleted: [], retainForScrub: [], escalated: false }));
  const res = await executeErasure(deps(store, emptyMech), baseInput(rid));
  assert.equal(res.status, 'held');
  assert.ok(res.reasons.includes('c2_empty_report'));
  assert.equal(store.audits.length, 0);
});

test('ALLOWLIST: a failed escalation_emit leg does NOT strand a genuinely-done erasure (verify MAJOR-2)', async () => {
  const store = new InMemoryDeletionWorkflowStore();
  store.putEntity('target');
  store.putMemory({ id: 'm-solo', content: 'x', entity_ids: ['target'], sensitivity: 'personal' });
  const rid = await setup(store);
  const mech = fakeC2(store, (r) => ({ ...r, legs: [...r.legs, { leg: 'escalation_emit', status: 'failed', detail: 'event_log write lost' }] }));
  const res = await executeErasure(deps(store, mech), baseInput(rid));
  assert.equal(res.done, true, 'a lost observability emit is C2 non-fatal — the erasure still completes');
  assert.equal(res.status, 'executed');
});

test('ALLOWLIST: an `owed` on a NON-scrub leg blocks (only scrub_pending is fulfillable, verify MAJOR-3)', async () => {
  const store = new InMemoryDeletionWorkflowStore();
  store.putEntity('target');
  store.putMemory({ id: 'm-solo', content: 'x', entity_ids: ['target'], sensitivity: 'personal' });
  const rid = await setup(store);
  const mech = fakeC2(store, (r) => ({ ...r, legs: [...r.legs, { leg: 'backup_purge_flag', status: 'owed', detail: 'not run' }], done: false }));
  const res = await executeErasure(deps(store, mech), baseInput(rid));
  assert.equal(res.status, 'held');
  assert.ok(res.reasons.some((r) => r.includes('backup_purge_flag=owed')));
});

test('an `owed` scrub leg is FULFILLED not blocked — the erasure completes done', async () => {
  const store = new InMemoryDeletionWorkflowStore();
  store.putEntity('target');
  store.putMemory({ id: 'm-multi', content: 'John Smith and Acme', entity_ids: ['target', 'acme'], sensitivity: 'personal' });
  const rid = await setup(store);
  const res = await executeErasure(deps(store, fakeC2(store)), baseInput(rid, { confirmedScrubIds: ['m-multi'] }));
  assert.equal(res.done, true);
  assert.equal(res.erasureReport!.done, false, 'the C2 report itself was NOT done (scrub was owed)');
  assert.deepEqual((await store.getMemory('m-multi'))!.entity_ids, ['acme']);
});

test('a Personal single-entity row that survived C2 holds + escalates (#2 residue backstop)', async () => {
  const store = new InMemoryDeletionWorkflowStore();
  store.putEntity('target');
  store.putMemory({ id: 'm-solo', content: 'x', entity_ids: ['target'], sensitivity: 'personal' });
  const rid = await setup(store);
  const brokenC2: ErasureMechanismPort = new ScriptedErasureMechanism(async (t) => ({ done: true, target: t.targetEntityId, requestId: t.requestId, legs: [{ leg: 'memory_hard_delete', status: 'complete', detail: 'LIED — nothing deleted' }], hardDeleted: [], retainForScrub: [], escalated: false }));
  const res = await executeErasure(deps(store, brokenC2), baseInput(rid));
  assert.equal(res.status, 'held');
  assert.ok(res.reasons.some((r) => r.includes('single_entity_residue') || r.includes('residue_after_erasure')));
  assert.equal(store.audits.length, 0);
});

test('an audit-write failure FAILS THE ERASURE CLOSED (AC-10.DEL.005.3)', async () => {
  const store = new InMemoryDeletionWorkflowStore();
  store.putEntity('target');
  store.putMemory({ id: 'm-solo', content: 'x', entity_ids: ['target'], sensitivity: 'personal' });
  const rid = await setup(store);
  store.writeDeletionAudit = async () => { throw new Error('access_audit write failed'); };
  const res = await executeErasure(deps(store, fakeC2(store)), baseInput(rid));
  assert.equal(res.status, 'held');
  assert.ok(res.reasons.some((r) => r.includes('audit_write_failed')));
  assert.notEqual((await store.getRequest(rid))!.status, 'executed');
});

test('a frozen deployment blocks + surfaces (AC-10.DEL.007.1)', async () => {
  const store = new InMemoryDeletionWorkflowStore();
  store.frozenAt = '2026-07-01T00:00:00.000Z';
  store.putEntity('target');
  const rid = await setup(store);
  await assert.rejects(() => executeErasure(deps(store, fakeC2(store)), baseInput(rid)), DeploymentFrozenError);
  assert.ok(store.lifecycle.some((e) => e.event === 'deletion_request_blocked_frozen'));
  assert.equal(store.audits.length, 0);
});

test('a connector-detection error fails closed BEFORE the destructive call (AC-10.DEL.006.4)', async () => {
  const store = new InMemoryDeletionWorkflowStore();
  store.putEntity('target');
  store.putMemory({ id: 'm-solo', content: 'x', entity_ids: ['target'], sensitivity: 'personal' });
  const rid = await setup(store);
  const presence: ConnectorPresencePort = { detect: async () => { throw new Error('connector registry unreachable'); } };
  const res = await executeErasure(deps(store, fakeC2(store), { connectorPresence: presence }), baseInput(rid));
  assert.equal(res.status, 'held');
  assert.ok(res.reasons.some((r) => r.includes('connector_detection_error')));
  assert.equal(store.memories.has('m-solo'), true, 'the destructive C2 call was never reached');
});

test('two-person is enforced from the PERSISTED request — a request missing the second authoriser is held (verify B1)', async () => {
  const store = new InMemoryDeletionWorkflowStore();
  store.putEntity('target');
  const req = await store.createRequest({ requesterId: 'r', targetUserId: null, targetEntityId: 'target', legalBasis: 'g' });
  await authorizeRequest(store, req.id, { actorId: 'admin-a', permissions: PERMS }); // ONLY the first authoriser
  const res = await executeErasure(deps(store, fakeC2(store)), baseInput(req.id));
  assert.equal(res.status, 'held');
  assert.ok(res.reasons.some((r) => r.includes('missing_second_authoriser')));
});

test('the destructive identity must be the vetted executor — authz.actorIdentity != executorId is held (verify m3)', async () => {
  const store = new InMemoryDeletionWorkflowStore();
  store.putEntity('target');
  const rid = await setup(store);
  const res = await executeErasure(deps(store, fakeC2(store)), baseInput(rid, { authz: { ...AUTHZ, actorIdentity: 'someone-else' } }));
  assert.equal(res.status, 'held');
  assert.ok(res.reasons.includes('authz_identity_not_executor'));
});

test('RBAC: an executor without PERM-memory.delete is rejected (AC-10.DEL.001.3)', async () => {
  const store = new InMemoryDeletionWorkflowStore();
  store.putEntity('target');
  const rid = await setup(store);
  const res = await executeErasure(deps(store, fakeC2(store)), baseInput(rid, { executorPermissions: [] }));
  assert.equal(res.status, 'held');
  assert.ok(res.reasons.some((r) => r.includes('authorisation') && r.includes(PERM_MEMORY_DELETE)));
});

test('a config read failure does NOT block (two-person is DB-mandated, not config-gated) — still completes', async () => {
  const store = new InMemoryDeletionWorkflowStore();
  store.putEntity('target');
  store.putMemory({ id: 'm-solo', content: 'x', entity_ids: ['target'], sensitivity: 'personal' });
  const rid = await setup(store);
  const res = await executeErasure(deps(store, fakeC2(store), { loadConfig: async () => { throw new Error('config_values unreachable'); } }), baseInput(rid));
  assert.equal(res.done, true);
  assert.ok(store.lifecycle.some((e) => e.event === 'deletion_config_fail_closed'));
});

test('a connector-present target raises tracked flags carried on the result (AC-10.DEL.006.1)', async () => {
  const store = new InMemoryDeletionWorkflowStore();
  store.putEntity('target');
  store.putMemory({ id: 'm-solo', content: 'x', entity_ids: ['target'], sensitivity: 'personal' });
  const rid = await setup(store);
  const presence: ConnectorPresencePort = { detect: async () => ['ghl', 'slack'] };
  const res = await executeErasure(deps(store, fakeC2(store), { connectorPresence: presence }), baseInput(rid));
  assert.equal(res.done, true);
  assert.deepEqual(res.connectorFlagsRaised, ['ghl', 'slack']);
  assert.equal((await store.listConnectorFlags(rid)).length, 2);
});
