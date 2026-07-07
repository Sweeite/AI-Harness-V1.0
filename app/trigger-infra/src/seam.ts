// ISSUE-037 — the C0→C3 seam types this slice CONSUMES, and the connector identity set.
//
// This slice never re-verifies a webhook — that is C0 webhook-auth's trust boundary (ISSUE-017,
// FR-0.WHK.*). On a 200 outcome, C0 hands us `VerifyOutcome.verifiedPayload` + `connector` + `eventId`
// (app/webhook-auth/src/outcome.ts L21-31). We model that seam here STRUCTURALLY (mirroring VerifyOutcome
// exactly), rather than hard-importing across packages — the house precedent (app/triggers/src/store.ts
// L59 defines its own VerifiedEvent at the same seam). A hard cross-package import would couple this
// slice's offline test to another package's build graph for a shape that is one interface wide.
//
// The `Connector` domain is the SAME closed set app/webhook-auth/src/store.ts L18 defines
// (`ghl | google | slack`) — kept in lockstep. A drift here would let this slice route an event C0 can
// never produce, so the value set is asserted in tests.

export type Connector = 'ghl' | 'google' | 'slack';
export const CONNECTORS: readonly Connector[] = ['ghl', 'google', 'slack'] as const;
export function isConnector(v: unknown): v is Connector {
  return typeof v === 'string' && (CONNECTORS as readonly string[]).includes(v);
}

/** The already-verified event C0 (ISSUE-017) hands to this slice at a 200 outcome. Mirrors
 *  `VerifyOutcome` (status 200) from app/webhook-auth/src/outcome.ts: `connector`, `eventId`,
 *  `verifiedPayload`. `verified` is a defence-in-depth flag — this slice REFUSES to process an event
 *  that is not flagged verified (fail-closed; C0 should never hand an unverified one, but #2 says don't
 *  assume). `rawEventId` is the connector's own delivery/event id used for dedup (deliveryId / event_id /
 *  message id) — see FR-3.TRIG.004 per-vendor dedup keys. */
export interface VerifiedEvent {
  connector: Connector;
  verified: boolean;
  /** The connector's per-delivery id: GHL deliveryId · Slack event_id · Google message id. Dedup key. */
  rawEventId: string;
  /** The verified payload C0 handed off (VerifyOutcome.verifiedPayload) — opaque until the parser runs. */
  verifiedPayload: unknown;
}
