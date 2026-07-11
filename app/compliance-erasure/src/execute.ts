// ISSUE-082 §8 steps 6+9 — the erasure orchestrator + the verify-before-done gate (FR-10.DEL.003/005 + AC-10.DEL.003.4).
//
// This composes the whole C10 workflow around the C2 mechanism and enforces the one invariant this slice exists for:
// the "done" audit is NEVER written until the C2 erasure reported its destructive legs complete. The gate is an
// ALLOWLIST over the ErasureReport legs (not a denylist): the erasure proceeds to its final audit ONLY when the C2
// report has a non-empty leg set and EVERY leg is `complete`, with two deliberate exceptions —
//   • `scrub_pending` may be `owed`: it is a legitimate hand-off TO THIS SLICE (the multi-entity content scrub), which
//     C10 then fulfils; and
//   • `escalation_emit` may be `failed`: that is C2's non-fatal observability emit (C2 keeps its `done` verdict when
//     only that leg fails), so holding on it would strand a genuinely-complete erasure forever.
// ANY other status — `failed`/`blocked`, an `owed` on a non-scrub leg, an unknown status, or an EMPTY leg list — is
// treated as partial/failed/indeterminate → HOLD the request + escalate + write NO done-audit + do NOT mark executed
// (AC-10.DEL.003.4). An allowlist (not a denylist) is what makes "indeterminate blocks" true.
//
// Fail-closed everywhere: frozen deployment, an unreadable freeze state, a config read failure, a connector-detection
// error, a residue re-read that is non-zero, a scrub that would empty an entity_ids array, and an audit-write failure
// ALL hold + escalate rather than silently completing.

import { checkExecutorAuthorization } from './authorize.ts';
import { DEFAULT_DELETION_WORKFLOW_CONFIG, type DeletionWorkflowConfig } from './config.ts';
import { detectAndRaiseConnectorFlags } from './connectors.ts';
import { checkDeploymentFreeze, DeploymentFrozenError } from './freeze.ts';
import { identifyAffectedRecords, redactionTerms, type ErasureSubject } from './identify.ts';
import { redactContent } from './scrub.ts';
import type { ConnectorPresencePort, DeletionWorkflowStore, ErasureAuthz, ErasureMechanismPort, ErasureReport, ErasureLeg } from './store.ts';

export interface ExecuteErasureDeps {
  store: DeletionWorkflowStore;
  /** the injected ISSUE-029 C2 mechanism — `(t, a) => eraseTarget(realDeps, t, a)` in the live wiring. */
  mechanism: ErasureMechanismPort;
  connectorPresence: ConnectorPresencePort;
  /** load the LIVE deletion config (audit-retention floor etc.). A THROW is caught → the fail-closed default. */
  loadConfig: () => Promise<DeletionWorkflowConfig>;
  now: () => string;
}

export interface ExecuteErasureInput {
  requestId: string;
  /** the resolved target entity_id the erasure runs against (workflow-resolved in-flight; OD-206). */
  targetEntityId: string;
  /** the lawful basis / reason — mandatory (Personal/Restricted access is reason-gated, NFR-SEC.016). */
  reason: string;
  /** name + identifiers for the Step-1 probabilistic (name-in-content) sweep + the redaction term set. */
  subject: ErasureSubject;
  /** the C2 gate authz (Super-Admin + PERM-memory.delete + erasureConfirmed) — passed through to eraseTarget. Its
   *  actorIdentity MUST equal executorId (the destructive act runs as the vetted executor, not a decoupled identity). */
  authz: ErasureAuthz;
  /** the actor executing the erasure — must hold PERM-memory.delete + be distinct from the two persisted authorisers. */
  executorId: string;
  executorPermissions: readonly string[];
  /** memory ids the admin CONFIRMED for content redaction (class-b matches + retained-row content mentions). Nothing
   *  is content-scrubbed without an id here (AC-10.DEL.004.1 — human-confirmed, never auto). */
  confirmedScrubIds?: readonly string[];
}

export interface ExecuteErasureResult {
  /** true ONLY if fully verified complete AND the immutable audit was written AND the request marked executed. */
  done: boolean;
  status: 'executed' | 'held';
  requestId: string;
  /** why the erasure was held (empty when done). */
  reasons: string[];
  erasureReport: ErasureReport | null;
  dispositions: { hardDeleted: number; idRemoved: number; redacted: number };
  connectorFlagsRaised: string[];
  escalated: boolean;
}

