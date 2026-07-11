// ISSUE-029 — the orchestrator + the verified-complete-or-fails-loud contract (AC-2.MNT.017.5). The #1/#2/#3 core.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryErasureStore } from './store.ts';
import { eraseTarget, type EraseDeps, type ErasureEventSink } from './erase.ts';
import { ErasureGateError } from './gate.ts';
import type { BackupPurgePort, ErasureAuthz, ErasureTarget, LogRedactionPort, PurgeFlag, SinkRedactionResult } from './store.ts';

const T = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const O = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const m = InMemoryErasureStore.memory;

const target: ErasureTarget = { targetEntityId: T, requestId: 'req-1', reason: 'lawful erasure request' };
const authz: ErasureAuthz = {
  actorIdentity: 'sa@client',
  originatingUserId: '11111111-1111-1111-1111-111111111111',
  isSuperAdmin: true,
  permissions: ['PERM-memory.delete'],
  erasureConfirmed: true,
};

// ── configurable fakes for the fan-out ports + event sink ──
function fakeBackup(over: Partial<{ raised: boolean; new: boolean; throws: boolean }> = {}): BackupPurgePort & { calls: PurgeFlag[] } {
  const calls: PurgeFlag[] = [];
  return {
    calls,
    async raisePurgeFlag(flag: PurgeFlag) {
      calls.push(flag);
      if (over.throws) throw new Error('backup ledger unreachable');
      return { raised: over.raised ?? true, new: over.new ?? true };
    },
  };
}
function sink(sinkName: SinkRedactionResult['sink'], n: number): SinkRedactionResult {
  return { sink: sinkName, redacted: Array.from({ length: n }, (_, i) => `${sinkName}-${i}`), already_tombstoned: [] };
}
function fakeRedaction(over: Partial<{ residual: number; throws: boolean; eventN: number; guardN: number }> = {}): LogRedactionPort & { fired: number } {
  let fired = 0;
  return {
    get fired() {
      return fired;
    },
    async redactSubject() {
      fired++;
      if (over.throws) throw new Error('C7 sink unreachable');
      return { event_log: sink('event_log', over.eventN ?? 2), guardrail_log: sink('guardrail_log', over.guardN ?? 1) };
    },
    async countUnredactedMatches() {
      return over.residual ?? 0;
    },
  };
}
function fakeEvents(): ErasureEventSink & { completed: unknown[]; incomplete: unknown[] } {
  const completed: unknown[] = [];
  const incomplete: unknown[] = [];
  return {
    completed,
    incomplete,
    async erasureCompleted(p) {
      completed.push(p);
    },
    async erasureIncomplete(p) {
      incomplete.push(p);
    },
  };
}
let seq = 0;
interface TestDeps extends EraseDeps {
  events: ReturnType<typeof fakeEvents>;
  backup: ReturnType<typeof fakeBackup>;
  redaction: ReturnType<typeof fakeRedaction>;
}
function deps(store: InMemoryErasureStore, over: { backupPurge?: BackupPurgePort & { calls: PurgeFlag[] }; logRedaction?: LogRedactionPort & { fired: number } } = {}): TestDeps {
  const events = fakeEvents();
  const backup = over.backupPurge ?? fakeBackup();
  const redaction = over.logRedaction ?? fakeRedaction();
  return {
    store,
    backupPurge: backup,
    logRedaction: redaction,
    events,
    now: () => '2026-07-11T00:00:00.000Z',
    genFlagId: () => `flag-${seq++}`,
    // handles for assertions
    backup: backup as ReturnType<typeof fakeBackup>,
    redaction: redaction as ReturnType<typeof fakeRedaction>,
  };
}

