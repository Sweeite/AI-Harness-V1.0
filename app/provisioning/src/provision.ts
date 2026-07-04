// The provisioning orchestrator (FR-10.PRV.001). Idempotent + loud on partial failure.
// No live infra here — all side effects go through the injected `Infra` port.

import { randomBytes } from "node:crypto";
import type { Infra } from "./infra.ts";
import {
  type ClientRegistryRow,
  type DeploymentConfig,
  requiredSecretKeys,
} from "./types.ts";

/** Loud, typed failure — surfaces exactly what stopped provisioning (never a silent half-silo). */
export class ProvisioningError extends Error {
  constructor(
    readonly step: string,
    message: string,
    readonly cause?: unknown,
  ) {
    super(`[${step}] ${message}`);
    this.name = "ProvisioningError";
  }
}

/** Mint the internal_token (operator-side, once). Dual-stored: Railway env + management DB. */
export function mintInternalToken(): string {
  return `itk_${randomBytes(32).toString("hex")}`;
}

export interface ProvisionResult {
  slug: string;
  status: ClientRegistryRow["status"];
  /** step names that actually did work this run (empty on a fully-converged re-run). */
  applied: string[];
  /** step names skipped because already done (proves idempotency). */
  skipped: string[];
}

/**
 * Provision a new client silo. Steps run in ADR-005 §5 order; each is idempotent (checks state,
 * skips if done) and loud on failure (throws ProvisioningError — the caller exits non-zero).
 *
 * @param providedSecrets client-supplied secret values (from the secure channel). INTERNAL_TOKEN
 *   is minted here, not supplied. A required key with no value AND not already set → fail loud.
 */
export async function provision(
  cfg: DeploymentConfig,
  providedSecrets: Record<string, string>,
  infra: Infra,
): Promise<ProvisionResult> {
  const applied: string[] = [];
  const skipped: string[] = [];
  const did = (step: string, didWork: boolean) =>
    (didWork ? applied : skipped).push(step);

  // ── Step 1: link the Railway project to the shared build repo ──
  try {
    if (await infra.isRailwayLinked(cfg.clientSlug)) {
      did("link-railway", false);
    } else {
      await infra.linkRailway(cfg);
      did("link-railway", true);
    }
  } catch (e) {
    throw new ProvisioningError("link-railway", "failed to link Railway project", e);
  }

  // ── Step 2: DEPLOYMENT_CONFIG (non-secret JSON) ──
  try {
    const existing = await infra.getDeploymentConfig(cfg.clientSlug);
    if (existing && sameConfig(existing, cfg)) {
      did("deployment-config", false);
    } else {
      await infra.setDeploymentConfig(cfg);
      did("deployment-config", true);
    }
  } catch (e) {
    throw new ProvisioningError("deployment-config", "failed to set DEPLOYMENT_CONFIG", e);
  }

  // ── Step 3: mint internal_token (reuse if the silo was already registered) ──
  const alreadyRegistered = await infra.getRegistryRow(cfg.clientSlug);
  const present = await infra.getPresentSecretKeys(cfg.clientSlug);
  let internalToken: string | null = null;
  if (alreadyRegistered) {
    // Token already minted + dual-stored on a prior run. Re-mint would break the DB copy.
    // The Railway-env copy must still be present; if not, this is NOT silently recoverable
    // (the DB copy is encrypted) — fail loud and tell the operator to rotate (ISSUE-012).
    if (!present.has("INTERNAL_TOKEN")) {
      throw new ProvisioningError(
        "internal-token",
        "registry row exists but INTERNAL_TOKEN missing from Railway env — dual-store is inconsistent; rotate via the management plane (ISSUE-012) rather than re-minting",
      );
    }
    did("mint-token", false);
  } else if (present.has("INTERNAL_TOKEN")) {
    did("mint-token", false); // minted on a prior partial run, not yet in the registry
  } else {
    internalToken = mintInternalToken();
    did("mint-token", true);
  }

  // ── Step 4: validate + set the env-secret set (fail loud on any missing required secret) ──
  const required = requiredSecretKeys(cfg);
  const missing: string[] = [];
  for (const key of required) {
    if (present.has(key)) continue; // already set (idempotent)
    if (key === "INTERNAL_TOKEN") continue; // handled below (minted, not client-supplied)
    if (providedSecrets[key] === undefined || providedSecrets[key] === "") missing.push(key);
  }
  if (missing.length > 0) {
    // #3 non-negotiable: never half-provision silently.
    throw new ProvisioningError(
      "secrets",
      `missing required secret(s): ${missing.join(", ")} — complete the onboarding runbook (delegated access / OAuth registration) before re-running`,
    );
  }
  try {
    let set = 0;
    for (const key of required) {
      if (present.has(key)) continue;
      if (key === "INTERNAL_TOKEN") {
        if (internalToken) {
          await infra.setSecret(cfg.clientSlug, key, internalToken);
          set++;
        }
        continue;
      }
      await infra.setSecret(cfg.clientSlug, key, providedSecrets[key]!);
      set++;
    }
    did("secrets", set > 0);
  } catch (e) {
    throw new ProvisioningError("secrets", "failed setting an env secret", e);
  }

  // ── Step 5: insert client_registry row (dual-store the token in the management DB) ──
  try {
    if (alreadyRegistered) {
      did("registry-row", false);
    } else {
      const tokenForDb =
        internalToken ??
        (() => {
          // minted on a prior run and set in Railway env, but we don't hold the plaintext now.
          throw new ProvisioningError(
            "registry-row",
            "internal_token was minted on a prior partial run and set in Railway env, but the plaintext is not available to write the management-DB copy; rotate via ISSUE-012 to restore dual-store consistency",
          );
        })();
      const row: ClientRegistryRow = {
        clientSlug: cfg.clientSlug,
        clientName: cfg.clientName,
        railwayUrl: cfg.railwayUrl,
        coreVersion: cfg.coreVersion,
        region: cfg.region,
        internalTokenEncrypted: tokenForDb, // encrypted at the mgmt-DB boundary (live adapter)
        status: "initialising",
      };
      await infra.insertRegistryRow(row);
      did("registry-row", true);
    }
  } catch (e) {
    if (e instanceof ProvisioningError) throw e;
    throw new ProvisioningError("registry-row", "failed to insert client_registry row", e);
  }

  // ── Step 6: trigger the first deploy (runs the C0/C1 seed) ──
  try {
    const status = await infra.getDeploymentStatus(cfg.clientSlug);
    if (status === "none") {
      await infra.triggerFirstDeploy(cfg.clientSlug);
      did("first-deploy", true);
    } else {
      did("first-deploy", false);
    }
  } catch (e) {
    throw new ProvisioningError("first-deploy", "first deploy / seed failed", e);
  }

  // ── Step 7: confirm status reached `initialising` (loud if the seed silently didn't land) ──
  const finalStatus = await infra.getDeploymentStatus(cfg.clientSlug);
  if (finalStatus === "none") {
    throw new ProvisioningError(
      "verify",
      "deploy triggered but status never reached `initialising` — seed did not complete; not marking ready",
    );
  }

  return { slug: cfg.clientSlug, status: finalStatus, applied, skipped };
}

function sameConfig(a: DeploymentConfig, b: DeploymentConfig): boolean {
  return (
    a.clientSlug === b.clientSlug &&
    a.clientName === b.clientName &&
    a.region === b.region &&
    a.railwayUrl === b.railwayUrl &&
    a.coreVersion === b.coreVersion &&
    a.connectors.slice().sort().join(",") === b.connectors.slice().sort().join(",")
  );
}
