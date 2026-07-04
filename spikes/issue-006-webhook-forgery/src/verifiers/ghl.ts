// ISSUE-006 §8 step 3 — GHL verifier (Ed25519). Depends on facts DISCOVERED in §8.0 (AF-090):
//   - the exact bytes GHL signs (raw body only, or body concatenated with a timestamp/header), and
//   - GHL's published Ed25519 public key + its primary-source URL.
// Neither is asserted by any repo file — that IS the open AF-090 question. So the harness models the
// signing-input construction as a REPLACEABLE strategy that MODE R confirms empirically against a live
// captured payload + the real key; MODE M can only exercise the mechanics with a chosen construction.
//
// Header handling (OD-046 HMAC→Ed25519 correction):
//   - `X-GHL-Signature` is the current Ed25519 signature header.
//   - `X-WH-Signature` is the LEGACY (pre-cutoff) header. After GHL_LEGACY_HEADER_CUTOFF a request
//     carrying ONLY the legacy header (no X-GHL-Signature) is rejected outright (AC-0.WHK.002.2).
// The public key is read from the webhook_secrets sink, never inline.

import { verify as edVerify } from 'node:crypto';
import { Buffer } from 'node:buffer';
import type { Ingress } from '../rawBody.js';
import type { Sinks } from '../sinks.js';
import { GHL_LEGACY_HEADER_CUTOFF, type Mode } from '../config.js';
import { reject, accept, type VerifyOutcome } from '../reject.js';
import { checkEventReplay } from '../replayCache.js';
import { replayDrop } from '../reject.js';

// ── AF-090: the signing-input construction ─────────────────────────────────────────
// The candidate base-string constructions GHL might use. MODE R resolves WHICH is correct by testing
// each against the live captured payload + real key; MODE M picks `raw_body_only` to exercise the
// mechanics (and flags that this choice is UNCONFIRMED — the AF-090 debt).
export type GhlSigningInput = 'raw_body_only' | 'timestamp_dot_body';

export function ghlSigningInput(construction: GhlSigningInput, rawBody: Buffer, timestamp?: string): Buffer {
  switch (construction) {
    case 'raw_body_only':
      return rawBody;
    case 'timestamp_dot_body':
      // e.g. `${timestamp}.${rawBody}` — the other common vendor pattern. MODE R confirms which.
      return Buffer.concat([Buffer.from(`${timestamp ?? ''}.`, 'utf8'), rawBody]);
  }
}

// Verify an Ed25519 signature (base64 or hex) over `signingInput` against a PEM SPKI public key.
export function verifyEd25519(publicKeyPem: string, signingInput: Buffer, signature: string): boolean {
  let sigBytes: Buffer;
  // GHL docs / operator capture may present the signature base64 or hex — accept either.
  if (/^[0-9a-fA-F]+$/.test(signature) && signature.length % 2 === 0) {
    sigBytes = Buffer.from(signature, 'hex');
  } else {
    sigBytes = Buffer.from(signature, 'base64');
  }
  try {
    // Ed25519 verify: algorithm arg is null (the key encodes it); no timingSafeEqual needed —
    // signature verification is itself constant-time in the crypto backend.
    return edVerify(null, signingInput, publicKeyPem, sigBytes);
  } catch {
    return false;
  }
}

// Discover the correct AF-090 construction by testing candidates against a KNOWN-GOOD (real) payload
// + real key. Returns the construction that verifies, or null if none does (a genuine AF-090 finding
// to record — the harness must NOT self-sign this away). MODE R only.
export function discoverGhlSigningInput(
  publicKeyPem: string,
  rawBody: Buffer,
  signature: string,
  timestamp?: string,
): GhlSigningInput | null {
  const candidates: GhlSigningInput[] = ['raw_body_only', 'timestamp_dot_body'];
  for (const c of candidates) {
    if (verifyEd25519(publicKeyPem, ghlSigningInput(c, rawBody, timestamp), signature)) return c;
  }
  return null;
}

export interface GhlRequest {
  ingress: Ingress;
  sourceId: string | null;
  now: number; // logical epoch seconds
  mode: Mode;
  // The signing-input construction to use. In MODE R this is the CONFIRMED value (discoverGhlSigningInput);
  // in MODE M it is the unconfirmed chosen mechanics value.
  construction: GhlSigningInput;
}

export function verifyGhl(sinks: Sinks, req: GhlRequest): VerifyOutcome {
  const { ingress, sourceId, now, construction } = req;
  const ghlSig = ingress.header('x-ghl-signature');
  const legacySig = ingress.header('x-wh-signature');
  const timestamp = ingress.header('x-ghl-timestamp');

  // AC-0.WHK.002.2 — legacy `X-WH-Signature`-only after the cutoff → rejected outright.
  const nowIso = new Date(now * 1000).toISOString();
  if (!ghlSig && legacySig) {
    if (nowIso >= GHL_LEGACY_HEADER_CUTOFF) {
      return reject(
        sinks,
        'ghl',
        sourceId,
        `legacy X-WH-Signature-only request after ${GHL_LEGACY_HEADER_CUTOFF} cutoff (OD-046 HMAC→Ed25519) — rejected`,
      );
    }
    // (Before the cutoff a legacy request would be handled by the old HMAC path — out of scope here.)
    return reject(sinks, 'ghl', sourceId, 'legacy X-WH-Signature path not exercised by this spike');
  }

  // AC-0.WHK.001.1 — absent signature → 401, no processing.
  if (!ghlSig) {
    return reject(sinks, 'ghl', sourceId, 'missing X-GHL-Signature');
  }

  // Ed25519 verify against the published public key read from webhook_secrets (never inline).
  const publicKeyPem = sinks.readSecret('ghl', 'ed25519_public_key');
  const signingInput = ghlSigningInput(construction, ingress.raw(), timestamp);
  if (!verifyEd25519(publicKeyPem, signingInput, ghlSig)) {
    return reject(sinks, 'ghl', sourceId, 'Ed25519 signature verification failed');
  }

  // Verified → replay-dedup by event ID (GHL/Google seen-ID cache), AFTER a valid signature.
  const parsed = ingress.parsed() as { id?: string; eventId?: string; event_id?: string } | undefined;
  const eventId = parsed?.id ?? parsed?.eventId ?? parsed?.event_id ?? `ghl-${ghlSig.slice(0, 16)}`;
  const { replay } = checkEventReplay(sinks, 'ghl', eventId, sourceId, now);
  if (replay) {
    return replayDrop(sinks, 'ghl', eventId, 'ghl webhook replayed (event ID already seen)');
  }

  return accept(sinks, 'ghl', eventId, 'ghl webhook verified', parsed);
}