test('gate-first: an unauthorized erasure throws BEFORE any read/delete (no data touched)', async () => {
  const store = new InMemoryErasureStore();
  store.put(m({ id: 's1', entity_ids: [T] }));
  const d = deps(store);
  await assert.rejects(() => eraseTarget(d, target, { ...authz, isSuperAdmin: false }), ErasureGateError);
  assert.equal(store.rows.has('s1'), true, 'nothing was deleted below the gate');
  assert.equal(d.redaction.fired, 0, 'no fan-out leg ran');
  assert.equal(store.tombstones.length, 0, 'no tombstone written for a gate rejection');
});

test('happy path: single-entity + episodic evidence + chain + derived all hard-deleted → done, tombstone written, completed emitted (AC-2.MNT.017.1/.3)', async () => {
  const store = new InMemoryErasureStore();
  store.put(m({ id: 'sem', entity_ids: [T], type: 'semantic', superseded_by: 'sem2' }));
  store.put(m({ id: 'sem2', entity_ids: [T], type: 'semantic' })); // newer version
  store.put(m({ id: 'evi', entity_ids: [T], type: 'episodic' })); // evidence layer
  store.put(m({ id: 'derived', entity_ids: [T], type: 'semantic' }), ['sem']); // summary of the erased content
  const d = deps(store);
  const rep = await eraseTarget(d, target, authz);

  assert.equal(rep.done, true);
  assert.equal(rep.escalated, false);
  assert.equal(store.rows.size, 0, 'every erased row is gone — no residue in rows, chain, evidence, embeddings, or derived');
  assert.deepEqual(rep.hardDeleted.sort(), ['derived', 'evi', 'sem', 'sem2']);
  assert.deepEqual(rep.retainForScrub, []);
  // the immutable tombstone records who/when/why/what-scope + done.
  assert.equal(store.tombstones.length, 1);
  const tomb = store.tombstones[0]!;
  assert.equal(tomb.auditType, 'compliance_erasure');
  assert.equal(tomb.action, 'memory_erasure_complete');
  assert.equal(tomb.targetEntityId, T);
  assert.equal(tomb.reason, 'lawful erasure request');
  assert.equal((tomb.afterValue as any).done, true);
  // loud + correct: completed emitted, not incomplete.
  assert.equal(d.events.completed.length, 1);
  assert.equal(d.events.incomplete.length, 0);
  // every leg complete.
  assert.ok(rep.legs.every((l) => l.status === 'complete'), JSON.stringify(rep.legs));
});

test('AC-NFR-CMP.005.2: a multi-entity primary row is retained + surfaced for scrub → NOT done (Personal residue owed), incomplete escalated', async () => {
  const store = new InMemoryErasureStore();
  store.put(m({ id: 'shared', entity_ids: [T, O], type: 'semantic' }));
  const d = deps(store);
  const rep = await eraseTarget(d, target, authz);

  assert.equal(store.rows.has('shared'), true, 'the co-authored row is NOT deleted (would destroy O\'s data, #1)');
  assert.deepEqual(rep.retainForScrub.map((r) => r.id), ['shared']);
  assert.equal(rep.done, false, 'erasure is not fully done while a content-scrub is owed (#2 — target content still present)');
  assert.equal(rep.escalated, true);
  assert.ok(rep.legs.some((l) => l.leg === 'scrub_pending' && l.status === 'owed'));
  assert.equal(d.events.incomplete.length, 1, 'the owed scrub is surfaced loudly (#3)');
  assert.equal(store.tombstones[0]!.action, 'memory_erasure_partial', 'the tombstone records a partial, not a false done');
});

