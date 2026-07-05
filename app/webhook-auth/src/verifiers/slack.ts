// ISSUE-017 §8 step 3 — Slack verifier (HMAC-SHA256, FR-0.WHK.004). Ported from the AF-078 spike.
// Order is load-bearing and per the ACs:
//   1. Reject timestamp older than replay_window_seconds FIRST, as a replay, BEFORE any signature
//      work (AC-0.WHK.004.1) — a stale forgery must be rejected cheaply.
//   2. Then HMAC-SHA256 over `v0:[timestamp]:[raw body]` with the signing secret, compared with
//      crypto.timingSafeEqual — NEVER `===` (AC-0.WHK.004.2).
// Production change vs the spike: DUAL-ACCEPT — accept a match against ANY active signing-secret
// version (FR-0.WHK.007).

import { createHmac, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import type { Ingress } from '../rawBody.js';
import type { ActiveSecret } from '../store.js';

export function slackBaseString(timestamp: string, rawBody: Buffer): Buffer {
  return Buffer.concat([Buffer.from(`v0:${timestamp}:`, 'utf8'), rawBody]);
}

export function signSlack(signingSecret: string, timestamp: string, rawBody: Buffer): string {
  const mac = createHmac('sha256', signingSecret).update(slackBaseString(timestamp, rawBody)).digest('hex');
  return `v0=${mac}`;
}

// Constant-time compare of two `v0=...` signature strings. Length-guard first (timingSafeEqual throws
// on unequal lengths), then a constant-time byte compare — never `===`.
export function safeEqualSig(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export interface SlackVerifyResult {
  ok: boolean;
  reason?: string;
  eventId?: string;
}

export function verifySlack(
  ingress: Ingress,
  activeSecrets: ActiveSecret[],
  now: number,
  replayWindowSeconds: number,
): SlackVerifyResult {
  const timestamp = ingress.header('x-slack-request-timestamp');
  const provided = ingress.header('x-slack-signature');

  // AC-0.WHK.001.1 — absent signature/timestamp → 401, no processing.
  if (!timestamp || !provided) return { ok: false, reason: 'missing X-Slack-Signature or X-Slack-Request-Timestamp' };

  // (1) Replay window FIRST — before any signature work (AC-0.WHK.004.1).
  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum) || Math.abs(now - tsNum) > replayWindowSeconds) {
    return { ok: false, reason: `timestamp outside ±${replayWindowSeconds}s replay window (stale/replayed) — rejected before signature check` };
  }

  // (2) HMAC over v0:ts:rawBody, constant-time compare, dual-accept over active versions.
  if (activeSecrets.length === 0) return { ok: false, reason: 'no active Slack signing secret in webhook_secrets' };
  const matched = activeSecrets.some((s) => safeEqualSig(signSlack(s.value, timestamp, ingress.raw()), provided));
  if (!matched) return { ok: false, reason: 'HMAC signature mismatch against all active secrets' };

  // Verified. Slack's replay defense is the timestamp window; the event id is derived from the ts.
  return { ok: true, eventId: `slack-${timestamp}` };
}
