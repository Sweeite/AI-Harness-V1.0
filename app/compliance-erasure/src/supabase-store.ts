// ISSUE-082 — the live pg adapter for the C10 right-to-erasure workflow (DeletionWorkflowStore over the real schema).
//
// Every method mirrors the InMemory fake 1:1 at the boundary (R10). This adapter carries NO destructive memory
// statement of its own — the sole `delete from memories` is ISSUE-029's (C2, invoked as the mechanism port); the
// governed writes here are the queue rows (deletion_requests), the connector flags, the in-place content scrub +
// entity-id de-link on memories (the sole-writer path, ADR-004), the entity-record delete, and the immutable
// access_audit deletion record. It adds NO migration + NO event_type value (schema §14 is 0001 baseline; the erasure
// event_types are 029's 0046) — so lifecycle emits MAP onto EXISTING event_type enum values (no 22P02, R10).

import pg from 'pg';
import type {
  ConnectorDeletionFlag,
  DeletionAuditEntry,
  DeletionRequest,
  DeletionRequestIntake,
  DeletionWorkflowStore,
  WorkflowMemoryRow,
} from './store.ts';

export type QueryExec = <R extends pg.QueryResultRow>(text: string, params?: unknown[]) => Promise<{ rows: R[]; rowCount?: number | null }>;

// ── The additive event_type values this slice's lifecycle observability writes (migration 0047). event_type is a
//    FIXED enum with no deletion-workflow members, so a live event_log insert of an unregistered value throws 22P02
//    (the fake-passes/live-throws class R10 + the offline check gate catch). Each C10 lifecycle event gets its OWN
//    honest type (no conflation with an unrelated signal). The two ESCALATION events reuse the baseline
//    `approval_queue_stale` (both queues are approval queues — as ISSUE-028 does) → no new value for them. ──────────
export const DELETION_WORKFLOW_EVENT_TYPES: readonly string[] = [
  'deletion_request_received',
  'deletion_request_authorised',
  'deletion_request_second_authorised',
  'deletion_request_rejected',
  'deletion_records_identified',
  'deletion_config_fail_closed',
  'deletion_request_blocked_frozen',
  'deletion_request_held',
  'deletion_request_executed',
];

// ── Lifecycle → event_type map. Every value is either one of the 0047 additive values above or the baseline
//    `approval_queue_stale` (escalations). A live emit never throws 22P02 (asserted offline by the supabase-store test
//    against the migration corpus). An unmapped logical event falls back to `deletion_request_held` — a loud, valid
//    default (an unexpected event surfacing as a held/escalation signal is #3-safe, never silent). ────────────────
export const LIFECYCLE_EVENT_TYPE: Record<string, string> = {
  deletion_request_received: 'deletion_request_received',
  deletion_request_authorised: 'deletion_request_authorised',
  deletion_request_second_authorised: 'deletion_request_second_authorised',
  deletion_request_rejected: 'deletion_request_rejected',
  deletion_records_identified: 'deletion_records_identified',
  deletion_config_fail_closed: 'deletion_config_fail_closed',
  deletion_request_blocked_frozen: 'deletion_request_blocked_frozen',
  deletion_request_held: 'deletion_request_held',
  deletion_request_executed: 'deletion_request_executed',
  deletion_request_escalated: 'approval_queue_stale',
  connector_deletion_flag_escalated: 'approval_queue_stale',
};

interface RequestDbRow {
  id: string;
  requester_id: string;
  target_user_id: string | null;
  legal_basis: string | null;
  status: DeletionRequest['status'];
  authorized_by: string | null;
  second_authoriser_id: string | null;
  executor_id: string | null;
  executed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface FlagDbRow {
  id: string;
  deletion_request_id: string;
  connector: string;
  state: ConnectorDeletionFlag['state'];
  raised_at: Date;
  acknowledged_at: Date | null;
  acknowledged_by: string | null;
  escalated_at: Date | null;
}

const REQ_COLS = `id::text, requester_id::text, target_user_id::text, legal_basis, status,
  authorized_by::text, second_authoriser_id::text, executor_id::text, executed_at, created_at, updated_at`;
const FLAG_COLS = `id::text, deletion_request_id::text, connector, state, raised_at, acknowledged_at, acknowledged_by::text, escalated_at`;

export class SupabaseDeletionWorkflowStore implements DeletionWorkflowStore {
  /** the resolved target entity_id for the request being executed — OD-206: deletion_requests has no target_entity_id
   *  column, so the workflow carries the resolved entity_id in-flight. createRequest echoes the intake's value; a
   *  round-tripped getRequest returns '' for targetEntityId (the row does not persist it — the entity-level proof is
   *  the access_audit tombstone, target_entity_id). */
  constructor(private readonly exec: QueryExec) {}

