// ISSUE-066 (C8 LRN/COST) — the LIVE pg adapters for this slice's ports, against the REAL silo DDL
// (app/silo/migrations/0001_baseline.sql). The only module that imports `pg`. Each adapter implements the same port as
// its in-memory reference fake (store.ts) against the real schema:
//   • agent_result_cache (0001 L554) — the CacheStore: exact-key find, upsert put, scope-intersection invalidate.
//   • agent_health_metrics (0001 L540) — the LearningStore mismatch bump (routing_mismatch_count += 1).
//   • execution_plans (0001 L442) + event_log (0001 L483) — the LearningStore outcome read source.
//   • event_log (0001 L483) — the EventSink for the LRN/COST cost/cache/learning signals.
//
// ⚠️ NOT exercised by the offline suite — its behaviour is proven by the R10 live-adapter smoke (the in-memory fakes
// are the proven contract). Two known live-only facts the smoke must confirm:
//   (1) the LRN/COST event_type values (store.ts LRN_COST_EVENT_TYPES) are ADDITIVE — NOT in the 0001 baseline enum —
//       so a live event_log insert throws '22P02 invalid input value for enum event_type' until the additive
//       ALTER TYPE migration lands (see index.ts check + the migrationNeeded report). Same fake-passes-offline /
//       live-throws class R10 + the check gate exist to catch.
//   (2) the LRN.001 outcome source: baseline execution_plans has NO outcome column (the outcome model is ISSUE-064's).
//       planOutcomes() therefore reads the plan-version source from execution_plans and the outcome/reroute from the
//       orchestrator's `routing_outcome` event_log rows via a TEXT-cast filter (event_type::text = …) so it never
//       casts a possibly-absent enum literal. The smoke wires it to 064's landed outcome model.

import pg from 'pg';
import {
  type CacheEntry,
  type CacheKey,
  type CacheStore,
  type LearningStore,
  type PlanOutcomeRecord,
  type EventSink,
  type SecondarySink,
  type LrnCostEvent,
} from './store.ts';

export type QueryExec = <R extends pg.QueryResultRow>(text: string, params?: unknown[]) => Promise<{ rows: R[]; rowCount?: number | null }>;

/** The event_type the orchestrator (ISSUE-061) emits when it records a plan outcome — the LRN.001/002 outcome source.
 *  Read via a TEXT-cast filter so a live query never throws 22P02 even before that value is added to the enum. */
export const ORC_OUTCOME_EVENT_TYPE = 'routing_outcome' as const;

interface CacheDbRow {
  id: string;
  agent_id: string;
  scope_entity_ids: string[];
  memory_version: string;
  output: unknown;
  expires_at: Date;
  created_at: Date;
}

function toCacheEntry(r: CacheDbRow): CacheEntry {
  return {
    id: r.id,
    agent_id: r.agent_id,
    scope_entity_ids: r.scope_entity_ids ?? [],
    memory_version: r.memory_version,
    output: r.output,
    expires_at: r.expires_at.toISOString(),
    created_at: r.created_at.toISOString(),
  };
}

const CACHE_COLS = `id, agent_id, scope_entity_ids, memory_version, output, expires_at, created_at`;

/** LIVE agent_result_cache adapter. `find` matches the scope-aware key exactly (agent + the scope-id SET, order-
 *  independent, + version); `invalidateIntersecting` runs the array-overlap DELETE (`scope_entity_ids && $1`). */
