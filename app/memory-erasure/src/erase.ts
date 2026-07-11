// ISSUE-029 §8 steps 4-7 — the erasure orchestrator. Composes the gate + the walk, executes every destructive /
// fan-out leg, and enforces the verified-complete-or-fails-loud contract (AC-2.MNT.017.5): a per-leg status, a
// re-read after each destructive leg, a partial completion RECORDED + ESCALATED and NEVER reported done. Silent
// residue from a half-applied erasure is the #1/#2/#3 failure this module exists to prevent.

import { checkErasureGate, ErasureGateError } from './gate.ts';
import { computeErasureWalk } from './walk.ts';
import type { AuditEntry, BackupPurgePort, ErasureAuthz, ErasureStore, ErasureTarget, LogRedactionPort } from './store.ts';

export type LegStatus =
  | 'complete' // the leg ran and its post-condition (residual === 0 / flag raised) holds
  | 'failed' // the leg threw or its post-condition did NOT hold — the erasure is not done
  | 'blocked' // a precondition prevented the leg from running safely (e.g. a dangling FK) — surfaced, not forced
  | 'owed'; // the leg is a legitimate hand-off to another slice (scrub → C10) — surfaced, erasure not fully done

export interface ErasureLeg {
  leg: string;
  status: LegStatus;
  detail: string;
  /** rows/log-rows still present after the leg (0 required for `complete`). */
  residual?: number;
}

export interface ErasureReport {
  /** true ONLY if every leg the target's Personal data depends on is complete with zero residual AND nothing is
   *  owed/blocked. This is the value the C10 caller (ISSUE-082 AC-10.DEL.003.4) verifies before writing its own
   *  audit-done record — it must never be optimistic. */
  done: boolean;
  target: string;
  requestId: string;
  legs: ErasureLeg[];
  /** the ids actually hard-deleted (the sole destructive primitive). */
  hardDeleted: string[];
  /** multi-entity primary rows retained + owed to C10 scrubbing — surfaced loudly, never silently dropped (#3). */
  retainForScrub: { id: string; entity_ids: string[] }[];
  /** set whenever done === false — a partial/failed erasure was recorded + escalated (never silent, #3). */
  escalated: boolean;
}

/** The loud observability sink (#3 — an erasure, and above all a PARTIAL erasure, must never be silent). */
export interface ErasureEventSink {
  /** a completed erasure run (counts only — must NOT re-embed erased PII, AC-7.LOG.006.3). */
  erasureCompleted(payload: Record<string, unknown>): Promise<void>;
  /** a partial/failed erasure escalated — the #3 loud signal the operator/C10 acts on. */
  erasureIncomplete(payload: Record<string, unknown>): Promise<void>;
}

export interface EraseDeps {
  store: ErasureStore;
  backupPurge: BackupPurgePort;
  logRedaction: LogRedactionPort;
  events: ErasureEventSink;
  /** clock (injected for determinism / R10 parity). */
  now: () => string;
  /** flag-id minter for the backup-purge ledger (idempotent on flag_id). */
  genFlagId: () => string;
}

/** Execute a compliance erasure. Gate-first (throws before ANY read if the precondition fails). Then walk, then run
 *  every leg tracking a per-leg status, then verify-complete-or-fail-loud. */
