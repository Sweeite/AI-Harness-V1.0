// ISSUE-043 §8 steps 1-7 — the Layer1IdentityService: the save/edit-time validation of a `core` record
// (six-element completeness + non-removable safety elements) and the Super-Admin-only principles-edit path
// (PERM gate, mandatory change_reason, floor hard-block, distinct safety event, propagation to every
// agent's Layer 1) — all layered ON TOP of the ISSUE-042 prompt_layers store (the CorePromptStore port).
//
// This is where the FRs compose:
//   • FR-4.CID.001–006 — saveCore()/editCore() validate the six-element content contract; a missing
//     non-removable safety element (boundary instruction / hard-limit statement / uncertainty text /
//     seven-principle floor) HARD-BLOCKS the save (throws); the ~500-word bound is a NON-blocking advisory.
//   • FR-4.PRIN.001 — every saved core carries all seven canonical principles (the floor asserts it).
//   • FR-4.PRIN.002 — editPrinciples() is gated on PERM-prompt.edit_principles (Super-Admin only; Admin
//     denied + logged), requires a mandatory change_reason, emits a distinct safety-relevant edit event,
//     and PROPAGATES the edited block to EVERY agent's Layer 1 (a new version per agent — version
//     discipline from ISSUE-042, reused not rebuilt).
//   • FR-4.PRIN.002 / OD-053 — a principles edit that removes/empties any of the seven is HARD-BLOCKED
//     (the floor) before any write; reword/strengthen/add is permitted.
//   • FR-4.PRIN.002.3 — the propagated edit is the NEW head; an in-flight task pinned to the prior version
//     is unaffected (pinning is ISSUE-042's; here we only prove the new head reflects the edit, prior
//     versions remain readable = the pin still resolves).
//
// The service takes no wall clock: `now` (epoch seconds) is passed in (house determinism discipline).

import {
  Layer1Content,
  SECTION,
  renderLayer1Content,
  sectionBody,
  validateLayer1,
  type Layer1Validation,
} from './core-record.ts';
import {
  checkSevenPrincipleFloor,
  renderPrinciplesBlock,
  type PrinciplesBlock,
} from './principles.ts';
import {
  PERM,
  enforcePerm,
  type AuditSink,
  type PermChecker,
  type SafetyEventRow,
} from './rbac.ts';
import type { CorePromptStore, PromptLayer } from './store.ts';

export interface Layer1IdentityDeps {
  store: CorePromptStore;
  perms: PermChecker;
  audit: AuditSink;
}

/** Raised when a save is HARD-BLOCKED by the content contract (missing safety element / floor breach). */
export class Layer1SaveRejected extends Error {
  constructor(
    readonly validation: Layer1Validation,
    reason: string,
  ) {
    super(reason);
    this.name = 'Layer1SaveRejected';
  }
}

/** The result of a principles edit: the safety event + the per-agent versions it produced (propagation). */
export interface PrinciplesEditResult {
  safetyEvent: SafetyEventRow;
  /** One new head version per agent the block propagated to (FR-4.PRIN.002.3). */
  propagated: { agent_id: string; version: PromptLayer }[];
}

export class Layer1IdentityService {
  constructor(private readonly deps: Layer1IdentityDeps) {}

  // ── Save / edit a Layer-1 core record with the six-element content contract (FR-4.CID.*) ─────────

  /**
   * Create the FIRST version of an agent's Layer 1. HARD-BLOCKS (throws Layer1SaveRejected) if a
   * non-removable safety element is missing (boundary instruction / hard-limit statement / uncertainty /
   * seven-principle floor). The ~500-word bound is a NON-blocking advisory (returned in the validation).
   */
  async saveCore(
    agent_id: string,
    name: string,
    content: Layer1Content,
    change_reason: string,
    actorId: string,
    now: number,
  ): Promise<{ row: PromptLayer; validation: Layer1Validation }> {
    const validation = this.assertSaveable(content);
    const row = await this.deps.store.createCore(
      { name, content: renderLayer1Content(content), agent_id, change_reason, created_by: actorId },
      now,
    );
    return { row, validation };
  }

