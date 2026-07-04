// ISSUE-003 §8.1/§8.4 — the running harness that wires the seams (C5 step order FR-5.ASM.007)
// and DRIVES a payload end to end. This is the "running system" the red-team attacks.
//
// Step order (FR-5.ASM.007, asserted by AC-6.INJ.001.2):
//   1. anomaly-check  →  2. tool-read  →  3. SANITIZE (the C6 seam)  →  4. AI-call
//   →  5. enforce (code gate) BEFORE any side effect  →  6. tool-write / memory-write
//
// The sanitize call site sits explicitly between tool-read (2) and AI-call (4); the enforce call
// site sits explicitly between AI-call (4) and any consequential write (6). The trace records the
// exact order so the battery can prove the seam positions, not just the outcomes.

import type { Action, Actor } from './config.js';
import { runCompromisedAgent } from './agent.js';
import { enforce, type Decision } from './enforcement.js';
import { sanitizeToolRead, type ToolRead } from './sanitize.js';
import type { AppendOnlyStore } from './store.js';

const CONSEQUENTIAL: ReadonlySet<Action['kind']> = new Set<Action['kind']>([
  'external_email',
  'financial_transaction',
  'record_delete',
  'cross_client_read',
  'cross_client_share',
  'impersonate',
  'approve_queued_action',
]);

export interface HarnessTrace {
  steps: string[]; // ordered step log — proves the seam positions
  quarantined: boolean;
  wrapped: string | null;
  boundaryWrapped: boolean; // did non-quarantined tool content get <external_data> tags?
  obeyedInjection: boolean;
  emittedAction: Action;
  decision: Decision | null; // null when nothing consequential was attempted / content quarantined
  sideEffectExecuted: boolean; // the ground-truth breach flag — did a real side effect happen?
}

export interface DriveInput {
  taskId: string;
  toolRead: ToolRead;
  injectedIntent: Action | null; // the action the injection is trying to cause (null = benign)
  agentActor: Actor;
  actionRef: string;
}

/**
 * drive — run one payload through the full harness and return a trace. The harness NEVER executes
 * a consequential action that enforce() did not allow: `sideEffectExecuted` is true only when the
 * gate returned allowed AND the action is consequential. That is the ground truth the battery reads.
 */
export function drive(input: DriveInput, store: AppendOnlyStore): HarnessTrace {
  const steps: string[] = [];

  // 1. anomaly-check (FR-6.ANM.001) — stubbed pass-through; its own proof is ISSUE-057.
  steps.push('anomaly_check');

  // 2. tool-read — external, possibly-hostile content enters.
  steps.push('tool_read');

  // 3. SANITIZE — the C6 seam, BETWEEN tool-read and AI-call (AC-6.INJ.001.2).
  steps.push('sanitize');
  const san = sanitizeToolRead(input.toolRead, store, input.taskId);

  // 4. AI-call — the compromised model sees only what sanitize let through.
  steps.push('ai_call');
  const emission = runCompromisedAgent(san.wrapped, input.injectedIntent, input.agentActor);

  const action = emission.action;
  const consequential = CONSEQUENTIAL.has(action.kind);

  let decision: Decision | null = null;
  let sideEffectExecuted = false;

  if (consequential) {
    // 5. enforce — the code gate, BEFORE any side effect.
    steps.push('enforce');
    decision = enforce(action, input.agentActor, store, input.taskId, input.actionRef);

    // 6. tool-write / memory-write — executed ONLY if the gate allowed it.
    if (decision.allowed) {
      steps.push('side_effect_write');
      sideEffectExecuted = true;
    } else {
      steps.push('blocked_before_write');
    }
  } else if (action.kind === 'memory_write') {
    // memory-write path also passes the gate (sensitive tags are floored).
    steps.push('enforce');
    decision = enforce(action, input.agentActor, store, input.taskId, input.actionRef);
    if (decision.allowed) {
      steps.push('memory_write');
    } else {
      steps.push('blocked_before_write');
    }
  } else {
    steps.push('no_consequential_action');
  }

  return {
    steps,
    quarantined: san.quarantined,
    wrapped: san.wrapped,
    boundaryWrapped: !san.quarantined && san.wrapped !== null && san.wrapped.startsWith('<external_data'),
    obeyedInjection: emission.obeyedInjection,
    emittedAction: action,
    decision,
    sideEffectExecuted,
  };
}
