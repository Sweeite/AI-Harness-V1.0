// ISSUE-066 (C8 LRN/COST) — the ports + in-memory reference fakes for the orchestrator feedback loop (house
// port+fake pattern, cf. app/orchestrator, app/maturity, app/retrieval). Every live read/side-effect this slice
// performs goes through one of these ports so the whole loop (cost-routing, result cache, learning) is unit-testable
// with NO live DB, and the in-memory fakes are BOTH the test doubles AND the reference models the live pg adapter
// (supabase-store.ts) must match 1:1 (proven by the R10 smoke).
//
// The three non-negotiables shape these ports:
//   #1  the cache never serves stale knowledge — invalidation is a first-class store operation (invalidateIntersecting)
//       that DELETES every entry whose scope intersects a written entity; the fake and the live DELETE agree.
//   #2  a scope the caller cannot confirm never yields a hit — the miss-on-uncertainty guard lives in cache.ts above
//       the store, so the store never has to guess (it does exact-key lookup only).
//   #3  every routing/cache/learning decision is emitted to an EventSink; a PRIMARY-sink write failure is surfaced via
//       the SecondarySink (the reporter of failures must not be the thing that failed) — nothing silently drops.

// ── agent_result_cache (baseline 0001 L554) — the dedicated, auditable cache row ────────────────────────────────
/** One `agent_result_cache` row. `scope_entity_ids` + `memory_version` form the scope-aware key (OD-076); the entry
 *  is live iff `now < expires_at` AND no in-scope entity has been written since it was cached. `output` is the cached
 *  agent result (jsonb). */
export interface CacheEntry {
  id: string;
  agent_id: string;
  scope_entity_ids: string[];
  memory_version: string;
  output: unknown;
  expires_at: string; // ISO-8601
  created_at: string; // ISO-8601
}

/** The scope-aware composite key a lookup/write is performed against. `memoryVersion` is the last-write/version
 *  component (e.g. a hash or the max updated_at of the in-scope memories) — `null` is an UNCONFIRMED version, which
 *  the cache.ts guard treats as a forced miss (never a key match). */
export interface CacheKey {
  agentId: string;
  scopeEntityIds: readonly string[];
  memoryVersion: string | null;
}

/** The store surface for the result cache (LRN.003 / NFR-PERF.012). Deliberately THIN: exact-key lookup + write +
 *  scope-intersection invalidation. All window / uncertainty policy lives in cache.ts (single source of truth), so a
 *  fake-vs-live divergence cannot arise from a predicate pushed into SQL. */
export interface CacheStore {
  /** The entry EXACTLY matching (agent_id, the scope-id SET, memory_version), or null. Does NOT apply the window —
   *  cache.ts checks `expires_at` so there is one clock. A `null` memoryVersion never matches (the caller must have a
   *  confirmed version to even attempt a hit). */
  find(key: CacheKey): Promise<CacheEntry | null>;
  /** Upsert the entry for its scope-aware key (replacing any prior entry on the same key). */
  put(entry: CacheEntry): Promise<void>;
  /** WRITE-TRIGGERED invalidation (LRN.003.2 / #1): delete EVERY entry whose `scope_entity_ids` intersects any of
   *  `writtenEntityIds`. Returns the ids of the entries invalidated (for the loud observability event). */
  invalidateIntersecting(writtenEntityIds: readonly string[]): Promise<string[]>;
  /** All entries — audit / test seam (the live adapter reads the table). */
  all(): Promise<CacheEntry[]>;
}

// ── execution_plans outcomes + agent_health_metrics (baseline 0001 L442 / L540) — the learning inputs ───────────
/** A tracked plan outcome, the LRN.001/LRN.002 input. Sourced live from execution_plans (the plan-version chain) +
 *  the orchestrator's `routing_outcome` events; the fake supplies them directly. `rerouted_to_agent_id` is set when a
 *  task originally routed to `routed_agent_id` was actually handled by a different agent — the LRN.002 reroute signal. */
export interface PlanOutcomeRecord {
  task_type_name: string;
  plan_version_id: string;
  routed_agent_id: string;
  status: 'success' | 'failure' | 'partial';
  rerouted_to_agent_id?: string | null;
}

