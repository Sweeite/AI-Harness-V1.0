// ISSUE-030 (C2 MAT) — FR-2.MAT.002: the one-time cold-start MODE state machine (the deployment-level gate).
//
// ADR-002 §2 resolves the design-doc contradiction #2: the cold-start MODE is deployment-level and ONE-TIME — once
// aggregate Maturity first crosses cold_start_full_threshold (80%) the mode deactivates PERMANENTLY and its apparatus
// (banner, read-only, init indicator) never returns, even if the aggregate later dips (a client offboards, a bulk
// decay). This is a ONE-WAY LATCH: `deactivated` never flips back to false. AC-2.MAT.002.1 proves it does not re-arm.
//
// The 20/50/80 thresholds (cold_start_basic/proactive/full) drive the PHASE reported to ISSUE-071 (which owns the
// actual feature-suppression ladder). This slice produces the mode/threshold SIGNAL; it does not suppress behaviour.
// Per-entity [Building] eligibility (sufficiency.ts) SURVIVES after the mode is off — that flag is entity-level and
// standing (ADR-002 §4), a separate concern from this deployment-level latch.
//
// Pure reducer; the latch's PERSISTENCE is the store's job (readColdStartState / writeColdStartState) so it survives
// a restart — a latch that forgot it had latched would re-arm on the next boot (#1: never lose that decision).

import type { MaturityConfig } from './store.ts';

/** The reported cold-start phase (for ISSUE-071). 'full' once the aggregate reaches the full threshold — the point
 *  the mode deactivates. While deactivated the mode is OFF regardless of phase. */
export type ColdStartPhase = 'none' | 'basic' | 'proactive' | 'full';

/** The closed set of valid phases — used to reject a garbage persisted `phase` LOUD rather than passing an arbitrary
 *  string through the port (a corrupt latch must fail closed, never degrade silently — #3). */
export const COLD_START_PHASES: readonly ColdStartPhase[] = ['none', 'basic', 'proactive', 'full'] as const;
export function isColdStartPhase(v: unknown): v is ColdStartPhase {
  return typeof v === 'string' && (COLD_START_PHASES as readonly string[]).includes(v);
}

/** Thrown when the PERSISTED cold-start latch row exists but is malformed. A corrupt one-way latch must fail LOUD +
 *  CLOSED — never silently degrade to 'mode active', which would re-arm the apparatus ADR-002 §2 guarantees never
 *  returns (#1 lost decision / #3 silent failure). Distinct from a missing row, which is a legitimate fresh default. */
export class ColdStartLatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ColdStartLatchError';
  }
}

export interface ColdStartState {
  /** ONE-WAY LATCH: true once aggregate Maturity has EVER reached the full threshold. Never returns to false. When
   *  true the cold-start mode is permanently OFF (ADR-002 §2). */
  deactivated: boolean;
  /** The phase last observed from the aggregate (informational for ISSUE-071's ladder). */
  phase: ColdStartPhase;
}

/** A fresh deployment: mode active, nothing learned yet. */
export const INITIAL_COLD_START_STATE: ColdStartState = { deactivated: false, phase: 'none' };

/** Phase from an aggregate percentage against the 20/50/80 thresholds (config is int 0–100). */
export function phaseFor(aggregatePct: number, cfg: MaturityConfig): ColdStartPhase {
  if (aggregatePct >= cfg.coldStartFullThreshold) return 'full';
  if (aggregatePct >= cfg.coldStartProactiveThreshold) return 'proactive';
  if (aggregatePct >= cfg.coldStartBasicThreshold) return 'basic';
  return 'none';
}

/**
 * Advance the cold-start latch given a fresh aggregate Maturity (0–1 fraction, or null = nothing computed yet → 0%).
 * The reducer is monotonic in `deactivated`: once true it stays true (the LATCH). It flips to true the moment the
 * aggregate reaches cold_start_full_threshold (80%). A later dip re-computes `phase` for observability but can NEVER
 * clear `deactivated` — that is the AC-2.MAT.002.1 guarantee.
 */
export function advanceColdStart(prev: ColdStartState, aggregate: number | null, cfg: MaturityConfig): ColdStartState {
  const pct = (aggregate ?? 0) * 100;
  const phase = phaseFor(pct, cfg);
  // The latch: once deactivated, forever deactivated — a later dip does NOT re-arm (#1: never un-decide this).
  const deactivated = prev.deactivated || pct >= cfg.coldStartFullThreshold;
  return { deactivated, phase };
}

/** The cold-start MODE is active (apparatus shown, proactive suppressed) iff the latch has NOT tripped. The single
 *  boolean ISSUE-071 gates the deployment-level apparatus on. */
export function coldStartModeActive(state: ColdStartState): boolean {
  return !state.deactivated;
}
