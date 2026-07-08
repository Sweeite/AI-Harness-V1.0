// ISSUE-078 — surface-06 fleet-grid rendering (FR-7.MGM.003 / AC-7.MGM.003.1/.2). Two invariants govern:
//
//   • #2 map-not-warehouse — a card renders ONLY from the push-fed management store (client_registry +
//     deployment_health), NEVER a client-data pull (AC-7.MGM.003.1). This module takes an already-pushed
//     snapshot; there is deliberately NO code path that fetches a client endpoint. Clicking into a client is
//     a hand-off to that client's OWN dashboard under the client's RBAC (AC-7.MGM.003.2) — it carries no
//     management-plane grant.
//   • #3 dark-≠-healthy — the liveness classification (owned by C10 ISSUE-012's staleness evaluator, AF-118/
//     AF-120) is RENDERED honestly: stale/unreachable/never-reported read loud (never green); a FROZEN
//     deployment reads "expected quiet", not a dead-alert and not green (AC-10.OFF.004.4).
//
// The `Liveness` classification is produced upstream (management.staleness). This surface renders it — it does
// not re-derive the staleness math. The input shape below mirrors that producer's output (kept local to avoid
// a cross-package build dependency; the field set is asserted stable by ISSUE-012).

export type Liveness = "fresh" | "stale" | "unreachable" | "frozen-quiet" | "never-reported";
export type ClientStatus = "initialising" | "active" | "offboarding" | "frozen";

/** A pushed per-deployment snapshot (operational metadata ONLY — no business data can appear here). */
export interface DeploymentSnapshot {
  clientSlug: string; // valid HERE only (management plane) — never on a per-deployment surface (OD-096)
  clientName: string;
  status: ClientStatus; // server-authoritative registry status (the frozen-vs-dead discriminator)
  liveness: Liveness; // from the C10 staleness evaluator (server-authoritative time)
  healthScore: number | null;
  lastPushAtEpochS: number | null;
  openCriticalAlerts: number | null;
  coreVersion: string | null;
  costToDateUsd: number | null;
  backupOk: boolean | null; // null ⇒ unknown (never render null as a ✓)
}

export type CardTone = "healthy" | "quiet" | "loud" | "unknown";

export interface FleetCardRender {
  clientSlug: string;
  clientName: string;
  tone: CardTone;
  /** True ⇒ a cross-deployment alert is raised for this card (never a silent green). */
  alert: boolean;
  badge: string; // the honest status/liveness label
  healthDisplay: string; // "—" when unknown, never a fabricated 0
  /** The click-through descriptor — proves it hands off to the CLIENT's RBAC, not a mgmt-plane node. */
  clickThrough: { label: string; auth: "client-own-rbac"; managementPlaneNode: null };
}

/** Render one deployment card from its pushed snapshot. Never pulls; never renders a dark deployment green. */
export function renderFleetCard(s: DeploymentSnapshot): FleetCardRender {
  const clickThrough = {
    label: "Open client dashboard ↗",
    auth: "client-own-rbac" as const, // AC-7.MGM.003.2 — the client's login + RBAC, NOT a management-plane node
    managementPlaneNode: null,
  };
  const base = { clientSlug: s.clientSlug, clientName: s.clientName, clickThrough };

  switch (s.liveness) {
    case "frozen-quiet":
      // AC-10.OFF.004.4 — frozen ≠ dead: expected-quiet, not a dead-alert AND not green.
      return { ...base, tone: "quiet", alert: false, badge: "offboarding — expected quiet", healthDisplay: "—" };
    case "stale":
      return { ...base, tone: "loud", alert: true, badge: "STALE — no recent report", healthDisplay: "—" };
    case "unreachable":
      return { ...base, tone: "loud", alert: true, badge: "UNREACHABLE", healthDisplay: "—" };
    case "never-reported":
      return { ...base, tone: "loud", alert: true, badge: "never reported", healthDisplay: "—" };
    case "fresh":
      return {
        ...base,
        tone: "healthy",
        alert: (s.openCriticalAlerts ?? 0) > 0,
        badge: `active${(s.openCriticalAlerts ?? 0) > 0 ? " — critical alert" : ""}`,
        healthDisplay: s.healthScore === null ? "—" : String(s.healthScore),
      };
  }
}

/** A registry row whose health snapshot is missing renders as a `stale` card ("no recent report"), NEVER as a
 *  healthy card (surface-06 §A Partial state). This is the render for the "registry loaded, snapshot absent"
 *  case, distinct from the whole-fleet fetch error (which the panel-state machine handles). */
export function renderMissingSnapshotCard(clientSlug: string, clientName: string, status: ClientStatus): FleetCardRender {
  if (status === "frozen") {
    return renderFleetCard({
      clientSlug, clientName, status, liveness: "frozen-quiet",
      healthScore: null, lastPushAtEpochS: null, openCriticalAlerts: null, coreVersion: null, costToDateUsd: null, backupOk: null,
    });
  }
  return renderFleetCard({
    clientSlug, clientName, status, liveness: "never-reported",
    healthScore: null, lastPushAtEpochS: null, openCriticalAlerts: null, coreVersion: null, costToDateUsd: null, backupOk: null,
  });
}

export interface FleetSummary {
  active: number;
  initialising: number;
  offboardingOrFrozen: number;
  staleOrUnreachable: number;
  withCriticalAlerts: number;
  fleetCostEstimateUsd: number | null; // null ⇒ some deployments blind (never rendered as $0)
  costEstimateLabelled: true;
}

/** The sticky fleet-summary strip. A stale/unreachable count > 0 is always the loud figure (#3). Cost is an
 *  ESTIMATE across the fleet (ADR-003); a blind deployment makes the total explicitly unknown, not $0. */
export function fleetSummary(cards: DeploymentSnapshot[]): FleetSummary {
  let cost = 0;
  let anyBlind = false;
  for (const c of cards) {
    if (c.costToDateUsd === null) anyBlind = true;
    else cost += c.costToDateUsd;
  }
  return {
    active: cards.filter((c) => c.liveness === "fresh" && c.status === "active").length,
    initialising: cards.filter((c) => c.status === "initialising").length,
    offboardingOrFrozen: cards.filter((c) => c.status === "offboarding" || c.status === "frozen").length,
    staleOrUnreachable: cards.filter((c) => c.liveness === "stale" || c.liveness === "unreachable" || c.liveness === "never-reported").length,
    withCriticalAlerts: cards.filter((c) => (c.openCriticalAlerts ?? 0) > 0).length,
    fleetCostEstimateUsd: anyBlind ? null : cost,
    costEstimateLabelled: true,
  };
}

/** Backup-health render (Section G) — a deployment whose backup status is unknown reads "—", NEVER a ✓ (a
 *  false "backed up ✓" that is really a fetch failure is a #1 hole: it implies recoverable data that may not
 *  exist). Sourced from the Supabase Management API / pushed rollup upstream (AC-7.MGM.005.1). */
export function renderBackupHealth(backupOk: boolean | null): { display: string; healthy: boolean } {
  if (backupOk === null) return { display: "backup status unknown — can't confirm", healthy: false };
  return backupOk ? { display: "backed up ✓", healthy: true } : { display: "BACKUP FAILING", healthy: false };
}
