// ISSUE-027 (C2 MNT) — the LIVE pg adapter for the MaintenanceStore port. Authored to schema.md §3 (memories /
// entities / ingestion_queue) + the 0001 baseline DDL: every read/mutation/emit mirrors an InMemory method 1:1 so a
// green offline suite predicts live behaviour (R10). NOT exercised by the offline AC suite — its behaviour is proven
// by the R10 live-adapter smoke; supabase-store.test.ts drives it against a FAKE exec seam to assert the SQL shape +
// row mapping offline.
//
// LIVE side effects, all NON-DESTRUCTIVE (the port has no delete — decay-never-deletes is structural, NFR-DR.008):
//   • setConfidence  → UPDATE memories.confidence (+ updated_at).
//   • casSupersede   → UPDATE memories SET superseded_by WHERE id=$1 AND superseded_by IS NULL (CAS, ADR-004).
//   • insertDerivedMemory → INSERT INTO memories … ON CONFLICT (idempotency_key) DO NOTHING (governed, idempotent).
//   • the observability sinks → INSERT INTO event_log.
//
// The maintenance event_type values (memory_maintenance_run / memory_confidence_changed / memory_maintenance_task /
// memory_maintenance_mutation) are ADDITIVE — NOT in the 0001 baseline enum — so a live INSERT throws '22P02 invalid
// input value for enum event_type' until the additive migration lands (the check gate + R10 smoke guard this; see
// index.ts + the migrationNeeded manifest). The amber/bulk alert reuses the BASELINE 'memory_confidence_drop' value.

import type pg from 'pg';
import type { MemoryRow, EntityRow } from '../../memory/src/store.ts';
import { validateMemoryRow } from '../../memory/src/store.ts';
import type {
  MaintenanceStore,
  IngestionQueueRow,
  JobRunRecord,
  ConfidenceChange,
  MaintenanceAlert,
  MaintenanceTask,
} from './store.ts';

export type QueryExec = <R extends pg.QueryResultRow>(text: string, params?: unknown[]) => Promise<{ rows: R[]; rowCount?: number | null }>;

// ── the additive event_type values this adapter emits (the check gate asserts they exist before a live write) ──
export const EVT_MAINTENANCE_RUN = 'memory_maintenance_run' as const; // FR-2.MNT.015 job-run log + job_failure alert
export const EVT_CONFIDENCE_CHANGED = 'memory_confidence_changed' as const; // FR-2.MNT.001/016 cause-tagged movement
export const EVT_MAINTENANCE_TASK = 'memory_maintenance_task' as const; // FR-2.MNT.009/010/011 dashboard tasks/flags
export const EVT_MAINTENANCE_MUTATION = 'memory_maintenance_mutation' as const; // FR-2.MNT.005/006/007 merge/supersede/summarise
/** The BASELINE alert value the amber/bulk drop reuses (already in the 0001 enum — no migration for this one). */
export const EVT_CONFIDENCE_DROP = 'memory_confidence_drop' as const;

/** The ADDITIVE values the orchestrator must register (reported in migrationNeeded). memory_confidence_drop is NOT
 *  here — it is baseline. */
export const MAINTENANCE_EVENT_TYPES: readonly string[] = [EVT_MAINTENANCE_RUN, EVT_CONFIDENCE_CHANGED, EVT_MAINTENANCE_TASK, EVT_MAINTENANCE_MUTATION] as const;

