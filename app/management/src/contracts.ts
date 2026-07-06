// ISSUE-012 — the cross-deployment READ CONTRACTS (FR-7.MGM.003/004/005). This slice owns the CONTRACT —
// which deployment_health / client_registry field feeds which Super Admin card — NOT the screens (those are
// ISSUE-078). The contract is data-only and business-data-free (FR-10.MGT.003 / AC-10.MGT.003.1): every card
// sources ONLY operational metadata from the push-fed store; "look inside a client" = click-through into that
// client's deployment under ITS RBAC (AC-10.MGT.003.2 / AC-NFR-SEC.002.3), never a mgmt-plane mirror.

import { type DeploymentHealthRow, type ClientRegistryRow } from './store.ts';
import { type CardLiveness } from './staleness.ts';

/** FR-7.MGM.003 — deployment health grid: one card per active deployment, keyed on client_registry, sourcing
 *  ONLY operational metadata. Card click-through routes into the client deployment (not a mgmt-plane copy). */
export interface HealthGridCard {
  client_slug: string;
  client_name: string;
  health_score: number | null;
  last_active: string | null; // = deployment_health.last_push_at (freshness timestamp)
  open_alerts: number; // = sum of deployment_health.alert_counts
  approval_queue_depth: number | null;
  core_version: string | null;
  liveness: CardLiveness['liveness'];
  /** the route a click-through takes — into the CLIENT's own deployment under its RBAC (never mgmt data). */
  click_through_url: string | null; // = client_registry.railway_url
}

export function healthGridCard(
  registry: ClientRegistryRow,
  health: DeploymentHealthRow | null,
  liveness: CardLiveness,
): HealthGridCard {
  return {
    client_slug: registry.client_slug,
    client_name: registry.client_name,
    health_score: health?.health_score ?? null,
    last_active: health?.last_push_at ?? null,
    open_alerts: sumAlerts(health?.alert_counts ?? null),
    approval_queue_depth: health?.approval_queue_depth ?? null,
    core_version: health?.core_version ?? registry.core_version ?? null,
    liveness: liveness.liveness,
    click_through_url: registry.railway_url, // route into the client deployment (AC-7.MGM.003.2)
  };
}

/** FR-7.MGM.004 — cross-deployment alerts + CI/CD status. Any critical alert across any deployment surfaces;
 *  the CI/CD panel shows per-deployment core_version + last-push status + plugin_version. */
export interface CrossDeploymentAlert {
  client_slug: string;
  kind: string;
  count: number;
  detail: string;
}
export interface CiCdRow {
  client_slug: string;
  core_version: string | null; // keyed field
  last_migrated_at: string | null;
  plugin_version: string | null;
  last_push_at: string | null;
  push_failing: boolean; // derived from liveness (stale/unreachable ⇒ last push failed to land)
}

/** Surface every critical alert across the fleet (AC-7.MGM.004.1). alert_counts is an operational rollup
 *  (counts only, never message text). Staleness/never-reported also raises a synthetic alert. */
export function crossDeploymentAlerts(
  fleet: Array<{ health: DeploymentHealthRow | null; liveness: CardLiveness }>,
): CrossDeploymentAlert[] {
  const out: CrossDeploymentAlert[] = [];
  for (const f of fleet) {
    for (const [kind, count] of Object.entries(f.health?.alert_counts ?? {})) {
      if (count > 0) out.push({ client_slug: f.liveness.client_slug, kind, count, detail: `${count} ${kind} alert(s)` });
    }
    if (f.liveness.alert) {
      out.push({ client_slug: f.liveness.client_slug, kind: f.liveness.liveness, count: 1, detail: f.liveness.detail });
    }
  }
  return out;
}

export function ciCdRow(registry: ClientRegistryRow, health: DeploymentHealthRow | null, liveness: CardLiveness): CiCdRow {
  return {
    client_slug: registry.client_slug,
    core_version: health?.core_version ?? registry.core_version ?? null,
    last_migrated_at: health?.last_migrated_at ?? null,
    plugin_version: health?.plugin_version ?? null,
    last_push_at: health?.last_push_at ?? null,
    push_failing: liveness.liveness === 'stale' || liveness.liveness === 'unreachable' || liveness.liveness === 'never-reported',
  };
}

/** FR-7.MGM.005 — backup-health (Supabase Management API, ADR-008) + estimate-grade cost overview (ADR-003).
 *  backup_health is pushed as an opaque operational rollup; cost is ALWAYS labelled estimate-grade. */
export interface BackupHealthCard {
  client_slug: string;
  backup_health: Record<string, unknown> | null; // sourced from the Supabase Management API push
  source: 'supabase-management-api';
}
export interface CostOverviewRow {
  client_slug: string;
  cost_to_date: number | null;
  grade: 'estimate'; // ALWAYS estimate-grade (COST.001 / ADR-003) — never presented as billed/actual
}

export function backupHealthCard(registry: ClientRegistryRow, health: DeploymentHealthRow | null): BackupHealthCard {
  return { client_slug: registry.client_slug, backup_health: health?.backup_health ?? null, source: 'supabase-management-api' };
}
export function costOverviewRow(registry: ClientRegistryRow, health: DeploymentHealthRow | null): CostOverviewRow {
  return { client_slug: registry.client_slug, cost_to_date: health?.cost_to_date ?? null, grade: 'estimate' };
}

function sumAlerts(alertCounts: Record<string, number> | null): number {
  if (!alertCounts) return 0;
  return Object.values(alertCounts).reduce((a, b) => a + (b || 0), 0);
}