test('AC-2.MNT.017.5 fail-loud: an injected DELETE that leaves residue is caught → NOT done, escalated, tombstone still records the partial (never reports done)', async () => {
  const store = new InMemoryErasureStore();
  store.put(m({ id: 's1', entity_ids: [T] }));
  store.put(m({ id: 's2', entity_ids: [T] }));
  // sabotage the delete primitive to only remove ONE of the two (a half-applied erasure).
  const orig = store.hardDeleteMemories.bind(store);
  store.hardDeleteMemories = async (idsArg: string[]) => {
    await orig([idsArg[0]!]); // delete only the first
    return { deleted: [idsArg[0]!] };
  };
  const d = deps(store);
  const rep = await eraseTarget(d, target, authz);

  assert.equal(rep.done, false, 'a residual row means the run is NOT done');
  assert.equal(rep.escalated, true);
  const del = rep.legs.find((l) => l.leg === 'memory_hard_delete')!;
  assert.equal(del.status, 'failed');
  assert.equal(del.residual, 1);
  assert.equal(d.events.incomplete.length, 1);
  assert.equal(store.tombstones.length, 1, 'the tombstone is STILL written — the partial is recorded, not silent (#3)');
  assert.equal((store.tombstones[0]!.afterValue as any).done, false);
});

test('fail-loud: the delete primitive THROWING is caught as a failed leg (not an unhandled crash), still not-done + escalated', async () => {
  const store = new InMemoryErasureStore();
  store.put(m({ id: 's1', entity_ids: [T] }));
  store.hardDeleteMemories = async () => {
    throw new Error('db connection lost mid-delete');
  };
  const d = deps(store);
  const rep = await eraseTarget(d, target, authz);
  assert.equal(rep.done, false);
  assert.equal(rep.legs.find((l) => l.leg === 'memory_hard_delete')!.status, 'failed');
  assert.equal(d.events.incomplete.length, 1);
});

test('fail-loud: a C7 redaction that leaves un-redacted log rows is caught (log-sink residue is #2 residue too)', async () => {
  const store = new InMemoryErasureStore();
  store.put(m({ id: 's1', entity_ids: [T] }));
  const d = deps(store, { logRedaction: fakeRedaction({ residual: 3 }) });
  const rep = await eraseTarget(d, target, authz);
  assert.equal(rep.done, false);
  const leg = rep.legs.find((l) => l.leg === 'log_sink_redaction')!;
  assert.equal(leg.status, 'failed');
  assert.equal(leg.residual, 3);
});

test('fail-loud: the C7 redaction trigger THROWING is caught as a failed leg', async () => {
  const store = new InMemoryErasureStore();
  store.put(m({ id: 's1', entity_ids: [T] }));
  const d = deps(store, { logRedaction: fakeRedaction({ throws: true }) });
  const rep = await eraseTarget(d, target, authz);
  assert.equal(rep.done, false);
  assert.equal(rep.legs.find((l) => l.leg === 'log_sink_redaction')!.status, 'failed');
});

test('fail-loud: raising the backup-purge flag THROWING is caught as a failed leg', async () => {
  const store = new InMemoryErasureStore();
  store.put(m({ id: 's1', entity_ids: [T] }));
  const d = deps(store, { backupPurge: fakeBackup({ throws: true }) });
  const rep = await eraseTarget(d, target, authz);
  assert.equal(rep.done, false);
  assert.equal(rep.legs.find((l) => l.leg === 'backup_purge_flag')!.status, 'failed');
});

test('BLOCKER end-to-end: erasing alice deletes her source + the shared merge, RESTORES bob\'s source live, and completes done', async () => {
  const ALICE = T;
  const BOB = O;
  const store = new InMemoryErasureStore();
  store.put(m({ id: 'S_alice', entity_ids: [ALICE], superseded_by: 'D' }));
  store.put(m({ id: 'S_bob', entity_ids: [BOB], superseded_by: 'D' }));
  store.put(m({ id: 'D', entity_ids: [ALICE, BOB], type: 'semantic', superseded_by: null }), ['S_alice', 'S_bob']);
  const d = deps(store);
  const rep = await eraseTarget(d, { ...target, targetEntityId: ALICE }, authz);

  assert.equal(store.rows.has('S_alice'), false, 'alice\'s source is gone');
  assert.equal(store.rows.has('D'), false, 'the merge folding alice is gone');
  assert.equal(store.rows.has('S_bob'), true, 'BOB\'S SOURCE SURVIVES (no over-erasure of another subject, #1)');
  assert.equal(store.rows.get('S_bob')!.superseded_by, null, 'bob\'s source was RESTORED LIVE (relinked) since the merge it pointed to was erased');
  assert.ok(rep.legs.some((l) => l.leg === 'supersede_relink' && l.status === 'complete'), 'the relink leg ran');
  assert.equal(rep.done, true, 'alice is fully erased + bob preserved → done');
});

