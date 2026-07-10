// ISSUE-066 (C8 LRN.003 / NFR-PERF.012) — the scope-aware agent result cache. Pure logic over the CacheStore port,
// so the whole hit/miss/invalidate contract is provable offline against the in-memory reference model.
//
// The one invariant this file exists to hold: the cache NEVER serves stale knowledge (#1, OD-076). Three guards, in
// order, each of which fails to a MISS-and-recompute (the safe direction):
//   1. miss-on-uncertainty (LRN.003.3 / NFR-PERF.012.2) — if the caller cannot CONFIRM the scope (entity-extraction
//      confidence below floor, scope unresolved, an out-of-band write to a read-class the entry's agent reads) OR the
//      memory version is unknown, we do not even attempt a key match — recompute. Blind-spot-fails-safe.
//   2. window (LRN.003.1) — an entry is only reusable strictly BEFORE its per-agent-type expires_at.
//   3. write-triggered invalidation (LRN.003.2 / NFR-PERF.012.1) — a write to ANY in-scope entity DELETEs the entry
//      (driven by the Memory Agent's commit, the single nameable producer of the "entity X changed" signal), so a
//      relevant write drops the entry BEFORE the window expires. Time-window alone is rejected (OD-076) precisely
//      because it can serve a stale answer after a relevant write.
//
// COST-shape note: a hit/miss/invalidation is a cost signal (COST.003 substrate) — each is emitted to event_log.

import {
  type CacheEntry,
  type CacheKey,
  type CacheStore,
  type EventSink,
  type SecondarySink,
  EVT_CACHE_HIT,
  EVT_CACHE_MISS,
  EVT_CACHE_INVALIDATED,
  emitEvent,
} from './store.ts';
import { CACHE_TIME_WINDOW_DEFAULTS, type CacheableAgentType } from './config.ts';

/** The default entity-extraction confidence floor below which a lookup is treated as unconfirmed → forced miss. Lives
 *  here (not a live CFG) because it is the fail-safe posture threshold, not an operator dial; can be overridden per
 *  call. */
export const DEFAULT_SCOPE_CONFIDENCE_FLOOR = 0.7;

/** Why a lookup missed — recorded so the miss is never silent (#3) and the cost signal is attributable. */
export type MissReason = 'uncertain_scope' | 'uncertain_version' | 'cold' | 'expired';

export interface CacheLookupRequest {
  agentId: string;
  /** The agent type — selects the per-agent-type window on write (research 30 / client 60 / … / insight 1440). */
  agentType: CacheableAgentType;
  /** The RESOLVED in-scope entity ids (the keyword-scope of the agent's read). Empty = scope unresolved → uncertain. */
  scopeEntityIds: readonly string[];
  /** The last-write/memory version of the in-scope entities (e.g. max updated_at or a hash). `null` = unconfirmed. */
  memoryVersion: string | null;
  /** Entity-extraction confidence for the scope (0..1). Below the floor ⇒ uncertain ⇒ forced miss (LRN.003.3). */
  scopeConfidence: number;
  /** Set true when an out-of-band write touched an entity CLASS this agent reads but no specific keyed id could be
   *  resolved — the second clause of LRN.003.3. Fails safe to a miss even if a fresh entry exists. */
  classWriteUnresolved?: boolean;
  /** Optional override of the confidence floor. */
  confidenceFloor?: number;
}

export type CacheLookupResult =
  | { outcome: 'hit'; entry: CacheEntry }
  | { outcome: 'miss'; reason: MissReason };

/** Is a lookup's scope confirmable enough to even attempt a key match? The miss-on-uncertainty guard (LRN.003.3 /
 *  NFR-PERF.012.2). Pure + independently testable. */
export function scopeIsConfirmed(req: CacheLookupRequest): boolean {
  const floor = req.confidenceFloor ?? DEFAULT_SCOPE_CONFIDENCE_FLOOR;
  if (req.classWriteUnresolved === true) return false; // out-of-band class write, no resolvable id → blind spot
  if (req.scopeEntityIds.length === 0) return false; // scope unresolved
  if (req.scopeConfidence < floor) return false; // extraction confidence below floor
  return true;
}

/** LRN.003.1/.3 + NFR-PERF.012.2 — look up a cacheable agent result. Emits the hit/miss cost signal. On ANY
 *  uncertainty, misses (recomputes) rather than risk a stale hit. `nowMs` is caller-supplied (deterministic). */
