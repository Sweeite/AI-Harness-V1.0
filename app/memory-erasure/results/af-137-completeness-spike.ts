// AF-137 — transitive-erasure completeness verification SPIKE (build-time, GATES ship per ISSUE-029 §9 / test-strategy).
//
// The unproven assumption AF-137 de-risks: a compliance erasure that spans MANY stores (memory rows + supersede
// chain + merge-collapsed + summary-from-episodic + embeddings + the access_audit tombstone + the C7
// event_log/guardrail_log redaction + the off-platform backup-purge flag) can be VERIFIED COMPLETE across every leg,
// so a partial completion is DETECTED + ESCALATED, never reported done. The OD-074 cross-process C2→C7 fan-out adds
// a new failure point, so this spike composes the REAL C7 redaction module (app/log-retention) + the REAL backup-DR
// receive-leg (app/backup-dr) behind the injected ports — the exact wiring the live path uses — and:
//   RUN 1 — plants residue in EVERY leg, runs the erasure, asserts every leg is CLEARED + done === true.
//   RUN 2 — re-plants + injects a partial failure in one leg, asserts it is CAUGHT (done === false, escalated,
//           the tombstone records the partial) — the erasure NEVER reports done on a residue.
//
// Run:  cd app/memory-erasure && npx tsx results/af-137-completeness-spike.ts
// This is offline (real module fakes) — it proves the cross-process COMPLETENESS logic. The memory-side hard-delete
// against the real silo is additionally R10-proven in results/live-smoke.ts.

import { InMemoryErasureStore } from '../src/store.ts';
import { eraseTarget, type EraseDeps, type ErasureEventSink } from '../src/erase.ts';
import type { BackupPurgePort, ErasureAuthz, ErasureTarget, LogRedactionPort, PurgeFlag } from '../src/store.ts';
import { InMemoryEventLogStore, InMemoryGuardrailLogStore, InMemoryEventWriteSink } from '../../log-retention/src/store.ts';
import { eraseEventLogSubject, eraseGuardrailLogSubject } from '../../log-retention/src/redaction.ts';
import type { EventLogRow, GuardrailLogRow } from '../../log-retention/src/types.ts';
import { InMemoryBackupDrStore } from '../../backup-dr/src/store.ts';

const T = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const O = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const NOW = '2026-07-11T00:00:00.000Z';
const m = InMemoryErasureStore.memory;

const results: string[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) throw new Error(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
  results.push(`✓ ${name}`);
}

const target: ErasureTarget = { targetEntityId: T, requestId: 'req-af137', reason: 'AF-137 lawful erasure spike' };
const authz: ErasureAuthz = {
  actorIdentity: 'sa@client',
  originatingUserId: '11111111-1111-1111-1111-111111111111',
  isSuperAdmin: true,
  permissions: ['PERM-memory.delete'],
  erasureConfirmed: true,
};

// ── residue planting ────────────────────────────────────────────────────────────────────────────────────────────
function eventRow(id: string, matchesTarget: boolean): EventLogRow {
  return {
    id,
    task_id: null,
    event_type: 'memory_written',
    entity_ids: matchesTarget ? [T] : [O],
    summary: matchesTarget ? `PII about ${T}` : 'unrelated',
    payload: { note: matchesTarget ? 'sensitive' : 'ok' },
    duration_ms: null,
    cost_tokens: null,
    cost_unknown: false,
    answer_mode: null,
    redacted_at: null,
    created_at: NOW,
  };
}
function guardRow(id: string, matchesTarget: boolean): GuardrailLogRow {
  return {
    id,
    task_id: null,
    guardrail_type: 'prompt_injection',
    description: matchesTarget ? `blocked exfil of ${T} data` : 'unrelated block',
    action_blocked: true,
    status: 'approved',
    reviewed_by: null,
    reviewed_at: null,
    escalated_at: null,
    redacted_at: null,
    created_at: NOW,
  };
}

function plantMemories(): InMemoryErasureStore {
  const store = new InMemoryErasureStore();
  // a live single-entity Personal row + an older superseded-chain row (both the target's).
  store.put(m({ id: 'live', entity_ids: [T], type: 'semantic', superseded_by: null }));
  store.put(m({ id: 'old', entity_ids: [T], type: 'semantic', superseded_by: 'live' }));
  // episodic evidence cluster + a SUMMARY derived from it (FR-2.MNT.007) — re-tagged Standard/[O] to test the edge.
  store.put(m({ id: 'epi1', entity_ids: [T], type: 'episodic' }));
  store.put(m({ id: 'epi2', entity_ids: [T], type: 'episodic' }));
  store.put(m({ id: 'summary', entity_ids: [O], sensitivity: 'standard', type: 'semantic' }), ['epi1', 'epi2']);
  // a MERGE-collapsed row (FR-2.MNT.005) that folded a target input + another — recomputable → deleted.
  store.put(m({ id: 'srcT', entity_ids: [T] }));
  store.put(m({ id: 'merged', entity_ids: [T, O], type: 'semantic' }), ['srcT', 'otherSrc']);
  return store;
}

