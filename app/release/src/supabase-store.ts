// ISSUE-080 — the LIVE DeploymentHealthStore adapter (pg, against the MANAGEMENT-PLANE Supabase). It is
// the only module that imports `pg`. It implements the same port as InMemoryDeploymentHealthStore against
// the real DDL (schema.md §13 deployment_health — the push-fed operational rollup, mgmt-plane only).
//
// ⚠️ NOT YET RUN LIVE in this offline half. The skew evaluation reads these rows on the management plane;
// the health-push INGEST that populates them is C7's (FR-7.MGM.001/002, ISSUE-012). This adapter is
// authored to the DDL so the seam is real and typechecks; InMemoryDeploymentHealthStore is the proven
// reference model. The live read is exercised at the two-party capstone against the mgmt-plane DB.
//
// Isolation (#2): this reads the MGMT DB (MGMT_DATABASE_URL), never a client silo — deployment_health is
// mgmt-plane operational metadata with no client business data (schema.md §13 note).

import pg from "pg";
import type { DeploymentHealthRow, DeploymentHealthStore } from "./store.js";

export class SupabaseDeploymentHealthStore implements DeploymentHealthStore {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString });
  }

  async list(): Promise<DeploymentHealthRow[]> {
    const { rows } = await this.pool.query<{
      client_slug: string;
      core_version: string | null;
      last_migrated_at: Date | null;
      plugin_version: string | null;
      last_push_at: Date;
    }>(
      `select client_slug, core_version, last_migrated_at, plugin_version, last_push_at
         from deployment_health`,
    );
    return rows.map((r) => ({
      client_slug: r.client_slug,
      core_version: r.core_version,
      last_migrated_at: r.last_migrated_at === null ? null : r.last_migrated_at.toISOString(),
      plugin_version: r.plugin_version,
      last_push_at: r.last_push_at.toISOString(),
    }));
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}
