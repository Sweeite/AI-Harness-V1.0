// ISSUE-067 (surface-09 · UI-AGENT-BUILDER) — THE reject-at-write FRONT GATE the Builder save path calls.
//
// This is the Builder's defense-in-depth layer (OD-140 "show + explain + block"): a pure, deterministic guard
// that evaluates a proposed registry write BEFORE it lands and returns a typed verdict (so the UI can grey a
// forbidden tool with its reason, block Save, and — critically — the SERVER ACTION can deny the write, not just
// hint at it, ADR-007). It does NOT re-encode the invariants: it COMPOSES the real upstream guards —
//   • the tools_allowed hard-limit deny (Comms⊄send / Finance⊄transaction / only-Memory-writes) is
//     app/specialists' `evaluateToolsAllowed` (ISSUE-062 / AF-068 GREEN via ISSUE-003) — ONE source of truth;
//   • the empty-description (REG.001.2) and empty-change_reason (REG.004.1) rejections mirror the exact
//     conditions + messages app/orchestrator's InMemoryAgentRegistry throws (ERR_EMPTY_*), which the server
//     action then re-enforces by actually writing through that registry (belt-and-braces #2).
// What THIS module additionally owns is the runtime `memory_scope` SHAPE validator (AC-8.SCO.003.1): the
// MemoryScope TypeScript type is compile-time only, but an edit arriving from a form/API is `unknown` at the
// write boundary — an invalid scope must be REJECTED at write, never persisted as a malformed retrieval filter
// (a #1/#2 risk: a broken least-privilege filter). Fail-CLOSED: anything not provably valid is rejected.
//
// Three non-negotiables: #2 (a forbidden capability / invalid scope is DENIED at write, code-level, not audited),
// #3 (every rejection carries a LOUD human reason — never a silent drop), #1 (nothing half-written — the verdict
// gates the write; the prior version stands on any rejection).

import {
  evaluateToolsAllowed,
  evaluateLiveGrant,
  type ToolClassifier,
  type ForbiddenGrantDetail,
  type LiveToolRow,
  type UncertifiableGrantDetail,
} from '../../../app/specialists/src/store.ts';
import {
  ERR_EMPTY_DESCRIPTION,
  ERR_EMPTY_CHANGE_REASON,
  MEMORY_TIERS,
  type MemoryScope,
  type MemoryTier,
} from '../../../app/orchestrator/src/registry.ts';

// ── Reject codes — a stable, testable enum the UI + server action branch on. ────────────────────────────
export const BUILDER_REJECT_CODES = {
  CHANGE_REASON_REQUIRED: 'change_reason_required', // AC-8.REG.004.1
  DESCRIPTION_REQUIRED: 'description_required', // AC-8.REG.001.2
  INVALID_MEMORY_SCOPE: 'invalid_memory_scope', // AC-8.SCO.003.1
  FORBIDDEN_CAPABILITY: 'forbidden_capability', // AC-8.SPC.003.3 / .004.3 / .005.2
  UNCERTIFIABLE_CAPABILITY: 'uncertifiable_capability', // AC-8.SPC.005.2 fail-CLOSED (unclassified-write / unknown tool)
} as const;
export type BuilderRejectCode = (typeof BUILDER_REJECT_CODES)[keyof typeof BUILDER_REJECT_CODES];

// ── memory_scope shape validation (AC-8.SCO.003.1 — an invalid scope is rejected at write). ─────────────
export type ScopeValidation =
  | { ok: true; scope: MemoryScope }
  | { ok: false; reason: string };