// ── the LogRedactionPort bound to the REAL C7 module (app/log-retention) ─────────────────────────────────────────
function makeRedactionPort(evStore: InMemoryEventLogStore, grStore: InMemoryGuardrailLogStore, opts: { induceEventFailure?: boolean } = {}): LogRedactionPort {
  const writer = new InMemoryEventWriteSink();
  const nowDate = () => new Date(NOW); // the C7 module stamps redacted_at via now().toISOString()
  const matchEvent = (r: EventLogRow) => (r.entity_ids ?? []).includes(T);
  const matchGuard = (r: GuardrailLogRow) => r.description.includes(T);
  return {
    async redactSubject() {
      if (opts.induceEventFailure) evStore.induceReadFailure('injected: event_log substrate unreachable');
      const ev = await eraseEventLogSubject({ store: evStore, now: nowDate, writer }, matchEvent);
      const gr = await eraseGuardrailLogSubject({ store: grStore, now: nowDate, writer }, matchGuard);
      return { event_log: ev, guardrail_log: gr };
    },
    async countUnredactedMatches() {
      const ev = (await evStore.all()).filter((r) => matchEvent(r) && r.redacted_at === null).length;
      const gr = (await grStore.all()).filter((r) => matchGuard(r) && r.redacted_at === null).length;
      return ev + gr;
    },
  };
}

// ── the BackupPurgePort bound to the REAL backup-DR receive-leg (app/backup-dr) ──────────────────────────────────
function makeBackupPort(store: InMemoryBackupDrStore, opts: { throws?: boolean } = {}): BackupPurgePort {
  return {
    async raisePurgeFlag(flag: PurgeFlag) {
      if (opts.throws) throw new Error('injected: backup ledger unreachable');
      const res = await store.receivePurgeFlag({ ...flag, client_slug: 'acme' });
      return { raised: true, new: res.new };
    },
  };
}

/** the receive-leg ledger has a FK to the silo's backup posture — register it before raising (provision-time state). */
async function seededBackupStore(): Promise<InMemoryBackupDrStore> {
  const store = new InMemoryBackupDrStore();
  await store.registerSilo({ client_slug: 'acme', now: Date.parse(NOW) });
  return store;
}

function makeEvents(): ErasureEventSink & { completed: unknown[]; incomplete: unknown[] } {
  const completed: unknown[] = [];
  const incomplete: unknown[] = [];
  return { completed, incomplete, async erasureCompleted(p) { completed.push(p); }, async erasureIncomplete(p) { incomplete.push(p); } };
}

let seq = 0;
function baseDeps(store: InMemoryErasureStore, backup: BackupPurgePort, redaction: LogRedactionPort, events: ErasureEventSink): EraseDeps {
  return { store, backupPurge: backup, logRedaction: redaction, events, now: () => NOW, genFlagId: () => `af137-flag-${seq++}` };
}

