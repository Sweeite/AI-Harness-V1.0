// ISSUE-029 — Compliance erasure walk (memory-side transitive delete). The store port + InMemory reference fake.
//
// This is the ONE sanctioned destructive path in a deliberately non-destructive model (FR-2.MNT.017). Everywhere else
// "decay never deletes" (FR-2.MNT.002) — the ports across memory-write/memory-maintenance/conflict-consolidation
// expose NO delete. This port is the exception: `hardDeleteMemories` is the first + only sanctioned true DELETE of
// `memories` rows, and it exists solely to satisfy a #2 legal obligation (a lawful erasure request), Super-Admin +
// PERM-memory.delete gated, audited, and verified-complete-or-fails-loud (AC-2.MNT.017.5).
//
// The fakes mirror the live SQL 1:1 at the method boundary so a green offline suite predicts live behaviour (R10).
// Any filter/edge in the live adapter's SQL is reproduced here (the conflict-consolidation store.ts discipline).

import type { MemoryRow } from '../../memory/src/store.ts';

/** A memory row carrying its OD-204 provenance edge (memories.derived_from, migration 0045). `derived_from` is the
 *  set of source memory ids a merge/summary row was derived from; empty = a directly-written (non-derived) row. The
 *  erasure walk classifies on it: a derived row is recomputable and always hard-deleted. */
export type ErasureRow = MemoryRow & { derived_from: string[] };

// ── The erasure target the caller (ISSUE-082 C10 workflow) resolves and hands this slice ─────────────────────────
// Per §2 Out-of-scope: this slice does NOT decide which records to erase from a fuzzy match — it erases the resolved
// target it is handed (a deterministic entity_id). Free-text fuzzy resolution is C10 (ISSUE-082).
export interface ErasureTarget {
  /** the individual/entity being erased — the deterministic entity_id (AC-NFR-CMP.005.2). */
  targetEntityId: string;
  /** the deletion_requests id this erasure executes against (audit + tombstone linkage). */
  requestId: string;
  /** the lawful basis / reason — mandatory (Personal/Restricted access is reason-gated, schema §2). */
  reason: string;
}

// ── The authorization context the gate checks (FR-2.MNT.017 preconditions) ───────────────────────────────────────
// Destructive-by-design → the gate is STRICTER than retire/supersede: Super-Admin + PERM-memory.delete + an
// erasure-specific confirmation distinct from the routine retire path.
export interface ErasureAuthz {
  /** the actor performing the erasure (audit actor_identity). */
  actorIdentity: string;
  /** the Super-Admin user id (audit originating_user_id / FK to profiles). */
  originatingUserId: string;
  /** true iff the actor holds the Super-Admin role (FR-2.MNT.017 — Super-Admin-gated). */
  isSuperAdmin: boolean;
  /** the permission nodes the actor holds — must include PERM-memory.delete. */
  permissions: readonly string[];
  /** the erasure-specific gate: an explicit destructive-erasure confirmation, NOT reusable from a retire action. */
  erasureConfirmed: boolean;
}

/** The permission node this destructive path requires (homed in C1 PERMISSION_NODES.md, consumed here). */
export const PERM_MEMORY_DELETE = 'PERM-memory.delete' as const;

// ── An immutable access_audit entry (schema §2, append-only) — the erasure tombstone shape ───────────────────────
export interface AuditEntry {
  auditType: string;
  actorIdentity: string;
  actorType: 'user' | 'agent' | 'system';
  action: string;
  targetType: string | null;
  targetEntityId: string | null;
  reason: string | null;
  pathContext: string;
  originatingUserId: string | null;
  /** the after-state summary (what-scope was erased) — jsonb; must NOT re-embed erased PII (AC-7.LOG.006.3). */
  afterValue: Record<string, unknown> | null;
}

// ── The fan-out legs this slice RAISES / TRIGGERS (owned elsewhere; injected as ports so the engine stays a pure,
//    testable orchestrator). §2: this slice raises the flag + fires the trigger; Phase-5/C7 own the mechanism. ─────

