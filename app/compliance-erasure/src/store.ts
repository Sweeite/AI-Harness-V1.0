// ISSUE-082 (C10) — Individual right-to-erasure WORKFLOW. The store port + injected mechanism ports + InMemory fakes.
//
// This slice is the request-to-audit workflow that WRAPS the ISSUE-029 (C2) memory-side transitive delete. It owns:
// the Admin deletion queue + escalation, two-class identification (deterministic entity_id vs human-confirmed
// name-in-content), two-person authorisation (DB-enforced distinctness), the frozen-deployment guard, the
// connector-deletion flags, the content scrub of RETAINED multi-entity rows, and — the crux — the verify-before-done
// gate across the C10→C2 boundary (AC-10.DEL.003.4): it NEVER writes the "done" audit until the C2 mechanism reported
// its destructive legs complete. It does NOT re-implement the transitive walk — it CALLS eraseTarget (injected as
// ErasureMechanismPort) and reads its ErasureReport.
//
// The fakes mirror the live adapter's SQL 1:1 at the method boundary so a green offline suite predicts live (R10).

import type { ErasureAuthz, ErasureLeg, ErasureReport, ErasureTarget } from '../../memory-erasure/src/index.ts';

export type { ErasureAuthz, ErasureLeg, ErasureReport, ErasureTarget };

// ── The permission node this workflow's authorise/execute path requires (homed in C1, consumed here) ─────────────
export const PERM_MEMORY_DELETE = 'PERM-memory.delete' as const;

// ── deletion_requests lifecycle (schema §14 enum: received | authorised | executed | rejected) ───────────────────
export type DeletionStatus = 'received' | 'authorised' | 'executed' | 'rejected';

/** A row of the Admin deletion queue (DATA-deletion_requests, schema §14). See OD-206: the erasure runs against a
 *  resolved `targetEntityId` (the C2 mechanism's remit); `targetUserId` is the profiles subject when the subject is
 *  ALSO a platform user (else null), persisted to the `target_user_id` column. The entity-level erasure PROOF is the
 *  immutable access_audit tombstone (target_entity_id), not this tracker row. */
export interface DeletionRequest {
  id: string;
  requesterId: string;
  /** the profiles subject when the subject is a platform user; null for a non-user data subject (OD-206). */
  targetUserId: string | null;
  /** the resolved entity_id the erasure executes against (workflow-resolved; not a persisted column — OD-206). */
  targetEntityId: string;
  legalBasis: string | null;
  status: DeletionStatus;
  authorizedBy: string | null;
  secondAuthoriserId: string | null;
  executorId: string | null;
  executedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The intake payload (FR-10.DEL.001) — requester + legal basis + resolved target. */
export interface DeletionRequestIntake {
  requesterId: string;
  targetUserId: string | null;
  targetEntityId: string;
  legalBasis: string | null;
}

// ── connector_deletion_flags (schema §14) — the tracked-until-acknowledged SoR reminder (FR-10.DEL.006(a)) ─────────
export type ConnectorFlagState = 'raised' | 'acknowledged' | 'resolved';
export interface ConnectorDeletionFlag {
  id: string;
  deletionRequestId: string;
  connector: string;
  state: ConnectorFlagState;
  raisedAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  escalatedAt: string | null;
}

// ── A minimal memory row shape for identification + scrubbing (a slice of DATA-memories) ─────────────────────────
export interface WorkflowMemoryRow {
  id: string;
  content: string;
  entity_ids: string[];
  sensitivity: 'standard' | 'confidential' | 'personal' | 'restricted';
}

/** The immutable deletion audit record (FR-10.DEL.005) — who/authoriser/executor/when + the three disposition
 *  counts. Written to access_audit (append-only, schema §2). Contains NO erased PII (counts only). */
export interface DeletionAuditEntry {
  requestId: string;
  requesterId: string;
  authorizedBy: string | null;
  secondAuthoriserId: string | null;
  executorId: string | null;
  actorIdentity: string;
  originatingUserId: string | null;
  targetEntityId: string;
  legalBasis: string | null;
  executedAt: string;
  /** the disposition split (AC-10.DEL.005.1). */
  hardDeletedCount: number;
  idRemovedCount: number;
  redactedCount: number;
  /** whether this is a completed erasure ('memory_erasure_complete') or a held/partial one — never falsely "done". */
  done: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// The workflow store port — the queue, identification reads, scrub writes, entity delete, connector flags, freeze
// read, and the immutable audit write. Every destructive memory mutation is routed through the C2 sole-writer path;
// the entity-record delete + the content scrub are the C10-owned governed writes.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface DeletionWorkflowStore {
  // ── Queue (FR-10.DEL.001) ──
  createRequest(intake: DeletionRequestIntake): Promise<DeletionRequest>;
  getRequest(id: string): Promise<DeletionRequest | null>;
  /** set authorisers/executor + status; the DB CHECKs enforce distinctness (AC-10.DEL.006.2). */
  updateRequest(id: string, patch: Partial<Pick<DeletionRequest, 'status' | 'authorizedBy' | 'secondAuthoriserId' | 'executorId' | 'executedAt'>>): Promise<DeletionRequest>;
  /** the request-escalation sweep — DERIVED, not stamped (deletion_requests has no escalated_at column, unlike the
   *  connector flags). Returns the ids of un-actioned requests (status received|authorised) older than the window. The
   *  caller emits a cadence alert per id; the overdue badge is derived from created_at on the surface, so the state is
   *  correct regardless of alerting. Re-returning a still-overdue request is intentional (a legal clock nags until
   *  actioned) — never silent expiry (AC-10.DEL.001.2). */
  overdueRequests(escalationDays: number, now: number): Promise<string[]>;