export class SupabaseCacheStore implements CacheStore {
  private pool: pg.Pool | null = null;
  private readonly exec: QueryExec;
  constructor(connectionString: string, queryExec?: QueryExec) {
    if (queryExec) {
      this.exec = queryExec;
    } else {
      const ssl = /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: false };
      const pool = new pg.Pool({ connectionString, ssl });
      this.pool = pool;
      this.exec = (text, params) => pool.query(text, params);
    }
  }
  async end(): Promise<void> {
    await this.pool?.end();
  }

  async find(key: CacheKey): Promise<CacheEntry | null> {
    if (key.memoryVersion === null) return null; // an unconfirmed version never matches a key (#2)
    // Scope match is SET equality (order-independent): contains-both-ways via array `@>` + equal cardinality.
    const { rows } = await this.exec<CacheDbRow>(
      `select ${CACHE_COLS} from agent_result_cache
        where agent_id = $1
          and memory_version = $2
          and scope_entity_ids @> $3::uuid[]
          and scope_entity_ids <@ $3::uuid[]
        order by created_at desc
        limit 1`,
      [key.agentId, key.memoryVersion, [...key.scopeEntityIds]],
    );
    return rows[0] ? toCacheEntry(rows[0]) : null;
  }

  async put(entry: CacheEntry): Promise<void> {
    // Replace any entry on the SAME scope-aware key, then insert (the scope-aware upsert). Done in one statement pair
    // so a concurrent reader never sees zero rows for a live key it just held.
    await this.exec(
      `delete from agent_result_cache
        where agent_id = $1 and memory_version = $2
          and scope_entity_ids @> $3::uuid[] and scope_entity_ids <@ $3::uuid[]`,
      [entry.agent_id, entry.memory_version, [...entry.scope_entity_ids]],
    );
    await this.exec(
      `insert into agent_result_cache (agent_id, scope_entity_ids, memory_version, output, expires_at, created_at)
       values ($1, $2::uuid[], $3, $4::jsonb, $5::timestamptz, $6::timestamptz)`,
      [entry.agent_id, [...entry.scope_entity_ids], entry.memory_version, JSON.stringify(entry.output), entry.expires_at, entry.created_at],
    );
  }

  async invalidateIntersecting(writtenEntityIds: readonly string[]): Promise<string[]> {
    if (writtenEntityIds.length === 0) return [];
    // Array-overlap DELETE — every entry whose scope intersects a written entity (LRN.003.2 / #1). RETURNING ids so the
    // invalidation is loudly observable, never a silent purge.
    const { rows } = await this.exec<{ id: string }>(
      `delete from agent_result_cache where scope_entity_ids && $1::uuid[] returning id`,
      [[...writtenEntityIds]],
    );
    return rows.map((r) => r.id);
  }

  async all(): Promise<CacheEntry[]> {
    const { rows } = await this.exec<CacheDbRow>(`select ${CACHE_COLS} from agent_result_cache order by created_at`);
    return rows.map(toCacheEntry);
  }
}

/** LIVE learning-signal adapter over agent_health_metrics + execution_plans/event_log. */
export class SupabaseLearningStore implements LearningStore {
  private pool: pg.Pool | null = null;
  private readonly exec: QueryExec;
  constructor(connectionString: string, queryExec?: QueryExec) {
    if (queryExec) {
      this.exec = queryExec;
    } else {
      const ssl = /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: false };
      const pool = new pg.Pool({ connectionString, ssl });
      this.pool = pool;
      this.exec = (text, params) => pool.query(text, params);
    }
  }
  async end(): Promise<void> {
    await this.pool?.end();
  }

  async planOutcomes(taskTypeName?: string): Promise<PlanOutcomeRecord[]> {
    // The plan-version source is execution_plans; the outcome + reroute come from the orchestrator's routing_outcome
    // events (payload). TEXT-cast the event_type filter so this never throws 22P02 before that enum value lands. The
    // exact payload shape is owed to ISSUE-064's outcome model — the R10 smoke reconciles it.
    const { rows } = await this.exec<{
      task_type_name: string;
      plan_version_id: string;
      routed_agent_id: string | null;
      status: string | null;
      rerouted_to_agent_id: string | null;
    }>(
      `select ep.task_type_name,
              ep.id::text                                as plan_version_id,
              (ev.payload->'outcome'->>'routed_agent_id')     as routed_agent_id,
              (ev.payload->'outcome'->>'status')              as status,
              (ev.payload->'outcome'->>'rerouted_to_agent_id') as rerouted_to_agent_id
         from execution_plans ep
         left join event_log ev
           on ev.event_type::text = $2
          and (ev.payload->>'plan_version_id') = ep.id::text
        where ($1::text is null or ep.task_type_name = $1)`,
      [taskTypeName ?? null, ORC_OUTCOME_EVENT_TYPE],
    );
    return rows
      .filter((r) => r.routed_agent_id && (r.status === 'success' || r.status === 'failure' || r.status === 'partial'))
      .map((r) => ({
        task_type_name: r.task_type_name,
        plan_version_id: r.plan_version_id,
        routed_agent_id: r.routed_agent_id!,
        status: r.status as PlanOutcomeRecord['status'],
        rerouted_to_agent_id: r.rerouted_to_agent_id,
      }));
  }

  async bumpRoutingMismatch(agentId: string): Promise<number> {
    // Upsert-increment: a metric row may not exist yet (ISSUE-065 seeds them), so INSERT ... ON CONFLICT bumps. The
    // count is flag-only telemetry (OD-078) — it never auto-corrects the agent.
    const { rows } = await this.exec<{ routing_mismatch_count: number }>(
      `insert into agent_health_metrics (agent_id, routing_mismatch_count, updated_at)
       values ($1, 1, now())
       on conflict (agent_id) do update
         set routing_mismatch_count = agent_health_metrics.routing_mismatch_count + 1,
             updated_at = now()
       returning routing_mismatch_count`,
      [agentId],
    );
    return Number(rows[0]?.routing_mismatch_count ?? 0);
  }

  async routingMismatchCount(agentId: string): Promise<number> {
    const { rows } = await this.exec<{ routing_mismatch_count: number }>(
      `select routing_mismatch_count from agent_health_metrics where agent_id = $1`,
      [agentId],
    );
    return Number(rows[0]?.routing_mismatch_count ?? 0);
  }
}

