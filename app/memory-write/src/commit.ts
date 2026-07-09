// ISSUE-024 (C2 WRT) — FR-2.WRT.006: the validate-and-commit path (ADR-004 §3). The CommitStore PORT + the
// in-memory reference fake. This is the correctness core of the slice and the Checkpoint-6 closing condition:
// the short, advisory-locked txn is the SINGLE point where the per-entity watermark, idempotency, CAS-supersede,
// and mid-task authorization are re-validated TOGETHER, closing the TOCTOU window the unlocked LLM phase opens
// without ever losing a write (#1) or committing on a stale/unauthorized snapshot (#2).
//
// ADR-004 §3 sequence (mirrored EXACTLY by the fake AND the live pg adapter so a green offline suite predicts
// live behaviour — R10):
//   0. (unlocked, caller) read watermark v0 = max(updated_at) over the entity set; Sonnet writer + embed produce
//      a proposed write + a conflict decision (none/soft/hard + targets).
//   1. (locked) acquire SORTED per-entity advisory locks — deadlock-free (ADR-004 §2). Disjoint entity sets take
//      disjoint locks → never block (AC-2.WRT.006.2).
//   2. mid-task authz re-check at the commit boundary — the commit IS "the next consequential side effect"
//      FR-1.RLS.007 governs (AC-2.WRT.006.3). Deactivated / relied-on-grant-revoked → halt + quarantine, never
//      commit; a benign session-expiry does NOT halt.
//   3. re-read watermark v1. v1==v0 → apply the decision as-is. v1!=v0 → re-run ONLY the cheap DB contradiction
//      re-check (no LLM); a newly-arrived same-slot conflict re-decides (soft→ still supersede the survivors;
//      an on-race hard → quarantine instead of overwrite).
//   4. insert idempotency-keyed (ON CONFLICT DO NOTHING) — a retried step is a no-op, never a duplicate
//      (AC-2.WRT.006.1). CAS-supersede the soft targets WHERE superseded_by IS NULL — a lost CAS race affects 0
//      rows and is dropped (the winner's supersede stands; no lost-supersede).

import { validateMemoryRow, type MemoryRow } from '../../memory/src/store.ts';
import type { MemoryType, VisibilityTier, SensitivityTier } from '../../memory/src/entity-types.ts';
import { contentHash, computeIdempotencyKey } from '../../memory/src/memory.ts';
import { reevaluate, type ReliedOn, type AuthzReeval } from '../../rls-enforcement/src/recheck.ts';
import type { OriginatingAuthz } from '../../rls-enforcement/src/store.ts';
import { assignConfidence, type SourceType } from './confidence.ts';
import { classifyConflict, decisionStale, type Candidate, type Classification } from './contradiction.ts';

// ── The draft the writer hands the commit path (post-embed, pre-commit). ────────────────────────────────────
export interface MemoryDraft {
  type: MemoryType;
  content: string;
  entity_ids: string[];
  sourceType: SourceType;
  /** proposed confidence from the writer (clamped into the source-type band); ignored for system_pointer. */
  proposedConfidence?: number | null;
  source_ref: string | null;
  visibility: VisibilityTier;
  sensitivity: SensitivityTier;
  expires_at: string | null;
  /** the validated embedding (produced by @harness/embeddings embedForWrite — FR-2.WRT.007 already passed). */
  embedding: number[];
  embedding_model: string;
  /** the writer's contradiction decision against the similar set it saw (unlocked). */
  contradicts?: boolean;
}

export interface TaskAuthz {
  taskId: string;
  serviceRoleIdentity: string;
  originatingUserId: string;
  reliedOn: ReliedOn;
}

export interface CommitInput {
  draft: MemoryDraft;
  /** the unlocked pre-check decision (kind + targetIds) the writer produced against the v0 similar set. */
  decision: Classification;
  /** the candidate view used for the cheap on-race re-check (type/content/entity_ids/contradicts). */
  candidate: Candidate;
  /** the watermark read unlocked (v0). */
  watermarkV0: number;
  /** authz context for the FR-1.RLS.007 commit-boundary re-check. */
  task: TaskAuthz;
}