/** The verify-before-done ALLOWLIST: a C2 leg is acceptable only if complete, OR it is the scrub_pending leg this
 *  slice fulfils (owed), OR it is C2's non-fatal observability emit (escalation_emit failed). Everything else blocks. */
function legAcceptable(l: ErasureLeg): boolean {
  return l.status === 'complete' || (l.leg === 'scrub_pending' && l.status === 'owed') || (l.leg === 'escalation_emit' && l.status === 'failed');
}

export async function executeErasure(deps: ExecuteErasureDeps, input: ExecuteErasureInput): Promise<ExecuteErasureResult> {
  const { store, mechanism, connectorPresence, loadConfig, now } = deps;
  const empty = { hardDeleted: 0, idRemoved: 0, redacted: 0 };
  const held = async (reasons: string[], report: ErasureReport | null, dispositions = empty, flags: string[] = []): Promise<ExecuteErasureResult> => {
    // best-effort loud signal — a failing observability write must NOT turn a structured hold into a promise rejection
    // (the caller still gets the held result; the emit failure is itself surfaced, never silent).
    try {
      await store.emitLifecycle('deletion_request_held', input.requestId, { reasons });
    } catch {
      /* the hold stands regardless of the emit; the durable state is the un-executed request + no done-audit. */
    }
    return { done: false, status: 'held', requestId: input.requestId, reasons, erasureReport: report, dispositions, connectorFlagsRaised: flags, escalated: true };
  };

  // ── Step 3: frozen-deployment guard (FR-10.DEL.007). Fail-closed on an unreadable freeze state (never assume live). ──
  let frozenAt: string | null;
  try {
    ({ frozenAt } = await checkDeploymentFreeze(store));
  } catch (e) {
    return held([`freeze_read_failed:${errMsg(e)}`], null);
  }
  if (frozenAt !== null) {
    try {
      await store.emitLifecycle('deletion_request_blocked_frozen', input.requestId, { frozen_at: frozenAt });
    } catch {
      /* best-effort */
    }
    throw new DeploymentFrozenError(frozenAt);
  }

  // ── Config (fail-closed on throw). Used for the audit-retention floor + narrative; the two-person requirement is
  //    unconditional (DB-mandated), so a config read failure can never loosen it. ──
  let cfg: DeletionWorkflowConfig;
  try {
    cfg = await loadConfig();
  } catch {
    cfg = { ...DEFAULT_DELETION_WORKFLOW_CONFIG };
    await store.emitLifecycle('deletion_config_fail_closed', input.requestId, { reason: 'config read failed — fail-closed defaults' }).catch(() => {});
  }
  void cfg; // individualDeletionAuditYears is enforced by the C7 retention floor; carried for the audit record's context.

  // ── Read the PERSISTED request: the two authorisers were written by their own perm-checked authorise steps
  //    (authorize.ts). The executor NEVER supplies authoriser ids — the gate reads them from the request, so a single
  //    admin cannot fabricate a second authoriser (the verify B1 finding). ──
  const request = await store.getRequest(input.requestId);
  if (!request) return held(['request_not_found'], null);

  // ── Authorisation gate: executor holds the perm; three DISTINCT non-null identities; and the destructive identity
  //    (authz.actorIdentity) is the vetted executor, not a decoupled one. Two-person is unconditional. ──
  const authVerdict = checkExecutorAuthorization({
    executorId: input.executorId,
    executorPermissions: input.executorPermissions,
    authorizedBy: request.authorizedBy,
    secondAuthoriserId: request.secondAuthoriserId,
  });
  if (!authVerdict.allowed) return held([`authorisation:${authVerdict.reasons.join(',')}`], null);
  if (input.authz.actorIdentity !== input.executorId) return held(['authz_identity_not_executor'], null);

  // ── Record the executor on the request BEFORE the destructive act (a crash mid-erasure still names who ran it). The
  //    DB CHECK (executor distinct from both authorisers) is re-asserted here. ──
  try {
    await store.updateRequest(input.requestId, { executorId: input.executorId });
  } catch (e) {
    return held([`executor_persist_failed:${errMsg(e)}`], null);
  }

  // ── Step 1: identify (deterministic + probabilistic-for-confirmation). Wrapped so a Step-1 store error holds
  //    uniformly (never a bare rejection that leaves the request authorised with no held signal). ──
  let ident;
  try {
    ident = await identifyAffectedRecords(store, input.targetEntityId, input.subject);
    await store.emitLifecycle('deletion_records_identified', input.requestId, { deterministic: ident.counts.deterministic, probabilistic: ident.counts.probabilistic, search_terms: ident.searchTerms.length });
  } catch (e) {
    return held([`identify_failed:${errMsg(e)}`], null);
  }

  // ── Step 6(a): connector-presence detection + flag raise. Detection OR raise error ⇒ fail closed (block until resolved). ──
  const flagResult = await detectAndRaiseConnectorFlags(store, connectorPresence, input.requestId, input.targetEntityId);
  if (flagResult.detectionError) {
    return held([`connector_detection_error:${flagResult.detectionErrorDetail ?? 'unknown'}`], null, empty, flagResult.raised);
  }

  // ── Invoke the C2 mechanism (ISSUE-029 eraseTarget). A throw (e.g. the C2 gate rejecting a non-Super-Admin) is
  //    caught and surfaced as held — a destructive-mechanism error must never be swallowed. ──
  let report: ErasureReport;
  try {
    report = await mechanism.erase({ targetEntityId: input.targetEntityId, requestId: input.requestId, reason: input.reason }, input.authz);
  } catch (e) {
    return held([`c2_mechanism_threw:${errMsg(e)}`], null, empty, flagResult.raised);
  }

  // ── Verify-before-done ALLOWLIST (AC-10.DEL.003.4): an empty leg set or any non-acceptable leg blocks. ──
  if (report.legs.length === 0) {
    return held(['c2_empty_report'], report, { hardDeleted: report.hardDeleted.length, idRemoved: 0, redacted: 0 }, flagResult.raised);
  }
  const blocking = report.legs.filter((l) => !legAcceptable(l));
  if (blocking.length > 0) {
    return held([`c2_incomplete:${blocking.map((l) => `${l.leg}=${l.status}`).join(',')}`], report, { hardDeleted: report.hardDeleted.length, idRemoved: 0, redacted: 0 }, flagResult.raised);
  }

  // ── Step 2–4: de-link the target from EVERY memory that still references it after the C2 delete, then scrub. C2's
  //    remit is the target's PERSONAL rows only (delete single-entity/derived, retain Personal multi-entity); but
  //    FR-10.DEL.003's deterministic set is every memory whose entity_ids[] contains the target REGARDLESS of
  //    sensitivity. Rows still referencing the target after C2 = the Personal multi-entity rows C2 retained + NON-
  //    Personal business records outside C2's remit. Both are de-identified (remove the target entity_id, retaining the
  //    row — a business record is never hard-deleted, #1); content is redacted only where the admin confirmed the
  //    mention (AC-10.DEL.004.1), against the NARROW redaction term set (full name + identifiers) so a third party's
  //    "John" in a retained row is never nuked (the verify M1 finding). ──
  const confirmed = new Set(input.confirmedScrubIds ?? []);
  const redactTerms = redactionTerms(input.subject);
  let idRemoved = 0;
  let redacted = 0;
  try {
    const stillReferencing = await store.deterministicMemoryIds(input.targetEntityId); // post-C2-delete residual set
    const handled = new Set(stillReferencing); // so the probabilistic loop never re-touches a de-linked row
    for (const id of stillReferencing) {
      const m = await store.getMemory(id);
      if (!m) continue; // already gone — idempotent
      if (m.entity_ids.length <= 1) {
        // removing the last entity_id would violate memories' cardinality(entity_ids)>=1. A Personal single-entity row
        // should have been C2-hard-deleted; a NON-Personal single-entity-target row is a #2 tagging anomaly (a memory
        // solely about the target, mis-tagged non-Personal). Surface it — NEVER force an empty array or a silent skip.
        return held([`single_entity_residue:${id}_references_only_target_but_survived_c2`], report, { hardDeleted: report.hardDeleted.length, idRemoved, redacted }, flagResult.raised);
      }
      const doRedact = confirmed.has(id);
      const { redacted: content, replacements } = doRedact ? redactContent(m.content, redactTerms) : { redacted: m.content, replacements: 0 };
      await store.scrubMemory(id, input.targetEntityId, content, /* removeEntityId */ true); // throws (→ held) if it would empty the array
      idRemoved += 1;
      if (doRedact && replacements > 0) redacted += 1; // only count a redaction that actually replaced content (no overstated audit count)
    }
    // confirmed probabilistic content-only matches (name-in-content, never in entity_ids): redact content, no id to
    // remove. Skip anything already de-linked above (the `handled` set is the reliable guard). Skip a no-op (0
    // replacements ⇒ only a paraphrase the narrow terms can't reach — the residual review burden, not a silent scrub).
    for (const id of confirmed) {
      if (handled.has(id)) continue;
      const m = await store.getMemory(id);
      if (!m || m.entity_ids.includes(input.targetEntityId)) continue; // any remaining deterministic row: C2's remit
      const { redacted: content, replacements } = redactContent(m.content, redactTerms);
      if (replacements === 0) continue;
      await store.scrubMemory(id, input.targetEntityId, content, /* removeEntityId */ false);
      redacted += 1;
    }
  } catch (e) {
    return held([`scrub_failed:${errMsg(e)}`], report, { hardDeleted: report.hardDeleted.length, idRemoved, redacted }, flagResult.raised);
  }

  // ── Verify-before-done residue re-read (BEFORE the entity-record delete, so a TOCTOU insert never leaves a memory
  //    pointing at a just-deleted entity): no memory may still reference the erased entity_id. A non-zero residue is
  //    the #2 failure — hold + escalate. ──
  const residual = await store.deterministicMemoryIds(input.targetEntityId);
  if (residual.length > 0) {
    return held([`residue_after_erasure:${residual.length}_memories_still_reference_target`], report, { hardDeleted: report.hardDeleted.length, idRemoved, redacted }, flagResult.raised);
  }

  // ── Step 3: hard-delete the entity record (AC-10.DEL.003.2) — the LAST destructive step, now that no memory
  //    references it and the residue re-read passed. ──
  try {
    if (ident.entityExists) await store.hardDeleteEntityRecord(input.targetEntityId);
  } catch (e) {
    return held([`entity_delete_failed:${errMsg(e)}`], report, { hardDeleted: report.hardDeleted.length, idRemoved, redacted }, flagResult.raised);
  }

  // ── Step 5: the immutable deletion audit (FR-10.DEL.005). A failure to write it FAILS THE ERASURE CLOSED
  //    (AC-10.DEL.005.3). The requester is the REAL intake requester (request.requesterId), not the executor. (Note:
  //    the C2 mechanism has already written its own access_audit tombstone inside eraseTarget, so the erasure is not
  //    audit-less even here — this is the C10 workflow-level record on top of it.) ──
  const executedAt = now();
  const dispositions = { hardDeleted: report.hardDeleted.length, idRemoved, redacted };
  try {
    await store.writeDeletionAudit({
      requestId: input.requestId,
      requesterId: request.requesterId,
      authorizedBy: request.authorizedBy,
      secondAuthoriserId: request.secondAuthoriserId,
      executorId: input.executorId,
      actorIdentity: input.authz.actorIdentity,
      originatingUserId: input.authz.originatingUserId,
      targetEntityId: input.targetEntityId,
      legalBasis: input.reason,
      executedAt,
      hardDeletedCount: dispositions.hardDeleted,
      idRemovedCount: dispositions.idRemoved,
      redactedCount: dispositions.redacted,
      done: true,
    });
  } catch (e) {
    return held([`audit_write_failed:${errMsg(e)}`], report, dispositions, flagResult.raised);
  }

  // ── Mark executed (triggers the all-three-non-null CHECK) + emit the loud complete signal. ──
  try {
    await store.updateRequest(input.requestId, { status: 'executed', executedAt });
  } catch (e) {
    // the audit is written but the status flip failed — surface loudly (the erasure DID complete + is audited, but the
    // queue row is not marked). Held so a human reconciles; never silently "done" with a stale queue row.
    return held([`status_flip_failed:${errMsg(e)}`], report, dispositions, flagResult.raised);
  }
  await store.emitLifecycle('deletion_request_executed', input.requestId, { target_entity_id: input.targetEntityId, ...dispositions, connector_flags: flagResult.raised }).catch(() => {});

  return {
    done: true,
    status: 'executed',
    requestId: input.requestId,
    reasons: [],
    erasureReport: report,
    dispositions,
    connectorFlagsRaised: flagResult.raised,
    escalated: false,
  };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
