// ISSUE-017 §8 step 3 — Google Pub/Sub push verifier (JWT, FR-0.WHK.003). Ported from the AF-078
// spike. A Pub/Sub push arrives with `Authorization: Bearer <JWT>` (RS256, signed by Google). We:
//   1. parse header/payload/signature from the compact JWT,
//   2. verify the RS256 signature against Google's certs (JWKS), matched by `kid`,
//   3. check `aud` === google_expected_audience (AC-0.WHK.003.1 — wrong audience → 401),
//   4. check `exp` (not expired) + `nbf` sanity,
// then replay-dedup by the Pub/Sub message ID (the entrypoint owns the cache write).
// The JWKS is fetched from GOOGLE_CERTS_URL at runtime (the entrypoint injects it; the fake injects a
// local JWKS). Dual-accept applies to the expected-audience (any active audience version matches).

import { createVerify, createPublicKey, type JsonWebKey } from 'node:crypto';
import { Buffer } from 'node:buffer';
import type { Ingress } from '../rawBody.js';
import type { ActiveSecret } from '../store.js';

export interface Jwk extends JsonWebKey {
  kid?: string;
  alg?: string;
  use?: string;
}
export interface Jwks {
  keys: Jwk[];
}

interface JwtHeader {
  alg: string;
  kid?: string;
  typ?: string;
}
interface JwtClaims {
  aud?: string;
  exp?: number;
  iat?: number;
  nbf?: number;
  iss?: string;
  [k: string]: unknown;
}

function b64urlToBuffer(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export interface ParsedJwt {
  header: JwtHeader;
  claims: JwtClaims;
  signingInput: Buffer; // `${headerB64}.${payloadB64}` — what RS256 signs
  signature: Buffer;
}

export function parseJwt(token: string): ParsedJwt | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts as [string, string, string];
  try {
    const header = JSON.parse(b64urlToBuffer(h).toString('utf8')) as JwtHeader;
    const claims = JSON.parse(b64urlToBuffer(p).toString('utf8')) as JwtClaims;
    return { header, claims, signingInput: Buffer.from(`${h}.${p}`, 'utf8'), signature: b64urlToBuffer(s) };
  } catch {
    return null;
  }
}

export function verifyJwtSignature(parsed: ParsedJwt, jwks: Jwks): boolean {
  if (parsed.header.alg !== 'RS256') return false; // Google Pub/Sub push tokens are RS256
  const jwk = parsed.header.kid ? jwks.keys.find((k) => k.kid === parsed.header.kid) : jwks.keys[0];
  if (!jwk) return false;
  try {
    const pub = createPublicKey({ key: jwk, format: 'jwk' });
    return createVerify('RSA-SHA256').update(parsed.signingInput).verify(pub, parsed.signature);
  } catch {
    return false;
  }
}

export interface GoogleVerifyResult {
  ok: boolean;
  reason?: string;
  eventId?: string;
}

export function verifyGoogle(
  ingress: Ingress,
  jwks: Jwks,
  expectedAudiences: ActiveSecret[],
  now: number,
): GoogleVerifyResult {
  const auth = ingress.header('authorization');

  // AC-0.WHK.001.1 — absent bearer → 401, no processing.
  if (!auth || !/^Bearer\s+/i.test(auth)) return { ok: false, reason: 'missing/invalid Authorization bearer' };
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  const parsed = parseJwt(token);
  if (!parsed) return { ok: false, reason: 'malformed JWT' };

  // (2) Signature against Google certs.
  if (!verifyJwtSignature(parsed, jwks)) return { ok: false, reason: 'JWT signature verification failed (RS256 / JWKS)' };

  // (3) Audience — wrong aud → 401 (AC-0.WHK.003.1). Dual-accept across active audience versions.
  if (expectedAudiences.length === 0) return { ok: false, reason: 'no google_expected_audience configured in webhook_secrets' };
  const audOk = expectedAudiences.some((a) => a.value === parsed.claims.aud);
  if (!audOk) return { ok: false, reason: `JWT audience mismatch (aud=${parsed.claims.aud ?? '∅'} ≠ expected)` };

  // (4) Expiry / not-before.
  if (typeof parsed.claims.exp === 'number' && now >= parsed.claims.exp) return { ok: false, reason: 'JWT expired (exp passed)' };
  if (typeof parsed.claims.nbf === 'number' && now < parsed.claims.nbf) return { ok: false, reason: 'JWT not yet valid (nbf in future)' };

  const body = ingress.parsed() as { message?: { messageId?: string; message_id?: string } } | undefined;
  const eventId =
    body?.message?.messageId ?? body?.message?.message_id ?? `google-${parsed.signature.toString('hex').slice(0, 16)}`;
  return { ok: true, eventId };
}