async function main(): Promise<void> {
  // ══ RUN 1 — residue in every leg, full clear ══
  {
    const mem = plantMemories();
    const evStore = new InMemoryEventLogStore([eventRow('ev-hit-1', true), eventRow('ev-hit-2', true), eventRow('ev-miss', false)]);
    const grStore = new InMemoryGuardrailLogStore([guardRow('gr-hit', true), guardRow('gr-miss', false)]);
    const backupStore = await seededBackupStore();
    const events = makeEvents();
    const deps = baseDeps(mem, makeBackupPort(backupStore), makeRedactionPort(evStore, grStore), events);

    const plantedMemCount = mem.rows.size;
    const rep = await eraseTarget(deps, target, authz);

    check('RUN1: erasure reports done', rep.done, JSON.stringify(rep.legs));
    check('RUN1: not escalated', rep.escalated === false);
    check('RUN1: every planted memory row hard-deleted (rows/chain/episodic/summary/merged/embeddings)', mem.rows.size === 0, `${mem.rows.size} residual of ${plantedMemCount}`);
    check('RUN1: the re-tagged summary + merge-collapsed rows are gone (no re-tag residue, AC-2.MNT.017.3)', !mem.rows.has('summary') && !mem.rows.has('merged'));
    // C7 legs cleared: every target-matching log row tombstoned, non-matching untouched.
    const evAfter = await evStore.all();
    const grAfter = await grStore.all();
    check('RUN1: matching event_log rows redaction-tombstoned', evAfter.filter((r) => r.id.startsWith('ev-hit')).every((r) => r.redacted_at !== null && r.summary === '[redacted]'));
    check('RUN1: non-matching event_log row untouched', evAfter.find((r) => r.id === 'ev-miss')!.redacted_at === null);
    check('RUN1: matching guardrail_log row scrubbed to sentinel, metadata retained', grAfter.find((r) => r.id === 'gr-hit')!.description === '[redacted]' && grAfter.find((r) => r.id === 'gr-hit')!.status === 'approved');
    check('RUN1: no un-redacted matches remain (C7 completeness)', (await deps.logRedaction.countUnredactedMatches(T)) === 0);
    // backup flag raised + open.
    const flags = await backupStore.listOpenPurgeFlags('acme');
    check('RUN1: the off-platform backup-purge flag was raised + is OPEN', flags.length === 1 && flags[0]!.flag.target_ref === T);
    // tombstone + loud signal.
    check('RUN1: an immutable erasure tombstone was written recording done', mem.tombstones.length === 1 && (mem.tombstones[0]!.afterValue as any).done === true);
    check('RUN1: the completed event was emitted (not incomplete)', events.completed.length === 1 && events.incomplete.length === 0);
    check('RUN1: every leg status is complete', rep.legs.every((l) => l.status === 'complete'));
  }

  // ══ RUN 2 — inject a partial failure in the C7 event_log leg; assert it is CAUGHT, never reported done ══
  {
    const mem = plantMemories();
    const evStore = new InMemoryEventLogStore([eventRow('ev-hit-1', true)]);
    const grStore = new InMemoryGuardrailLogStore([guardRow('gr-hit', true)]);
    const backupStore = await seededBackupStore();
    const events = makeEvents();
    const deps = baseDeps(mem, makeBackupPort(backupStore), makeRedactionPort(evStore, grStore, { induceEventFailure: true }), events);

    const rep = await eraseTarget(deps, target, authz);

    check('RUN2: a failed C7 leg means NOT done', rep.done === false);
    check('RUN2: the run escalated', rep.escalated === true);
    check('RUN2: the log_sink_redaction leg is marked failed', rep.legs.find((l) => l.leg === 'log_sink_redaction')!.status === 'failed');
    check('RUN2: the incomplete event was emitted (loud #3)', events.incomplete.length === 1 && events.completed.length === 0);
    check('RUN2: the tombstone STILL records the partial (done:false) — never silent, never a false done', mem.tombstones.length === 1 && (mem.tombstones[0]!.afterValue as any).done === false);
    check('RUN2: NO leg is falsely reported complete-and-done — at least one non-complete leg present', rep.legs.some((l) => l.status !== 'complete'));
  }

  // ══ RUN 3 — inject a memory-delete residue; assert the completeness re-read catches it ══
  {
    const mem = plantMemories();
    const evStore = new InMemoryEventLogStore([]);
    const grStore = new InMemoryGuardrailLogStore([]);
    const events = makeEvents();
    // sabotage: the delete only removes half the set (a half-applied erasure).
    const orig = mem.hardDeleteMemories.bind(mem);
    mem.hardDeleteMemories = async (ids: string[]) => {
      const half = ids.slice(0, Math.max(1, Math.floor(ids.length / 2)));
      return orig(half);
    };
    const deps = baseDeps(mem, makeBackupPort(new InMemoryBackupDrStore()), makeRedactionPort(evStore, grStore), events);

    const rep = await eraseTarget(deps, target, authz);
    const delLeg = rep.legs.find((l) => l.leg === 'memory_hard_delete')!;
    check('RUN3: a half-applied memory delete is caught by the residual re-read', delLeg.status === 'failed' && (delLeg.residual ?? 0) > 0);
    check('RUN3: the run is not done + escalated', rep.done === false && rep.escalated === true);
    check('RUN3: residue actually remains (proving the re-read is real, not cosmetic)', mem.rows.size > 0);
  }

  console.log(results.join('\n'));
  console.log(`\n✅ AF-137 completeness spike GREEN — ${results.length} assertions across 3 runs (full-clear · injected C7 failure · injected delete residue).`);
}

main().catch((e) => {
  console.error(`\n❌ AF-137 SPIKE FAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
