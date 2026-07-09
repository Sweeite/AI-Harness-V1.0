// ISSUE-067 (surface-09) — the PURE UI-facing helpers the Builder render layer composes over the reject-at-write
// guard kernel. NO new invariant logic: the save gate delegates to `evaluateBuilderSave` (builder-guard.ts, the
// composed kernel: ISSUE-062 tool hard-limits + the memory_scope validator + empty description/change_reason), and
// the authority policy delegates to the OD-080 PERM nodes app/rbac already mints (registry.ts). This module only
// shapes those into what a React component needs, so the render is a thin renderer and this logic is proven with
// tsx --test exactly like the 21 guard tests (builder-ui.test.ts) — the client app carries no untested UI logic.
//
// Three non-negotiables it upholds: #2 (a capability edit an Admin isn't authorized for is LOCKED, not writable),
// #3 (a rejected save carries a loud reason — never a silent drop), #1 (the verdict gates the write — nothing
// half-written; the prior version stands on any reject).

import {
  PERM_AGENTS_VIEW,
  PERM_AGENTS_EDIT_DESCRIPTION,
  PERM_AGENTS_EDIT_CAPABILITY,
} from '../../../app/orchestrator/src/registry.ts';
import type { ToolClassifier } from '../../../app/specialists/src/store.ts';
import { evaluateBuilderSave, type BuilderSaveVerdict } from './builder-guard.ts';

// ── OD-080 authority policy (OD-139 option a — inline split). ─────────────────────────────────────────────
// The Builder renders ALL fields; capability fields are read-only/locked for a caller lacking the tighter
// PERM-agents.edit_capability (Super-Admin-only by default), while description/tuning stay editable for anyone
// holding PERM-agents.edit_description (Super Admin + Admin). Entry itself is gated on PERM-agents.view. This is
// a PURE projection of the caller's granted-node set — the SAME set app/rbac's can()/RLS resolve (no second
// source of truth). Transparency over hiding (#3): an Admin SEES the capability fields but cannot mutate them.
export interface BuilderAuthority {
  /** may enter the Builder / fleet at all (PERM-agents.view). */
  canView: boolean;
  /** may edit description / max_tokens / registry tuning / roll back a plan version (PERM-agents.edit_description). */
  canEditDescription: boolean;
  /** may edit memory_scope / tools_allowed / enabled, add an agent, disable an agent (PERM-agents.edit_capability). */
  canEditCapability: boolean;
}

/** Project the caller's granted permission-node set onto the OD-080 authority tiers. Fail-closed: an absent node
 *  is a locked capability, never an open one. */
export function builderAuthority(grantedNodes: ReadonlySet<string>): BuilderAuthority {
  return {
    canView: grantedNodes.has(PERM_AGENTS_VIEW),
    canEditDescription: grantedNodes.has(PERM_AGENTS_EDIT_DESCRIPTION),
    canEditCapability: grantedNodes.has(PERM_AGENTS_EDIT_CAPABILITY),
  };
}

/** The affordance copy shown on a locked capability field for a caller who can view but not edit it (OD-139a). */
export const CAPABILITY_LOCKED_AFFORDANCE =
  'Super-Admin-only (OD-080) — capability edits (memory scope / tools / enabled / add / disable) are tighter than description tuning.';

// ── The composed save gate (the render's save path routes EVERY save through here). ───────────────────────
/** A staged Builder edit — the fields a Save is about to write. `undefined` fields are untouched by this edit
 *  (a description-only tuning edit leaves memory_scope/tools_allowed alone, and vice-versa). */
export interface StagedBuilderEdit {
  /** the agent's routing role/domain slug — drives the per-agent hard-limit tool gate. */
  role: string;
  /** true on insert / add-agent (description is a REQUIRED field then — REG.001.2). */
  descriptionRequired?: boolean;
  description?: string;
  /** raw (form-supplied) memory_scope — validated at write by the guard (SCO.003.1). */
  memory_scope?: unknown;
  tools_allowed?: readonly string[];
  /** mandatory on EVERY save (REG.004.1) — an empty reason is rejected by the guard. */
  change_reason: string;
}

/**
 * THE Builder save gate. Delegates to `evaluateBuilderSave` (the composed reject-at-write kernel) — it does not
 * re-encode any rejection. A caller MUST NOT persist a new version when this returns `ok:false`: the prior version
 * stands (#1), the reason is surfaced inline (#3), a forbidden capability is denied at write (#2). The offline
 * reference classifier greys/blocks the picker; the live server action additionally passes `liveToolRows` for the
 * fail-closed gate (not on this dev/seeded render — no live DB).
 */
export function evaluateStagedSave(edit: StagedBuilderEdit, classifier: ToolClassifier): BuilderSaveVerdict {
  return evaluateBuilderSave({
    role: edit.role,
    descriptionRequired: edit.descriptionRequired,
    description: edit.description,
    memory_scope: edit.memory_scope,
    tools_allowed: edit.tools_allowed,
    change_reason: edit.change_reason,
    classifier,
  });
}

// ── Fleet-health honest-state (AC-8.HLTH.004.2 / #3 never-false-healthy). ─────────────────────────────────
/** Is the PRIMARY success/failure health badge's data stale-at-source — so it must render NON-green? A fresh
 *  overall read is NOT enough: a stalled producer heartbeat means the numbers are last-known (not current), and a
 *  dead-agent flag means a 0%-success agent must never read as a confident green. Pure so the render's tone
 *  decision is unit-tested (the M1 render-only false-healthy hole the pure suite otherwise misses). */
export function primaryHealthStale(input: { readStale: boolean; producerHeartbeat: string; deadAgentFlag: boolean }): boolean {
  return input.readStale || input.producerHeartbeat === 'stalled' || input.deadAgentFlag;
}
