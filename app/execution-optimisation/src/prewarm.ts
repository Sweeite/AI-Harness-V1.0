// ISSUE-054 (C5 OPT) — FR-5.OPT.004 Chained-task pre-warm. Build order step 4. For a chain A→B with pre-warm ON, B's
// MEMORY RETRIEVAL may begin while A is still running, to cut latency — but ONLY as a READ-ONLY, discardable
// optimisation that respects OD-059's fresh-scope rule (AC-5.OPT.004.1):
//   • OD-059: B starts a FRESH envelope with an explicit handoff payload and RE-RETRIEVES under its OWN scope/
//     clearance. B never inherits A's full envelope/scope. So pre-warm warms B's OWN retrieval — it MUST be handed
//     B's fresh, handoff-derived scope, never A's envelope (a #2 over-reach guard, enforced loud);
//   • READ-ONLY + NO SIDE EFFECT: pre-warm only reads memory; it writes nothing. Enforced via an injected write-guard
//     the pre-warm path must never trip;
//   • DISCARDABLE: if B never runs, the pre-warmed result is dropped — no persistence, no side effect.
// FLAG-OFF: with chained_task_prewarm_enabled off, no pre-warm happens — B retrieves at its own start (additive layer).
//
// The retrieval itself is owned by the C2 read flow (ISSUE-025/053); this slice only SCHEDULES it early over an
// injected read-only retriever port. It does not build retrieval or the envelope (ISSUE-050).

import type { OptConfig } from './config.ts';
import { resolveConfig } from './config.ts';

/** B's fresh retrieval scope — derived from the A→B handoff payload (OD-059), NOT inherited from A's envelope. The
 * `source` discriminant makes the fresh-vs-inherited distinction explicit so an inherited scope is rejected loud. */
export interface BFreshScope {
  /** MUST be 'handoff' — B re-retrieves under its own scope built from the explicit handoff (OD-059 option a). An
   * 'inherited' scope (A's full envelope crossing the boundary) is the #2 over-reach OD-059 forbids. */
  source: 'handoff' | 'inherited';
  b_task_id: string;
  /** the explicit handoff payload (A's relevant output + provenance link) B's retrieval keys off. */
  handoff: unknown;
  /** B's own entity/clearance scope, re-derived — the C2 clearance gate re-applies at retrieval. */
  entities: unknown[];
}

/** The guard the retriever is handed: calling it means a WRITE was attempted on the read-only pre-warm path. It
 * NEVER returns — it throws ERR_WRITE_DURING_PREWARM (fail LOUD, #2/#3). A genuine read-only retriever never calls
 * it; a buggy/over-reaching one that tries to persist trips it and is rejected loud rather than silently writing. */
export type WriteGuard = () => never;

/** A read-only memory retriever for B's scope (owned by C2 read flow; injected). It is handed a WriteGuard it MUST
 * never call — pre-warm threads the guard in so an attempted write on this path fails LOUD instead of leaking a
 * side effect (AC-5.OPT.004.1). A read-only retriever ignores the guard entirely. */
export type ReadOnlyRetriever = (scope: BFreshScope, writeGuard: WriteGuard) => Promise<unknown[]>;

/** B's fresh envelope surface the committed pre-warm result lands in (subset of ISSUE-050 ContextEnvelope). */
export interface BEnvelope {
  task_id: string;
  memory_retrieved: unknown[];
}

export const ERR_INHERITED_SCOPE =
  'execution-optimisation: pre-warm requires B\'s OWN fresh handoff-derived scope — refusing an inherited A-scope (OD-059 / #2)';
export const ERR_SCOPE_TASK_MISMATCH =
  'execution-optimisation: pre-warm scope b_task_id does not match the envelope it is committed to (OD-059 provenance)';
export const ERR_WRITE_DURING_PREWARM =
  'execution-optimisation: a WRITE was attempted during read-only pre-warm — pre-warm must never mutate/persist (AC-5.OPT.004.1 / #2 / #3)';

/** The outcome of a pre-warm: either a held read-only result (enabled) or a no-op (disabled/flag-off). */
export interface PrewarmHandle {
  /** whether pre-warm actually ran early. false ⇒ flag off (B retrieves at its own start). */
  warmed: boolean;
  /** commit the pre-warmed memories into B's FRESH envelope when B actually runs. Returns the mutated envelope.
   * A no-op handle (flag off / discarded) commits nothing and returns the envelope unchanged. */
  commit(bEnv: BEnvelope): BEnvelope;
  /** discard the pre-warmed result — called when B never runs. Idempotent; drops the held memory, no side effect. */
  discard(): void;
  /** for tests/observability: is the held result still live (not discarded)? */
  isLive(): boolean;
}

/** Begin B's memory retrieval early (while A runs), read-only + discardable, under B's own fresh scope. A WriteGuard
 * is threaded into the injected retriever: pre-warm itself never writes, and if the retriever attempts a write it
 * trips the guard and pre-warm is rejected LOUD (ERR_WRITE_DURING_PREWARM) rather than leaking a side effect — this
 * is the enforced form of the no-side-effect half of AC-5.OPT.004.1 (#2/#3), not merely an asserted-and-hoped one. */
export async function prewarmChainedRetrieval(
  scope: BFreshScope,
  retrieve: ReadOnlyRetriever,
  cfg: Partial<OptConfig> = {},
): Promise<PrewarmHandle> {
  const config: OptConfig = resolveConfig(cfg);
  if (!config.chainedTaskPrewarmEnabled) {
    return {
      warmed: false,
      commit: (bEnv) => bEnv, // flag off: nothing pre-warmed; B retrieves at its own start
      discard: () => {},
      isLive: () => false,
    };
  }
  // OD-059 guard: only B's OWN fresh handoff-derived scope may be pre-warmed — never A's inherited scope (#2).
  if (scope.source !== 'handoff') throw new Error(ERR_INHERITED_SCOPE);

  // The live write-guard: a genuine read-only retriever never calls it; an attempted write trips it and fails LOUD.
  const writeGuard: WriteGuard = () => {
    throw new Error(ERR_WRITE_DURING_PREWARM);
  };
  let held: unknown[] | null = await retrieve(scope, writeGuard); // READ-ONLY — the guard proves no write leaked
  return {
    warmed: true,
    commit(bEnv: BEnvelope): BEnvelope {
      if (held === null) return bEnv; // already discarded — nothing to commit
      if (bEnv.task_id !== scope.b_task_id) throw new Error(ERR_SCOPE_TASK_MISMATCH);
      bEnv.memory_retrieved = [...held];
      return bEnv;
    },
    discard(): void {
      held = null; // drop the pre-warmed result; no persistence, no side effect
    },
    isLive(): boolean {
      return held !== null;
    },
  };
}