  // queue ----------------------------------------------------------------------------------------------------------
  async createRequest(intake: DeletionRequestIntake): Promise<DeletionRequest> {
    const { rows } = await this.exec<RequestDbRow>(
      `insert into deletion_requests (requester_id, target_user_id, legal_basis, status)
         values ($1::uuid, $2::uuid, $3, 'received')
       returning ${REQ_COLS}`,
      [intake.requesterId, intake.targetUserId, intake.legalBasis],
    );
    return toRequest(rows[0]!, intake.targetEntityId);
  }

  async getRequest(id: string): Promise<DeletionRequest | null> {
    const { rows } = await this.exec<RequestDbRow>(`select ${REQ_COLS} from deletion_requests where id = $1::uuid`, [id]);
    return rows[0] ? toRequest(rows[0], '') : null;
  }

  async updateRequest(id: string, patch: Partial<Pick<DeletionRequest, 'status' | 'authorizedBy' | 'secondAuthoriserId' | 'executorId' | 'executedAt'>>): Promise<DeletionRequest> {
    // coalesce forward — a patch never NULLs a set field; the DB CHECKs enforce the two-person distinctness + the
    // all-three-non-null-at-executed guarantee (a violation throws here → surfaced by the caller as held).
    const { rows } = await this.exec<RequestDbRow>(
      `update deletion_requests set
         status               = coalesce($2, status),
         authorized_by        = coalesce($3::uuid, authorized_by),
         second_authoriser_id = coalesce($4::uuid, second_authoriser_id),
         executor_id          = coalesce($5::uuid, executor_id),
         executed_at          = coalesce($6, executed_at),
         updated_at           = now()
       where id = $1::uuid
       returning ${REQ_COLS}`,
      [id, patch.status ?? null, patch.authorizedBy ?? null, patch.secondAuthoriserId ?? null, patch.executorId ?? null, patch.executedAt ?? null],
    );
    if (!rows[0]) throw new Error(`deletion_request ${id} not found`);
    return toRequest(rows[0], '');
  }

  async overdueRequests(escalationDays: number, now: number): Promise<string[]> {
    const cutoff = new Date(now - escalationDays * 86400_000).toISOString();
    const { rows } = await this.exec<{ id: string }>(
      `select id::text as id from deletion_requests where status in ('received','authorised') and created_at <= $1::timestamptz`,
      [cutoff],
    );
    return rows.map((r) => r.id);
  }

  // identification -------------------------------------------------------------------------------------------------
  async deterministicMemoryIds(targetEntityId: string): Promise<string[]> {
    // every memory referencing the target — ALL sensitivities (FR-10.DEL.003 deterministic set), not just Personal.
    const { rows } = await this.exec<{ id: string }>(`select id::text as id from memories where $1::uuid = any(entity_ids)`, [targetEntityId]);
    return rows.map((r) => r.id);
  }

  async entityExists(targetEntityId: string): Promise<boolean> {
    const { rows } = await this.exec<{ n: string }>(`select count(*)::text as n from entities where id = $1::uuid`, [targetEntityId]);
    return Number(rows[0]?.n ?? 0) > 0;
  }

  async probabilisticContentMatches(terms: string[], excludeIds: string[]): Promise<WorkflowMemoryRow[]> {
    const needles = terms.map((t) => t.trim()).filter((t) => t.length >= 2);
    if (needles.length === 0) return [];
    // recall-oriented content match — case-insensitive ILIKE over any term, EXCLUDING the deterministic set. The
    // semantic (embedding) arm is the AF-134 seam; this keyword floor mirrors the fake's includes() 1:1.
    const { rows } = await this.exec<{ id: string; content: string; entity_ids: string[]; sensitivity: WorkflowMemoryRow['sensitivity'] }>(
      `select id::text as id, content, entity_ids, sensitivity
         from memories
        where id <> all($2::uuid[])
          and content ilike any($1::text[])`,
      [needles.map((n) => `%${n}%`), excludeIds],
    );
    return rows.map((r) => ({ id: r.id, content: r.content, entity_ids: r.entity_ids, sensitivity: r.sensitivity }));
  }

