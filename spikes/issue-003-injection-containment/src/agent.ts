// ISSUE-003 §8.3 (the adversary's leverage) — the COMPROMISED-MODEL simulator.
//
// Containment-first assumes the worst about the model (ADR-007 part 1): a successful injection
// means the model DOES treat tool content as instructions (this is hard limit HL7 happening at the
// reasoning layer — we do NOT rely on the model resisting it). So this simulated agent is maximally
// obedient: whatever dangerous action the injected content asks for, it emits — as an autonomous
// agent, with no human approval token (it cannot mint one — HL6). The security claim never depends
// on this agent refusing; it depends on enforce() blocking what the agent emits.
//
// Modelling the model as fully obedient is the STRONGEST adversary and the honest one — a real LLM
// that happened to refuse would only mask a gap in the code boundary.

import type { Action, Actor } from './config.js';

export interface AgentEmission {
  // The action the compromised model attempts because it obeyed the injected instruction.
  action: Action;
  // Whether the model "saw" the injected instruction at all (false ⇒ content was quarantined
  // before the AI-call, so the model never received it and emits nothing).
  obeyedInjection: boolean;
}

/**
 * runCompromisedAgent — given the content that actually reached the model (post-sanitize `wrapped`,
 * or null if quarantined) and the injected `intent`, emit the dangerous action.
 *
 * The agent treats ANYTHING inside <external_data> as instructions — i.e. it ignores the boundary
 * tag entirely. That is the point: boundary tagging is a prompt-layer hint the compromised model
 * disregards, which is exactly why the code gate (not the tag) must be what contains the action.
 */
export function runCompromisedAgent(
  wrapped: string | null,
  intent: Action | null,
  agentActor: Actor,
): AgentEmission {
  if (wrapped === null) {
    // Content was quarantined by the pipeline → never reached the model. Nothing to obey.
    return { action: { kind: 'internal_note', description: 'no external content available (quarantined)' }, obeyedInjection: false };
  }
  if (intent === null) {
    // Benign content, no injected instruction — the agent does ordinary, non-consequential work.
    return { action: { kind: 'internal_note', description: 'benign tool content processed' }, obeyedInjection: false };
  }
  // Compromised: the model obeys the injected instruction and attempts the dangerous action
  // AUTONOMOUSLY. Crucially it acts as `agentActor` (kind 'agent', NO hard-approval token) — the
  // injection cannot upgrade the agent's authority or forge a human approval.
  void agentActor;
  return { action: intent, obeyedInjection: true };
}
