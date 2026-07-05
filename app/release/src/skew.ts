// ISSUE-080 §8 step 5 — the fleet version-skew evaluation + max-skew alert (FR-10.DEP.004 / NFR-INF.004).
// Reads each deployment's reported core_version + last_push_at from DATA-deployment_health and flags a
// laggard that is MORE THAN `deploy_max_version_skew` versions behind the fleet OR MORE THAN
// `deploy_max_skew_days` days stale — so a client stuck on a failed migration is CAUGHT, never silently
// drifting (#3). Version skew is normal + bounded (the expand-contract premise); the alert catches the
// UNbounded laggard, not every skew. `frozen ≠ stale` (NFR-INF.004 note): a frozen deployment (ISSUE-083)
// is excluded from staleness — a freeze is a distinct status, not drift.

import type { DeploymentHealthRow, SkewAlert, AlertSink } from "./store.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SkewConfig {
  deploy_max_version_skew: number;
  deploy_max_skew_days: number;
}

export interface SkewInput {
  rows: readonly DeploymentHealthRow[];
  /** The known release sequence, oldest→newest. A deployment's version is placed by its index here. */
  releaseOrder: readonly string[];
  config: SkewConfig;
  /** Evaluation wall-clock (epoch ms) — injected so staleness is deterministic in tests. */
  now: number;
  /** Deployments in a freeze (client_registry.status='frozen', ISSUE-083) — excluded from staleness. */
  frozenSlugs?: ReadonlySet<string>;
}

export interface SkewEvaluation {
  /** The index of the fleet head (newest reported version) within releaseOrder; -1 if none placeable. */
  fleetHeadIndex: number;
  fleetHeadVersion: string | null;
  alerts: SkewAlert[];
  /** Deployments whose reported version is absent from the known release order (surfaced, never dropped). */
  unplaceable: string[];
}

/** Evaluate fleet skew. Pure — emits nothing; returns the alerts. Use `evaluateAndEmit` to hand off. */
export function evaluateSkew(input: SkewInput): SkewEvaluation {
  const { rows, releaseOrder, config, now } = input;
  const frozen = input.frozenSlugs ?? new Set<string>();
  const indexOf = (v: string | null): number => (v === null ? -1 : releaseOrder.indexOf(v));

  // Fleet head = the newest version any deployment actually reports (the leader they lag behind).
  let fleetHeadIndex = -1;
  for (const r of rows) {
    const i = indexOf(r.core_version);
    if (i > fleetHeadIndex) fleetHeadIndex = i;
  }
  const fleetHeadVersion = fleetHeadIndex >= 0 ? (releaseOrder[fleetHeadIndex] ?? null) : null;

  const alerts: SkewAlert[] = [];
  const unplaceable: string[] = [];

  for (const r of rows) {
    // ── version skew ──────────────────────────────────────────────────────────
    const i = indexOf(r.core_version);
    if (i < 0) {
      // Unknown/unreported version — cannot place it. That is itself drift (#3): alert loud, don't drop.
      unplaceable.push(r.client_slug);
      alerts.push({
        client_slug: r.client_slug,
        kind: "version_skew",
        detail: `reports version ${r.core_version === null ? "(none)" : `'${r.core_version}'`} not in the known release order — cannot place; treated as drift`,
        observed: releaseOrder.length,
        bound: config.deploy_max_version_skew,
      });
    } else if (fleetHeadIndex - i > config.deploy_max_version_skew) {
      const behind = fleetHeadIndex - i;
      alerts.push({
        client_slug: r.client_slug,
        kind: "version_skew",
        detail: `${behind} versions behind the fleet head (${fleetHeadVersion}); bound is ${config.deploy_max_version_skew}`,
        observed: behind,
        bound: config.deploy_max_version_skew,
      });
    }

    // ── staleness ─────────────────────────────────────────────────────────────
    // frozen ≠ stale — a freeze is a deliberate status, not drift (NFR-INF.004 note).
    if (!frozen.has(r.client_slug)) {
      const pushedAt = Date.parse(r.last_push_at);
      if (!Number.isNaN(pushedAt)) {
        const daysStale = (now - pushedAt) / DAY_MS;
        if (daysStale > config.deploy_max_skew_days) {
          alerts.push({
            client_slug: r.client_slug,
            kind: "stale_skew",
            detail: `last push ${daysStale.toFixed(1)} days ago; bound is ${config.deploy_max_skew_days} days`,
            observed: Math.floor(daysStale),
            bound: config.deploy_max_skew_days,
          });
        }
      }
    }
  }

  return { fleetHeadIndex, fleetHeadVersion, alerts, unplaceable };
}

/** Evaluate and hand every alert to the C7 sink (FR-7.MGM.004 delivery seam). Returns the evaluation. */
export async function evaluateAndEmit(input: SkewInput, sink: AlertSink): Promise<SkewEvaluation> {
  const evalResult = evaluateSkew(input);
  for (const a of evalResult.alerts) await sink.emit(a);
  return evalResult;
}