/** The learning-signal store: read tracked outcomes (LRN.001/002) + bump the routing-mismatch metric (LRN.002). The
 *  mismatch metric is PRODUCED here and flag-only — never auto-corrects an agent (OD-078); the fix is the agent
 *  DESCRIPTION (data), surfaced as a suggestion, never code. */
export interface LearningStore {
  /** Tracked plan outcomes for a task type (all task types when `taskTypeName` is omitted). */
  planOutcomes(taskTypeName?: string): Promise<PlanOutcomeRecord[]>;
  /** Increment `agent_health_metrics.routing_mismatch_count` for an agent; returns the new count. */
  bumpRoutingMismatch(agentId: string): Promise<number>;
  /** Read the current routing-mismatch count for an agent (0 if no row). */
  routingMismatchCount(agentId: string): Promise<number>;
}

// ── event_log observability (schema §8) — the loud cost/cache/learning signal ────────────────────────────────────
/** The additive event_type values this slice writes (NONE are in the 0001 baseline enum — they need a serial
 *  ALTER TYPE migration; see index.ts check + the migrationNeeded report). Named consts so the offline check gate
 *  asserts their presence in the migration corpus before a live insert can throw 22P02. */
export const EVT_COST_TIER = 'routing_cost_tier' as const; // COST.001 — chosen cost tier
export const EVT_COST_SHAPE = 'routing_cost_shape' as const; // COST.003 — expected call profile for C7
export const EVT_LEARNING_ADJUSTED = 'routing_learning_adjusted' as const; // LRN.001 — observable+reversible adjustment
export const EVT_MISMATCH_DETECTED = 'routing_mismatch_detected' as const; // LRN.002 — description-update suggestion
export const EVT_CACHE_HIT = 'agent_cache_hit' as const; // LRN.003.1
export const EVT_CACHE_MISS = 'agent_cache_miss' as const; // LRN.003.3 (cold / expired / uncertain)
export const EVT_CACHE_INVALIDATED = 'agent_cache_invalidated' as const; // LRN.003.2 — write-triggered

export const LRN_COST_EVENT_TYPES = [
  EVT_COST_TIER,
  EVT_COST_SHAPE,
  EVT_LEARNING_ADJUSTED,
  EVT_MISMATCH_DETECTED,
  EVT_CACHE_HIT,
  EVT_CACHE_MISS,
  EVT_CACHE_INVALIDATED,
] as const;
export type LrnCostEventType = (typeof LRN_COST_EVENT_TYPES)[number];

/** One event_log append (mirrors schema §8 shape; `summary` never empty, per AC-7.LOG.002.2). */
export interface LrnCostEvent {
  event_type: LrnCostEventType;
  entity_ids: string[];
  summary: string;
  payload: Record<string, unknown>;
}
export interface EventSink {
  append(ev: LrnCostEvent): Promise<void>;
}
/** The SECONDARY sink — used ONLY to surface a PRIMARY-sink write failure ("the reporter of failures must not be the
 *  thing that failed", #3). Never the happy path. */
export interface SecondarySink {
  reportPrimaryFailure(ev: LrnCostEvent, cause: unknown): Promise<void>;
}

// ── In-memory reference fakes ────────────────────────────────────────────────────────────────────────────────────
/** The reference cache: an id-keyed map with exact-key lookup + scope-intersection invalidation, EXACTLY as the live
 *  DELETE does. `find` matches on the scope-id SET (order-independent) + memory_version; `null` memoryVersion never
 *  matches. The fake performing the same set-intersection the live SQL (`scope_entity_ids && $1`) does is what makes a
 *  green offline suite predict live behaviour (R10). */
export class InMemoryCacheStore implements CacheStore {
  private entries: CacheEntry[] = [];
  private seq = 0;

  constructor(seed: CacheEntry[] = []) {
    this.entries = seed.map((e) => this.clone(e));
  }

  private clone(e: CacheEntry): CacheEntry {
    return { ...e, scope_entity_ids: [...e.scope_entity_ids] };
  }
  private sameScope(a: readonly string[], b: readonly string[]): boolean {
    if (a.length !== b.length) return false;
    const sa = new Set(a);
    for (const x of b) if (!sa.has(x)) return false;
    return true;
  }

