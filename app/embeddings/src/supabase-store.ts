// ISSUE-023 (C2 VEC) — the LIVE pg adapter for the VectorAdmin port, against the REAL silo DDL:
//   • memories (baseline 0001) — embedding / embedding_model / embedding_v2 (vector(1536)); the reconcile counts + the
//     model-change DDL run here.
//   • memories_embedding_hnsw (0001b_indexes) — the HNSW index whose documented params (m=16, ef_construction=64) the
//     assertion reads back from pg_class.reloptions (AC-2.VEC.001.1).
//   • event_log (0001) — the loud model-change / re-embed-progress / reconcile-blocked observability (event_types added
//     additively in 0038; a live insert of an unlisted value throws 22P02, which the `check` gate forbids silently).
//
// ⚠️ Verify with the R10 live-adapter smoke (results/live-smoke.sql) before claiming these paths proven. The in-memory
// reference model (store.ts) is the proven contract; this adapter must AGREE with the real schema (the fake-passes-
// offline / live-throws class R10 exists to catch).
//
// LIVE-SPECIFIC SAFETY: `contract()` (the destructive drop-old) RE-CHECKS the reconcile gate against the live corpus
// and refuses if any live row lacks a valid embedding_v2 — a destructive drop must never run on an incomplete backfill
// even if mis-sequenced (#1, defense-in-depth over runModelChange's own gate). CONCURRENTLY index builds run OUTSIDE a
// txn (they cannot run inside one) — so expand() uses the pool directly, never a transaction.

import pg from 'pg';
import {
  ReconcileShortfallError,
  reconcileGate,
  type ModelChangeObserver,
  type ModelChangePhase,
  type ReconcileStatus,
} from './model-change.ts';
import {
  hnswParamsMatch,
  type HnswIndexInfo,
  type RetrievalPlanProbe,
  type VectorAdmin,
} from './store.ts';
import { applyRetrievalSession, EF_SEARCH_DEFAULT } from './retrieval-session.ts';
import type { EmbeddingProvider } from './embed.ts';

export type QueryExec = <R extends pg.QueryResultRow>(text: string, params?: unknown[]) => Promise<{ rows: R[]; rowCount?: number | null }>;

/** The event_type values this slice writes (added additively in migration 0038). The check gate verifies they exist. */
export const EVT_MODEL_CHANGE = 'embedding_model_change' as const;
export const EVT_REEMBED_PROGRESS = 'embedding_reembed_progress' as const;
export const EVT_RECONCILE_BLOCKED = 'embedding_reconcile_blocked' as const;
export const EMBEDDING_EVENT_TYPES: readonly string[] = [EVT_MODEL_CHANGE, EVT_REEMBED_PROGRESS, EVT_RECONCILE_BLOCKED] as const;

// "live" = not superseded and not expired — only live rows gate the reconcile (a superseded/expired row is not read on
// the vector arm, so it need not carry a valid v2). This predicate is the single source of truth for both counts.
const LIVE_PRED = `superseded_by is null and (expires_at is null or expires_at > now())`;

export interface SupabaseVectorAdminDeps {
  queryExec?: QueryExec;
  /** The re-embed provider for backfill (OpenAI via the AI SDK at deploy). Un-wired → backfill THROWS (never fake-done). */
  reEmbed?: EmbeddingProvider;
  /** Read a row's content for re-embedding. Un-wired → backfill THROWS. */
  contentOf?: (id: string) => Promise<string>;
}

