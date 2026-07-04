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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// RailwayInfra — the LIVE `Infra` adapter (FR-10.PRV.001), codified from the AF-004 session.
//
// Every Railway op goes through the GraphQL API `https://backboard.railway.com/graphql/v2`
// (the `.app` host is STALE — tool-integrations/railway.md §4); `client_registry` reads/writes go
// through the Supabase Management API (`/database/query`) on the operator's management-plane project.
//
// PROVENANCE (Rule 0 — cite, don't guess):
//  • PROVEN LIVE in AF-004 (evidence: ../results/af-004-evidence.2026-07-04.md §"GraphQL mutations
//    validated live"): `variableUpsert`/`variableCollectionUpsert` (skipDeploys), `serviceDomainCreate`,
//    the `deployments` query, and the Supabase Management API `/database/query` (used to apply the
//    mgmt migration + write the `client_registry` row this session).
//  • DOCUMENTED but NOT yet live-validated in AF-004 → carry ⚠️ AF-143 (validate the name/input against
//    the live `railway.com/graphiql` before relying on it): the `variables` read query,
//    `serviceInstanceDeploy`, and the service repo-link read. Marked inline; they are the documented
//    shapes from tool-integrations/railway.md §4, not invented.
//  • AF-141 (manual gate): the GitHub App install + repo link has NO API/CLI path. `linkRailway`
//    therefore FAILS LOUD pointing at the one-time operator step (OD-174) — it never silently
//    "deploys from nothing" (#3). `isRailwayLinked` verifies the repo is connected.
//  • AF-142: this adapter needs a **Workspace/Account** Railway token (project tokens can't create).
//    Custody it as a god-mode secret (operator store only), passed in as `railwayApiToken`.
//
// Env-write discipline (railway.md §12 residuals): every variable write passes `skipDeploys:true`
// (they redeploy by default); `variableCollectionUpsert replace:true` is destructive — never used here.

import { REQUIRED_SECRETS } from "./types.ts";

const RAILWAY_GQL = "https://backboard.railway.com/graphql/v2";

export interface RailwayInfraConfig {
  /** Workspace/Account token (AF-142) — operator secret store only. */
  railwayApiToken: string;
  /** Railway topology (from the AF-004 evidence file / DEPLOYMENT onboarding). */
  projectId: string;
  serviceId: string;
  environmentId: string;
  /** Management-plane Supabase project ref + PAT (client_registry lives here). */
  mgmtProjectRef: string;
  supabaseAccessToken: string;
  fetchImpl?: typeof fetch;
}