/** The off-platform backup-purge flag (NFR-DR.009). This slice RAISES it (writes the receive-leg ledger row);
 *  Phase-5 backup/DR (ISSUE-085) clears it on the next dump cycle. Idempotent on flag_id. */
export interface PurgeFlag {
  flag_id: string;
  target_ref: string;
  raised_at: string;
  erasure_effective_at: string;
}
export interface BackupPurgePort {
  /** raise (idempotent) — returns whether the ledger row was newly created. A throw = the leg FAILED (fail-loud). */
  raisePurgeFlag(flag: PurgeFlag): Promise<{ raised: boolean; new: boolean }>;
}

/** The C7 log-sink redaction (AC-2.MNT.017.4 / NFR-CMP.007). This slice TRIGGERS the scrub across event_log +
 *  guardrail_log for the target; C7 owns the in-place redaction-tombstone mechanism (app/log-retention). */
export interface SinkRedactionResult {
  sink: 'event_log' | 'guardrail_log';
  redacted: string[];
  already_tombstoned: string[];
}
export interface LogRedactionPort {
  /** fire the C7 scrub across both sinks for the target entity. A throw on either sink = the leg FAILED. */
  redactSubject(targetEntityId: string): Promise<{ event_log: SinkRedactionResult; guardrail_log: SinkRedactionResult }>;
  /** completeness re-read: count log rows matching the target that are NOT yet redaction-tombstoned. 0 = cleared. */
  countUnredactedMatches(targetEntityId: string): Promise<number>;
}

// ── The erasure store port — reads for the transitive walk + the sole destructive primitive + the tombstone ──────
export interface ErasureStore {
  /** The target's Personal-sensitivity memory rows (semantic + episodic evidence + procedural), LIVE or superseded.
   *  Only sensitivity='personal' rows are in an erasure's remit (FR-2.MNT.017 — "the target's Personal data"). */
  resolveTargetMemories(targetEntityId: string): Promise<ErasureRow[]>;
  /** The full superseded_by chain reachable from `ids` — every older superseded row AND every newer row that
   *  superseded one of them (transitive both directions). A "deleted" memory that survives in the chain is the
   *  #2/#3 residue this walk forbids (FR-2.MNT.017 edge). */
  walkSupersededChain(ids: string[]): Promise<ErasureRow[]>;
  /** Rows DERIVED (merge FR-2.MNT.005 / summary FR-2.MNT.007) from any of `sourceIds` — the OD-204 provenance edge
   *  (memories.derived_from && ARRAY[sourceIds]). Reaches derived rows that folded an erased Personal input. */
  findDerivedFrom(sourceIds: string[]): Promise<ErasureRow[]>;
  /** Any row NOT in `deleteSet` whose superseded_by points INTO `deleteSet` — a self-FK a bulk delete would violate
   *  (a retained/other-subject row referencing an erased one). Read for the pre-delete relink + the residue check. */
  danglingSupersedeRefs(deleteSet: string[]): Promise<string[]>;
  /** Un-supersede: NULL superseded_by for every row (OUTSIDE `deleteSet`) that points INTO it, so the bulk delete
   *  can proceed without an FK violation AND another subject's source (CAS-superseded into a now-erased shared merge)
   *  is RESTORED LIVE instead of being lost (#1). Returns the ids relinked. This is #1-safe: it only ever makes a
   *  superseded row live again (never deletes, never loses knowledge). */
  clearSupersededByRefs(deleteSet: string[]): Promise<string[]>;
  /** THE sole sanctioned destructive primitive: hard-DELETE the rows (and their embeddings, which are columns of the
   *  row) — a true delete, not a supersede. Returns the ids actually removed. */
  hardDeleteMemories(ids: string[]): Promise<{ deleted: string[] }>;
  /** Completeness re-read (AC-2.MNT.017.5): how many of `ids` still exist. Must be 0 after the delete leg. */
  countResidual(ids: string[]): Promise<number>;
  /** Write the immutable erasure tombstone to access_audit (who/when/why/what-scope). Append-only (schema §2). */
  writeTombstone(entry: AuditEntry): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// InMemory reference fake — mirrors the live adapter's SQL semantics at the method boundary.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export class InMemoryErasureStore implements ErasureStore {
  /** the memory graph keyed by id. `derived_from` is carried alongside (the OD-204 edge; migration 0045). */
  readonly rows = new Map<string, MemoryRow & { derived_from: string[] }>();
  readonly tombstones: AuditEntry[] = [];

