// ISSUE-017 §8 step 2 (+ integration note) — the SHARED verification entrypoint. FR-0.WHK.001 and
// FR-0.WHK.005 are ONE pipeline, not two features: .001 is the reject-before-process contract, .005
// is the how (raw-body-before-parse / constant-time / log / alert). The three per-vendor verifiers
// (.002/.003/.004) are strategy plug-ins; .007 wraps the read side (dual-accept), .008 the post-verify
// side (replay + rate). Getting the raw-body-before-parse ordering wrong invalidates every signature
// at once — the single load-bearing correctness point AF-078 exists to prove.
//
// Pipeline order:
//   0. throttle gate  — a source auto-throttled by a prior breach is dropped (429) with no verify work.
//   1. raw body       — the ingress captured raw BEFORE parse (rawBody.ts); verifiers sign over raw().
//   2. route          — by connector; load that connector's ACTIVE secret versions (dual-accept).
//   3. verify         — the per-vendor verifier; failure → reject() (401 + guardrail_log + threshold alert/throttle).
//   4. replay dedup   — GHL/Google seen-event-ID cache AFTER a valid signature (Slack's is its ts window).
//   5. accept         — event_log accept + hand off downstream, unless over the per-source accept-rate limit.

import { ingress as makeIngress, type InboundRequest, type Ingress } from './rawBody.js';
import type { Connector, WebhookStore } from './store.js';
import { SECRET_KIND, type WebhookConfig } from './config.js';
import { sourceId as makeSourceId } from './source.js';
import { reject, accept, replayDrop, throttled, type VerifyOutcome } from './outcome.js';
import { verifyGhl } from './verifiers/ghl.js';
import { verifySlack } from './verifiers/slack.js';
import { verifyGoogle, type Jwks } from './verifiers/google.js';

export interface VerifyDeps {
  store: WebhookStore;
  cfg: WebhookConfig;
  /** Per-deployment obscurity token embedded in the endpoint URL (FR-0.WHK.006) — part of source id. */
  endpointToken: string;
  /** Logical clock (epoch seconds). Production passes Date.now()/1000; tests pass a fixed value. */
  now: number;
  /** Google JWKS provider (fetched from GOOGLE_CERTS_URL live; injected as a local JWKS in tests). */
  googleJwks?: () => Promise<Jwks>;
}

// Verify one inbound webhook end to end. `req.raw` MUST be the exact received bytes (captured before
// any JSON parse — see rawBody.ts / AC-0.WHK.005.1).
export async function verifyWebhook(connector: Connector, req: InboundRequest, deps: VerifyDeps): Promise<VerifyOutcome> {
  const { store, cfg, endpointToken, now } = deps;
  const ingress = makeIngress(req);
  const sid = makeSourceId(connector, endpointToken, ingress.sourceIp());

  // 0. Throttle gate — a source auto-throttled by a prior breach is dropped before any verify work.
  if (await store.isThrottled(sid, now)) return throttled(connector, sid);

  // 3. Per-connector verification (2 = route + load secrets happens inside each branch).
  switch (connector) {
    case 'ghl':
      return verifyGhlFlow(ingress, sid, deps);
    case 'slack':
      return verifySlackFlow(ingress, sid, deps);
    case 'google':
      return verifyGoogleFlow(ingress, sid, deps);
  }
}

async function verifyGhlFlow(ingress: Ingress, sid: string, deps: VerifyDeps): Promise<VerifyOutcome> {
  const { store, cfg, now } = deps;
  const keys = await store.readActiveSecrets('ghl', SECRET_KIND.ghl_ed25519_public_key);
  const r = verifyGhl(ingress, keys, now);
  if (!r.ok) return reject(store, cfg, 'ghl', sid, now, r.reason ?? 'ghl verify failed');

  // 4. Replay dedup by event ID (post-signature).
  const { replay } = await store.recordOrDetectReplay('ghl', r.eventId!, sid, now, cfg.replay_cache_window);
  if (replay) return replayDrop(store, 'ghl', r.eventId!, `ghl webhook replayed (event ID ${r.eventId} already seen)`);

  // 5. Accept (rate-limited).
  return accept(store, cfg, 'ghl', sid, now, r.eventId!, ingress.parsed());
}

async function verifySlackFlow(ingress: Ingress, sid: string, deps: VerifyDeps): Promise<VerifyOutcome> {
  const { store, cfg, now } = deps;
  const secrets = await store.readActiveSecrets('slack', SECRET_KIND.slack_signing);
  const r = verifySlack(ingress, secrets, now, cfg.replay_window_seconds);
  if (!r.ok) return reject(store, cfg, 'slack', sid, now, r.reason ?? 'slack verify failed');

  // Slack's replay defense IS the 5-min timestamp window (checked inside the verifier); no ID cache.
  return accept(store, cfg, 'slack', sid, now, r.eventId!, ingress.parsed());
}

async function verifyGoogleFlow(ingress: Ingress, sid: string, deps: VerifyDeps): Promise<VerifyOutcome> {
  const { store, cfg, now, googleJwks } = deps;
  if (!googleJwks) return reject(store, cfg, 'google', sid, now, 'no Google JWKS provider configured');
  const jwks = await googleJwks();
  const audiences = await store.readActiveSecrets('google', SECRET_KIND.google_expected_audience);
  const r = verifyGoogle(ingress, jwks, audiences, now);
  if (!r.ok) return reject(store, cfg, 'google', sid, now, r.reason ?? 'google verify failed');

  const { replay } = await store.recordOrDetectReplay('google', r.eventId!, sid, now, cfg.replay_cache_window);
  if (replay) return replayDrop(store, 'google', r.eventId!, `google push replayed (message ID ${r.eventId} already seen)`);

  return accept(store, cfg, 'google', sid, now, r.eventId!, ingress.parsed());
}