  // ── Step 1 identification (FR-10.DEL.002) ──
  /** the DETERMINISTIC set: every memory whose entity_ids[] contains the target (auto-actioned by the C2 walk). */
  deterministicMemoryIds(targetEntityId: string): Promise<string[]>;
  /** does the target's entity record exist? (for the entity-record delete + the audit). */
  entityExists(targetEntityId: string): Promise<boolean>;
  /** the recall-oriented PROBABILISTIC sweep (AF-134): memories whose CONTENT matches any search term (name variants
   *  + identifiers), EXCLUDING rows already in the deterministic set. Returned raw — surfaced for human confirmation,
   *  NEVER auto-actioned (AC-10.DEL.002.2). */
  probabilisticContentMatches(terms: string[], excludeIds: string[]): Promise<WorkflowMemoryRow[]>;

  // ── Step 4 content scrub (FR-10.DEL.004) — via the C2 sole-writer path ──
  /** read a memory (to redact its content + confirm it is retained/multi-entity). */
  getMemory(id: string): Promise<WorkflowMemoryRow | null>;
  /** the governed in-place scrub: replace content + (for a deterministic retained row) remove the target entity_id
   *  from entity_ids[]. Returns the resulting entity_ids (so the caller can detect an emptied array). */
  scrubMemory(id: string, targetEntityId: string, redactedContent: string, removeEntityId: boolean): Promise<{ entity_ids: string[] }>;

  // ── Step 3 entity-record delete (FR-10.DEL.003 / AC-10.DEL.003.2) ──
  /** hard-delete the person's entity record (after all its memory references are gone). Idempotent. */
  hardDeleteEntityRecord(targetEntityId: string): Promise<{ deleted: boolean }>;

  // ── Step 6 connector flags (FR-10.DEL.006(a)) ──
  raiseConnectorFlag(deletionRequestId: string, connector: string): Promise<ConnectorDeletionFlag>;
  listConnectorFlags(deletionRequestId: string): Promise<ConnectorDeletionFlag[]>;
  acknowledgeConnectorFlag(flagId: string, acknowledgedBy: string): Promise<ConnectorDeletionFlag>;
  escalateOverdueConnectorFlags(escalationDays: number, now: number): Promise<string[]>;

  // ── Frozen-deployment guard (FR-10.DEL.007) ──
  readDeploymentFrozenAt(): Promise<string | null>;

  // ── Step 5 immutable audit (FR-10.DEL.005) ──
  writeDeletionAudit(entry: DeletionAuditEntry): Promise<void>;

  // ── Observability (request lifecycle → event_log) ──
  emitLifecycle(event: string, requestId: string, detail: Record<string, unknown>): Promise<void>;
}

/** The injected C2 mechanism (ISSUE-029 eraseTarget). The workflow CALLS it and reads its completeness verdict; the
 *  live wiring binds `(t, a) => eraseTarget(realDeps, t, a)`. Keeping it a port means this slice's tests never wire
 *  029's full destructive dependency graph — they verify the WORKFLOW's handling of every ErasureReport shape. */
export interface ErasureMechanismPort {
  erase(target: ErasureTarget, authz: ErasureAuthz): Promise<ErasureReport>;
}

/** Connector-presence detection (FR-10.DEL.006(a)). Returns the connectors holding the person's data. A THROW is a
 *  detection error → the workflow fails CLOSED (AC-10.DEL.006.4): the erasure cannot complete until it is resolved,
 *  never silently producing no flag (the #2 "forgotten connector deletion"). */
export interface ConnectorPresencePort {
  detect(targetEntityId: string): Promise<string[]>;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// InMemory reference fakes — mirror the live adapter's SQL semantics at the method boundary (R10 parity).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export class InMemoryDeletionWorkflowStore implements DeletionWorkflowStore {
  readonly requests = new Map<string, DeletionRequest>();
  readonly flags = new Map<string, ConnectorDeletionFlag>();
  readonly memories = new Map<string, WorkflowMemoryRow>();
  readonly entities = new Set<string>();
  readonly audits: DeletionAuditEntry[] = [];
  readonly lifecycle: { event: string; requestId: string; detail: Record<string, unknown> }[] = [];
  frozenAt: string | null = null;
  private seq = 0;