export type CommitStatus =
  | 'committed' // the memory was inserted (and any soft supersede applied)
  | 'noop' // idempotent retry — the idempotency key already existed; nothing written
  | 'quarantined' // hard conflict — inserted into memory_conflicts, NOT into the live set
  | 'halted'; // mid-task authz revoked — the pending write was quarantined, not committed

export interface CommitResult {
  status: CommitStatus;
  memoryId: string | null;
  superseded: string[]; // ids CAS-superseded (soft path)
  conflictId: string | null; // memory_conflicts id (hard path / halt quarantine)
  reeval?: AuthzReeval; // the authz decision made at the boundary (for the halt path)
  rewrote: boolean; // true iff the on-race re-check changed the unlocked decision
}

/** Event sink for the loud WRT observability (#3). Additive event_type values ship in migration 0039. */
export interface WriteEventSink {
  memoryWritten(payload: Record<string, unknown>): Promise<void>;
  superseded(payload: Record<string, unknown>): Promise<void>;
  conflictQuarantined(payload: Record<string, unknown>): Promise<void>;
  /** the mid-task authz halt — reuses the existing authz_revoked_midtask event (rls-enforcement / OD-170). */
  authzHalted(payload: Record<string, unknown>): Promise<void>;
}

/** The authz-state reader (rls-enforcement's loadOriginatingAuthz). null = unknown/unreadable → fail-closed. */
export interface AuthzReader {
  loadOriginatingAuthz(userId: string): Promise<OriginatingAuthz | null>;
}

/** The cheap DB contradiction re-check reader — the 3–5 most similar LIVE memories for an entity set (vector arm,
 *  ISSUE-023 contract / ISSUE-025). Read at commit time to detect a newly-arrived conflict (no LLM). */
export interface SimilarMemoryReader {
  findSimilar(entityIds: string[], type: MemoryType, k: number): Promise<MemoryRow[]>;
}

export interface CommitDeps {
  authz: AuthzReader;
  similar: SimilarMemoryReader;
  events: WriteEventSink;
  /** CFG-review_escalation_days (default 7) — the quarantine escalation clock (AC-2.WRT.002.3). */
  reviewEscalationDays?: number;
  /** the cheap re-check pulls this many similar rows (FR-2.WRT.002 "3–5"). */
  similarK?: number;
}

/** The commit port — the single governed write boundary (FR-2.WRT.001). */
export interface CommitStore {
  /** unlocked read of the per-entity watermark v0 = max(updated_at epoch) over the entity set (0 if none). */
  readWatermark(entityIds: string[]): Promise<number>;
  /** the locked validate-and-commit txn (ADR-004 §3). */
  commit(input: CommitInput): Promise<CommitResult>;
  /** AC-2.WRT.002.3 — escalate any hard conflict un-actioned past CFG-review_escalation_days (alert + badge),
   *  never auto-resolving it. (The mechanism lives here; ISSUE-028 drives + renders it.) */
  escalateOverdueConflicts(now?: number): Promise<string[]>;
}

// ── quarantine row shape (memory_conflicts) ─────────────────────────────────────────────────────────────────
export interface ConflictRow {
  id: string;
  new_memory: Record<string, unknown>;
  conflicting_memory_ids: string[];
  state: 'pending' | 'escalated' | 'resolved';
  escalated_at: string | null;
  created_at: string;
}

/** Build the full MemoryRow from a draft (deriving confidence/source/hash/idempotency) + validate it. Shared by
 *  the fake AND the live adapter so offline and live construct + reject identical rows (R10). */
export function buildMemoryRow(draft: MemoryDraft, id: string, nowIso: string): MemoryRow {
  const { confidence, storedSource } = assignConfidence(draft.sourceType, draft.proposedConfidence);
  const hash = contentHash(draft.content);
  const idempotency_key = computeIdempotencyKey(draft.source_ref, draft.entity_ids, hash);
  const row: MemoryRow = {
    id,
    type: draft.type,
    content: draft.content,
    embedding: draft.embedding,
    embedding_model: draft.embedding_model,
    entity_ids: [...draft.entity_ids],
    source: storedSource,
    source_ref: draft.source_ref,
    confidence,
    visibility: draft.visibility,
    sensitivity: draft.sensitivity,
    superseded_by: null,
    content_hash: hash,
    idempotency_key,
    expires_at: draft.expires_at,
    created_at: nowIso,
    updated_at: nowIso,
  };
  validateMemoryRow(row); // the four enum domains + the two DB CHECKs + golden-rule pointer-needs-ref
  return row;
}

