// The `Infra` port — every live side effect (Railway, Supabase mgmt, management DB) goes through
// here so the orchestrator (provision.ts) stays testable with no live infra. The LIVE adapter
// (RailwayInfra) is the two-party AF-004 step; only DryRunInfra is implemented now.

import type { ClientRegistryRow, DeploymentConfig } from "./types.ts";

export interface Infra {
  // — Railway link —
  isRailwayLinked(slug: string): Promise<boolean>;
  linkRailway(cfg: DeploymentConfig): Promise<void>;

  // — DEPLOYMENT_CONFIG (non-secret JSON) —
  getDeploymentConfig(slug: string): Promise<DeploymentConfig | null>;
  setDeploymentConfig(cfg: DeploymentConfig): Promise<void>;

  // — env secrets (Railway) —
  getPresentSecretKeys(slug: string): Promise<Set<string>>;
  setSecret(slug: string, key: string, value: string): Promise<void>;

  // — management DB (client_registry; table DDL owned by ISSUE-012) —
  getRegistryRow(slug: string): Promise<ClientRegistryRow | null>;
  insertRegistryRow(row: ClientRegistryRow): Promise<void>;

  // — deploy + status —
  triggerFirstDeploy(slug: string): Promise<void>;
  getDeploymentStatus(slug: string): Promise<ClientRegistryRow["status"] | "none">;
}

/**
 * In-memory fake used by the build-time smoke tests. Records calls, supports fault injection
 * (a set of secret keys to treat as un-settable, or a step to blow up on) so we can PROVE
 * fail-loud + idempotency without any live infra. This is NOT the live adapter.
 */
export class DryRunInfra implements Infra {
  linked = new Set<string>();
  config = new Map<string, DeploymentConfig>();
  secrets = new Map<string, Map<string, string>>();
  rows = new Map<string, ClientRegistryRow>();
  deployed = new Set<string>();
  readonly calls: string[] = [];

  /** keys whose setSecret() throws — simulates a secret the operator never supplied. */
  failingSecretKeys = new Set<string>();
  /** if set, the named step method throws once — simulates a transient partial failure. */
  failOnce: string | null = null;

  private maybeFail(step: string) {
    if (this.failOnce === step) {
      this.failOnce = null;
      throw new Error(`injected failure at ${step}`);
    }
  }
  private secretsOf(slug: string) {
    let m = this.secrets.get(slug);
    if (!m) this.secrets.set(slug, (m = new Map()));
    return m;
  }

  async isRailwayLinked(slug: string) {
    return this.linked.has(slug);
  }
  async linkRailway(cfg: DeploymentConfig) {
    this.calls.push(`linkRailway:${cfg.clientSlug}`);
    this.maybeFail("linkRailway");
    this.linked.add(cfg.clientSlug);
  }
  async getDeploymentConfig(slug: string) {
    return this.config.get(slug) ?? null;
  }
  async setDeploymentConfig(cfg: DeploymentConfig) {
    this.calls.push(`setDeploymentConfig:${cfg.clientSlug}`);
    this.maybeFail("setDeploymentConfig");
    this.config.set(cfg.clientSlug, cfg);
  }
  async getPresentSecretKeys(slug: string) {
    return new Set(this.secretsOf(slug).keys());
  }
  async setSecret(slug: string, key: string, value: string) {
    this.calls.push(`setSecret:${slug}:${key}`);
    this.maybeFail("setSecret");
    if (this.failingSecretKeys.has(key)) {
      throw new Error(`cannot set secret ${key} (not supplied)`);
    }
    this.secretsOf(slug).set(key, value);
  }
  async getRegistryRow(slug: string) {
    return this.rows.get(slug) ?? null;
  }
  async insertRegistryRow(row: ClientRegistryRow) {
    this.calls.push(`insertRegistryRow:${row.clientSlug}`);
    this.maybeFail("insertRegistryRow");
    this.rows.set(row.clientSlug, row);
  }
  async triggerFirstDeploy(slug: string) {
    this.calls.push(`triggerFirstDeploy:${slug}`);
    this.maybeFail("triggerFirstDeploy");
    // The first deploy runs the C0/C1 seed. Status observable only once the deploy has run.
    this.deployed.add(slug);
  }
  async getDeploymentStatus(slug: string) {
    if (!this.deployed.has(slug)) return "none";
    return this.rows.get(slug)?.status ?? "none";
  }
}

// TODO(AF-004): RailwayInfra implements Infra against the real Railway CLI/API + Supabase
// management API + the management DB (client_registry, ISSUE-012). Built in the two-party session.