export async function lookupCache(
  store: CacheStore,
  events: EventSink,
  secondary: SecondarySink,
  req: CacheLookupRequest,
  nowMs: number,
): Promise<CacheLookupResult> {
  // Guard 1 — miss-on-uncertainty (before any key match). Scope first, then version — each fails safe to a miss.
  if (!scopeIsConfirmed(req)) {
    await emitMiss(events, secondary, req, 'uncertain_scope');
    return { outcome: 'miss', reason: 'uncertain_scope' };
  }
  if (req.memoryVersion === null) {
    await emitMiss(events, secondary, req, 'uncertain_version');
    return { outcome: 'miss', reason: 'uncertain_version' };
  }

  // Key match (exact scope-aware key).
  const key: CacheKey = { agentId: req.agentId, scopeEntityIds: req.scopeEntityIds, memoryVersion: req.memoryVersion };
  const entry = await store.find(key);
  if (entry === null) {
    await emitMiss(events, secondary, req, 'cold');
    return { outcome: 'miss', reason: 'cold' };
  }

  // Guard 2 — window (strictly before expires_at).
  if (nowMs >= Date.parse(entry.expires_at)) {
    await emitMiss(events, secondary, req, 'expired');
    return { outcome: 'miss', reason: 'expired' };
  }

  await emitEvent(events, secondary, {
    event_type: EVT_CACHE_HIT,
    entity_ids: [...req.scopeEntityIds],
    summary: `Result-cache HIT for agent '${req.agentId}' (${req.agentType}) on ${req.scopeEntityIds.length} in-scope entity(ies) at version '${req.memoryVersion}' — reused within window (LRN.003.1).`,
    payload: { agent_id: req.agentId, agent_type: req.agentType, scope_entity_ids: [...req.scopeEntityIds], memory_version: req.memoryVersion, cache_id: entry.id },
  });
  return { outcome: 'hit', entry };
}

async function emitMiss(events: EventSink, secondary: SecondarySink, req: CacheLookupRequest, reason: MissReason): Promise<void> {
  await emitEvent(events, secondary, {
    event_type: EVT_CACHE_MISS,
    entity_ids: [...req.scopeEntityIds],
    summary: `Result-cache MISS (${reason}) for agent '${req.agentId}' (${req.agentType}) — recomputing rather than risk a stale hit (LRN.003.3 / NFR-PERF.012.2).`,
    payload: { agent_id: req.agentId, agent_type: req.agentType, reason, scope_entity_ids: [...req.scopeEntityIds], memory_version: req.memoryVersion, scope_confidence: req.scopeConfidence },
  });
}

/** LRN.003.1 write path — cache a fresh agent output with its scope-aware key + the per-agent-type window. `expires_at`
 *  = now + cache_time_window[agentType]. The window map is LIVE config (config.ts default mirrors config-registry §K). */
export async function writeCache(
  store: CacheStore,
  req: { agentId: string; agentType: CacheableAgentType; scopeEntityIds: readonly string[]; memoryVersion: string; output: unknown },
  nowMs: number,
  windowMinutes: Record<CacheableAgentType, number> = CACHE_TIME_WINDOW_DEFAULTS,
): Promise<CacheEntry> {
  const minutes = windowMinutes[req.agentType];
  if (!(minutes > 0)) {
    // A non-positive / missing window would mean an entry that never expires — refuse LOUD rather than cache forever (#1).
    throw new Error(`writeCache: cache_time_window for agent type '${req.agentType}' must be a positive number of minutes, got ${minutes}`);
  }
  const entry: CacheEntry = {
    id: '',
    agent_id: req.agentId,
    scope_entity_ids: [...req.scopeEntityIds],
    memory_version: req.memoryVersion,
    output: req.output,
    expires_at: new Date(nowMs + minutes * 60_000).toISOString(),
    created_at: new Date(nowMs).toISOString(),
  };
  await store.put(entry);
  return entry;
}

/** LRN.003.2 / NFR-PERF.012.1 — the WRITE-TRIGGERED invalidation. Subscribe the Memory Agent's commit (C2 sole-writer)
 *  to this: on any in-scope-entity write, DELETE every cache entry whose scope intersects the written entity(ies).
 *  Emits the loud invalidation event. Returns the invalidated cache-entry ids. */
export async function invalidateOnWrite(
  store: CacheStore,
  events: EventSink,
  secondary: SecondarySink,
  writtenEntityIds: readonly string[],
  now: { ms: number } = { ms: Date.now() },
): Promise<string[]> {
  const dropped = await store.invalidateIntersecting(writtenEntityIds);
  if (dropped.length > 0) {
    await emitEvent(events, secondary, {
      event_type: EVT_CACHE_INVALIDATED,
      entity_ids: [...writtenEntityIds],
      summary: `Write to ${writtenEntityIds.length} in-scope entity(ies) invalidated ${dropped.length} cache entry(ies) BEFORE window expiry — never a stale hit (LRN.003.2 / OD-076 / #1).`,
      payload: { written_entity_ids: [...writtenEntityIds], invalidated_cache_ids: dropped, at_ms: now.ms },
    });
  }
  return dropped;
}