/**
 * Validate a raw (form/API-supplied) value as a well-formed `memory_scope`. FAIL-CLOSED, but NARROW-IS-VALID.
 *
 * THE CONTRACT (explicit, so guard / DB / registry cannot drift — see the check gate + the seed non-drift test):
 * the DB column is `memory_scope jsonb NOT NULL` with NO CHECK, and the canonical roster is seeded with the
 * fail-closed narrow default `'{}'::jsonb` (0001d_seed.sql L121-126, OD-177 — retrieves NOTHING until ISSUE-063
 * wires the real per-agent scope). So the ONLY structural requirement is "a JSON object"; every field is OPTIONAL
 * and a MISSING field means the fail-closed narrow value (no tiers, no entity model, no tool registry) — exactly
 * what `{}` means. This makes `{}` VALID (previously it was wrongly rejected, blocking any capability edit that
 * round-trips a seed agent's existing scope). A valid scope is:
 *   • an object (not null, not an array),
 *   • `tiers`: OPTIONAL; when present, an array whose every element is one of MEMORY_TIERS
 *     ('semantic'|'episodic'|'procedural'|'entity'), with no duplicates and no unknown tier. Absent ⇒ [] (narrow).
 *   • `entity_model`: OPTIONAL boolean. Absent ⇒ false (fail-closed — not in scope).
 *   • `tool_registry`: OPTIONAL boolean. Absent ⇒ false (fail-closed — not in scope).
 *   • `note`: OPTIONAL string.
 * Narrowness is a valid least-privilege choice; only a MALFORMED scope (non-object, or a PRESENT field of the wrong
 * type / an unknown or duplicate tier) is rejected. The returned scope is normalised to the full MemoryScope shape
 * with the fail-closed defaults filled in.
 */
export function validateMemoryScope(raw: unknown): ScopeValidation {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'memory_scope must be an object (the least-privilege retrieval filter) — got ' + kindOf(raw) };
  }
  const o = raw as Record<string, unknown>;

  // tiers — OPTIONAL; absent ⇒ [] (the fail-closed narrow default, matching the seeded '{}'). When PRESENT it must
  // be a valid, duplicate-free array of known tiers (a malformed tiers value is still rejected at write).
  let tiers: MemoryTier[] = [];
  if (o.tiers !== undefined) {
    if (!Array.isArray(o.tiers)) {
      return { ok: false, reason: 'memory_scope.tiers, when present, must be an array of memory tiers' };
    }
    const seen = new Set<string>();
    for (const t of o.tiers) {
      if (typeof t !== 'string' || !(MEMORY_TIERS as readonly string[]).includes(t)) {
        return {
          ok: false,
          reason: `memory_scope.tiers contains an invalid tier '${String(t)}' — allowed: ${MEMORY_TIERS.join(', ')}`,
        };
      }
      if (seen.has(t)) {
        return { ok: false, reason: `memory_scope.tiers contains a duplicate tier '${t}'` };
      }
      seen.add(t);
    }
    tiers = (o.tiers as MemoryTier[]).slice();
  }

  // entity_model / tool_registry — OPTIONAL booleans; absent ⇒ false (fail-closed). A PRESENT non-boolean is rejected.
  if (o.entity_model !== undefined && typeof o.entity_model !== 'boolean') {
    return { ok: false, reason: 'memory_scope.entity_model, when present, must be a boolean' };
  }
  if (o.tool_registry !== undefined && typeof o.tool_registry !== 'boolean') {
    return { ok: false, reason: 'memory_scope.tool_registry, when present, must be a boolean' };
  }
  if (o.note !== undefined && typeof o.note !== 'string') {
    return { ok: false, reason: 'memory_scope.note, when present, must be a string' };
  }
  const scope: MemoryScope = {
    tiers,
    entity_model: o.entity_model === true,
    tool_registry: o.tool_registry === true,
    ...(o.note !== undefined ? { note: o.note as string } : {}),
  };
  return { ok: true, scope };
}

function kindOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