export class RailwayInfra implements Infra {
  private readonly cfg: RailwayInfraConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(cfg: RailwayInfraConfig) {
    this.cfg = cfg;
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  // ── low-level: Railway GraphQL ──
  private async gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await this.fetchImpl(RAILWAY_GQL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.cfg.railwayApiToken}`,
      },
      body: JSON.stringify({ query, variables }),
    });
    const json = (await res.json()) as { data?: T; errors?: unknown };
    if (!res.ok || json.errors) {
      throw new Error(`Railway GraphQL ${res.status}: ${JSON.stringify(json.errors ?? json).slice(0, 400)}`);
    }
    return json.data as T;
  }

  // ── low-level: Supabase Management API (management-plane client_registry) ──
  private async mgmt<T = Record<string, unknown>>(sql: string): Promise<T[]> {
    const res = await this.fetchImpl(
      `https://api.supabase.com/v1/projects/${this.cfg.mgmtProjectRef}/database/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.cfg.supabaseAccessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: sql }),
      },
    );
    const body = await res.text();
    if (!res.ok) throw new Error(`Supabase mgmt query ${res.status}: ${body.slice(0, 400)}`);
    return JSON.parse(body) as T[];
  }
  private sqlLit(v: string): string {
    return `'${v.replace(/'/g, "''")}'`; // escape single quotes for a SQL string literal
  }

  // ── Railway link (AF-141 manual gate) ──
  async isRailwayLinked(_slug: string): Promise<boolean> {
    // ⚠️ AF-143: `service.repoTriggers` is the documented read for a connected repo — validate live.
    const data = await this.gql<{ service: { repoTriggers?: { edges: unknown[] } } | null }>(
      `query($id: String!) { service(id: $id) { id repoTriggers { edges { node { id } } } } }`,
      { id: this.cfg.serviceId },
    );
    return (data.service?.repoTriggers?.edges?.length ?? 0) > 0;
  }
  async linkRailway(_cfg: DeploymentConfig): Promise<void> {
    // AF-141: no API/CLI path to install the GitHub App or authorize the repo. Fail LOUD, don't fake it.
    throw new Error(
      "Railway repo link is a MANUAL, dashboard/OAuth-only step (AF-141 / OD-174): install the Railway " +
        "GitHub App on the operator org and grant it access to the shared repo, link it to this service, " +
        "then re-run. Provisioning will not deploy from an unlinked service (#3).",
    );
  }

  // ── DEPLOYMENT_CONFIG (non-secret JSON, stored as a Railway variable) ──
  async getDeploymentConfig(_slug: string): Promise<DeploymentConfig | null> {
    const vars = await this.readVariables();
    const raw = vars["DEPLOYMENT_CONFIG"];
    if (!raw) return null;
    try {
      return JSON.parse(raw) as DeploymentConfig;
    } catch {
      return null;
    }
  }
  async setDeploymentConfig(cfg: DeploymentConfig): Promise<void> {
    await this.upsertVariable("DEPLOYMENT_CONFIG", JSON.stringify(cfg));
  }

  // ── env secrets (Railway variables) ──
  async getPresentSecretKeys(_slug: string): Promise<Set<string>> {
    return new Set(Object.keys(await this.readVariables()));
  }
  async setSecret(_slug: string, key: string, value: string): Promise<void> {
    await this.upsertVariable(key, value);
  }

  /** ⚠️ AF-143: the `variables(...)` read query is documented (railway.md §4) — validate live. */
  private async readVariables(): Promise<Record<string, string>> {
    const data = await this.gql<{ variables: Record<string, string> }>(
      `query($projectId: String!, $environmentId: String!, $serviceId: String!) {
         variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)
       }`,
      { projectId: this.cfg.projectId, environmentId: this.cfg.environmentId, serviceId: this.cfg.serviceId },
    );
    return data.variables ?? {};
  }
  /** variableUpsert with skipDeploys:true (PROVEN in AF-004) — never triggers a mid-seed redeploy. */
  private async upsertVariable(name: string, value: string): Promise<void> {
    await this.gql(
      `mutation($input: VariableUpsertInput!) { variableUpsert(input: $input) }`,
      {
        input: {
          projectId: this.cfg.projectId,
          environmentId: this.cfg.environmentId,
          serviceId: this.cfg.serviceId,
          name,
          value,
          skipDeploys: true,
        },
      },
    );
  }

  // ── management DB: client_registry (table DDL owned by ISSUE-012) ──
  async getRegistryRow(slug: string): Promise<ClientRegistryRow | null> {
    const rows = await this.mgmt<{
      client_slug: string;
      client_name: string;
      railway_url: string | null;
      core_version: string | null;
      region: string;
      internal_token: string;
      status: ClientRegistryRow["status"];
    }>(
      `select client_slug, client_name, railway_url, core_version, region, internal_token, status
         from client_registry where client_slug = ${this.sqlLit(slug)} limit 1`,
    );
    const r = rows[0];
    if (!r) return null;
    return {
      clientSlug: r.client_slug,
      clientName: r.client_name,
      railwayUrl: r.railway_url ?? "",
      coreVersion: r.core_version ?? "",
      region: r.region,
      internalTokenEncrypted: r.internal_token,
      status: r.status,
    };
  }
  async insertRegistryRow(row: ClientRegistryRow): Promise<void> {
    // ON CONFLICT DO NOTHING on the unique client_slug → idempotent re-run (never double-inserts).
    await this.mgmt(
      `insert into client_registry (client_slug, client_name, railway_url, internal_token, core_version, region, status)
         values (${this.sqlLit(row.clientSlug)}, ${this.sqlLit(row.clientName)}, ${this.sqlLit(row.railwayUrl)},
                 ${this.sqlLit(row.internalTokenEncrypted)}, ${this.sqlLit(row.coreVersion)}, ${this.sqlLit(row.region)},
                 ${this.sqlLit(row.status)})
       on conflict (client_slug) do nothing`,
    );
  }

  // ── deploy + status ──
  async triggerFirstDeploy(_slug: string): Promise<void> {
    // ⚠️ AF-143: `serviceInstanceDeploy` is the documented deploy mutation (railway.md §4) — validate
    // live. (In AF-004 the first deploy came from the GitHub-native push; this is the scripted path.)
    await this.gql(
      `mutation($serviceId: String!, $environmentId: String!) {
         serviceInstanceDeploy(serviceId: $serviceId, environmentId: $environmentId)
       }`,
      { serviceId: this.cfg.serviceId, environmentId: this.cfg.environmentId },
    );
  }
  async getDeploymentStatus(slug: string): Promise<ClientRegistryRow["status"] | "none"> {
    // "none" = no Railway deploy has happened yet (→ orchestrator triggers the first deploy). Once a
    // deploy exists, the authoritative lifecycle status is the mgmt-DB client_registry.status.
    const data = await this.gql<{
      deployments: { edges: { node: { id: string; status: string } }[] };
    }>(
      `query($input: DeploymentListInput!) {
         deployments(input: $input, first: 1) { edges { node { id status } } }
       }`, // PROVEN in AF-004 (deployments query + status enum)
      { input: { projectId: this.cfg.projectId, environmentId: this.cfg.environmentId, serviceId: this.cfg.serviceId } },
    );
    if ((data.deployments?.edges?.length ?? 0) === 0) return "none";
    const row = await this.getRegistryRow(slug);
    return row?.status ?? "none";
  }
}

// Reference: the base secret manifest this adapter must see present before a healthy boot.
export { REQUIRED_SECRETS };
