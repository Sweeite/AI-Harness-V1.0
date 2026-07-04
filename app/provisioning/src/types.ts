// Types for the provisioning flow (FR-10.PRV.001). See ADR-005 §5.

/** A connector this client uses (client-driven — only in-scope ones are provisioned). */
export type Connector = "ghl" | "google" | "slack";

/** `DEPLOYMENT_CONFIG` — NON-SECRET JSON set on the Railway deployment (ADR-005 §5). */
export interface DeploymentConfig {
  clientSlug: string;
  clientName: string;
  /** Default Sydney (FR-10.ISO.003 / ADR-001). */
  region: string;
  /** Assigned by Railway; redirect URIs point here (FR-10.PRV.002). */
  railwayUrl: string;
  coreVersion: string;
  connectors: Connector[];
}

/**
 * The env-secret keys that MUST be present for a deployment to boot (the `secret_manifest`).
 * A required-but-missing secret blocks boot loudly (never a silent half-silo). Values never
 * live in the repo or in DEPLOYMENT_CONFIG — only in the deployment's Railway env + (for the
 * internal_token) the management DB.
 */
export const REQUIRED_SECRETS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "INTERNAL_TOKEN", // minted by this script, dual-stored (Railway env + management DB)
  "LOGIN_OAUTH_CLIENT_ID",
  "LOGIN_OAUTH_CLIENT_SECRET",
] as const;

/** Per-connector secret keys, required only for in-scope connectors. */
export const CONNECTOR_SECRETS: Record<Connector, readonly string[]> = {
  ghl: ["GHL_CLIENT_ID", "GHL_CLIENT_SECRET"],
  google: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  slack: ["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET"],
};

export type SecretKey = string;

/** The registry row this script INSERTS (schema owned by ISSUE-012 / FR-10.MGT.001). */
export interface ClientRegistryRow {
  clientSlug: string;
  clientName: string;
  railwayUrl: string;
  coreVersion: string;
  region: string;
  /** encrypted at rest by the management DB; the mint is dual-stored. */
  internalTokenEncrypted: string;
  status: "initialising" | "active" | "offboarding" | "frozen";
}

/** The full list of secret keys required for a given config (base + in-scope connectors). */
export function requiredSecretKeys(cfg: DeploymentConfig): SecretKey[] {
  const keys: SecretKey[] = [...REQUIRED_SECRETS];
  for (const c of cfg.connectors) keys.push(...CONNECTOR_SECRETS[c]);
  return keys;
}