// ── The composed Builder save verdict. ──────────────────────────────────────────────────────────────────
export interface BuilderSaveInput {
  /** The agent's routing role/domain slug (e.g. 'comms'|'finance'|'memory'|'client'|…|'orchestrator'|custom).
   *  Drives the per-agent hard-limit invariant (the tool guard classifies by role). */
  role: string;
  /** The staged description. `undefined` = not part of this edit (a capability-only edit leaves it untouched). */
  description?: string;
  /** The staged memory_scope (raw — validated here). `undefined` = not part of this edit. */
  memory_scope?: unknown;
  /** The staged tools_allowed (tool ids). `undefined` = not part of this edit. */
  tools_allowed?: readonly string[];
  /** Mandatory on EVERY save (REG.004.1). */
  change_reason: string;
  /** Whether `description` is a REQUIRED field of this save (true on insert / add-agent — REG.001.2). On a
   *  capability-only edit the description is untouched, so an absent description is not a rejection. */
  descriptionRequired?: boolean;
  /** The tool classifier (id → forbidden class). The OFFLINE REFERENCE / greyed-picker classifier (ISSUE-062).
   *  NB: this kernel is FAIL-OPEN by construction — an unclassified tool id (classOf → null) is treated as
   *  non-forbidden (store.ts). It is correct for the in-memory reference (its map is fully populated) and the
   *  picker preview, but it is NOT the authority on the live save path. */
  classifier: ToolClassifier;
  /** OPTIONAL — the FAIL-CLOSED live classification: the `tools` rows (id + coarse category + `hard_limit_class`
   *  tag) fetched for exactly the proposed `tools_allowed` ids. When present, the tool gate runs the fail-CLOSED
   *  `evaluateLiveGrant` (which DENIES an unclassified write tool / an unknown tool id) INSTEAD OF the fail-open
   *  reference classifier. The real surface-09 save path / server action MUST supply this so a forbidden-but-
   *  untagged grant cannot pass the Builder gate — the exact fail-open the reject-at-write invariant exists to
   *  close (AF-068 / #2). Today `tools.config->>'hard_limit_class'` is on no row, so with live rows an untagged
   *  write grant is correctly denied as `unclassified_write` until the tag convention ships. */
  liveToolRows?: readonly LiveToolRow[];
}

export type BuilderSaveVerdict =
  | { ok: true }
  | {
      ok: false;
      code: BuilderRejectCode;
      /** The staged field the rejection is anchored to (for inline field errors). */
      field: 'change_reason' | 'description' | 'memory_scope' | 'tools_allowed';
      reason: string;
      /** Present only for a forbidden-capability rejection: the offending grant (drives the greyed-tool reason). */
      forbidden?: ForbiddenGrantDetail;
      /** Present only for a fail-CLOSED uncertifiable rejection (live path): the grant that could not be proven
       *  benign (an unclassified write tool / an unknown tool id) — denied rather than silently permitted (#2). */
      uncertifiable?: UncertifiableGrantDetail;
    };

/**
 * Evaluate a staged Builder save. Deterministic, side-effect-free. Checked in a FAIL-CLOSED order so the first
 * (most fundamental) violation is reported: change_reason → description → memory_scope → tools_allowed. A caller
 * (the surface-09 save path / server action) MUST NOT write when this returns `ok:false` — the prior version
 * stands (#1), the reason is surfaced (#3), the forbidden capability is denied (#2).
 */
