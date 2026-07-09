// ISSUE-023 (C2 VEC) — FR-2.VEC.003: the embedding-model change as a ZERO-DOWNTIME EXPAND-CONTRACT migration. Changing
// CFG-embedding_model (REBUILD-class) invalidates every existing embedding (different vectors/dims), so the model is
// NEVER swapped in place (that would orphan the whole corpus — the #1 failure). Instead:
//
//   expand         → add the embedding_v2 column (already in the 0001 baseline slot) + build its HNSW index CONCURRENTLY
//   backfill       → a background job re-embeds every LIVE row into embedding_v2 under the new model
//   reconcile_gate → BLOCK: 100% of live rows must carry a valid embedding_v2 before proceeding (the load-bearing gate)
//   switch_reads   → point retrieval at embedding_v2 (reads used the OLD column until here — no mixed-dimension query)
//   contract       → rename/drop the old column + rebuild the index on the new column
//
// The reconcile gate (AC-2.VEC.003.2) is the whole point: dropping the old column while ANY live row lacks a valid
// embedding_v2 would silently make those rows unsearchable on the vector arm (#1/#3). A partial backfill (the
// FR-2.WRT.007 provider-fragility case — some rows never re-embedded) HALTS the migration before contract with a loud
// alert. This module is the PURE state machine + gate; the DDL/count operations are injected (live pg adapter or fake).

export type ModelChangePhase = 'expand' | 'backfill' | 'reconcile_gate' | 'switch_reads' | 'contract' | 'done';

export const MODEL_CHANGE_ORDER: readonly ModelChangePhase[] = [
  'expand',
  'backfill',
  'reconcile_gate',
  'switch_reads',
  'contract',
  'done',
] as const;

export interface ReconcileStatus {
  liveRows: number;
  validV2Rows: number;
  shortfall: number; // liveRows - validV2Rows; 0 = complete
  completePct: number; // validV2Rows / liveRows * 100 (100 when liveRows == 0)
  complete: boolean;
}

export class ReconcileShortfallError extends Error {
  constructor(readonly status: ReconcileStatus) {
    super(
      `embeddings: re-embed reconcile gate FAILED — ${status.validV2Rows}/${status.liveRows} live rows have a valid ` +
        `embedding_v2 (${status.shortfall} short, ${status.completePct.toFixed(2)}%). The contract/drop-old step is ` +
        `BLOCKED (AC-2.VEC.003.2); the migration halts with an alert — no row is left unsearchable.`,
    );
    this.name = 'ReconcileShortfallError';
  }
}

/** The DDL + count operations the expand-contract sequence drives. Injected so the state machine is testable offline
 * (fake) and runnable live (SupabaseVectorAdmin). Each is a discrete, individually-observable step. */
export interface ModelChangeOps {
  /** expand: add the embedding_v2 column (idempotent — the baseline slot) + build memories_embedding_v2_hnsw CONCURRENTLY. */
  expand(newModel: string): Promise<void>;
  /** backfill: re-embed live rows into embedding_v2 under newModel; returns how many rows now carry a valid v2. */
  backfill(newModel: string): Promise<{ embedded: number }>;
  /** counts for the reconcile gate — MUST read the live corpus at gate time (never a cached count). */
  liveRowCount(): Promise<number>;
  validV2Count(): Promise<number>;
  /** switch_reads: repoint retrieval to embedding_v2 (config/read-path switch; reversible until contract). */
  switchReads(newModel: string): Promise<void>;
  /** contract: rename/drop the old embedding column + rebuild the index on the new column. Destructive — only after the gate. */
  contract(newModel: string): Promise<void>;
}

/** Loud observability (FR-2.VEC.003 Observability): re-embed progress + reconcile completeness % + the blocked halt,
 * to event_log (#3 — never a silent migration). Injected; a no-op sink is allowed but a live deployment wires the DB one. */
export interface ModelChangeObserver {
  onPhase(phase: ModelChangePhase, newModel: string): void;
  onReconcile(status: ReconcileStatus, newModel: string): void;
  onBlocked(status: ReconcileStatus, newModel: string): void;
}

export const noopObserver: ModelChangeObserver = {
  onPhase() {},
  onReconcile() {},
  onBlocked() {},
};

/** Read the live counts and compute the reconcile status. Pure over the injected counts (which MUST be live). */
export async function reconcileGate(ops: Pick<ModelChangeOps, 'liveRowCount' | 'validV2Count'>): Promise<ReconcileStatus> {
  const liveRows = await ops.liveRowCount();
  const validV2Rows = await ops.validV2Count();
  const shortfall = Math.max(0, liveRows - validV2Rows);
  const complete = liveRows === 0 ? true : validV2Rows >= liveRows;
  const completePct = liveRows === 0 ? 100 : (Math.min(validV2Rows, liveRows) / liveRows) * 100;
  return { liveRows, validV2Rows, shortfall, completePct, complete };
}

/**
 * Drive the full expand-contract sequence for a model change. The contract/drop-old step runs ONLY after the reconcile
 * gate reads 100% complete against the LIVE corpus (re-checked here, immediately before contract — never trusting the
 * backfill's own return count, which could race a concurrent insert). A shortfall throws ReconcileShortfallError and
 * the migration halts BEFORE contract, with an onBlocked alert (AC-2.VEC.003.1/.2). Returns the final reconcile status.
 */
export async function runModelChange(
  newModel: string,
  ops: ModelChangeOps,
  observer: ModelChangeObserver = noopObserver,
): Promise<ReconcileStatus> {
  if (typeof newModel !== 'string' || newModel.trim().length === 0) {
    throw new Error('embeddings: a model change requires a non-empty target model name (CFG-embedding_model)');
  }

  observer.onPhase('expand', newModel);
  await ops.expand(newModel);

  observer.onPhase('backfill', newModel);
  await ops.backfill(newModel);

  // reconcile_gate — read LIVE counts NOW (a row inserted during backfill under the OLD model still lacks a valid v2,
  // so a fresh live re-check is the only honest gate; the backfill's own count can be stale/racing).
  observer.onPhase('reconcile_gate', newModel);
  const status = await reconcileGate(ops);
  observer.onReconcile(status, newModel);
  if (!status.complete) {
    observer.onBlocked(status, newModel);
    throw new ReconcileShortfallError(status); // HALT before contract — no orphaned/unsearchable rows (#1).
  }

  observer.onPhase('switch_reads', newModel);
  await ops.switchReads(newModel);

  observer.onPhase('contract', newModel);
  await ops.contract(newModel);

  observer.onPhase('done', newModel);
  return status;
}
