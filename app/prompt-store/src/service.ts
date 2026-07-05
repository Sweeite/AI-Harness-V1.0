// ISSUE-042 §8 steps 3-8 — the PromptService: the version-discipline + PERM-gating + rollback +
// pinning-at-assembly + single-source-of-truth layer over the PromptStore port. This is where the FRs
// compose:
//   • FR-4.STO.003 — edit = appendVersion (never overwrite) + mandatory change_reason (enforced in store).
//   • FR-4.STO.005 — editWithReason is gated on PERM-prompt.edit (default-deny + log on denial).
//   • FR-4.STO.004 — rollback = a NEW version equal to version K + change_reason (deletes nothing),
//     gated on PERM-prompt.rollback; readHistory gated on PERM-prompt.view_history.
//   • FR-4.STO.006 / OD-050 — pinAtAssembly() captures the version id in force; an in-flight task stays
//     on that pinned version even after an edit publishes N+1 (mid-run immutability, FR-4.LYR.003).
//   • FR-4.STO.002 / OD-048 — readAgentCore() is the ONLY Layer-1 read path (prompt_layers layer='core');
//     nothing here reads/writes agents.system_prompt.
//   • FR-4.LYR.001/004 — assembleStructure() produces the four ordered layer slots and halts (via the
//     ISSUE-053 seam) if the resolved core lacks a required safety element.
//
// The service takes no wall clock: `now` (epoch seconds) is passed in (house determinism discipline).

import {
  LAYER_ORDER,
  PERM,
  slotOf,
  validateAssembledCore,
  type AssemblyValidationResult,
  type LayerSlot,
  type RequiredElementChecks,
  type ResolvedCore,
} from './layers.js';
import { enforcePerm, type DenialAuditSink, type PermChecker } from './rbac.js';
import type { AssetKey, EditInput, NewLayerInput, PromptLayer, PromptStore } from './store.js';

export interface PromptServiceDeps {
  store: PromptStore;
  perms: PermChecker;
  audit: DenialAuditSink;
}

/** A pin captured at assembly time — the immutable version id a running task uses to completion. */
export interface AssemblyPin {
  /** version-id per positional slot; a slot with no layer is absent (e.g. a task with no memory). */
  slots: Partial<Record<LayerSlot, string>>;
  pinnedAt: string;
}

/** The resolved four-layer structure at assembly (content resolved from the pinned versions). */
export interface AssembledStructure {
  order: readonly LayerSlot[]; // always [core, business, memory, task] — FR-4.LYR.001
  layers: { slot: LayerSlot; version_id: string; version: number; content: string }[];
  validation: AssemblyValidationResult; // FR-4.LYR.004 — !ok ⇒ the run pipeline halts loudly
}

export class PromptService {
  constructor(private readonly deps: PromptServiceDeps) {}

  // ── Create / edit (version discipline + PERM gating) ───────────────────────────────────────────

  /** Create version 1 of a new asset, gated on PERM-prompt.edit (FR-4.STO.005). */
  async createLayer(actorId: string, input: NewLayerInput, now: number): Promise<PromptLayer> {
    enforcePerm(
      this.deps.perms,
      this.deps.audit,
      actorId,
      PERM.edit,
      'prompt.create',
      `create ${input.layer} '${input.name}' (agent_id=${input.agent_id})`,
      now,
    );
    return this.deps.store.createLayer(input, now);
  }

  /**
   * Edit an asset: append a NEW version (never overwrite), mandatory change_reason, gated on
   * PERM-prompt.edit. Takes effect on the NEXT assembly with no redeploy (FR-4.STO.005 / AC-4.STO.005.1).
   * A denial is logged, not silent (AC-4.STO.005.2).
   */
  async editWithReason(actorId: string, currentVersionId: string, edit: EditInput, now: number): Promise<PromptLayer> {
    enforcePerm(
      this.deps.perms,
      this.deps.audit,
      actorId,
      PERM.edit,
      'prompt.edit',
      `edit version ${currentVersionId}: ${edit.change_reason}`,
      now,
    );
    // Attribute the version to the acting user unless the caller set it explicitly (FR-4.STO.003 audit chain).
    return this.deps.store.appendVersion(currentVersionId, { ...edit, created_by: edit.created_by ?? actorId }, now);
  }

  // ── History + rollback (FR-4.STO.004) ──────────────────────────────────────────────────────────