  constructor(private readonly now: () => string = () => '2026-07-11T00:00:00.000Z') {}

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  // test helpers ---------------------------------------------------------------------------------------------------
  putMemory(row: WorkflowMemoryRow): WorkflowMemoryRow {
    this.memories.set(row.id, { ...row, entity_ids: [...row.entity_ids] });
    return row;
  }
  putEntity(id: string): void {
    this.entities.add(id);
  }

  // queue ----------------------------------------------------------------------------------------------------------
  async createRequest(intake: DeletionRequestIntake): Promise<DeletionRequest> {
    const t = this.now();
    const req: DeletionRequest = {
      id: this.id('req'),
      requesterId: intake.requesterId,
      targetUserId: intake.targetUserId,
      targetEntityId: intake.targetEntityId,
      legalBasis: intake.legalBasis,
      status: 'received',
      authorizedBy: null,
      secondAuthoriserId: null,
      executorId: null,
      executedAt: null,
      createdAt: t,
      updatedAt: t,
    };
    this.requests.set(req.id, req);
    return { ...req };
  }

  async getRequest(id: string): Promise<DeletionRequest | null> {
    const r = this.requests.get(id);
    // R10 parity: the live adapter cannot round-trip targetEntityId (OD-206 — no persisted column), so a read-back
    // returns '' for it. Mirror that here so an offline suite sees the same shape a live getRequest returns. (The
    // workflow carries the resolved targetEntityId in-flight; it never sources it from a round-tripped getRequest.)
    return r ? { ...r, targetEntityId: '' } : null;
  }

  async updateRequest(id: string, patch: Partial<Pick<DeletionRequest, 'status' | 'authorizedBy' | 'secondAuthoriserId' | 'executorId' | 'executedAt'>>): Promise<DeletionRequest> {
    const r = this.requests.get(id);
    if (!r) throw new Error(`deletion_request ${id} not found`);
    // mirror the DB CHECKs (AC-10.DEL.006.2): distinctness + all-three-non-null at 'executed'. Fail-loud on a violation.
    const next: DeletionRequest = { ...r, ...patch, updatedAt: this.now() };
    assertDistinctness(next);
    this.requests.set(id, next);
    return { ...next };
  }

  async overdueRequests(escalationDays: number, now: number): Promise<string[]> {
    const cutoff = now - escalationDays * 86400_000;
    const overdue: string[] = [];
    for (const r of this.requests.values()) {
      const open = r.status === 'received' || r.status === 'authorised';
      if (open && Date.parse(r.createdAt) <= cutoff) overdue.push(r.id);
    }
    return overdue;
  }

  // identification -------------------------------------------------------------------------------------------------
  async deterministicMemoryIds(targetEntityId: string): Promise<string[]> {
    return [...this.memories.values()].filter((m) => m.entity_ids.includes(targetEntityId)).map((m) => m.id);
  }

  async entityExists(targetEntityId: string): Promise<boolean> {
    return this.entities.has(targetEntityId);
  }

  async probabilisticContentMatches(terms: string[], excludeIds: string[]): Promise<WorkflowMemoryRow[]> {
    const exclude = new Set(excludeIds);
    // mirror the live filter 1:1 (supabase-store: trim + length>=2) so the fake and the ILIKE-any SQL agree (R10).
    const needles = terms.map((t) => t.trim().toLowerCase()).filter((t) => t.length >= 2);
    return [...this.memories.values()]
      .filter((m) => !exclude.has(m.id))
      .filter((m) => needles.some((n) => m.content.toLowerCase().includes(n)))
      .map((m) => ({ ...m, entity_ids: [...m.entity_ids] }));
  }

  // scrub ----------------------------------------------------------------------------------------------------------
  async getMemory(id: string): Promise<WorkflowMemoryRow | null> {
    const m = this.memories.get(id);
    return m ? { ...m, entity_ids: [...m.entity_ids] } : null;
  }

  async scrubMemory(id: string, targetEntityId: string, redactedContent: string, removeEntityId: boolean): Promise<{ entity_ids: string[] }> {
    const m = this.memories.get(id);
    if (!m) throw new Error(`memory ${id} not found for scrub`);
    const nextEntityIds = removeEntityId ? m.entity_ids.filter((e) => e !== targetEntityId) : m.entity_ids;
    // mirror the live memories cardinality(entity_ids)>=1 CHECK: de-linking the last id would empty the array and
    // throw live (caught as scrub_failed → held). A duplicate-target row ([target,target]) is exactly this case — the
    // fake must throw too, or an offline suite would fake-pass where live holds (R10) + leave an orphaned row (#1).
    if (nextEntityIds.length === 0) throw new Error(`memories cardinality CHECK: scrubbing ${id} would empty entity_ids (de-linking the last reference)`);
    m.content = redactedContent;
    if (removeEntityId) m.entity_ids = nextEntityIds;
    return { entity_ids: [...m.entity_ids] };
  }