  // scrub ----------------------------------------------------------------------------------------------------------
  async getMemory(id: string): Promise<WorkflowMemoryRow | null> {
    const { rows } = await this.exec<{ id: string; content: string; entity_ids: string[]; sensitivity: WorkflowMemoryRow['sensitivity'] }>(
      `select id::text as id, content, entity_ids, sensitivity from memories where id = $1::uuid`,
      [id],
    );
    return rows[0] ? { id: rows[0].id, content: rows[0].content, entity_ids: rows[0].entity_ids, sensitivity: rows[0].sensitivity } : null;
  }

  async scrubMemory(id: string, targetEntityId: string, redactedContent: string, removeEntityId: boolean): Promise<{ entity_ids: string[] }> {
    // the governed in-place scrub (sole-writer path): set content + optionally de-link the target entity_id. The
    // array_remove is a no-op if the id is absent (idempotent). memories' cardinality(entity_ids)>=1 CHECK guarantees
    // we never empty the array here (the caller guards single-entity rows upstream → they never reach this UPDATE).
    const { rows } = await this.exec<{ entity_ids: string[] }>(
      `update memories
          set content = $2,
              entity_ids = case when $4 then array_remove(entity_ids, $3::uuid) else entity_ids end,
              updated_at = now()
        where id = $1::uuid
        returning entity_ids`,
      [id, redactedContent, targetEntityId, removeEntityId],
    );
    if (!rows[0]) throw new Error(`memory ${id} not found for scrub`);
    return { entity_ids: rows[0].entity_ids };
  }

  // entity delete --------------------------------------------------------------------------------------------------
  async hardDeleteEntityRecord(targetEntityId: string): Promise<{ deleted: boolean }> {
    const { rowCount } = await this.exec(`delete from entities where id = $1::uuid`, [targetEntityId]);
    return { deleted: (rowCount ?? 0) > 0 };
  }

  // connector flags ------------------------------------------------------------------------------------------------
  async raiseConnectorFlag(deletionRequestId: string, connector: string): Promise<ConnectorDeletionFlag> {
    // idempotent per (request, connector): return the existing open flag rather than raising a duplicate.
    const existing = await this.exec<FlagDbRow>(
      `select ${FLAG_COLS} from connector_deletion_flags where deletion_request_id = $1::uuid and connector = $2 and state <> 'resolved' limit 1`,
      [deletionRequestId, connector],
    );
    if (existing.rows[0]) return toFlag(existing.rows[0]);
    const { rows } = await this.exec<FlagDbRow>(
      `insert into connector_deletion_flags (deletion_request_id, connector, state)
         values ($1::uuid, $2, 'raised') returning ${FLAG_COLS}`,
      [deletionRequestId, connector],
    );
    return toFlag(rows[0]!);
  }

  async listConnectorFlags(deletionRequestId: string): Promise<ConnectorDeletionFlag[]> {
    const { rows } = await this.exec<FlagDbRow>(`select ${FLAG_COLS} from connector_deletion_flags where deletion_request_id = $1::uuid`, [deletionRequestId]);
    return rows.map(toFlag);
  }

  async acknowledgeConnectorFlag(flagId: string, acknowledgedBy: string): Promise<ConnectorDeletionFlag> {
    const { rows } = await this.exec<FlagDbRow>(
      `update connector_deletion_flags set state = 'acknowledged', acknowledged_at = now(), acknowledged_by = $2::uuid
        where id = $1::uuid returning ${FLAG_COLS}`,
      [flagId, acknowledgedBy],
    );
    if (!rows[0]) throw new Error(`connector flag ${flagId} not found`);
    return toFlag(rows[0]);
  }

