// ISSUE-068 (C9 MODE) — the no-bypass / no-back-door suite (FR-9.MODE.003 / NFR-SEC.013 / FR-6.FMM.001).
// Proves every proactive action traverses the IDENTICAL C6 pipeline, a hard-limit hit is blocked + surfaced
// (never auto-executed), and a guardrail-check error fails CLOSED.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  runProactiveAction,
  REASON_FAILED_CLOSED,
  type C6Decision,
  type C6PipelineSeam,
  type ProactiveActionCall,
} from './modes.ts';

/** A recording pipeline seam — the SAME seam a reactive action would use. Records every action it evaluated. */
class RecordingPipeline implements C6PipelineSeam {
  readonly seen: ProactiveActionCall[] = [];
  constructor(private readonly decide: (a: ProactiveActionCall) => C6Decision) {}
  async evaluate(action: ProactiveActionCall): Promise<C6Decision> {
    this.seen.push(action);
    return this.decide(action);
  }
}

const ACT_CALL: ProactiveActionCall = { actionType: 'internal_tidy', mode: 'act', originatingUserId: 'u1' };

// ── AC-9.MODE.003.1 / AC-NFR-SEC.013.1 — a proactive Act call passes through the same C6 pipeline; there is no
//    bypass path (the executor never runs without the pipeline evaluating first). ─────────────────────────
test('AC-9.MODE.003.1 — a proactive Act call always traverses the C6 pipeline before executing', async () => {
  const pipeline = new RecordingPipeline(() => ({ allowed: true, reason: 'permitted' }));
  let executed = 0;
  const out = await runProactiveAction(ACT_CALL, pipeline, async () => {
    executed++;
  });
  assert.equal(out.executed, true);
  assert.equal(executed, 1);
  // the pipeline saw the exact action — no shortcut around it:
  assert.equal(pipeline.seen.length, 1);
  assert.equal(pipeline.seen[0]!.actionType, 'internal_tidy');
});

test('AC-NFR-SEC.013.1 — a blocked action NEVER reaches the executor (no proactive bypass)', async () => {
  const pipeline = new RecordingPipeline(() => ({ allowed: false, reason: 'anomaly check tripped' }));
  let executed = 0;
  const out = await runProactiveAction(ACT_CALL, pipeline, async () => {
    executed++;
  });
  assert.equal(out.executed, false);
  assert.equal(out.blocked, true);
  assert.equal(executed, 0, 'the executor must not run when the pipeline denies (no bypass)');
  assert.equal(pipeline.seen.length, 1, 'the pipeline was still consulted');
});

// ── AC-9.MODE.003.2 — a hard-limit hit is blocked + logged + surfaced, never auto-executed. ──────────────
test('AC-9.MODE.003.2 — a hard-limit hit blocks + surfaces, never auto-executes on the basis of being proactive', async () => {
  const pipeline = new RecordingPipeline(() => ({ allowed: false, hardLimitHit: true, reason: 'hard limit #3: mass_delete' }));
  let executed = 0;
  const out = await runProactiveAction(ACT_CALL, pipeline, async () => {
    executed++;
  });
  assert.equal(out.executed, false);
  assert.equal(out.blocked, true);
  assert.equal(executed, 0);
  assert.match(out.reason, /hard limit/i);
});

// ── FR-6.FMM.001 — a guardrail-check that itself ERRORS fails CLOSED (never executes). ───────────────────
test('FR-6.FMM.001 — a guardrail-check error fails closed (action not executed)', async () => {
  const pipeline: C6PipelineSeam = {
    evaluate: async () => {
      throw new Error('anomaly service unreachable');
    },
  };
  let executed = 0;
  const out = await runProactiveAction(ACT_CALL, pipeline, async () => {
    executed++;
  });
  assert.equal(out.executed, false);
  assert.equal(out.blocked, true);
  assert.equal(out.failedClosed, true);
  assert.equal(executed, 0, 'a guardrail-check error must never let the action run');
  assert.ok(out.reason.startsWith(REASON_FAILED_CLOSED.slice(0, 40)));
});