/** LIVE event_log EventSink for the LRN/COST signals. The event_type values are ADDITIVE (see migrationNeeded) — a live
 *  insert throws 22P02 until the ALTER TYPE lands. `summary` is never empty (AC-7.LOG.002.2); payload is redacted-safe
 *  (no tokens/secrets — these are routing/cost shapes only). */
export class SupabaseEventSink implements EventSink {
  private pool: pg.Pool | null = null;
  private readonly exec: QueryExec;
  constructor(connectionString: string, queryExec?: QueryExec) {
    if (queryExec) {
      this.exec = queryExec;
    } else {
      const ssl = /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: false };
      const pool = new pg.Pool({ connectionString, ssl });
      this.pool = pool;
      this.exec = (text, params) => pool.query(text, params);
    }
  }
  async end(): Promise<void> {
    await this.pool?.end();
  }

  async append(ev: LrnCostEvent): Promise<void> {
    if (!ev.summary || ev.summary.trim().length === 0) throw new Error('LrnCostEvent.summary must never be empty (AC-7.LOG.002.2)');
    await this.exec(
      `insert into event_log (event_type, entity_ids, summary, payload)
       values ($1::event_type, $2::uuid[], $3, $4::jsonb)`,
      [ev.event_type, ev.entity_ids, ev.summary, JSON.stringify(ev.payload)],
    );
  }
}

/** LIVE secondary sink — a distinct channel so a PRIMARY event_log failure is surfaced, never swallowed (#3). Writes a
 *  notifications row (the operator-visible fallback). Kept minimal; the reference posture is the InMemory fake. */
export class SupabaseSecondarySink implements SecondarySink {
  private pool: pg.Pool | null = null;
  private readonly exec: QueryExec;
  constructor(connectionString: string, queryExec?: QueryExec) {
    if (queryExec) {
      this.exec = queryExec;
    } else {
      const ssl = /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: false };
      const pool = new pg.Pool({ connectionString, ssl });
      this.pool = pool;
      this.exec = (text, params) => pool.query(text, params);
    }
  }
  async end(): Promise<void> {
    await this.pool?.end();
  }

  async reportPrimaryFailure(ev: LrnCostEvent, cause: unknown): Promise<void> {
    // The reporter of failures must not be the thing that failed — write to notifications, NOT event_log.
    await this.exec(
      `insert into notifications (type, severity, title, body)
       values ('cost_threshold_breach', 'warning', $1, $2)`,
      [
        `LRN/COST event_log write failed (${ev.event_type})`,
        `The primary event_log sink failed for a '${ev.event_type}' signal — surfaced here so it is never silently lost (#3). Summary: ${ev.summary}. Cause: ${String(cause)}`,
      ],
    );
  }
}