interface MemoryDbRow {
  id: string;
  type: MemoryRow['type'];
  content: string;
  embedding: string;
  embedding_model: string;
  entity_ids: string[];
  source: MemoryRow['source'];
  source_ref: string | null;
  confidence: string | null;
  visibility: MemoryRow['visibility'];
  sensitivity: MemoryRow['sensitivity'];
  superseded_by: string | null;
  content_hash: string;
  idempotency_key: string;
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const MEMORY_COLS = `id, type, content, embedding, embedding_model, entity_ids, source, source_ref, confidence,
  visibility, sensitivity, superseded_by, content_hash, idempotency_key, expires_at, created_at, updated_at`;

function parseVector(v: string | null): number[] {
  if (!v) return [];
  const inner = v.trim().replace(/^\[/, '').replace(/\]$/, '');
  if (inner.length === 0) return [];
  return inner.split(',').map(Number);
}
function toVectorLiteral(embedding: readonly number[]): string {
  return `[${embedding.join(',')}]`;
}

function toMemoryRow(r: MemoryDbRow): MemoryRow {
  return {
    id: r.id,
    type: r.type,
    content: r.content,
    embedding: parseVector(r.embedding),
    embedding_model: r.embedding_model,
    entity_ids: r.entity_ids,
    source: r.source,
    source_ref: r.source_ref,
    confidence: r.confidence === null ? null : Number(r.confidence),
    visibility: r.visibility,
    sensitivity: r.sensitivity,
    superseded_by: r.superseded_by,
    content_hash: r.content_hash,
    idempotency_key: r.idempotency_key,
    expires_at: r.expires_at ? r.expires_at.toISOString() : null,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

interface EntityDbRow {
  id: string;
  type: string;
  name: string;
  external_refs: Record<string, string> | null;
  is_internal_org: boolean;
  maturity: string | null;
  maturity_updated_at: Date | null;
  created_at: Date;
}
function toEntityRow(r: EntityDbRow): EntityRow {
  return {
    id: r.id,
    type: r.type,
    name: r.name,
    external_refs: r.external_refs ?? {},
    is_internal_org: r.is_internal_org,
    maturity: r.maturity === null ? null : Number(r.maturity),
    maturity_updated_at: r.maturity_updated_at ? r.maturity_updated_at.toISOString() : null,
    created_at: r.created_at.toISOString(),
  };
}

interface QueueDbRow {
  id: string;
  content: string;
  source_ref: string | null;
  state: IngestionQueueRow['state'];
  target_entity_id: string | null;
  deferred_until: Date | null;
  created_at: Date;
}
function toQueueRow(r: QueueDbRow): IngestionQueueRow {
  return {
    id: r.id,
    content: r.content,
    source_ref: r.source_ref,
    state: r.state,
    target_entity_id: r.target_entity_id,
    deferred_until: r.deferred_until ? r.deferred_until.toISOString() : null,
    created_at: r.created_at.toISOString(),
  };
}

export class SupabaseMaintenanceStore implements MaintenanceStore {
  constructor(private readonly exec: QueryExec) {}

  async listMemories(): Promise<MemoryRow[]> {
    const { rows } = await this.exec<MemoryDbRow>(`select ${MEMORY_COLS} from memories`);
    return rows.map(toMemoryRow);
  }
  async listEntities(): Promise<EntityRow[]> {
    const { rows } = await this.exec<EntityDbRow>(`select id, type, name, external_refs, is_internal_org, maturity, maturity_updated_at, created_at from entities`);
    return rows.map(toEntityRow);
  }
  async listIngestionQueue(): Promise<IngestionQueueRow[]> {
    const { rows } = await this.exec<QueueDbRow>(`select id, content, source_ref, state, target_entity_id, deferred_until, created_at from ingestion_queue`);
    return rows.map(toQueueRow);
  }
  async underReviewMemoryIds(): Promise<Set<string>> {
    // The live memories currently referenced by an UNRESOLVED conflict (memory_conflicts) — frozen against every
    // automated mutation. Both 'pending' AND 'escalated' are under active human review (mem_review_state becomes
    // 'resolved' only when a human closes it); an escalated conflict is MORE contested, not less, so excluding it would
    // let the daily jobs decay/supersede/merge a memory precisely while a human is still deciding it (#2 gate bypass /
    // #1 contested-knowledge drift). Only a 'resolved' conflict releases the freeze.
    const { rows } = await this.exec<{ conflicting_memory_ids: string[] }>(`select conflicting_memory_ids from memory_conflicts where state in ('pending','escalated')`);
    const out = new Set<string>();
    for (const r of rows) for (const id of r.conflicting_memory_ids ?? []) out.add(id);
    return out;
  }

  async setConfidence(id: string, newConfidence: number): Promise<void> {
    const { rowCount } = await this.exec(`update memories set confidence = $2, updated_at = now() where id = $1`, [id, newConfidence]);
    if (rowCount === 0) throw new Error(`setConfidence: memory '${id}' not found (0 rows) — refusing a silent no-op (#3)`);
  }

  async casSupersede(oldId: string, newId: string): Promise<boolean> {
    // CAS: only supersede a still-live row (WHERE superseded_by IS NULL). A lost race updates 0 rows (ADR-004).
    const { rowCount } = await this.exec(`update memories set superseded_by = $2::uuid, updated_at = now() where id = $1 and superseded_by is null`, [oldId, newId]);
    const won = (rowCount ?? 0) > 0;
    if (won) await this.emit(EVT_MAINTENANCE_MUTATION, [], 'memory superseded (maintenance)', { kind: 'supersede', old_id: oldId, new_id: newId });
    return won;
  }

  async insertDerivedMemory(row: MemoryRow, derivedFrom: string[]): Promise<{ inserted: boolean; id: string }> {
    validateMemoryRow(row); // same shape gate the fake applies — offline + live reject identical rows
    // OD-204: persist the derived_from provenance edge queryably (migration 0045) so ISSUE-029's compliance-erasure
    // walk can reach this derived row from its source ids (FR-2.MNT.017 / AC-2.MNT.017.3). null = not a derived row.
    const derivedFromParam = derivedFrom.length > 0 ? derivedFrom : null;
    const { rows } = await this.exec<{ id: string }>(
      `insert into memories (${MEMORY_COLS}, derived_from)
       values (gen_random_uuid(), $1, $2, $3::vector, $4, $5::uuid[], $6, $7, $8, $9, $10, $11, $12, $13, $14, now(), now(), $15::uuid[])
       on conflict (idempotency_key) do nothing
       returning id`,
      [
        row.type,
        row.content,
        toVectorLiteral(row.embedding),
        row.embedding_model,
        row.entity_ids,
        row.source,
        row.source_ref,
        row.confidence,
        row.visibility,
        row.sensitivity,
        row.superseded_by,
        row.content_hash,
        row.idempotency_key,
        row.expires_at,
        derivedFromParam,
      ],
    );
    if (rows.length === 0) {
      // idempotent no-op — the row already existed; fetch its id so the caller can chain (never a duplicate).
      const { rows: existing } = await this.exec<{ id: string }>(`select id from memories where idempotency_key = $1`, [row.idempotency_key]);
      return { inserted: false, id: existing[0]?.id ?? row.id };
    }
    const id = rows[0]!.id;
    await this.emit(EVT_MAINTENANCE_MUTATION, row.entity_ids, 'derived memory inserted (merge/summarise)', { kind: 'derived_insert', memory_id: id, derived_from: derivedFrom });
    return { inserted: true, id };
  }

  async jobRun(rec: JobRunRecord): Promise<void> {
    await this.emit(EVT_MAINTENANCE_RUN, [], `maintenance job '${rec.job}' (${rec.cadence}) ${rec.outcome} — ${rec.recordsAffected} record(s)`, rec as unknown as Record<string, unknown>);
  }
  async confidenceChanged(rec: ConfidenceChange): Promise<void> {
    await this.emit(EVT_CONFIDENCE_CHANGED, [rec.memoryId], `confidence ${rec.oldConfidence} → ${rec.newConfidence} (${rec.cause}) by ${rec.actor}`, rec as unknown as Record<string, unknown>);
  }
  async alert(rec: MaintenanceAlert): Promise<void> {
    // Amber/bulk reuse the BASELINE memory_confidence_drop value; a job_failure surfaces as a maintenance_run event.
    const evt = rec.kind === 'job_failure' ? EVT_MAINTENANCE_RUN : EVT_CONFIDENCE_DROP;
    await this.emit(evt, rec.memoryIds, `maintenance alert (${rec.kind}): ${rec.detail}`, rec as unknown as Record<string, unknown>);
  }
  async task(rec: MaintenanceTask): Promise<void> {
    await this.emit(EVT_MAINTENANCE_TASK, [rec.targetId], `maintenance task (${rec.kind}) → ${rec.action}: ${rec.detail}`, rec as unknown as Record<string, unknown>);
  }

  private async emit(eventType: string, entityIds: string[], summary: string, payload: Record<string, unknown>): Promise<void> {
    await this.exec(
      `insert into event_log (event_type, entity_ids, summary, payload, created_at)
       values ($1::event_type, $2::uuid[], $3, $4::jsonb, now())`,
      [eventType, entityIds, summary, JSON.stringify(payload)],
    );
  }
}
