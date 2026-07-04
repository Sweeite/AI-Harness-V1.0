// ISSUE-006 §8 step 2 — Slack verifier (the self-signable reference; built first).
//
// Order is load-bearing and per the ACs:
//   1. Reject timestamp older than replay_window_seconds FIRST, as a replay, BEFORE any signature
//      work (AC-0.WHK.004.1) — a stale forgery must be rejected cheaply.
//   2. Then HMAC-SHA256 over the base string `v0:[timestamp]:[raw body]` with the signing secret,
//      compared with crypto.timingSafeEqual — NEVER `===` (AC-0.WHK.004.2).
//
// The signing secret is read from the webhook_secrets sink, never inline.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import type { Ingress } from '../rawBody.js';
import type { Sinks } from '../sinks.js';
import { CFG } from '../config.js';
import { reject, accept, type VerifyOutcome } from '../reject.js';

// Slack signs `v0:${timestamp}:${rawBody}` and sends `X-Slack-Signature: v0=<hexdigest>` +
// `X-Slack-Request-Timestamp: <unix seconds>`.
export function slackBaseString(timestamp: string, rawBody: Buffer): Buffer {
  return Buffer.concat([Buffer.from(`v0:${timestamp}:`, 'utf8'), rawBody]);
}

export function signSlack(signingSecret: string, timestamp: string, rawBody: Buffer): string {
  const mac = createHmac('sha256', signingSecret).update(slackBaseString(timestamp, rawBody)).digest('hex');
  return `v0=${mac}`;
}

// Constant-time compare of two `v0=...` signature strings. Length-guard first (timingSafeEqual throws
// on unequal lengths), then a constant-time byte compare — never `===`.
function safeEqualSig(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export interface SlackRequest {
  ingress: Ingress; // raw() is the exact received bytes — the ONLY signing input
  sourceId: string | null; // Slack team/app id for per-source failure counting
  now: number; // logical epoch seconds (deterministic)
}

export function verifySlack(sinks: Sinks, req: SlackRequest): VerifyOutcome {
  const { ingress, sourceId, now } = req;
  const timestamp = ingress.header('x-slack-request-timestamp');
  const provided = ingress.header('x-slack-signature');

  // AC-0.WHK.001.1 — absent signature/timestamp → 401, no processing.
  if (!timestamp || !provided) {
    return reject(sinks, 'slack', sourceId, 'missing X-Slack-Signature or X-Slack-Request-Timestamp');
  }

  // (1) Replay window FIRST — before any signature work (AC-0.WHK.004.1).
  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum) || Math.abs(now - tsNum) > CFG.replay_window_seconds) {
    return reject(
      sinks,
      'slack',
      sourceId,
      `timestamp outside ±${CFG.replay_window_seconds}s replay window (stale/replayed) — rejected before signature check`,
    );
  }

  // (2) HMAC over v0:ts:rawBody, constant-time compare (AC-0.WHK.004.2).
  const signingSecret = sinks.readSecret('slack', 'hmac_signing_secret');
  const expected = signSlack(signingSecret, timestamp, ingress.raw());
  if (!safeEqualSig(expected, provided)) {
    return reject(sinks, 'slack', sourceId, 'HMAC signature mismatch');
  }

  // Verified. Slack has no event-ID cache in this path (its replay defense is the timestamp window);
  // event_id here is derived from the timestamp for the accept row.
  return accept(sinks, 'slack', `slack-${timestamp}`, 'slack webhook verified', ingress.parsed());
}
