// ISSUE-012 — the push-staleness detector (FR-7.MGM.002 + NFR-OBS.006). The #3 posture on the management
// plane: absence of signal IS a signal — a deployment that stops pushing must read stale/unreachable, never
// carry-forward a last-known-green.
//
// Three feasibility-load-bearing properties, modelled faithfully (they are 🟢 from ISSUE-011 and must stay so):
//   • AF-120 — server-authoritative window math. Staleness = (serverNow − last_push_at) > window, computed
//     against a SINGLE server clock. A reporter-asserted timestamp is NEVER trusted (a fast reporter clock
//     cannot make a dead deployment look fresh). last_push_at is stamped by the STORE at ingest, not the push.
//   • AF-118 — the evaluator runs on an INDEPENDENT HEARTBEAT and cannot itself fail silently. Each sweep
//     records its own heartbeat; if the evaluator stops sweeping, that stall is itself a surfaced condition
//     (a "meta-staleness" alert), so the stale-detector cannot go dark unnoticed (the meta-#3).
//   • frozen ≠ dead — a silo in client_registry.status = frozen reads INTENTIONALLY QUIET, not a
//     dead-deployment alert (AC-NFR-OBS.006.3 / AC-10.OFF.004.4). status is server-authoritative (read from
//     the registry, never a reporter-asserted value).

import { type DeploymentHealthRow, type ClientRegistryRow, type ClientStatus } from './store.ts';

export type Liveness = 'fresh' | 'stale' | 'unreachable' | 'frozen-quiet' | 'never-reported';

export interface CardLiveness {
  client_slug: string;
  liveness: Liveness;
  status: ClientStatus; // server-authoritative registry status (frozen ≠ dead)
  last_push_at: string | null;
  age_seconds: number | null; // serverNow − last_push_at, on server-authoritative time (AF-120)
  alert: boolean; // true ⇒ a cross-deployment alert is raised (never a silent green)
  detail: string;
}

/** Evaluate one deployment's liveness against a server-authoritative clock (AF-120). `windowSeconds` is
 *  deployment_staleness_window (config §J, default 900s = 15 min). `unreachableFactor` widens the window for
 *  the harder "unreachable" (vs merely "stale") classification. */
export function evaluateLiveness(
  registry: ClientRegistryRow,
  health: DeploymentHealthRow | null,
  serverNow: number,
  windowSeconds: number,
  unreachableFactor = 2,
): CardLiveness {
  const base = {
    client_slug: registry.client_slug,
    status: registry.status,
    last_push_at: health?.last_push_at ?? null,
  };

  // frozen ≠ dead — a frozen silo is intentionally quiet; it is NOT a staleness alert (AC-NFR-OBS.006.3).
  // We read status from the REGISTRY (server-authoritative), never a pushed/asserted value.
  if (registry.status === 'frozen') {
    return {
      ...base,
      liveness: 'frozen-quiet',
      age_seconds: health ? ageSeconds(health.last_push_at, serverNow) : null,
      alert: false,
      detail: 'client_registry.status=frozen — intentionally quiet (retention-freeze), not a dead deployment',
    };
  }

  if (!health) {
    // Registered but never pushed — surfaced, never a phantom green.
    return {
      ...base,
      liveness: 'never-reported',
      age_seconds: null,
      alert: true,
      detail: 'no snapshot ever received — surfaced as never-reported, not rendered healthy',
    };
  }

  const age = ageSeconds(health.last_push_at, serverNow); // server-authoritative (AF-120)
  if (age <= windowSeconds) {
    return { ...base, liveness: 'fresh', age_seconds: age, alert: false, detail: `fresh (age ${age}s ≤ window ${windowSeconds}s)` };
  }
  if (age <= windowSeconds * unreachableFactor) {
    return {
      ...base,
      liveness: 'stale',
      age_seconds: age,
      alert: true,
      detail: `STALE (age ${age}s > window ${windowSeconds}s) — cross-deployment alert raised, not a carried-forward green`,
    };
  }
  return {
    ...base,
    liveness: 'unreachable',
    age_seconds: age,
    alert: true,
    detail: `UNREACHABLE (age ${age}s > ${windowSeconds * unreachableFactor}s) — cross-deployment alert raised`,
  };
}

function ageSeconds(lastPushAtIso: string, serverNow: number): number {
  // serverNow is epoch seconds (server-authoritative). last_push_at was stamped by the STORE at ingest, also
  // on server time — so this subtraction is skew-free (AF-120): no reporter clock enters the computation.
  return Math.max(0, serverNow - Math.floor(Date.parse(lastPushAtIso) / 1000));
}

// ── AF-118: the independent-heartbeat evaluator that cannot itself fail silently ──────────────────────
//
// The staleness sweep is not a one-shot the receiver could miss. It runs on its own heartbeat and records
// each run. A separate meta-check confirms the evaluator itself is alive: if the last sweep is older than
// the evaluator's own heartbeat window, THAT is a surfaced condition (a meta-staleness alert) — so the
// stale-detector going dark is itself detected (the meta-#3 AF-118 exists to prevent).

export interface SweepRecord {
  ran_at: number; // server epoch seconds
  evaluated: number; // cards evaluated this sweep
  alerts_raised: number;
}

export class StalenessEvaluator {
  private lastSweepAt: number | null = null;
  readonly sweeps: SweepRecord[] = [];

  /** Run one staleness sweep across the fleet on server-authoritative time. Records its own heartbeat. */
  sweep(
    fleet: Array<{ registry: ClientRegistryRow; health: DeploymentHealthRow | null }>,
    serverNow: number,
    windowSeconds: number,
  ): { cards: CardLiveness[]; sweep: SweepRecord } {
    const cards = fleet.map((f) => evaluateLiveness(f.registry, f.health, serverNow, windowSeconds));
    const rec: SweepRecord = {
      ran_at: serverNow,
      evaluated: cards.length,
      alerts_raised: cards.filter((c) => c.alert).length,
    };
    this.lastSweepAt = serverNow;
    this.sweeps.push(rec);
    return { cards, sweep: rec };
  }

  /** AF-118 meta-check: is the EVALUATOR ITSELF alive? If the last sweep is older than heartbeatWindow (or it
   *  never ran), the detector has gone dark — a surfaced meta-staleness alert, so the stale-detector cannot
   *  fail silently. This is the property AF-118 gates; it must be GREEN before ship. */
  evaluatorLiveness(serverNow: number, heartbeatWindowSeconds: number): { alive: boolean; alert: boolean; detail: string } {
    if (this.lastSweepAt === null) {
      return { alive: false, alert: true, detail: 'staleness evaluator has never run — meta-staleness alert (AF-118)' };
    }
    const age = serverNow - this.lastSweepAt;
    if (age > heartbeatWindowSeconds) {
      return {
        alive: false,
        alert: true,
        detail: `staleness evaluator STALLED (last sweep ${age}s ago > heartbeat window ${heartbeatWindowSeconds}s) — meta-staleness alert (AF-118): the stale-detector itself is down`,
      };
    }
    return { alive: true, alert: false, detail: `evaluator alive (last sweep ${age}s ago)` };
  }
}
