// ISSUE-027 (C2 MNT) — FR-2.MNT.007: the weekly summarise job. For an entity with ≥ `summarise_episode_trigger`
// (10) new episodic memories since its last summary, it generates ONE richer semantic memory referencing the
// episodic cluster it came from — and RETAINS the episodics as an evidence layer (never deleted/superseded) so any
// fact stays drillable to the events that produced it (L1796, #1). Personal-tier episodics are never folded
// (FR-2.MNT.014) — they are excluded from the cluster and routed to the ISSUE-028 approval queue.

import type { MemoryRow, EntityRow } from '../../memory/src/store.ts';
import type { SensitivityTier } from '../../memory/src/entity-types.ts';
import { contentHash, computeIdempotencyKey } from '../../memory/src/memory.ts';
import type { MaintenanceConfig } from './config.ts';
import { isLiveMemory, isPersonal, type MaintenanceStore } from './store.ts';

const TIER_ORDER: readonly SensitivityTier[] = ['standard', 'confidential', 'personal', 'restricted'];

/** The most-restrictive tier among a cluster (the summary inherits it — never LESS restrictive than any input, so a
 *  summary can't down-tier and broaden exposure, #2). */
function mostRestrictiveTier(rows: readonly MemoryRow[]): SensitivityTier {
  let idx = 0;
  for (const m of rows) idx = Math.max(idx, TIER_ORDER.indexOf(m.sensitivity));
  return TIER_ORDER[idx]!;
}

export interface SummariseRunResult {
  recordsAffected: number;
  summaries: Array<{ entityId: string; summaryId: string; clusterIds: string[] }>;
  personalSkipped: string[];
}

/** Build the semantic summary row for an entity's episodic cluster. */
export function buildSummaryMemory(entity: EntityRow, cluster: MemoryRow[], nowIso: string): MemoryRow {
  const content = `Summary of ${cluster.length} episodes about ${entity.name}: ${cluster.map((m) => m.content).join(' | ')}`;
  const hash = contentHash(content);
  const entity_ids = [entity.id];
  return {
    id: `summary-${entity.id}-${cluster.length}`,
    type: 'semantic',
    content,
    embedding: [...(cluster[cluster.length - 1]?.embedding ?? new Array(1536).fill(0.01))],
    embedding_model: cluster[cluster.length - 1]?.embedding_model ?? 'text-embedding-3-small',
    entity_ids,
    source: 'ai_inferred',
    source_ref: null,
    confidence: Math.max(...cluster.map((m) => m.confidence ?? 0), 0.6),
    visibility: cluster[cluster.length - 1]?.visibility ?? 'global',
    sensitivity: mostRestrictiveTier(cluster),
    superseded_by: null,
    content_hash: hash,
    idempotency_key: computeIdempotencyKey(null, entity_ids, hash),
    expires_at: null,
    created_at: nowIso,
    updated_at: nowIso,
  };
}

/**
 * Run the weekly summarise pass. For each entity, the "new episodics" are the live episodic memories referencing it
 * created after its newest live semantic memory (or all of them if it has none). Personal episodics are excluded +
 * queued. When the non-Personal cluster reaches the trigger, one semantic summary is inserted (referencing the
 * cluster) and the episodics are LEFT LIVE (retained evidence).
 */
export async function runSummarise(store: MaintenanceStore, cfg: MaintenanceConfig, nowMs: number): Promise<SummariseRunResult> {
  const memories = await store.listMemories();
  const entities = await store.listEntities();
  const nowIso = new Date(nowMs).toISOString();
  const live = memories.filter((m) => isLiveMemory(m, nowMs));

  const summaries: Array<{ entityId: string; summaryId: string; clusterIds: string[] }> = [];
  const personalSkipped: string[] = [];

  for (const entity of entities) {
    const onEntity = live.filter((m) => m.entity_ids.includes(entity.id));
    const lastSummaryAt = Math.max(0, ...onEntity.filter((m) => m.type === 'semantic').map((m) => Date.parse(m.created_at)));
    const newEpisodics = onEntity.filter((m) => m.type === 'episodic' && Date.parse(m.created_at) > lastSummaryAt);

    const personal = newEpisodics.filter((m) => isPersonal(m.sensitivity));
    for (const m of personal) if (!personalSkipped.includes(m.id)) personalSkipped.push(m.id);
    if (personal.length > 0) {
      await store.task({ kind: 'personal_consolidation', targetId: entity.id, action: 'human_approval', detail: `${personal.length} Personal-tier episodic(s) on ${entity.name} — never auto-summarised; queued for explicit human approval (ISSUE-028)`, at: nowIso });
    }

    const cluster = newEpisodics.filter((m) => !isPersonal(m.sensitivity));
    if (cluster.length < cfg.summariseEpisodeTrigger) continue;

    cluster.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    const summaryRow = buildSummaryMemory(entity, cluster, nowIso);
    const clusterIds = cluster.map((m) => m.id);
    const ins = await store.insertDerivedMemory(summaryRow, clusterIds);
    // NOTE: the episodics are deliberately NOT superseded/deleted — they remain the evidence layer (#1).
    summaries.push({ entityId: entity.id, summaryId: ins.id, clusterIds });
  }
  return { recordsAffected: summaries.length, summaries, personalSkipped };
}