  // entity delete --------------------------------------------------------------------------------------------------
  async hardDeleteEntityRecord(targetEntityId: string): Promise<{ deleted: boolean }> {
    return { deleted: this.entities.delete(targetEntityId) };
  }

  // connector flags ------------------------------------------------------------------------------------------------
  async raiseConnectorFlag(deletionRequestId: string, connector: string): Promise<ConnectorDeletionFlag> {
    // idempotent per (request, connector): a re-raise returns the existing open flag.
    const existing = [...this.flags.values()].find((f) => f.deletionRequestId === deletionRequestId && f.connector === connector && f.state !== 'resolved');
    if (existing) return { ...existing };
    const flag: ConnectorDeletionFlag = {
      id: this.id('flag'),
      deletionRequestId,
      connector,
      state: 'raised',
      raisedAt: this.now(),
      acknowledgedAt: null,
      acknowledgedBy: null,
      escalatedAt: null,
    };
    this.flags.set(flag.id, flag);
    return { ...flag };
  }

  async listConnectorFlags(deletionRequestId: string): Promise<ConnectorDeletionFlag[]> {
    return [...this.flags.values()].filter((f) => f.deletionRequestId === deletionRequestId).map((f) => ({ ...f }));
  }

  async acknowledgeConnectorFlag(flagId: string, acknowledgedBy: string): Promise<ConnectorDeletionFlag> {
    const f = this.flags.get(flagId);
    if (!f) throw new Error(`connector flag ${flagId} not found`);
    f.state = 'acknowledged';
    f.acknowledgedAt = this.now();
    f.acknowledgedBy = acknowledgedBy;
    return { ...f };
  }

  async escalateOverdueConnectorFlags(escalationDays: number, now: number): Promise<string[]> {
    const cutoff = now - escalationDays * 86400_000;
    const escalated: string[] = [];
    for (const f of this.flags.values()) {
      if (f.state === 'raised' && f.escalatedAt === null && Date.parse(f.raisedAt) <= cutoff) {
        f.escalatedAt = this.now();
        escalated.push(f.id);
      }
    }
    return escalated;
  }

  // freeze ---------------------------------------------------------------------------------------------------------
  async readDeploymentFrozenAt(): Promise<string | null> {
    return this.frozenAt;
  }

  // audit + observability ------------------------------------------------------------------------------------------
  async writeDeletionAudit(entry: DeletionAuditEntry): Promise<void> {
    this.audits.push({ ...entry });
  }

  async emitLifecycle(event: string, requestId: string, detail: Record<string, unknown>): Promise<void> {
    this.lifecycle.push({ event, requestId, detail });
  }
}

/** Mirror of the deletion_requests two-person-auth CHECK constraints (schema §14). The DB is the real guarantee; this
 *  keeps the fake honest so a distinctness violation fails offline exactly as it would live (R10). */
export function assertDistinctness(r: DeletionRequest): void {
  const { authorizedBy: a, secondAuthoriserId: s, executorId: e, status } = r;
  if (s !== null && a !== null && s === a) throw new Error('deletion_requests CHECK: second_authoriser_id must be distinct from authorized_by');
  if (e !== null && a !== null && e === a) throw new Error('deletion_requests CHECK: executor_id must be distinct from authorized_by');
  if (e !== null && s !== null && e === s) throw new Error('deletion_requests CHECK: executor_id must be distinct from second_authoriser_id');
  if (status === 'executed' && (a === null || s === null || e === null)) {
    throw new Error('deletion_requests CHECK: status=executed requires authorized_by, second_authoriser_id, executor_id all non-null');
  }
}

/** An InMemory ErasureMechanismPort backed by the real ISSUE-029 InMemoryErasureStore + a scripted set of fan-out leg
 *  outcomes. Tests use it to assert the workflow's handling of every ErasureReport shape (done / owed-scrub / failed).
 *  It is intentionally thin — the C2 mechanism's own correctness is proven in app/memory-erasure (AF-137). */
export class ScriptedErasureMechanism implements ErasureMechanismPort {
  constructor(private readonly fn: (target: ErasureTarget, authz: ErasureAuthz) => Promise<ErasureReport> | ErasureReport) {}
  async erase(target: ErasureTarget, authz: ErasureAuthz): Promise<ErasureReport> {
    return this.fn(target, authz);
  }
}
