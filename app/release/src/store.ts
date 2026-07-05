// ISSUE-080 §5 — the ports the skew evaluation reads/writes through (house port+fake pattern; cf.
// app/silo, app/webhook-auth). BOTH tables are MANAGEMENT-PLANE only (schema.md §13); no client-silo
// table is touched by this slice. The in-memory fakes are the test doubles + reference model; the live
// pg/Management-API adapter (supabase-store.ts) is the thin translation, authored to the DDL, NOT run
// live in this offline half.

/**
 * The skew-relevant projection of DATA-deployment_health (schema.md §13) — the push-fed operational row,
 * one per client_slug. Fields beyond these exist on the table but are not read by the skew evaluation.
 */
export interface DeploymentHealthRow {
  client_slug: string;
  core_version: string | null; // last reported by the health push
  last_migrated_at: string | null; // ISO-8601
  plugin_version: string | null;
  last_push_at: string; // ISO-8601 — staleness is measured against server-authoritative time
}

/**
 * The management-plane read port. `list()` returns the current health row per fleet deployment. The live
 * adapter reads the mgmt-plane Supabase; the fake holds an in-memory map.
 */
export interface DeploymentHealthStore {
  list(): Promise<DeploymentHealthRow[]>;
}

export class InMemoryDeploymentHealthStore implements DeploymentHealthStore {
  private readonly rows = new Map<string, DeploymentHealthRow>();

  constructor(seed: readonly DeploymentHealthRow[] = []) {
    for (const r of seed) this.rows.set(r.client_slug, r);
  }

  /** Upsert a deployment's latest health row (models the C7 health-push ingest). */
  put(row: DeploymentHealthRow): void {
    this.rows.set(row.client_slug, row);
  }

  async list(): Promise<DeploymentHealthRow[]> {
    return [...this.rows.values()];
  }
}

// ── Alert emission (the cross-deployment max-skew alert hand-off to C7 — FR-7.MGM.004) ──────────────
// This slice PRODUCES the alert; C7 owns delivery/rendering. The sink is the seam between them.

export interface SkewAlert {
  client_slug: string;
  // version_skew / stale_skew are the ISSUE-080 fleet-drift alerts; migration_failure is the ISSUE-081
  // fail-loud signal a per-deployment migrate raises when it halts (fed into the SAME C7 seam so a stuck
  // silo surfaces both as a direct alert AND, because its version never advances, as a skew laggard).
  kind: "version_skew" | "stale_skew" | "migration_failure";
  detail: string;
  /** The observed value that breached bound (versions behind, or days stale). 0 for migration_failure. */
  observed: number;
  /** The configured bound it breached. 0 for migration_failure. */
  bound: number;
}

export interface AlertSink {
  emit(alert: SkewAlert): Promise<void>;
}

export class InMemoryAlertSink implements AlertSink {
  readonly emitted: SkewAlert[] = [];
  async emit(alert: SkewAlert): Promise<void> {
    this.emitted.push(alert);
  }
}