  /** Read the full version history of an asset, gated on PERM-prompt.view_history. */
  async readHistory(actorId: string, key: AssetKey, now: number): Promise<PromptLayer[]> {
    enforcePerm(
      this.deps.perms,
      this.deps.audit,
      actorId,
      PERM.viewHistory,
      'prompt.view_history',
      `history of ${key.layer} '${key.name}' (agent_id=${key.agent_id})`,
      now,
    );
    return this.deps.store.history(key);
  }

  /**
   * Non-destructive rollback: create a NEW version whose content/enabled equal historical version K,
   * with a mandatory change_reason. NOTHING is deleted (FR-4.STO.004 / AC-4.STO.004.1). Gated on
   * PERM-prompt.rollback.
   */
  async rollbackTo(actorId: string, targetVersionId: string, change_reason: string, now: number): Promise<PromptLayer> {
    enforcePerm(
      this.deps.perms,
      this.deps.audit,
      actorId,
      PERM.rollback,
      'prompt.rollback',
      `rollback to version ${targetVersionId}: ${change_reason}`,
      now,
    );
    const target = await this.deps.store.getVersion(targetVersionId);
    if (!target) throw new Error(`cannot roll back to unknown version ${targetVersionId}`);
    const key: AssetKey = { layer: target.layer, name: target.name, agent_id: target.agent_id };
    const head = await this.deps.store.currentVersion(key);
    if (!head) throw new Error(`asset for version ${targetVersionId} has no head — cannot roll back`);
    // A rollback is an ordinary append whose content/enabled are copied from K — a NEW version, K+…+1,
    // linking previous_version_id to the current head. K itself and every version between are retained.
    return this.deps.store.appendVersion(
      head.id,
      { content: target.content, enabled: target.enabled, change_reason, created_by: actorId },
      now,
    );
  }

  // ── Single source of truth (FR-4.STO.002 / OD-048) ─────────────────────────────────────────────

  /** The ONLY Layer-1 read path: the current core for an agent, from prompt_layers only. */
  async readAgentCore(agent_id: string): Promise<PromptLayer | null> {
    return this.deps.store.currentCoreForAgent(agent_id);
  }

  // ── Pinning at assembly + the four-layer assembly contract (FR-4.LYR.001/003/004, FR-4.STO.006) ─

  /**
   * Capture the version ids in force NOW for a task's assembly. The returned pin is immutable — a later
   * edit publishing N+1 does NOT change it, so an in-flight task runs to completion on its pinned
   * versions (FR-4.STO.006 / FR-4.LYR.003 / OD-050). The caller passes the asset keys for the slots the
   * task uses (core is required; business/memory/task optional depending on the call).
   */
  async pinAtAssembly(slotKeys: Partial<Record<LayerSlot, AssetKey>>, now: number): Promise<AssemblyPin> {
    const slots: Partial<Record<LayerSlot, string>> = {};
    for (const slot of LAYER_ORDER) {
      const key = slotKeys[slot];
      if (!key) continue;
      const head = await this.deps.store.currentVersion(key);
      if (head) slots[slot] = head.id;
    }
    return { slots, pinnedAt: new Date(now * 1000).toISOString() };
  }

  /**
   * Resolve the pinned versions into the ordered four-layer structure and run the FR-4.LYR.004
   * required-element validation on the resolved core. A `!validation.ok` result is a LOUD halt signal for
   * the run pipeline (ISSUE-053) — the caller must not send. The content predicates (ISSUE-043) are
   * passed through; without them the structural core-present check stands (see layers.ts).
   */
  async assembleFromPin(pin: AssemblyPin, requiredElementChecks?: RequiredElementChecks): Promise<AssembledStructure> {
    const layers: AssembledStructure['layers'] = [];
    let resolvedCore: ResolvedCore | null = null;
    for (const slot of LAYER_ORDER) {
      const vid = pin.slots[slot];
      if (!vid) continue;
      const row = await this.deps.store.getVersion(vid);
      if (!row) continue; // append-only: a pinned version id can never vanish; defensive only
      layers.push({ slot: slotOf(row.layer), version_id: row.id, version: row.version, content: row.content });
      if (slot === 'core') resolvedCore = { layer: row.layer, enabled: row.enabled, content: row.content };
    }
    const validation = validateAssembledCore(resolvedCore, requiredElementChecks);
    return { order: LAYER_ORDER, layers, validation };
  }
}