test('the independent residue re-read catches a TOCTOU Personal row the delete-set-scoped check would miss', async () => {
  const store = new InMemoryErasureStore();
  store.put(m({ id: 's1', entity_ids: [T] }));
  // hijack hardDelete to also INSERT a new target Personal row AFTER the walk (a concurrent write) — the delete-set
  // residual re-read (countResidual over the walked ids) would report 0, but the independent re-read must catch it.
  const orig = store.hardDeleteMemories.bind(store);
  store.hardDeleteMemories = async (ids: string[]) => {
    const r = await orig(ids);
    store.put(m({ id: 'late', entity_ids: [T] })); // arrived after the walk — not in deleteIds
    return r;
  };
  const d = deps(store);
  const rep = await eraseTarget(d, target, authz);
  assert.equal(rep.legs.find((l) => l.leg === 'memory_hard_delete')!.status, 'complete', 'the delete-set-scoped check is satisfied (its ids are gone)');
  const rr = rep.legs.find((l) => l.leg === 'residue_reread')!;
  assert.equal(rr.status, 'failed', 'but the INDEPENDENT re-read catches the late-arriving target row');
  assert.equal(rr.residual, 1);
  assert.equal(rep.done, false, 'not done while target Personal content remains');
});

test('FINDING-1 guarded emit: a throwing erasureIncomplete does NOT vaporise the report — it is returned with an escalation_emit leg', async () => {
  const store = new InMemoryErasureStore();
  store.put(m({ id: 'shared', entity_ids: [T, O] })); // multi-entity primary → done:false → erasureIncomplete path
  const events = fakeEvents();
  events.erasureIncomplete = async () => {
    throw new Error('event_log write timed out');
  };
  const d: TestDeps = { ...deps(store), events };
  // eraseTarget must NOT throw — the report is the contract value C10 verifies.
  const rep = await eraseTarget(d, target, authz);
  assert.equal(rep.done, false);
  assert.ok(rep.legs.some((l) => l.leg === 'escalation_emit' && l.status === 'failed'), 'the emit failure is surfaced as a leg, not swallowed');
  assert.equal(store.tombstones.length, 1, 'the tombstone was still written');
});

test('FINDING-2 preflight throw: a walk read failure still writes a tombstone + emits incomplete + returns a report', async () => {
  const store = new InMemoryErasureStore();
  store.put(m({ id: 's1', entity_ids: [T] }));
  store.resolveTargetMemories = async () => {
    throw new Error('silo read timeout during the walk');
  };
  const d = deps(store);
  const rep = await eraseTarget(d, target, authz);
  assert.equal(rep.done, false);
  assert.ok(rep.legs.some((l) => l.leg === 'preflight_walk' && l.status === 'failed'));
  assert.equal(store.rows.has('s1'), true, 'nothing was deleted (the walk never produced a delete set)');
  assert.equal(store.tombstones.length, 1, 'the attempt is still audited (every erasure → a tombstone)');
  assert.equal(d.events.incomplete.length, 1, 'still escalated loudly (#3)');
});

test('the backup-purge flag is raised with the target ref + a minted flag id (idempotent ledger)', async () => {
  const store = new InMemoryErasureStore();
  store.put(m({ id: 's1', entity_ids: [T] }));
  const d = deps(store);
  await eraseTarget(d, target, authz);
  assert.equal(d.backup.calls.length, 1);
  assert.equal(d.backup.calls[0]!.target_ref, T);
  assert.ok(d.backup.calls[0]!.flag_id.startsWith('flag-'));
});
