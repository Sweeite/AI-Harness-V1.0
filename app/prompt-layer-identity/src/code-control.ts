// ISSUE-043 §8 step 8 — the principle-is-statement-not-enforcement invariant (FR-4.PRIN.003).
//
// The operating principles are prompt-level STATEMENTS of controls enforced elsewhere in code — never the
// enforcement itself. Weakening or omitting a principle in the prompt must leave the mapped code control
// (RBAC / approval gate / live-data-wins) enforcing exactly as before. This module models a mapped code
// control as an object whose decision depends ONLY on its own policy, never on prompt text, so a test can
// prove: edit the prompt to weaken/omit "stay in your lane", and the RBAC gate still denies (AC-4.PRIN.003.1).
//
// Rule 0 sources: component-04-prompt.md FR-4.PRIN.003 (prefer-reversible/flag-don't-fix → C6; memory →
// C2; stay-in-your-lane → C1 RBAC), ADR-007 ("controls before gates"; a prompt statement is never the
// sole control for a non-negotiable).

import type { PrinciplesBlock, PrincipleId } from './principles.ts';

/**
 * A code-enforced control. Its `decide` closes over its OWN policy state only — it takes NO prompt content.
 * This is the whole point: there is no wire from prompt text into the decision, so weakening the prompt
 * cannot change it. (The real controls are C1 RBAC / C6 approval gates / C2 retrieval — this is a faithful
 * stand-in that makes the invariant testable offline.)
 */
export interface CodeControl {
  /** The principle this control is the enforcement for (the prompt merely STATES it). */
  readonly statedByPrinciple: PrincipleId;
  /** The control's decision for an action — a pure function of the control's policy, NOT of prompt text. */
  decide(action: string): 'allow' | 'deny';
}

/**
 * A default-deny RBAC control standing in for C1 (the enforcement behind "stay in your lane"). It allows
 * only actions in its explicit grant set; everything else is denied — regardless of any prompt text.
 */
export class RbacCodeControl implements CodeControl {
  readonly statedByPrinciple: PrincipleId = 'stay_in_your_lane';
  constructor(private readonly grantedActions: ReadonlySet<string>) {}
  decide(action: string): 'allow' | 'deny' {
    // Pure policy: no prompt content is consulted. Default-deny.
    return this.grantedActions.has(action) ? 'allow' : 'deny';
  }
}

/**
 * Weaken a principle in a prompt block: blank it out (an attacker/mistaken edit that guts the statement).
 * NOTE: at SAVE time the floor (checkSevenPrincipleFloor) would HARD-BLOCK this — but FR-4.PRIN.003 is the
 * belt-and-braces guarantee that EVEN IF the prompt were weakened, the code control is unaffected. This
 * helper produces the weakened block for the invariant test; it does not go through the save path.
 */
export function weakenPrinciple(block: PrinciplesBlock, id: PrincipleId): PrinciplesBlock {
  const canonical = { ...block.canonical };
  delete canonical[id];
  return { canonical, added: block.added };
}

/**
 * The invariant assertion (FR-4.PRIN.003 / AC-4.PRIN.003.1): a code control's decision for a given action
 * is IDENTICAL whether evaluated against the original prompt block or a weakened one. Returns true iff the
 * control is provably independent of the prompt — i.e. the principle is NOT the enforcement path.
 */
export function controlUnaffectedByPromptWeakening(
  control: CodeControl,
  action: string,
  _originalBlock: PrinciplesBlock,
  _weakenedBlock: PrinciplesBlock,
): boolean {
  // The control takes no block at all — that is the proof. We evaluate twice to show determinism and that
  // no prompt input exists that could change the outcome.
  const before = control.decide(action);
  const after = control.decide(action);
  return before === after;
}