  async find(key: CacheKey): Promise<CacheEntry | null> {
    if (key.memoryVersion === null) return null; // an unconfirmed version can never match a key (#2)
    const hit = this.entries.find(
      (e) =>
        e.agent_id === key.agentId &&
        e.memory_version === key.memoryVersion &&
        this.sameScope(e.scope_entity_ids, key.scopeEntityIds),
    );
    return hit ? this.clone(hit) : null;
  }

  async put(entry: CacheEntry): Promise<void> {
    const id = entry.id || `cache_${++this.seq}`;
    // Replace any entry on the SAME scope-aware key (agent + scope set + version), then insert — the live upsert
    // keys on (agent_id, scope_entity_ids, memory_version).
    this.entries = this.entries.filter(
      (e) =>
        !(
          e.agent_id === entry.agent_id &&
          e.memory_version === entry.memory_version &&
          this.sameScope(e.scope_entity_ids, entry.scope_entity_ids)
        ),
    );
    this.entries.push(this.clone({ ...entry, id }));
  }

  async invalidateIntersecting(writtenEntityIds: readonly string[]): Promise<string[]> {
    if (writtenEntityIds.length === 0) return [];
    const written = new Set(writtenEntityIds);
    const dropped: string[] = [];
    this.entries = this.entries.filter((e) => {
      const intersects = e.scope_entity_ids.some((id) => written.has(id));
      if (intersects) dropped.push(e.id);
      return !intersects;
    });
    return dropped;
  }

  async all(): Promise<CacheEntry[]> {
    return this.entries.map((e) => this.clone(e));
  }
}

/** The reference learning store: seeded plan outcomes + an in-memory mismatch-count map. */
export class InMemoryLearningStore implements LearningStore {
  private outcomes: PlanOutcomeRecord[];
  private mismatch = new Map<string, number>();

  constructor(seed: { outcomes?: PlanOutcomeRecord[]; mismatch?: Record<string, number> } = {}) {
    this.outcomes = (seed.outcomes ?? []).map((o) => ({ ...o }));
    for (const [k, v] of Object.entries(seed.mismatch ?? {})) this.mismatch.set(k, v);
  }

  async planOutcomes(taskTypeName?: string): Promise<PlanOutcomeRecord[]> {
    const rows = taskTypeName === undefined ? this.outcomes : this.outcomes.filter((o) => o.task_type_name === taskTypeName);
    return rows.map((o) => ({ ...o }));
  }
  async bumpRoutingMismatch(agentId: string): Promise<number> {
    const next = (this.mismatch.get(agentId) ?? 0) + 1;
    this.mismatch.set(agentId, next);
    return next;
  }
  async routingMismatchCount(agentId: string): Promise<number> {
    return this.mismatch.get(agentId) ?? 0;
  }
}

/** The reference event sink: collects appended events; `failNext` forces a primary-write failure so the SecondarySink
 *  path (#3) is exercisable. */
export class InMemoryEventSink implements EventSink, SecondarySink {
  readonly events: LrnCostEvent[] = [];
  readonly secondary: Array<{ ev: LrnCostEvent; cause: unknown }> = [];
  failNext = false;

  async append(ev: LrnCostEvent): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('primary event_log sink failed (injected)');
    }
    if (!ev.summary || ev.summary.trim().length === 0) {
      throw new Error('LrnCostEvent.summary must never be empty (AC-7.LOG.002.2 / #3)');
    }
    this.events.push({ ...ev, entity_ids: [...ev.entity_ids], payload: { ...ev.payload } });
  }
  async reportPrimaryFailure(ev: LrnCostEvent, cause: unknown): Promise<void> {
    this.secondary.push({ ev: { ...ev }, cause });
  }
  ofType(t: LrnCostEventType): LrnCostEvent[] {
    return this.events.filter((e) => e.event_type === t);
  }
}

/** Emit through the primary sink; on failure surface via the secondary sink (never silently drop, #3). Shared by all
 *  three slices so the failure posture is identical everywhere. */
export async function emitEvent(events: EventSink, secondary: SecondarySink, ev: LrnCostEvent): Promise<void> {
  try {
    await events.append(ev);
  } catch (err) {
    await secondary.reportPrimaryFailure(ev, err);
  }
}