export class SupabaseVectorAdmin implements VectorAdmin {
  private pool: pg.Pool | null = null;
  private readonly exec: QueryExec;
  constructor(
    connectionString: string,
    private readonly deps: SupabaseVectorAdminDeps = {},
  ) {
    if (deps.queryExec) {
      this.exec = deps.queryExec;
    } else {
      const ssl = /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: false };
      const pool = new pg.Pool({ connectionString, ssl });
      this.pool = pool;
      this.exec = (text, params) => pool.query(text, params);
    }
  }

  // ── AC-2.VEC.001.1 — the HNSW index + its documented parameters, read from the catalog. ─────────────────────
  async hnswIndexInfo(): Promise<HnswIndexInfo | null> {
    const res = await this.exec<{ name: string; method: string; reloptions: string[] | null; indexdef: string }>(
      `select c.relname as name, am.amname as method, c.reloptions as reloptions, pg_get_indexdef(i.indexrelid) as indexdef
         from pg_index i
         join pg_class c on c.oid = i.indexrelid
         join pg_class t on t.oid = i.indrelid
         join pg_am am on am.oid = c.relam
        where t.relname = 'memories' and am.amname = 'hnsw'
        limit 1`,
    );
    const row = res.rows[0];
    if (!row) return null;
    const opts = new Map((row.reloptions ?? []).map((o) => {
      const eq = o.indexOf('=');
      return [o.slice(0, eq), o.slice(eq + 1)] as [string, string];
    }));
    const m = opts.has('m') ? Number(opts.get('m')) : null;
    const efc = opts.has('ef_construction') ? Number(opts.get('ef_construction')) : null;
    // column + opclass from the indexdef, e.g. "... USING hnsw (embedding vector_cosine_ops) WITH ...".
    const colMatch = row.indexdef.match(/using\s+hnsw\s*\(\s*(\w+)\s+(\w+)/i);
    return {
      name: row.name,
      method: row.method,
      column: colMatch?.[1] ?? 'embedding',
      m,
      efConstruction: efc,
      opclass: colMatch?.[2] ?? null,
    };
  }

  // ── the AF-019 retrieval-session contract, EXPLAINed — proves the scan is off seqscan under the contract. ────
  // NOTE: production retrieval query construction is ISSUE-025's; this is a DIAGNOSTIC that the session GUCs force the
  // index. The full recall/latency-under-RLS-at-50k proof is spikes/issue-023-hnsw-forcing (AF-019), not this call.
  async explainRetrieval(ef: number = EF_SEARCH_DEFAULT): Promise<RetrievalPlanProbe> {
    if (!this.pool) {
      // Injected-seam mode (tests): apply the contract through the seam so the wrapping is observable, then report the
      // fake plan the seam returns (the unit test asserts the GUCs were emitted, not a real planner decision).
      await applyRetrievalSession((sql) => this.exec(sql), ef);
      return { usesSeqScan: false, usesHnswIndex: true };
    }
    const probe = randomProbe();
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await applyRetrievalSession((sql) => client.query(sql), ef);
      const r = await client.query(
        `explain (format json) select id from memories order by embedding <=> $1::vector limit 7`,
        [probe],
      );
      await client.query('rollback');
      const plan = (r.rows[0] as any)['QUERY PLAN'][0];
      const s = JSON.stringify(plan);
      return { usesSeqScan: /Seq Scan/.test(s), usesHnswIndex: /memories_embedding_hnsw|Index Scan/.test(s), raw: plan };
    } catch (e) {
      await client.query('rollback').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  // ── reconcile-gate counts (AC-2.VEC.003.2) — read LIVE, never cached. ────────────────────────────────────────
  async liveRowCount(): Promise<number> {
    const r = await this.exec<{ c: string }>(`select count(*)::text as c from memories where ${LIVE_PRED}`);
    return Number(r.rows[0]!.c);
  }

  async validV2Count(): Promise<number> {
    const r = await this.exec<{ c: string }>(`select count(*)::text as c from memories where ${LIVE_PRED} and embedding_v2 is not null`);
    return Number(r.rows[0]!.c);
  }

  // ── model-change DDL (FR-2.VEC.003). expand/contract touch DDL; CONCURRENTLY runs outside a txn. ─────────────
  async expand(_newModel: string): Promise<void> {
    // idempotent: the embedding_v2 column is the baseline slot; the v2 HNSW index is built CONCURRENTLY (no txn).
    await this.exec(`alter table memories add column if not exists embedding_v2 vector(1536)`);
    await this.exec(
      `create index concurrently if not exists memories_embedding_v2_hnsw on memories using hnsw (embedding_v2 vector_cosine_ops) with (m = 16, ef_construction = 64)`,
    );
  }

  async backfill(newModel: string): Promise<{ embedded: number }> {
    // The re-embed EXECUTION is an injected seam (the embed provider). Un-wired → THROW (never report a fake-done
    // backfill — a silently-skipped backfill would then fail the reconcile gate, but failing loud HERE is #3-correct).
    const provider = this.deps.reEmbed;
    const contentOf = this.deps.contentOf;
    if (!provider || !contentOf) {
      throw new Error('embeddings: backfill requires an injected reEmbed provider + contentOf reader (onboarding wiring) — refusing to report a fake-done backfill');
    }
    const rows = await this.exec<{ id: string }>(`select id::text as id from memories where ${LIVE_PRED} and embedding_v2 is null`);
    let embedded = 0;
    for (const { id } of rows.rows) {
      const content = await contentOf(id);
      const vec = await provider.embed(content, newModel);
      await this.exec(`update memories set embedding_v2 = $1::vector where id = $2::uuid`, [`[${vec.join(',')}]`, id]);
      embedded++;
    }
    return { embedded };
  }

  async switchReads(newModel: string): Promise<void> {
    // The read-path repoint is consumed by ISSUE-025 (retrieval reads embedding_v2 after the switch) + CFG-embedding_model
    // (config-store, REBUILD). This adapter records the switch as a loud event so the migration is never silent (#3).
    await this.emitEvent(EVT_MODEL_CHANGE, `embedding read path switched to embedding_v2 (model ${newModel})`, { new_model: newModel, phase: 'switch_reads' });
  }

  async contract(newModel: string): Promise<void> {
    // DEFENSE IN DEPTH (#1): re-check the gate against the LIVE corpus before any destructive drop, even though
    // runModelChange already gated. A destructive drop on an incomplete backfill orphans rows — forbidden.
    const status = await reconcileGate(this);
    if (!status.complete) {
      await this.emitEvent(EVT_RECONCILE_BLOCKED, `contract BLOCKED — reconcile incomplete (${status.validV2Rows}/${status.liveRows})`, { new_model: newModel, ...status });
      throw new ReconcileShortfallError(status);
    }
    // expand-contract contract step: promote embedding_v2 → embedding, rebuild the index on the new column. Executed as
    // discrete DDL; the old HNSW index is dropped only after the new column is in place (never a destructive in-place swap).
    await this.exec(`alter table memories drop column embedding`);
    await this.exec(`alter table memories rename column embedding_v2 to embedding`);
    await this.exec(`alter index memories_embedding_v2_hnsw rename to memories_embedding_hnsw`);
    await this.emitEvent(EVT_MODEL_CHANGE, `embedding model change contracted to ${newModel}`, { new_model: newModel, phase: 'contract' });
  }

  private async emitEvent(eventType: string, summary: string, payload: Record<string, unknown>): Promise<void> {
    await this.exec(
      `insert into event_log (event_type, entity_ids, summary, payload, created_at)
       values ($1::event_type, array[]::uuid[], $2, $3::jsonb, now())`,
      [eventType, summary, JSON.stringify(payload)],
    );
  }

  async close(): Promise<void> {
    await this.pool?.end();
  }
}

/** A live ModelChangeObserver writing phase/reconcile/blocked events to event_log (loud migration, #3). */
export class SupabaseModelChangeObserver implements ModelChangeObserver {
  constructor(private readonly exec: QueryExec) {}
  onPhase(phase: ModelChangePhase, newModel: string): void {
    void this.write(EVT_MODEL_CHANGE, `model change phase ${phase} (${newModel})`, { phase, new_model: newModel });
  }
  onReconcile(status: ReconcileStatus, newModel: string): void {
    void this.write(EVT_REEMBED_PROGRESS, `reconcile ${status.validV2Rows}/${status.liveRows} (${status.completePct.toFixed(2)}%)`, { new_model: newModel, ...status });
  }
  onBlocked(status: ReconcileStatus, newModel: string): void {
    void this.write(EVT_RECONCILE_BLOCKED, `reconcile BLOCKED ${status.validV2Rows}/${status.liveRows}`, { new_model: newModel, ...status });
  }
  private async write(eventType: string, summary: string, payload: Record<string, unknown>): Promise<void> {
    await this.exec(
      `insert into event_log (event_type, entity_ids, summary, payload, created_at) values ($1::event_type, array[]::uuid[], $2, $3::jsonb, now())`,
      [eventType, summary, JSON.stringify(payload)],
    );
  }
}

function randomProbe(): string {
  const parts = new Array(1536);
  for (let i = 0; i < 1536; i++) parts[i] = Math.random().toFixed(6);
  return `[${parts.join(',')}]`;
}

export { SupabaseVectorAdmin as default };
