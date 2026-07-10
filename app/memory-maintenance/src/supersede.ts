// ISSUE-027 (C2 MNT) — FR-2.MNT.006: the daily supersede safety-net. The write-time contradiction check is a cheap
// LEXICAL classifier (ISSUE-024) — a SEMANTICALLY-contradicting racing write it misses must not silently persist.
// This daily job re-scans the live graph for same-slot (same type + same entity set) differing memories and, for a
// soft contradiction, CAS-supersedes the older by the newer via the traceable `superseded_by` chain (WHERE
// superseded_by IS NULL — ADR-004, a lost race affects 0 rows). A HARD conflict it finds is routed to the ISSUE-028
// quarantine, NEVER auto-resolved (losing a genuine contradiction silently is a #1 knowledge loss).
//
// The hard/soft discrimination is a seam: in production a Haiku/Sonnet re-judge classifies the semantic pair; here
// the deterministic default treats a same-slot differing pair as SOFT (a refine — newer wins, chain kept), and a
// test/production judge may return 'hard' to exercise the quarantine route.

import type { MemoryRow } from '../../memory/src/store.ts';
import { isLiveMemory, sameEntitySet, type MaintenanceStore } from './store.ts';

/** The hard/soft re-judge seam. `older`/`newer` are two live same-slot differing memories; returns whether the
 *  newer supersedes the older (soft) or the pair is a hard conflict for human review. Default = soft. */
export type ContradictionJudge = (older: MemoryRow, newer: MemoryRow) => 'soft' | 'hard';

const DEFAULT_JUDGE: ContradictionJudge = () => 'soft';

export interface SupersedeRunResult {
  recordsAffected: number;
  supersededIds: string[];
  quarantinedPairs: number;
}

/** Group signature = memory type + sorted entity ids (the "slot" a contradiction lives in). */
function slotKey(m: MemoryRow): string {
  return `${m.type}::${[...m.entity_ids].sort().join(',')}`;
}

/**
 * Run the daily supersede safety-net. For each slot with ≥2 live differing-content memories, the NEWEST is the
 * survivor; each older differing memory is either CAS-superseded by the survivor (soft) or routed to quarantine
 * (hard). Never deletes; never auto-resolves a hard conflict. Returns the run counts.
 */
export async function runSupersedeSafetyNet(store: MaintenanceStore, nowMs: number, judge: ContradictionJudge = DEFAULT_JUDGE): Promise<SupersedeRunResult> {
  const memories = await store.listMemories();
  // Freeze against active human review (#2 gate bypass / #1 contested-knowledge drift): a slot with a memory in an
  // unresolved conflict is being decided BY A HUMAN — the automated safety-net must not supersede or quarantine within
  // it until they resolve it. Skipping the whole slot (not just the one member) is deliberate: superseding the OTHER
  // member of a contested pair is the same drift.
  const underReview = await store.underReviewMemoryIds();
  const nowIso = new Date(nowMs).toISOString();
  const live = memories.filter((m) => isLiveMemory(m, nowMs));

  const bySlot = new Map<string, MemoryRow[]>();
  for (const m of live) {
    const k = slotKey(m);
    (bySlot.get(k) ?? bySlot.set(k, []).get(k)!).push(m);
  }

  const supersededIds: string[] = [];
  let quarantinedPairs = 0;

  for (const group of bySlot.values()) {
    if (group.length < 2) continue;
    // distinct content only — an exact duplicate is idempotency's job, not a contradiction.
    const distinct = dedupeByContentHash(group);
    if (distinct.length < 2) continue;
    // FREEZE: skip the whole slot if any member is under active human review (never mutate contested knowledge).
    if (distinct.some((m) => underReview.has(m.id))) continue;
    // newest survives; sort ascending by created_at so the last is the survivor.
    distinct.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    const survivor = distinct[distinct.length - 1]!;
    for (const older of distinct.slice(0, -1)) {
      // defend against sameEntitySet drift (slotKey already guarantees it, but the classifier contract states it).
      if (!sameEntitySet(older.entity_ids, survivor.entity_ids) || older.type !== survivor.type) continue;
      if (judge(older, survivor) === 'hard') {
        quarantinedPairs++;
        await store.task({ kind: 'hard_conflict_quarantine', targetId: older.id, action: 'quarantine', detail: `daily safety-net found a hard contradiction with newer memory ${survivor.id} — routed to review, never auto-resolved`, at: nowIso });
        continue;
      }
      const won = await store.casSupersede(older.id, survivor.id);
      if (won) supersededIds.push(older.id);
    }
  }
  return { recordsAffected: supersededIds.length, supersededIds, quarantinedPairs };
}

function dedupeByContentHash(rows: MemoryRow[]): MemoryRow[] {
  const seen = new Set<string>();
  const out: MemoryRow[] = [];
  for (const m of rows) {
    if (seen.has(m.content_hash)) continue;
    seen.add(m.content_hash);
    out.push(m);
  }
  return out;
}