  async escalateOverdueConnectorFlags(escalationDays: number, now: number): Promise<string[]> {
    const cutoff = new Date(now - escalationDays * 86400_000).toISOString();
    // stamp escalated_at (at-most-once — the state='raised' + null escalated_at predicate gates re-emit).
    const { rows } = await this.exec<{ id: string }>(
      `update connector_deletion_flags set escalated_at = now()
        where state = 'raised' and escalated_at is null and raised_at <= $1::timestamptz
        returning id::text as id`,
      [cutoff],
    );
    return rows.map((r) => r.id);
  }

  // freeze ---------------------------------------------------------------------------------------------------------
  async readDeploymentFrozenAt(): Promise<string | null> {
    const { rows } = await this.exec<{ frozen_at: Date | null }>(`select frozen_at from deployment_settings limit 1`);
    // the singleton is seeded at first boot; ZERO rows means the freeze state is UNREADABLE, not "not frozen". Throw so
    // the caller fails CLOSED (blocks the erasure) — an absent settings row must never read as a green light (#2/#3).
    if (rows.length === 0) throw new Error('deployment_settings singleton row absent — freeze state unreadable (fail closed)');
    return rows[0]!.frozen_at ? rows[0]!.frozen_at.toISOString() : null;
  }

  // audit + observability ------------------------------------------------------------------------------------------
  async writeDeletionAudit(entry: DeletionAuditEntry): Promise<void> {
    // the immutable deletion record (schema §2 access_audit, append-only). after_value carries the requester /
    // authoriser / executor identities + the three disposition counts — NO erased PII (AC-10.DEL.005.2).
    await this.exec(
      `insert into access_audit (audit_type, actor_identity, actor_type, action, target_type, target_entity_id, reason, path_context, originating_user_id, after_value)
         values ('individual_deletion', $1, 'user'::actor_type, $2, 'entity', $3::uuid, $4, $5, $6::uuid, $7::jsonb)`,
      [
        entry.actorIdentity,
        entry.done ? 'memory_erasure_complete' : 'memory_erasure_partial',
        entry.targetEntityId,
        entry.legalBasis,
        `deletion_request:${entry.requestId}`,
        entry.originatingUserId,
        JSON.stringify({
          request_id: entry.requestId,
          requester_id: entry.requesterId,
          authorized_by: entry.authorizedBy,
          second_authoriser_id: entry.secondAuthoriserId,
          executor_id: entry.executorId,
          executed_at: entry.executedAt,
          hard_deleted_count: entry.hardDeletedCount,
          id_removed_count: entry.idRemovedCount,
          redacted_count: entry.redactedCount,
          done: entry.done,
        }),
      ],
    );
  }

  async emitLifecycle(event: string, requestId: string, detail: Record<string, unknown>): Promise<void> {
    // map the logical lifecycle event to an EXISTING event_type enum value (no migration, no 22P02). An unmapped event
    // falls back to `deletion_request_held` — a loud, valid default (an unexpected event surfacing as a held/escalation is
    // #3-safe, never silent). The logical name + detail are preserved in the payload for the surface/audit.
    const eventType = LIFECYCLE_EVENT_TYPE[event] ?? 'deletion_request_held';
    await this.exec(
      `insert into event_log (event_type, summary, payload, created_at)
         values ($1::event_type, $2, $3::jsonb, now())`,
      [eventType, `deletion workflow: ${event} (request ${requestId})`, JSON.stringify({ logical_event: event, request_id: requestId, ...detail })],
    );
  }
}

function toRequest(r: RequestDbRow, targetEntityId: string): DeletionRequest {
  return {
    id: r.id,
    requesterId: r.requester_id,
    targetUserId: r.target_user_id,
    targetEntityId,
    legalBasis: r.legal_basis,
    status: r.status,
    authorizedBy: r.authorized_by,
    secondAuthoriserId: r.second_authoriser_id,
    executorId: r.executor_id,
    executedAt: r.executed_at ? r.executed_at.toISOString() : null,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

function toFlag(r: FlagDbRow): ConnectorDeletionFlag {
  return {
    id: r.id,
    deletionRequestId: r.deletion_request_id,
    connector: r.connector,
    state: r.state,
    raisedAt: r.raised_at.toISOString(),
    acknowledgedAt: r.acknowledged_at ? r.acknowledged_at.toISOString() : null,
    acknowledgedBy: r.acknowledged_by,
    escalatedAt: r.escalated_at ? r.escalated_at.toISOString() : null,
  };
}
