// ISSUE-020 / FR-1.RLS.008 — the RLS-vs-harness DIVERGENCE signal. The human path is guarded twice: the
// harness `can()` gate (code) AND RLS (DB). If the harness believed a read permitted but RLS returned ZERO
// rows, that empty result must NOT be indistinguishable from "no data exists" — it is a divergence (a
// forgotten/incorrect can() gate, or a policy bug) and is logged loudly (#3), never silently masked.
//
// This is the RUN-TIME counterpart to AF-080's build-time differential test: ADR-006 part 5 claims the two
// layers "cannot drift"; this turns that claim into an observable.

import { type RlsEnforcementStore, EVT_RLS_HARNESS_DIVERGENCE } from "./store.ts";

export interface DivergenceInput {
  /** the harness can() decision for this read */
  harnessPermitted: boolean;
  /** rows RLS actually returned */
  rlsRowCount: number;
}

/** Divergent iff the harness permitted the read but RLS returned nothing (the silent-zero-rows backstop). */
export function isDivergent(i: DivergenceInput): boolean {
  return i.harnessPermitted && i.rlsRowCount === 0;
}

export interface DivergenceContext extends DivergenceInput {
  resource: string; // e.g. "memories" / the query identity
  actingUserId: string;
}

export interface DivergenceResult {
  divergent: boolean;
}

/**
 * Evaluate a harness/RLS read pairing and, on divergence, log the rls_harness_divergence event so the
 * empty result is never silently returned as "no data" (AC-1.RLS.008.1). Returns whether it diverged so the
 * caller can surface it (alerting is C7).
 */
export async function checkAndLogDivergence(
  store: RlsEnforcementStore,
  ctx: DivergenceContext,
): Promise<DivergenceResult> {
  if (!isDivergent(ctx)) return { divergent: false };
  await store.appendEventLog({
    eventType: EVT_RLS_HARNESS_DIVERGENCE,
    entityIds: [],
    summary: `harness permitted a read of "${ctx.resource}" but RLS returned zero rows`,
    payload: {
      resource: ctx.resource,
      acting_user_id: ctx.actingUserId,
      harness_permitted: ctx.harnessPermitted,
      rls_row_count: ctx.rlsRowCount,
    },
  });
  return { divergent: true };
}
