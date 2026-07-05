// ISSUE-017 §8 step 7 — endpoint obscurity token (FR-0.WHK.006 / AC-0.WHK.006.1). A per-deployment
// random token embedded in the webhook URL structure. Priority: Could. EXPLICITLY NOT A SECURITY
// CONTROL — the design (L814) labels it "not a security measure": it only raises the bar; the
// signature check (FR-0.WHK.001) is the real trust boundary. It is captured here so no later
// requirement can lean on it as one, and it forms part of the source-identity triple (FR-0.WHK.005).
//
// The token is minted once per deployment (BOOT) and stored in deployment config, NOT in
// webhook_secrets (it is not a secret and not rotated on the vendor's clock). It must be absent from
// client-facing docs — enforced by convention + the provisioning runbook, asserted in the tests.

import { randomBytes } from 'node:crypto';

/** Mint a per-deployment obscurity token (URL-safe). Called once at provisioning; stored in config. */
export function mintEndpointToken(): string {
  return randomBytes(24).toString('base64url'); // 32 url-safe chars, ~192 bits
}

/** The webhook URL path for a connector, embedding the deployment's obscurity token. */
export function webhookPath(connector: 'ghl' | 'google' | 'slack', endpointToken: string): string {
  return `/webhooks/${connector}/${endpointToken}`;
}

/** True iff a token looks like a real minted token (non-empty, url-safe, ≥ 22 chars). Guards the
 *  AC-0.WHK.006.1 assertion that an endpoint actually carries a per-deployment token. */
export function isValidEndpointToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{22,}$/.test(token);
}