export async function eraseTarget(deps: EraseDeps, target: ErasureTarget, authz: ErasureAuthz): Promise<ErasureReport> {
  // ── Step 1: gate. Destructive → fail-closed BEFORE any read of the target's data. ──
  const verdict = checkErasureGate(authz);
  if (!verdict.allowed) throw new ErasureGateError(verdict.reasons);

  const { store, backupPurge, logRedaction, events, now, genFlagId } = deps;
  const legs: ErasureLeg[] = [];
  const record = (leg: string, status: LegStatus, detail: string, residual?: number): void => {
    legs.push(residual === undefined ? { leg, status, detail } : { leg, status, detail, residual });
  };

  // ── Steps 2-3: transitive walk + classification. ──
  // ── Steps 2-3: the transitive walk + the pre-delete relink. Wrapped so a read/cast failure here still produces the
  //    structured report + tombstone (a walk throwing must not vaporise the audit trail, #3). ──
  let hardDeleted: string[] = [];
  let retainForScrub: { id: string; entity_ids: string[] }[] = [];
  let deleteIds: string[] = [];
  let excludedCount = 0;
  let walkOk = false;
  try {
    const walk = await computeErasureWalk(store, target.targetEntityId);
    deleteIds = walk.deleteSet.map((r) => r.id);
    retainForScrub = walk.retainForScrub.map((r) => ({ id: r.id, entity_ids: [...r.entity_ids] }));
    excludedCount = walk.excluded.length;
    // ── Pre-delete: un-supersede any OTHER-subject row whose superseded_by points INTO the delete set (a sibling
    //    source CAS-superseded into a now-erased shared merge). This RESTORES it live rather than losing it (#1) and
    //    lets the bulk delete proceed without an FK violation — no half-apply. ──
    const relinked = await store.clearSupersededByRefs(deleteIds);
    if (relinked.length > 0) {
      record('supersede_relink', 'complete', `${relinked.length} superseded row(s) of another subject restored live (were CAS-superseded into an erased shared merge) — #1 no-loss`);
    }
    walkOk = true;
  } catch (e) {
    record('preflight_walk', 'failed', `resolving the erasure set threw: ${errMsg(e)}`);
  }

  // ── Step 4: the hard delete (the sole destructive primitive) + a delete-set residual re-read. ──
  if (walkOk) {
    try {
      const res = await store.hardDeleteMemories(deleteIds);
      hardDeleted = res.deleted;
      const residual = await store.countResidual(deleteIds);
      record('memory_hard_delete', residual === 0 ? 'complete' : 'failed', `${res.deleted.length}/${deleteIds.length} row(s) hard-deleted (rows + chain + derived + embeddings)`, residual);
    } catch (e) {
      record('memory_hard_delete', 'failed', `hard delete threw: ${errMsg(e)}`, deleteIds.length);
    }

    // ── Step 4b: an INDEPENDENT residue re-read — NOT scoped to the delete-set ids. It re-runs the seed queries so it
    //    catches (a) a TOCTOU Personal row inserted after the walk, (b) any single-entity target row the walk missed,
    //    and (c) a derived row still pointing at an erased source via the provenance edge (a re-tag/late arrival). It
    //    proves "no target content remains", not merely "I deleted what I chose" — the #1/#2 completeness backstop. ──
    try {
      const retainIds = new Set(retainForScrub.map((r) => r.id));
      const stillTarget = (await store.resolveTargetMemories(target.targetEntityId)).filter((r) => !retainIds.has(r.id));
      const stillDerived = (await store.findDerivedFrom(deleteIds)).filter((r) => !retainIds.has(r.id));
      const residue = stillTarget.length + stillDerived.length;
      record('residue_reread', residue === 0 ? 'complete' : 'failed', `independent re-read — ${stillTarget.length} target Personal + ${stillDerived.length} derived-from-erased row(s) still present`, residue);
    } catch (e) {
      record('residue_reread', 'failed', `the independent residue re-read threw: ${errMsg(e)}`);
    }
  }

  // ── Step 6a: trigger the C7 log-sink redaction (event_log + guardrail_log) + verify no un-redacted matches. ──
  try {
    const r = await logRedaction.redactSubject(target.targetEntityId);
    const residual = await logRedaction.countUnredactedMatches(target.targetEntityId);
    const n = r.event_log.redacted.length + r.guardrail_log.redacted.length;
    record('log_sink_redaction', residual === 0 ? 'complete' : 'failed', `${n} log row(s) redaction-tombstoned across event_log + guardrail_log (C7)`, residual);
  } catch (e) {
    record('log_sink_redaction', 'failed', `C7 redaction trigger threw: ${errMsg(e)}`);
  }

  // ── Step 6b: raise the off-platform backup-purge flag (NFR-DR.009 — Phase 5 clears it later). ──
  try {
    const raised = await backupPurge.raisePurgeFlag({
      flag_id: genFlagId(),
      target_ref: target.targetEntityId,
      raised_at: now(),
      erasure_effective_at: now(),
    });
    record('backup_purge_flag', 'complete', raised.new ? 'off-platform backup-purge flag raised' : 'purge flag already raised (idempotent)');
  } catch (e) {
    record('backup_purge_flag', 'failed', `raising the backup-purge flag threw: ${errMsg(e)}`);
  }

  // ── Step 3-tail: the retained multi-entity rows are a legitimate hand-off to C10 scrubbing — surfaced as OWED so
  //    the erasure is not falsely reported done while the target's Personal content survives in them (#2). ──
  if (retainForScrub.length > 0) {
    record('scrub_pending', 'owed', `${retainForScrub.length} multi-entity primary row(s) retained + owed to C10 content-scrub (AC-NFR-CMP.005.2)`, retainForScrub.length);
  }

  // ── Step 7 (pre-tombstone): verified-complete-or-fails-loud. done ⇔ at least one leg ran AND every leg complete.
  //    The `legs.length > 0` guard makes the verdict fail-CLOSED — an empty leg list can never read as done (a
  //    defensive default against any future refactor that computes done before a leg records). ──
  const done = legs.length > 0 && legs.every((l) => l.status === 'complete');

  // ── Step 5: the immutable access_audit tombstone — written on EVERY run (complete or partial), recording who /
  //    when / why / what-scope + the per-leg outcome. Append-only (schema §2). Counts only — no erased PII. ──
  const tombstone: AuditEntry = {
    auditType: 'compliance_erasure',
    actorIdentity: authz.actorIdentity,
    actorType: 'user',
    action: done ? 'memory_erasure_complete' : 'memory_erasure_partial',
    targetType: 'entity',
    targetEntityId: target.targetEntityId,
    reason: target.reason,
    pathContext: `deletion_request:${target.requestId}`,
    originatingUserId: authz.originatingUserId,
    afterValue: {
      request_id: target.requestId,
      hard_deleted_count: hardDeleted.length,
      retained_for_scrub_count: retainForScrub.length,
      other_subject_rows_excluded: excludedCount,
      legs: legs.map((l) => ({ leg: l.leg, status: l.status, residual: l.residual ?? null })),
      done,
    },
  };
  try {
    await store.writeTombstone(tombstone);
    record('audit_tombstone', 'complete', 'immutable erasure tombstone written to access_audit');
  } catch (e) {
    // the tombstone itself failed — the run is not done AND the audit trail is incomplete (a #3 double failure).
    record('audit_tombstone', 'failed', `writing the erasure tombstone threw: ${errMsg(e)}`);
  }

  // recompute the OPERATIONAL verdict to include the tombstone leg. This is the value the C10 caller verifies.
  const doneFinal = legs.length > 0 && legs.every((l) => l.status === 'complete');
  const report: ErasureReport = { done: doneFinal, target: target.targetEntityId, requestId: target.requestId, legs, hardDeleted, retainForScrub, escalated: !doneFinal };

  // ── Emit the loud signal — but GUARDED. The observability emit is NOT allowed to discard the structured report the
  //    caller verifies: a transient event_log write failure here (table lock, dropped conn) must never throw away a
  //    computed done:false or lose the report. A failed emit is surfaced as its own leg (a #3-on-#3, never silent),
  //    but the report is still returned with its operational `done` intact. ──
  try {
    if (doneFinal) {
      await events.erasureCompleted({ target: target.targetEntityId, request_id: target.requestId, hard_deleted: hardDeleted.length, retained_for_scrub: retainForScrub.length });
    } else {
      await events.erasureIncomplete({ target: target.targetEntityId, request_id: target.requestId, legs: legs.filter((l) => l.status !== 'complete').map((l) => ({ leg: l.leg, status: l.status })) });
    }
  } catch (e) {
    record('escalation_emit', 'failed', `emitting the ${doneFinal ? 'completed' : 'incomplete'} signal threw (report still returned): ${errMsg(e)}`);
  }

  return report;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
