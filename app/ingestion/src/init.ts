// ISSUE-026 (C2 ING) — the ordered initialisation sequence + the mandatory human verification pass (FR-2.ING.009).
// The seven onboarding steps run IN ORDER; step 7 (verification) is never skipped and bumps verified memories to
// confidence 1.0 / source human_verified. While verification is incomplete a persistent dashboard warning is shown —
// an unverified brain is made VISIBLE, never silently trusted (#3).

import type { MemoryVerificationSink } from './store.ts';

export const INIT_STEPS = [
  'define_entities', // 1. define the entity taxonomy
  'internal_org_founder', // 2. create Internal Org + capture founder knowledge
  'connect_sor', // 3. connect systems of record
  'structured_pass', // 4. structured data pass (Pipeline 1)
  'priority_documents', // 5. priority documents (Pipeline 2)
  'interviews', // 6. onboarding interviews (Pipeline 3)
  'verification', // 7. human verification pass (MANDATORY — bumps verified memories to confidence 1.0)
] as const;
export type InitStep = (typeof INIT_STEPS)[number];

export class InitSequenceError extends Error {
  constructor(
    public reason: string,
    message: string,
  ) {
    super(message);
    this.name = 'InitSequenceError';
  }
}

export const INCOMPLETE_VERIFICATION_WARNING =
  'Onboarding verification is incomplete — memories captured during onboarding are unverified. Complete the human verification pass to trust them.';

/** The ordered onboarding state machine. A step may complete only once every prior step is complete — the documented
 *  order (FR-2.ING.009) cannot be skipped, and step 7 (verification) cannot be reached until steps 1–6 are done. */
export class InitSequence {
  private readonly completed = new Set<InitStep>();

  constructor(private readonly verifier: MemoryVerificationSink) {}

  /** Mark a step complete. Throws if a prior step is still incomplete (order is enforced, not advisory). */
  complete(step: InitStep): void {
    const idx = INIT_STEPS.indexOf(step);
    for (let i = 0; i < idx; i++) {
      if (!this.completed.has(INIT_STEPS[i]!)) {
        throw new InitSequenceError('out_of_order', `cannot complete '${step}' before '${INIT_STEPS[i]}' (init order, FR-2.ING.009)`);
      }
    }
    this.completed.add(step);
  }

  isComplete(step: InitStep): boolean {
    return this.completed.has(step);
  }

  verificationComplete(): boolean {
    return this.completed.has('verification');
  }

  /** The persistent dashboard warning shown WHILE verification is incomplete (AC-2.ING.009.1). Empty once step 7 done. */
  warnings(): string[] {
    return this.verificationComplete() ? [] : [INCOMPLETE_VERIFICATION_WARNING];
  }

  /** Verify a memory: the human-verify bump to confidence 1.0 / source human_verified (AC-2.ING.009.2). This is the ONE
   *  allowed non-writer memory mutation (a human confirming an already-written memory, audited C1) — never a create. */
  async verifyMemory(memoryId: string, reviewer: string): Promise<{ memoryId: string; confidence: number; source: string }> {
    const result = await this.verifier.markVerified(memoryId, reviewer);
    // Loud invariant: the verification MUST produce the 1.0 / human_verified state (never a silent no-op, #3).
    if (result.confidence !== 1.0 || result.source !== 'human_verified') {
      throw new InitSequenceError('verify_incomplete', `verification of ${memoryId} did not reach confidence 1.0 / human_verified`);
    }
    return result;
  }
}
