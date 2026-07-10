// ISSUE-025 (C2 RET) — FR-2.RET.006: format the ranked set as a type-tagged Business Context section for Layer-3
// (ISSUE-045), and enforce Restricted-NEVER-auto-injected (FR-1.RST.003) unconditionally — even for a cleared holder.
//
// Restricted is dropped from the auto-injectable candidate set BEFORE ranking (retrieve.ts), so a restricted memory
// should never reach here. This module keeps a SECOND hard guard anyway (defence in depth on a #2 invariant): if a
// restricted memory is somehow present it is dropped AND the drop is surfaced (droppedRestricted > 0) rather than
// silently injected — a would-be #2 leak becomes a loud, observable safety-net trip, never a quiet one (#3).
//
// Provenance: the injected memory ids are retained (for the Cited pill, FR-2.RET.007 / AC-2.RET.007.2).

import type { RankedMemory } from './rank.ts';

/** One injected memory in the assembled Business Context — its id (provenance), type tag, and content. */
export interface InjectedMemory {
  id: string;
  /** the type tag rendered in the prompt: [Semantic] / [Episodic] / [Procedural] / [<Type>]. */
  tag: string;
  content: string;
}

export interface BusinessContext {
  /** the type-tagged memories, in ranked order (highest score first). */
  memories: InjectedMemory[];
  /** the injected memory ids (provenance for the Cited pill). */
  provenanceIds: string[];
  /** count of restricted memories the hard guard had to drop here (expected 0 — a non-zero is a safety-net trip that
   *  the pipeline pre-filter should have caught; surfaced, never swallowed). */
  droppedRestricted: number;
  /** the rendered Business Context block (Layer-3 prompt text), or '' when nothing was injected. */
  text: string;
}

/** [Semantic]/[Episodic]/[Procedural]/... — the memory type, Capitalised, in brackets. */
export function typeTag(memoryType: string): string {
  const label = memoryType.length === 0 ? 'Memory' : memoryType[0]!.toUpperCase() + memoryType.slice(1);
  return `[${label}]`;
}

/**
 * Assemble the Business Context from the ranked set. Restricted memories are dropped (hard guard) + counted; everything
 * else is type-tagged, ordered by rank, and its id retained for provenance. Pure — no side effects.
 */
export function injectBusinessContext(ranked: readonly RankedMemory[]): BusinessContext {
  const memories: InjectedMemory[] = [];
  const provenanceIds: string[] = [];
  let droppedRestricted = 0;

  for (const r of ranked) {
    const m = r.candidate.memory;
    if (m.sensitivity === 'restricted') {
      droppedRestricted++; // FR-1.RST.003 — never auto-inject, even if cleared. Surfaced (safety-net trip).
      continue;
    }
    memories.push({ id: m.id, tag: typeTag(m.type), content: m.content });
    provenanceIds.push(m.id);
  }

  const text =
    memories.length === 0
      ? ''
      : ['Business Context:', ...memories.map((m) => `${m.tag} ${m.content}`)].join('\n');

  return { memories, provenanceIds, droppedRestricted, text };
}
