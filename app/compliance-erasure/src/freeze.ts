// ISSUE-082 §8 step 3 — the frozen-deployment guard (FR-10.DEL.007 / AC-10.DEL.007.1).
//
// An ad-hoc individual erasure must NOT execute against a deployment in an offboarding retention freeze — that data
// is governed by the offboarding deletion path (FR-10.OFF.004), and a stray destructive write mid-teardown is the
// #1/#3 race this guard prevents. The freeze state is a LOCAL read of deployment_settings.frozen_at inside the
// client's own silo (OD-162 — no cross-deployment query). A frozen deployment is BLOCKED + SURFACED, never silently
// no-op'd (#3).

import type { DeletionWorkflowStore } from './store.ts';

export interface FreezeVerdict {
  frozen: boolean;
  frozenAt: string | null;
}

/** Read the local deployment freeze state. `frozen_at` non-null ⇒ frozen. A read that THROWS is surfaced by the
 *  caller as a fail-closed block (we never assume "not frozen" on an unreadable state). */
export async function checkDeploymentFreeze(store: DeletionWorkflowStore): Promise<FreezeVerdict> {
  const frozenAt = await store.readDeploymentFrozenAt();
  return { frozen: frozenAt !== null, frozenAt };
}

/** Thrown when an ad-hoc erasure is attempted against a frozen/offboarding deployment (routed to the offboarding
 *  path instead). A destructive op must never proceed on a frozen deployment. */
export class DeploymentFrozenError extends Error {
  constructor(public readonly frozenAt: string) {
    super(`erasure blocked: deployment is frozen (offboarding retention window) since ${frozenAt} — route through the offboarding deletion path (FR-10.OFF.004)`);
    this.name = 'DeploymentFrozenError';
  }
}
