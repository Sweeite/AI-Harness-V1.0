// ISSUE-037 §8.2 — per-connector transport + verification-SCHEME identity wiring (FR-3.TRIG.004).
//
// CRITICAL BOUNDARY: this slice does NOT re-verify webhook signatures. Authentication — raw-body
// capture, constant-time HMAC / Ed25519 / OIDC-JWT verify, 401-reject — is C0 webhook-auth's trust
// boundary (ISSUE-017, FR-0.WHK.*). By the time an event reaches here it is ALREADY verified. What this
// module owns is the OD-044 reconciliation: recording, per connector, WHICH scheme C0 applied (the
// algorithm identity) and WHICH field is the dedup key — the connector-contract homing of the scheme,
// not the crypto. That identity is what ISSUE-039/040/041 wire their concrete arms against.
//
// AF GATING (issue §4 gating spikes): the per-vendor ARMS whose correctness rests on an unproven vendor
// fact are HELD until their AF flips 🔴→🟢 in feasibility-register.md:
//   - GHL Ed25519 signing input      → AF-090 (held)
//   - Slack gap-reconciliation arm   → AF-084 / AF-083 (held; affects liveness.ts sweep, not this table)
//   - Google Gmail Pub/Sub OIDC e2e  → AF-109 ; Drive changes token expiry → AF-108 (held for watch arm)
// A HELD arm still declares its scheme identity here (the generic contract), but is marked armReady:false
// so the pipeline REFUSES to advance a held connector to live processing (fail-closed, #2) — the generic
// TRIG.001/002/003 machinery ships independently, the concrete vendor wiring does not until GREEN.

import type { Connector } from './seam.js';

export type SchemeAlgorithm = 'ed25519' | 'hmac_sha256' | 'oidc_jwt' | 'channel_token';

/** The transport + verification-scheme identity for a connector, homing OD-044 into the connector
 *  contract. Facts here are cited to the dossiers via the FR (FR-3.TRIG.004 Source line), NOT invented. */
export interface SchemeIdentity {
  connector: Connector;
  /** The primary inbound transport (native webhook / Pub-Sub / Events API / channel callback). */
  transport: string;
  /** The verification algorithm C0 applied. GHL = Ed25519 (X-GHL-Signature; legacy X-WH-Signature RSA
   *  deprecated 2026-07-01). Slack = HMAC-SHA256 over `v0:{ts}:{raw_body}`, >300s skew rejected.
   *  Gmail = OIDC-JWT (aud/email/skew). Drive/Calendar = signed X-Goog-Channel-Token + TLS. */
  algorithm: SchemeAlgorithm;
  /** The header the signature/token arrives in (documentary; C0 already consumed it). */
  signatureHeader: string;
  /** The field the connector dedups a re-delivery on (GHL deliveryId · Slack event_id · Google msg id). */
  dedupKey: string;
  /** True once the per-vendor arm's viability AF is GREEN. FALSE ⇒ arm HELD ⇒ pipeline fail-closed. */
  armReady: boolean;
  /** The AF ids gating this arm — surfaced so a held arm names its owed proof (never a silent hold, #3). */
  gatingAFs: readonly string[];
}

// The generic scheme table. Every arm is HELD (armReady:false) in this slice — concrete go-live is
// ISSUE-039/040/041 once the AFs flip. The scheme IDENTITY is authoritative now; only `armReady` waits.
export const SCHEME_TABLE: Readonly<Record<Connector, SchemeIdentity>> = {
  ghl: {
    connector: 'ghl',
    transport: 'native_app_webhook',
    algorithm: 'ed25519',
    signatureHeader: 'X-GHL-Signature',
    dedupKey: 'deliveryId',
    armReady: false, // held until AF-090 (exact Ed25519 signing input) GREEN
    gatingAFs: ['AF-090', 'AF-097'],
  },
  slack: {
    connector: 'slack',
    transport: 'events_api',
    algorithm: 'hmac_sha256',
    signatureHeader: 'X-Slack-Signature',
    dedupKey: 'event_id',
    armReady: false, // held until AF-084/AF-083 (gap reconciliation viability + history affordability) GREEN
    gatingAFs: ['AF-084', 'AF-083'],
  },
  google: {
    connector: 'google',
    transport: 'pubsub_and_channel_callback',
    algorithm: 'oidc_jwt', // Gmail; Drive/Calendar use channel_token (see note) — Gmail is the primary arm
    signatureHeader: 'Authorization', // Pub/Sub OIDC bearer; Drive/Calendar use X-Goog-Channel-Token
    dedupKey: 'messageId',
    armReady: false, // held until AF-109 (Gmail OIDC e2e) / AF-108 (Drive changes token) GREEN
    gatingAFs: ['AF-109', 'AF-108'],
  },
};

export function schemeFor(connector: Connector): SchemeIdentity {
  const s = SCHEME_TABLE[connector];
  if (!s) throw new Error(`no scheme identity for connector '${connector}' (FR-3.TRIG.004)`);
  return s;
}

/** True only if the connector's per-vendor arm is cleared to process live (its AF is GREEN). The
 *  pipeline uses this to fail-closed on a held arm rather than silently pretend-process it (#2/#3). */
export function isArmReady(connector: Connector): boolean {
  return schemeFor(connector).armReady;
}
