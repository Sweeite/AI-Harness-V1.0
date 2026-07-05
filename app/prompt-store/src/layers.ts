// ISSUE-042 §8 steps 5-6 — the four-layer structure/ordering contract (FR-4.LYR.001/002/004) and the
// assembly-time required-element validation rule (FR-4.LYR.004). This module is layer-CONTENT-agnostic:
// it owns the *structural* contract (which four layer kinds exist, in what order, that a `core` record
// is keyed per-agent) and the STORE-SIDE hook the run pipeline (ISSUE-053) calls at assembly. The
// specific Layer-1 *content* rules (the exact wording of the boundary instruction, the hard-limit set,
// the seven principles) are ISSUE-043's — this slice provides only the halt hook + the structural checks
// and the pluggable required-element detector the content slice fills in.
//
// Rule 0 sources: schema.md §5 `prompt_layer_kind` enum (`core|business|memory|task_template`);
// component-04-prompt.md FR-4.LYR.001 (four fixed layers, fixed order), FR-4.LYR.002 (Layer 1 per-agent),
// FR-4.LYR.004 (assembly halts if resolved core lacks a required safety element).

// ── The four fixed layer kinds — schema.md §5 `prompt_layer_kind` enum, exactly ──────────────────
// AC-4.LYR.001.2: a `layer` field is one of these four and NO other value is accepted.
export type LayerKind = 'core' | 'business' | 'memory' | 'task_template';

export const LAYER_KINDS: readonly LayerKind[] = ['core', 'business', 'memory', 'task_template'];

export function isLayerKind(v: string): v is LayerKind {
  return (LAYER_KINDS as readonly string[]).includes(v);
}

// ── The fixed assembly order — FR-4.LYR.001: core → business → memory → task ──────────────────────
// `task_template` is the STORED kind (a reusable template, FR-4.TSK.002); at assembly it resolves into
// the Layer-4 "task" slot. The ordering contract is expressed over the four positional slots so the
// assembled structure (AC-4.LYR.001.1) is exactly [core, business, memory, task] in that order.
export type LayerSlot = 'core' | 'business' | 'memory' | 'task';

export const LAYER_ORDER: readonly LayerSlot[] = ['core', 'business', 'memory', 'task'];

/** Map a stored kind to its positional assembly slot. `task_template` → the `task` slot. */
export function slotOf(kind: LayerKind): LayerSlot {
  return kind === 'task_template' ? 'task' : kind;
}

// ── PERM nodes this slice consumes as store-level gates (homed in C1's node model, ISSUE-018) ────
// component-04-prompt.md §5 Touches + FR-4.STO.005 / FR-4.STO.004. `PERM-prompt.edit_principles` is
// OUT of this slice (ISSUE-043) — this store never checks it.
export const PERM = {
  edit: 'PERM-prompt.edit',
  viewHistory: 'PERM-prompt.view_history',
  rollback: 'PERM-prompt.rollback',
} as const;

export type PromptPerm = (typeof PERM)[keyof typeof PERM];

// ── FR-4.LYR.004 — assembly-time required-element validation (the halt hook) ─────────────────────
// The assembled prompt stack MUST be rejected/halted if the *resolved* Layer 1 lacks any element
// required by FR-4.CID.001 — the external-data boundary instruction (FR-4.CID.003), the hard-limit
// statement (FR-4.CID.004), and the operating-principles block (FR-4.PRIN.001). C4 owns the requirement;
// the check *executes* in C5 at assembly. This slice delivers the callable + the store-side structural
// detection; the concrete content predicates are supplied by ISSUE-043 (injected here, not hard-coded).
//
// The default detector is DELIBERATELY structural-only (a core record must be present + enabled + have
// non-empty content). ISSUE-043 supplies the three content predicates via `requiredElementChecks`; until
// it does, a resolved core that is present-but-content-incomplete is NOT falsely passed — the contract is
// that the run pipeline (ISSUE-053) wires the ISSUE-043 predicates in. We surface the seam explicitly so
// there is never a silent "looked complete" (#3).

/** The three FR-4.CID required safety elements the resolved Layer 1 must carry (FR-4.LYR.004). */
export type RequiredElement = 'boundary_instruction' | 'hard_limit_statement' | 'principles_block';

export const REQUIRED_ELEMENTS: readonly RequiredElement[] = [
  'boundary_instruction',
  'hard_limit_statement',
  'principles_block',
];

/** A predicate over the resolved core content: true = the element is present. Supplied by ISSUE-043. */
export type RequiredElementCheck = (resolvedCoreContent: string) => boolean;
export type RequiredElementChecks = Record<RequiredElement, RequiredElementCheck>;

/** The minimal resolved-core shape the assembly validator inspects (a subset of a PromptLayer row). */
export interface ResolvedCore {
  layer: LayerKind;
  enabled: boolean;
  content: string;
}

export interface AssemblyValidationResult {
  ok: boolean;
  /** Non-empty when !ok — the elements found missing, plus a `core_missing` marker if there is no core. */
  missing: (RequiredElement | 'core_missing')[];
  reason: string;
}

/**
 * The FR-4.LYR.004 halt hook. Returns `ok:false` (with the missing element list) if the resolved core is
 * absent/disabled/empty (the store-side "core missing/incomplete" detection — AC-4.LYR.002.2) OR, when
 * ISSUE-043's content predicates are supplied, if any required safety element is absent (AC-4.LYR.004.1).
 * The run pipeline (ISSUE-053) treats a `!ok` result as a LOUD halt — never a silent send, never a
 * degraded prompt (#2/#3). This function itself does not throw; it reports — the caller decides the halt.
 */
export function validateAssembledCore(
  resolvedCore: ResolvedCore | null | undefined,
  requiredElementChecks?: RequiredElementChecks,
): AssemblyValidationResult {
  // AC-4.LYR.002.2 — no core record → configuration error (no agent runs without its own Layer 1).
  if (!resolvedCore) {
    return {
      ok: false,
      missing: ['core_missing'],
      reason: 'assembly halt (FR-4.LYR.004 / AC-4.LYR.002.2): no resolved Layer 1 (core) record — configuration error, no agent runs without its own Layer 1.',
    };
  }
  if (resolvedCore.layer !== 'core') {
    return {
      ok: false,
      missing: ['core_missing'],
      reason: `assembly halt (FR-4.LYR.004): resolved Layer-1 record is layer='${resolvedCore.layer}', expected 'core'.`,
    };
  }
  if (!resolvedCore.enabled || resolvedCore.content.trim() === '') {
    return {
      ok: false,
      missing: ['core_missing'],
      reason: 'assembly halt (FR-4.LYR.004 / AC-4.LYR.002.2): resolved core is disabled or has empty content — treated as core-missing.',
    };
  }
  // AC-4.LYR.004.1 — with ISSUE-043's predicates supplied, a resolved core missing any required safety
  // element halts loudly. Without them, the structural check above stands (a present, enabled, non-empty
  // core); the content-completeness gate is the run pipeline's to wire (seam, ISSUE-053/ISSUE-043).
  if (requiredElementChecks) {
    const missing = REQUIRED_ELEMENTS.filter((el) => !requiredElementChecks[el](resolvedCore.content));
    if (missing.length > 0) {
      return {
        ok: false,
        missing,
        reason: `assembly halt (FR-4.LYR.004 / AC-4.LYR.004.1): resolved core is missing required safety element(s): ${missing.join(', ')} — no silent send, no degraded prompt reaches the model (#2/#3).`,
      };
    }
  }
  return { ok: true, missing: [], reason: 'resolved core present + all required elements satisfied.' };
}