  /**
   * Edit an agent's Layer 1 (non-principles content path): append a NEW version. Same six-element gate.
   * This is the general content edit — it does NOT require the principles node (Admin may do it). The
   * caller is expected to have passed the general PERM-prompt.edit gate (ISSUE-042); this method enforces
   * the CONTENT contract, not the general edit PERM (that seam is ISSUE-042's).
   */
  async editCore(
    currentVersionId: string,
    content: Layer1Content,
    change_reason: string,
    actorId: string,
    now: number,
  ): Promise<{ row: PromptLayer; validation: Layer1Validation }> {
    const validation = this.assertSaveable(content);
    // logic-sweep fix (service.ts editCore): the general content edit is NOT the principles-edit path.
    // The shared operating-principles block is reserved to the PERM-gated, safety-event-emitting
    // editPrinciples() (OD-049 / FR-4.PRIN.002 / AC-4.PRIN.002.2). Pin the CURRENT head's principles
    // section back over the caller-supplied content so a sub-privilege actor (e.g. Admin holding only
    // PERM-prompt.edit) can NEVER silently reword/weaken the shared block through this path (#2/#3).
    const rendered = renderLayer1Content(content);
    const head = await this.deps.store.getVersion(currentVersionId);
    const pinned = head ? pinPrinciplesSection(rendered, head.content) : rendered;
    const row = await this.deps.store.appendCoreVersion(
      currentVersionId,
      { content: pinned, change_reason, created_by: actorId },
      now,
    );
    return { row, validation };
  }

  /** Validate + throw if a non-removable safety element is missing. Returns the (passing) validation. */
  private assertSaveable(content: Layer1Content): Layer1Validation {
    const validation = validateLayer1(content);
    if (!validation.saveAllowed) {
      const missingSafety = validation.findings.filter((f) => f.safetyCritical && !f.present).map((f) => f.element);
      throw new Layer1SaveRejected(
        validation,
        `Layer-1 save rejected — missing non-removable safety element(s): ${missingSafety.join(', ')} (FR-4.CID.003/004/005 / FR-4.PRIN.001 floor). ${validation.floor.ok ? '' : validation.floor.reason}`,
      );
    }
    return validation;
  }

  /** Read the current Layer 1 for an agent (the single Layer-1 read path — FR-4.STO.002). */
  async readCore(agent_id: string): Promise<PromptLayer | null> {
    return this.deps.store.currentCoreForAgent(agent_id);
  }

  // ── The Super-Admin-only principles-edit path (FR-4.PRIN.002 / OD-049 / OD-053) ──────────────────