export function evaluateBuilderSave(input: BuilderSaveInput): BuilderSaveVerdict {
  // (1) change_reason — mandatory on every write (REG.004.1). Mirrors ERR_EMPTY_CHANGE_REASON.
  if (typeof input.change_reason !== 'string' || input.change_reason.trim().length === 0) {
    return {
      ok: false,
      code: BUILDER_REJECT_CODES.CHANGE_REASON_REQUIRED,
      field: 'change_reason',
      reason: ERR_EMPTY_CHANGE_REASON,
    };
  }

  // (2) description — required on insert / non-empty when supplied (REG.001.2). Mirrors ERR_EMPTY_DESCRIPTION.
  const descProvided = input.description !== undefined;
  if (input.descriptionRequired || descProvided) {
    const d = input.description;
    if (typeof d !== 'string' || d.trim().length === 0) {
      return {
        ok: false,
        code: BUILDER_REJECT_CODES.DESCRIPTION_REQUIRED,
        field: 'description',
        reason: ERR_EMPTY_DESCRIPTION,
      };
    }
  }

  // (3) memory_scope — a shape-invalid scope is rejected at write (SCO.003.1). Only checked when part of the edit.
  if (input.memory_scope !== undefined) {
    const v = validateMemoryScope(input.memory_scope);
    if (!v.ok) {
      return {
        ok: false,
        code: BUILDER_REJECT_CODES.INVALID_MEMORY_SCOPE,
        field: 'memory_scope',
        reason: `REJECTED at write: ${v.reason} — an invalid memory_scope is denied at save (AC-8.SCO.003.1)`,
      };
    }
  }

  // (4) tools_allowed — the reject-at-write hard-limit deny (SPC.003.3/.004.3/.005.2). ONE source of truth:
  // app/specialists' guard kernels. Fires regardless of caller role (a negative invariant on the DATA).
  if (input.tools_allowed !== undefined) {
    if (input.liveToolRows !== undefined) {
      // FAIL-CLOSED live gate — the real save path. `evaluateLiveGrant` denies BOTH a recognized-forbidden grant
      // AND any grant it cannot CERTIFY benign (an unclassified write tool / an unknown id). Strictly stronger than
      // the fail-open reference: an untagged forbidden capability cannot slip through the Builder gate (AF-068 / #2).
      const verdict = evaluateLiveGrant(input.role, input.tools_allowed, input.liveToolRows);
      if (!verdict.ok) {
        if ('forbidden' in verdict) {
          return {
            ok: false,
            code: BUILDER_REJECT_CODES.FORBIDDEN_CAPABILITY,
            field: 'tools_allowed',
            reason:
              `REJECTED at write: ${verdict.forbidden.reason} — a per-agent hard-limit invariant, denied at save (a ` +
              `code-level deny, not merely audited; OD-140 / AC-8.SPC.003.3/.004.3/.005.2 / AF-068)`,
            forbidden: verdict.forbidden,
          };
        }
        return {
          ok: false,
          code: BUILDER_REJECT_CODES.UNCERTIFIABLE_CAPABILITY,
          field: 'tools_allowed',
          reason:
            `REJECTED at write (fail-closed): ${verdict.uncertifiable.reason} — the Builder will not certify a write ` +
            `grant the live classifier cannot prove benign (AF-068 / #2)`,
          uncertifiable: verdict.uncertifiable,
        };
      }
    } else {
      // Offline reference / greyed-picker preview ONLY (fail-open by construction — see `classifier` doc). The live
      // save path MUST pass `liveToolRows` above; this branch never certifies a real write on its own.
      const bad = evaluateToolsAllowed(input.role, input.tools_allowed, input.classifier);
      if (bad) {
        return {
          ok: false,
          code: BUILDER_REJECT_CODES.FORBIDDEN_CAPABILITY,
          field: 'tools_allowed',
          reason:
            `REJECTED at write: ${bad.reason} — a per-agent hard-limit invariant, denied at save (a code-level ` +
            `deny, not merely audited; OD-140 / AC-8.SPC.003.3/.004.3/.005.2 / AF-068)`,
          forbidden: bad,
        };
      }
    }
  }

  return { ok: true };
}

// ── The tools picker (OD-140 "show + explain + block"): every tool rendered; a forbidden one is greyed WITH
// its inline reason, never hidden. ──────────────────────────────────────────────────────────────────────
export interface ToolPickerOption {
  toolId: string;
  /** true = granting this tool to THIS role would breach a hard limit → render greyed + disabled. */
  forbidden: boolean;
  /** the inline reason, present iff forbidden (the SAME reason the save-time deny logs — OD-140 one source). */
  reason?: string;
}

/**
 * Build the tools-picker option list for an agent role: for each candidate tool id, whether granting it to this
 * role is forbidden and (if so) why. Reuses the exact upstream classification (evaluateToolsAllowed on a single
 * id) so the greyed reason and the save-time deny reason are byte-identical (OD-140 — no drift between what the
 * UI says and what the write does).
 */
export function toolPickerOptions(
  role: string,
  toolIds: readonly string[],
  classifier: ToolClassifier,
): ToolPickerOption[] {
  return toolIds.map((toolId) => {
    const bad = evaluateToolsAllowed(role, [toolId], classifier);
    return bad
      ? { toolId, forbidden: true, reason: bad.reason }
      : { toolId, forbidden: false };
  });
}
