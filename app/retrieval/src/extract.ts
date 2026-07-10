// ISSUE-025 (C2 RET) — FR-2.RET.001: extract the entities an incoming task is about, as the first retrieval step.
// This is READ-ONLY resolution: it reuses the ISSUE-022 resolution helper (resolveEntity, which realises FR-2.ENT.005:
// external_refs-first then a deterministic name/type match, per OD-033) against a snapshot of existing entities, and
// returns the entity ids that seed the keyword arm — but it NEVER creates an entity (that is the write path, ISSUE-024).
//
// The safety posture is inherited from resolveEntity (conservative — favour false-split over false-merge, #2):
//   • a CONFIDENT single match (kind 'linked') seeds the keyword arm with that entity.
//   • an AMBIGUOUS mention (several plausible candidates) is treated as NOT-known here — it does NOT seed the keyword
//     arm with a guessed entity (that would surface another entity's memory — a #2 cross-contamination on the read
//     path). The vector arm still runs semantically, so knowledge is not lost; it is just not entity-scoped.
//   • a NO-MATCH mention (a not-yet-known entity) yields no keyword hit; the vector arm still applies (FR-2.RET.001
//     branch) and the response may flag low Maturity.

import type { EntityRow } from '../../memory/src/store.ts';
import { resolveEntity, type Mention } from '../../memory/src/resolution.ts';

/** A task's entity mentions, parsed upstream (the model/NLP parse of the task text is a Phase-4 caller concern — this
 *  slice resolves the mentions deterministically). `primary` marks the entity the query is chiefly about (drives the
 *  Maturity read for the [Building] flag, FR-2.RET.007); if none is marked, the first resolved entity is primary. */
export interface TaskMention extends Mention {
  primary?: boolean;
}

export interface ExtractedEntities {
  /** The resolved entity ids that seed the keyword arm (confident single matches only). Deduped, order-stable. */
  entityIds: string[];
  /** The primary entity id (the marked-primary mention if it resolved, else the first resolved), or null if the task
   *  named no known entity. FR-2.RET.007 reads THIS entity's Maturity for the [Building] split. */
  primaryEntityId: string | null;
  /** True when at least one mention resolved ambiguously — surfaced so the observability hook can sample it (a high
   *  ambiguous rate is an entity-resolution health signal, AF-082). */
  hadAmbiguous: boolean;
}

/**
 * Resolve a task's mentions to known entity ids (read-only). Pure + deterministic. Only confident single matches seed
 * the keyword arm; ambiguous/no-match mentions do not (the vector arm still covers them semantically).
 */
export function extractEntities(mentions: readonly TaskMention[], entities: readonly EntityRow[]): ExtractedEntities {
  const snapshot = [...entities];
  const seen = new Set<string>();
  const entityIds: string[] = [];
  let primaryEntityId: string | null = null;
  let markedPrimaryId: string | null = null;
  let hadAmbiguous = false;

  for (const m of mentions) {
    const res = resolveEntity(m, snapshot);
    if (res.kind === 'ambiguous') {
      hadAmbiguous = true;
      continue; // never guess an entity on the read path (#2)
    }
    if (res.kind !== 'linked') continue; // no-match → not-yet-known; vector arm still runs
    if (!seen.has(res.entityId)) {
      seen.add(res.entityId);
      entityIds.push(res.entityId);
      if (primaryEntityId === null) primaryEntityId = res.entityId; // first resolved = default primary
    }
    if (m.primary === true && markedPrimaryId === null) markedPrimaryId = res.entityId;
  }

  return { entityIds, primaryEntityId: markedPrimaryId ?? primaryEntityId, hadAmbiguous };
}