  /**
   * Edit the shared operating-principles block. Gated on PERM-prompt.edit_principles (Super-Admin only —
   * Admin is DENIED and the denial is logged). Steps:
   *   1. PERM gate (default-deny; Admin denied + logged) — FR-4.PRIN.002 / AC-4.PRIN.002.1.
   *   2. Mandatory non-empty change_reason — AC-4.PRIN.002.2 (also enforced by the store).
   *   3. Seven-principle floor HARD-BLOCK — a removed/emptied canonical principle is rejected BEFORE any
   *      write (OD-053 / AC-4.PRIN.002.4). Reword/strengthen/add is permitted.
   *   4. Propagate: for EVERY agent with a core record, append a NEW version carrying the edited block
   *      (spliced into that agent's existing Layer-1 content) — AC-4.PRIN.002.3. Each is a new head; prior
   *      versions remain (an in-flight task pinned to the prior version is unaffected — ISSUE-042 pinning).
   *   5. Emit ONE distinct safety-relevant edit event over the whole propagation (AC-4.PRIN.002.2) so the
   *      shared-safety-posture change is never silent (#3).
   */
  async editPrinciples(
    actorId: string,
    newBlock: PrinciplesBlock,
    change_reason: string,
    now: number,
  ): Promise<PrinciplesEditResult> {
    // (1) PERM gate — Super-Admin only. Admin (holding only PERM-prompt.edit) is denied + logged.
    enforcePerm(
      this.deps.perms,
      this.deps.audit,
      actorId,
      PERM.editPrinciples,
      'prompt.edit_principles',
      `edit shared operating-principles block: ${change_reason}`,
      now,
    );

    // (2) mandatory change_reason.
    if (change_reason == null || change_reason.trim() === '') {
      throw new Error('a change_reason is mandatory for a principles edit (FR-4.PRIN.002 / AC-4.PRIN.002.2)');
    }

    // (3) floor HARD-BLOCK — reject before any write if a canonical principle is removed/emptied.
    const floor = checkSevenPrincipleFloor(newBlock);
    if (!floor.ok) {
      throw new PrinciplesFloorBreach(floor.removed, floor.reason);
    }

    // (4) propagate the edited block to EVERY agent's Layer 1 (a new head version per agent).
    const agents = await this.deps.store.agentsWithCore();
    const propagated: PrinciplesEditResult['propagated'] = [];
    for (const agent_id of agents) {
      const head = await this.deps.store.currentCoreForAgent(agent_id);
      if (!head) continue; // defensive; agentsWithCore only returns agents that have one
      const nextContent = splicePrinciplesBlock(head.content, newBlock);
      const version = await this.deps.store.appendCoreVersion(
        head.id,
        { content: nextContent, change_reason, created_by: actorId },
        now,
      );
      propagated.push({ agent_id, version });
    }

    // (5) ONE distinct safety-relevant edit event over the whole propagation.
    const safetyEvent = this.deps.audit.emitSafetyEvent(
      {
        kind: 'principles_edited',
        actor_id: actorId,
        produced_version_ids: propagated.map((p) => p.version.id),
        change_reason,
        detail: `operating-principles block edited by Super Admin ${actorId}; propagated to ${propagated.length} agent(s).`,
      },
      now,
    );

    return { safetyEvent, propagated };
  }
}

/** Raised when a principles edit would remove/empty a canonical principle (OD-053 hard floor). */
export class PrinciplesFloorBreach extends Error {
  constructor(
    readonly removed: string[],
    reason: string,
  ) {
    super(reason);
    this.name = 'PrinciplesFloorBreach';
  }
}

/**
 * Replace the `### OPERATING PRINCIPLES` section of a rendered Layer-1 content string with a freshly
 * rendered block, leaving every other section (identity, hard limits, boundary instruction, …) untouched
 * — so a principles edit changes ONLY the shared block, per-agent content is preserved (FR-4.LYR.002).
 */
export function splicePrinciplesBlock(content: string, block: PrinciplesBlock): string {
  return spliceRenderedPrinciplesSection(content, renderPrinciplesBlock(block));
}

/**
 * logic-sweep fix (service.ts editCore): pin the principles section of a freshly-rendered Layer-1 content
 * string to the block already stored on the CURRENT head — so the general content edit path (editCore)
 * cannot change the shared operating-principles block (only the PERM-gated editPrinciples() may). Returns
 * `rendered` unchanged if the head has no principles section (defensive; nothing to pin to).
 */
function pinPrinciplesSection(rendered: string, headContent: string): string {
  const headPrinciples = sectionBody(headContent, SECTION.principles);
  if (headPrinciples === null) return rendered;
  return spliceRenderedPrinciplesSection(rendered, headPrinciples);
}

/** Splice an already-rendered principles-section body into the `### OPERATING PRINCIPLES` slot of `content`. */
function spliceRenderedPrinciplesSection(content: string, renderedPrinciples: string): string {
  const TAG = '### OPERATING PRINCIPLES';
  const idx = content.indexOf(TAG);
  if (idx < 0) {
    // No principles section yet — append one.
    return `${content}\n\n${TAG}\n${renderedPrinciples}`;
  }
  const before = content.slice(0, idx);
  const rest = content.slice(idx + TAG.length);
  const nextTag = rest.indexOf('\n### ');
  const after = nextTag < 0 ? '' : rest.slice(nextTag);
  return `${before}${TAG}\n${renderedPrinciples}${after}`;
}
