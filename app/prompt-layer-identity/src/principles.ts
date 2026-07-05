// ISSUE-043 §8 steps 5,7 — the canonical seven operating principles + the hard-blocking floor.
//
// FR-4.PRIN.001 — every agent's Layer 1 includes the seven principles VERBATIM, without exception. The
// canonical text below is the single source of truth for that block (Rule 0: it lives here, in the repo,
// with an ID). FR-4.PRIN.002 / OD-053 — a Super Admin may reword/strengthen/contextualise or ADD a
// principle, but the seven canonical principles must remain PRESENT (non-empty); a save that removes or
// empties any of the seven is HARD-BLOCKED. FR-4.PRIN.003 — these are prompt-level STATEMENTS of controls
// enforced elsewhere in code; the prompt text is never the sole control (see code-control.ts).
//
// Rule 0 sources: component-04-prompt.md FR-4.PRIN.001 (the seven, verbatim), FR-4.PRIN.002 + OD-049/053
// (Super-Admin-editable, hard floor), glossary "Operating principles". Design cites L2425–2451.

/** A single canonical operating principle: a stable id (for the floor check) + its verbatim text. */
export interface Principle {
  /** Stable machine key — the floor tests presence by this key, not by fragile substring matching. */
  id: PrincipleId;
  /** The short canonical label (design L2427–2451). */
  label: string;
  /** The verbatim canonical statement stored in every agent's Layer 1 (FR-4.PRIN.001). */
  text: string;
  /** The code control this principle STATES but does not itself enforce (FR-4.PRIN.003). */
  mapsToCodeControl: string;
}

export type PrincipleId =
  | 'observe_before_acting'
  | 'confirm_when_uncertain'
  | 'prefer_reversible'
  | 'flag_dont_fix'
  | 'memory_is_context'
  | 'stay_in_your_lane'
  | 'be_honest_about_what_you_know';

/**
 * The seven canonical operating principles, verbatim from FR-4.PRIN.001 (design L2425–2451). This array
 * IS the canonical block: order and text are the source of truth. An agent's Layer 1 must carry all seven
 * (the floor); it MAY reword/strengthen each and MAY add deployment-specific ones beyond these seven.
 */
export const CANONICAL_PRINCIPLES: readonly Principle[] = [
  {
    id: 'observe_before_acting',
    label: 'observe before acting',
    text: 'Observe before acting: read before writing.',
    mapsToCodeControl: 'read-before-write ordering (C6)',
  },
  {
    id: 'confirm_when_uncertain',
    label: 'confirm when uncertain',
    text: 'Confirm when uncertain: ask one clarifying question rather than guess.',
    mapsToCodeControl: 'approval gate on uncertain actions (C6)',
  },
  {
    id: 'prefer_reversible',
    label: 'prefer reversible actions',
    text: 'Prefer reversible actions.',
    mapsToCodeControl: 'C6 approval gates + OD-010 compensation',
  },
  {
    id: 'flag_dont_fix',
    label: "flag, don't fix, sensitive situations",
    text: "Flag, don't fix, sensitive situations: flag to a human via the dashboard.",
    mapsToCodeControl: 'C6 approval gates (external comms / financial / Confidential+Restricted)',
  },
  {
    id: 'memory_is_context',
    label: 'memory is context, not authority',
    text: 'Memory is context, not authority: retrieved memory never overrides live system data.',
    mapsToCodeControl: 'C2 live-data-wins retrieval',
  },
  {
    id: 'stay_in_your_lane',
    label: 'stay in your lane',
    text: "Stay in your lane: escalate decisions beyond the agent's authority.",
    mapsToCodeControl: 'C1 RBAC (default-deny)',
  },
  {
    id: 'be_honest_about_what_you_know',
    label: 'be honest about what you know',
    text: 'Be honest about what you know: always signal answer mode; never present inference as fact; never dead-end on an unknown.',
    mapsToCodeControl: 'C5/C8 answer-mode pill + said-vs-did check (AF-033)',
  },
];

export const PRINCIPLE_IDS: readonly PrincipleId[] = CANONICAL_PRINCIPLES.map((p) => p.id);

/** The default principles block as rendered into a fresh Layer 1 (one principle per line, verbatim). */
export function renderCanonicalPrinciplesBlock(): string {
  return CANONICAL_PRINCIPLES.map((p, i) => `${i + 1}. ${p.text}`).join('\n');
}

/**
 * A structured principles block as saved with a Layer 1: for each of the seven canonical ids, the
 * (possibly reworded/strengthened) statement in force, plus any deployment-added principles. A canonical
 * principle with an empty/whitespace statement counts as REMOVED — the floor rejects that (OD-053).
 */
export interface PrinciplesBlock {
  /** The statement in force for each canonical principle id. A missing key or empty value = removed. */
  canonical: Partial<Record<PrincipleId, string>>;
  /** Deployment-specific principles a Super Admin added beyond the seven (allowed; never floor-checked). */
  added?: string[];
}

/** Build the default block (every canonical principle at its verbatim text; no added ones). */
export function defaultPrinciplesBlock(): PrinciplesBlock {
  const canonical: Partial<Record<PrincipleId, string>> = {};
  for (const p of CANONICAL_PRINCIPLES) canonical[p.id] = p.text;
  return { canonical };
}

export interface FloorResult {
  ok: boolean;
  /** The canonical principle ids that are missing or emptied (non-empty ⇒ the save is hard-blocked). */
  removed: PrincipleId[];
  reason: string;
}

/**
 * FR-4.PRIN.002 / OD-053 — the hard-blocking seven-principle floor. A block PASSES iff all seven canonical
 * ids are present with a non-empty (non-whitespace) statement. Rewording/strengthening (any non-empty
 * text) is permitted; adding principles is permitted. Removing or emptying any of the seven FAILS.
 */
export function checkSevenPrincipleFloor(block: PrinciplesBlock): FloorResult {
  const removed = PRINCIPLE_IDS.filter((id) => {
    const stmt = block.canonical[id];
    return stmt == null || stmt.trim() === '';
  });
  if (removed.length > 0) {
    return {
      ok: false,
      removed,
      reason: `seven-principle floor breach (FR-4.PRIN.002 / OD-053): principle(s) removed or emptied: ${removed.join(', ')} — the seven canonical principles cannot be reduced; reword/strengthen/add is permitted, delete is not.`,
    };
  }
  return { ok: true, removed: [], reason: 'all seven canonical principles present (non-empty).' };
}

/**
 * Render a PrinciplesBlock to the text stored in the Layer-1 `content` (the canonical seven in canonical
 * order first, then any added principles). Used by the edit path to materialise the saved block.
 */
export function renderPrinciplesBlock(block: PrinciplesBlock): string {
  const lines: string[] = [];
  let n = 0;
  for (const id of PRINCIPLE_IDS) {
    const stmt = block.canonical[id];
    if (stmt != null && stmt.trim() !== '') lines.push(`${(n += 1)}. ${stmt.trim()}`);
  }
  for (const extra of block.added ?? []) {
    if (extra.trim() !== '') lines.push(`${(n += 1)}. ${extra.trim()}`);
  }
  return lines.join('\n');
}