// ── an async per-entity mutex modelling pg transaction-scoped advisory locks (ADR-004 §2). ──────────────────
class EntityLocks {
  private chains = new Map<string, Promise<void>>();

  /** Acquire all locks for `ids` in SORTED order (deadlock-free — every txn acquires in the same order). Returns
   *  a release fn that frees them all (the txn boundary; pg auto-releases xact locks at commit/rollback). */
  async acquireAll(ids: readonly string[]): Promise<() => void> {
    const sorted = [...new Set(ids)].sort();
    const releases: Array<() => void> = [];
    for (const id of sorted) {
      const prev = this.chains.get(id) ?? Promise.resolve();
      let release!: () => void;
      const held = new Promise<void>((res) => (release = res));
      this.chains.set(id, prev.then(() => held));
      await prev; // block until the predecessor holder releases this entity's lock
      releases.push(release);
    }
    return () => {
      for (const r of releases) r();
    };
  }
}

let __seq = 0;
const nextId = (p: string) => `${p}-${++__seq}`;

/** Test seam: a hook the fake awaits INSIDE the locked section (after acquiring locks, before insert) so a test
 *  can prove disjoint writes don't block while same-entity writes do (AC-2.WRT.006.1/.2). No-op in production. */
export type InLockHook = (entityIds: string[]) => Promise<void>;

interface StoredMemory extends MemoryRow {
  _clock: number; // logical updated_at for the watermark
}

export class InMemoryCommitStore implements CommitStore {
  private memories = new Map<string, StoredMemory>();
  private byIdemKey = new Map<string, string>(); // idempotency_key → memory id
  private conflicts: ConflictRow[] = [];
  private locks = new EntityLocks();
  private clock = 1;
  private readonly reviewEscalationDays: number;
  private readonly similarK: number;

  constructor(
    private readonly deps: CommitDeps,
    private readonly inLockHook?: InLockHook,
  ) {
    this.reviewEscalationDays = deps.reviewEscalationDays ?? 7;
    this.similarK = deps.similarK ?? 5;
  }

  /** Seed a live memory (test/reference helper — mirrors what a prior committed write left). */
  _seed(row: MemoryRow): void {
    const stored: StoredMemory = { ...row, entity_ids: [...row.entity_ids], embedding: [...row.embedding], _clock: this.clock++ };
    this.memories.set(stored.id, stored);
    this.byIdemKey.set(stored.idempotency_key, stored.id);
  }

  _liveMemories(): MemoryRow[] {
    return [...this.memories.values()].filter((m) => m.superseded_by === null).map((m) => ({ ...m }));
  }
  _allMemories(): MemoryRow[] {
    return [...this.memories.values()].map((m) => ({ ...m }));
  }
  _conflicts(): ConflictRow[] {
    return this.conflicts.map((c) => ({ ...c }));
  }

  async readWatermark(entityIds: string[]): Promise<number> {
    const set = new Set(entityIds);
    let max = 0;
    for (const m of this.memories.values()) {
      if (m.entity_ids.some((e) => set.has(e)) && m._clock > max) max = m._clock;
    }
    return max;
  }