  /** test helper — insert a row into the graph. */
  put(row: MemoryRow, derivedFrom: string[] = []): MemoryRow {
    this.rows.set(row.id, { ...row, derived_from: [...derivedFrom] });
    return row;
  }

  /** test helper — build a minimal valid MemoryRow (mirrors the InMemory fakes elsewhere). */
  static memory(over: Partial<MemoryRow> & Pick<MemoryRow, 'id' | 'entity_ids'>): MemoryRow {
    return {
      type: 'semantic',
      content: 'c',
      embedding: new Array(1536).fill(0.01),
      embedding_model: 'text-embedding-3-small',
      source: 'ai_inferred',
      source_ref: null,
      confidence: 0.7,
      visibility: 'private',
      sensitivity: 'personal',
      superseded_by: null,
      content_hash: 'h',
      idempotency_key: `k-${over.id}`,
      expires_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      ...over,
    };
  }

  async resolveTargetMemories(targetEntityId: string): Promise<ErasureRow[]> {
    return [...this.rows.values()].filter((r) => r.entity_ids.includes(targetEntityId) && r.sensitivity === 'personal').map(clone);
  }

  async walkSupersededChain(ids: string[]): Promise<ErasureRow[]> {
    const seen = new Set<string>(ids);
    const frontier = [...ids];
    while (frontier.length) {
      const id = frontier.pop()!;
      const row = this.rows.get(id);
      if (!row) continue;
      // forward: the row this one was superseded BY (newer version).
      if (row.superseded_by && !seen.has(row.superseded_by)) {
        seen.add(row.superseded_by);
        frontier.push(row.superseded_by);
      }
      // backward: any row superseded BY this one (older versions).
      for (const other of this.rows.values()) {
        if (other.superseded_by === id && !seen.has(other.id)) {
          seen.add(other.id);
          frontier.push(other.id);
        }
      }
    }
    return [...seen].map((id) => this.rows.get(id)).filter((r): r is ErasureRow => !!r).map(clone);
  }

  async findDerivedFrom(sourceIds: string[]): Promise<ErasureRow[]> {
    const src = new Set(sourceIds);
    return [...this.rows.values()].filter((r) => r.derived_from.some((s) => src.has(s))).map(clone);
  }

  async danglingSupersedeRefs(deleteSet: string[]): Promise<string[]> {
    const del = new Set(deleteSet);
    return [...this.rows.values()].filter((r) => !del.has(r.id) && r.superseded_by !== null && del.has(r.superseded_by)).map((r) => r.id);
  }

  async clearSupersededByRefs(deleteSet: string[]): Promise<string[]> {
    const del = new Set(deleteSet);
    const relinked: string[] = [];
    for (const r of this.rows.values()) {
      if (!del.has(r.id) && r.superseded_by !== null && del.has(r.superseded_by)) {
        r.superseded_by = null; // restore live (its superseding row is being erased)
        relinked.push(r.id);
      }
    }
    return relinked;
  }

  async hardDeleteMemories(ids: string[]): Promise<{ deleted: string[] }> {
    const deleted: string[] = [];
    for (const id of ids) if (this.rows.delete(id)) deleted.push(id);
    return { deleted };
  }

  async countResidual(ids: string[]): Promise<number> {
    return ids.filter((id) => this.rows.has(id)).length;
  }

  async writeTombstone(entry: AuditEntry): Promise<void> {
    this.tombstones.push(entry);
  }
}

function clone(r: ErasureRow): ErasureRow {
  return { ...r, entity_ids: [...r.entity_ids], derived_from: [...r.derived_from] };
}
