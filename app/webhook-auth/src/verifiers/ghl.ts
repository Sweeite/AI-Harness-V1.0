// ISSUE-017 §8 step 3 — GHL verifier (Ed25519, FR-0.WHK.002). Ported from the AF-078 spike; the
// production change is DUAL-ACCEPT: it verifies against EVERY active published-key version from
// webhook_secrets (FR-0.WHK.007), so a key rotation drops no events. The signing input (AF-090) is
// GHL's raw-body-only Ed25519 over the published public key — DOCS-confirmed 2026-07-04; the live
// per-payload confirmation is owed at GHL onboarding (OD-172).
//
// Header handling (OD-046 HMAC→Ed25519 correction):
//   - `X-GHL-Signature` is the current Ed25519 signature header.
//   - `X-WH-Signature` is the LEGACY (pre-cutoff) header. After GHL_LEGACY_HEADER_CUTOFF a request
//     carrying ONLY the legacy header (no X-GHL-Signature) is rejected outright (AC-0.WHK.002.2).

import { verify as edVerify } from 'node:crypto';
import { Buffer } from 'node:buffer';
import type { Ingress } from '../rawBody.js';
import type { ActiveSecret } from '../store.js';
import { GHL_LEGACY_HEADER_CUTOFF } from '../config.js';

// AF-090: GHL signs the RAW BODY ONLY with Ed25519 (GHL primary docs, 2026-07-04). Kept as a named
// function so the base-string is a single auditable point shared with C3 FR-3.TRIG.004.
export function ghlSigningInput(rawBody: Buffer): Buffer {
  return rawBody;
}

// Verify an Ed25519 signature (base64 or hex) over `signingInput` against a PEM SPKI public key.
export function verifyEd25519(publicKeyPem: string, signingInput: Buffer, signature: string): boolean {
  let sigBytes: Buffer;
  if (/^[0-9a-fA-F]+$/.test(signature) && signature.length % 2 === 0) {
    sigBytes = Buffer.from(signature, 'hex');
  } else {
    sigBytes = Buffer.from(signature, 'base64');
  }
  try {
    // Ed25519 verify: algorithm arg is null (the key encodes it); signature verification is itself
    // constant-time in the crypto backend, so no timingSafeEqual is needed here.
    return edVerify(null, signingInput, publicKeyPem, sigBytes);
  } catch {
    return false;
  }
}

export interface GhlVerifyResult {
  ok: boolean;
  reason?: string;
  eventId?: string;
}

export function verifyGhl(ingress: Ingress, activeKeys: ActiveSecret[], now: number): GhlVerifyResult {
  const ghlSig = ingress.header('x-ghl-signature');
  const legacySig = ingress.header('x-wh-signature');

  // AC-0.WHK.002.2 — legacy `X-WH-Signature`-only after the cutoff → rejected outright.
  const nowIso = new Date(now * 1000).toISOString();
  if (!ghlSig && legacySig) {
    if (nowIso >= GHL_LEGACY_HEADER_CUTOFF) {
      return { ok: false, reason: `legacy X-WH-Signature-only after ${GHL_LEGACY_HEADER_CUTOFF} cutoff (OD-046) — rejected` };
    }
    return { ok: false, reason: 'legacy X-WH-Signature path not supported (Ed25519 only)' };
  }

  // AC-0.WHK.001.1 — absent signature → 401, no processing.
  if (!ghlSig) return { ok: false, reason: 'missing X-GHL-Signature' };
  if (activeKeys.length === 0) return { ok: false, reason: 'no active GHL public key in webhook_secrets' };

  // Dual-accept: verify against ANY active key version (FR-0.WHK.007).
  const signingInput = ghlSigningInput(ingress.raw());
  const verified = activeKeys.some((k) => verifyEd25519(k.value, signingInput, ghlSig));
  if (!verified) return { ok: false, reason: 'Ed25519 signature verification failed against all active keys' };

  // logic-sweep fix (ghl.ts wrong-default): `??` only coalesces null/undefined, so an empty-string id
  // (`id: ""`) or a numeric id used to pass through and collapse the replay key to `ghl::` — two
  // DISTINCT signed events would then collide and the second be silently dropped as a replay (#1
  // knowledge-loss). `id` is not even a documented GHL dedup field. Pick the first NON-EMPTY STRING
  // id; otherwise fall back to the per-body signature-derived id (unique per body).
  const parsed = ingress.parsed() as { id?: unknown; eventId?: unknown; event_id?: unknown } | undefined;
  const firstNonEmptyString = (...vals: unknown[]): string | undefined =>
    vals.find((v): v is string => typeof v === 'string' && v.length > 0);
  const eventId = firstNonEmptyString(parsed?.id, parsed?.eventId, parsed?.event_id) ?? `ghl-${ghlSig.slice(0, 16)}`;
  return { ok: true, eventId };
}