  async commit(input: CommitInput): Promise<CommitResult> {
    const { draft, task } = input;
    const release = await this.locks.acquireAll(draft.entity_ids);
    try {
      if (this.inLockHook) await this.inLockHook(draft.entity_ids);

      // [2] mid-task authz re-check at the commit boundary (FR-1.RLS.007 / AC-2.WRT.006.3). The commit IS the
      //     consequential side effect. Deactivated / relied-on-grant-revoked → halt + quarantine, never commit.
      const current = await this.deps.authz.loadOriginatingAuthz(task.originatingUserId);
      const reeval = reevaluate(current, task.reliedOn);
      if (!reeval.authorized) {
        const conflictId = this.quarantinePending(draft, [], `authz_revoked_midtask:${reeval.stopReason}`);
        await this.deps.events.authzHalted({
          task_id: task.taskId,
          originating_user_id: task.originatingUserId,
          stop_reason: reeval.stopReason,
          detail: reeval.detail,
          quarantine_id: conflictId,
        });
        return { status: 'halted', memoryId: null, superseded: [], conflictId, reeval, rewrote: false };
      }

      // [3] re-read the watermark; re-check the decision only if it moved (ADR-004 §3).
      let decision = input.decision;
      let rewrote = false;
      const v1 = await this.readWatermark(draft.entity_ids);
      if (v1 !== input.watermarkV0) {
        const currentSimilar = await this.deps.similar.findSimilar(draft.entity_ids, draft.type, this.similarK);
        if (decisionStale(input.candidate, currentSimilar, decision.targetIds)) {
          decision = classifyConflict(input.candidate, currentSimilar); // cheap DB re-check, no LLM
          rewrote = true;
        }
      }

      // [3b] a HARD conflict (initial or on-race) is quarantined — never written to the live set.
      if (decision.kind === 'hard') {
        const conflictId = this.quarantinePending(draft, decision.targetIds, decision.reason);
        await this.deps.events.conflictQuarantined({
          task_id: task.taskId,
          conflict_id: conflictId,
          conflicting_memory_ids: decision.targetIds,
          reason: decision.reason,
          on_race: rewrote,
        });
        return { status: 'quarantined', memoryId: null, superseded: [], conflictId, rewrote };
      }

      // [4] insert idempotency-keyed (ON CONFLICT DO NOTHING). A retried step is a no-op, never a duplicate.
      const row = buildMemoryRow(draft, nextId('mem'), new Date(this.clock).toISOString());
      const existingId = this.byIdemKey.get(row.idempotency_key);
      if (existingId) {
        return { status: 'noop', memoryId: existingId, superseded: [], conflictId: null, rewrote };
      }
      const stored: StoredMemory = { ...row, _clock: this.clock++ };
      this.memories.set(stored.id, stored);
      this.byIdemKey.set(stored.idempotency_key, stored.id);

      // [4b] CAS-supersede the soft targets WHERE superseded_by IS NULL (a lost race affects 0 rows → dropped).
      const superseded: string[] = [];
      if (decision.kind === 'soft') {
        for (const targetId of decision.targetIds) {
          const t = this.memories.get(targetId);
          if (t && t.superseded_by === null) {
            t.superseded_by = stored.id;
            t._clock = this.clock++; // supersede bumps the target's watermark too
            superseded.push(targetId);
          }
        }
        if (superseded.length > 0) {
          await this.deps.events.superseded({ task_id: task.taskId, memory_id: stored.id, superseded, on_race: rewrote });
        }
      }

      await this.deps.events.memoryWritten({ task_id: task.taskId, memory_id: stored.id, type: stored.type, source: stored.source, superseded_count: superseded.length });
      return { status: 'committed', memoryId: stored.id, superseded, conflictId: null, rewrote };
    } finally {
      release();
    }
  }

  private quarantinePending(draft: MemoryDraft, conflictingIds: string[], _reason: string): string {
    const id = nextId('conf');
    this.conflicts.push({
      id,
      new_memory: draftToJson(draft),
      conflicting_memory_ids: [...conflictingIds],
      state: 'pending',
      escalated_at: null,
      created_at: new Date(this.clock++).toISOString(),
    });
    return id;
  }

  async escalateOverdueConflicts(now: number = Date.now()): Promise<string[]> {
    const escalated: string[] = [];
    const deadlineMs = this.reviewEscalationDays * 24 * 60 * 60 * 1000;
    for (const c of this.conflicts) {
      if (c.state !== 'pending') continue;
      const age = now - Date.parse(c.created_at);
      if (age >= deadlineMs) {
        c.state = 'escalated';
        c.escalated_at = new Date(now).toISOString();
        escalated.push(c.id);
        await this.deps.events.conflictQuarantined({ conflict_id: c.id, escalated: true, reason: 'overdue past review_escalation_days' });
      }
    }
    return escalated;
  }
}

function draftToJson(draft: MemoryDraft): Record<string, unknown> {
  // The quarantine stores the PENDING candidate (not in the live set), without the raw embedding (large, and the
  // vector is reproduced on human-approve). Golden rule: source_ref is kept; content is enrichment, not a copy.
  const { embedding: _omit, ...rest } = draft;
  return { ...rest };
}
