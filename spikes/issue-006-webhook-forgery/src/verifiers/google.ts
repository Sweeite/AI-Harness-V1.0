// ISSUE-006 §8 step 4 — Google Pub/Sub push verifier (JWT).
//
// A Pub/Sub push arrives with `Authorization: Bearer <JWT>`. The JWT is RS256, signed by Google. We:
//   1. parse header/payload/signature from the compact JWT,
//   2. verify the RS256 signature against Google's certs (JWKS) — the cert matched by `kid`,
//   3. check `aud` === google_expected_audience (AC-0.WHK.003.1 — wrong audience → 401),
//   4. check `exp` (not expired) and `iat`/`nbf` sanity,
// then replay-dedup by the message ID (seen-event-ID cache, like GHL).
//
// MODE R fetches real certs from GOOGLE_CERTS_URL; MODE M verifies against a local JWKS the harness
// generated (and minted the JWT against). The expected audience is read from the webhook_secrets sink.

import { createVerify, createPublicKey, type JsonWebKey } from 'node:crypto';
import { Buffer } from 'node:buffer';
import type { Ingress } from '../rawBody.js';
import type { Sinks } from '../sinks.js';
import { reject, accept, replayDrop, type VerifyOutcome } from '../reject.js';
import { checkEventReplay } from '../replayCache.js';

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
  const [h, p, s] = parts;
  try {
    const header = JSON.parse(b64urlToBuffer(h).toString('utf8')) as JwtHeader;
    const claims = JSON.parse(b64urlToBuffer(p).toString('utf8')) as JwtClaims;
    return {
      header,
      claims,
      signingInput: Buffer.from(`${h}.${p}`, 'utf8'),
      signature: b64urlToBuffer(s),
    };
  } catch {
    return null;
  }
}

export function verifyJwtSignature(parsed: ParsedJwt, jwks: Jwks): boolean {
  if (parsed.header.alg !== 'RS256') return false; // Google Pub/Sub push tokens are RS256
  const jwk = parsed.header.kid
    ? jwks.keys.find((k) => k.kid === parsed.header.kid)
    : jwks.keys[0];
  if (!jwk) return false;
  try {
    const pub = createPublicKey({ key: jwk, format: 'jwk' });
    return createVerify('RSA-SHA256').update(parsed.signingInput).verify(pub, parsed.signature);
  } catch {
    return false;
  }
}

export interface GoogleRequest {
  ingress: Ingress;
  sourceId: string | null;
  now: number; // logical epoch seconds
  jwks: Jwks; // real Google certs (MODE R) or local JWKS (MODE M)
}

export function verifyGoogle(sinks: Sinks, req: GoogleRequest): VerifyOutcome {
  const { ingress, sourceId, now, jwks } = req;
  const auth = ingress.header('authorization');

  // AC-0.WHK.001.1 — absent bearer → 401, no processing.
  if (!auth || !/^Bearer\s+/i.test(auth)) {
    return reject(sinks, 'google', sourceId, 'missing/invalid Authorization bearer');
  }
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  const parsed = parseJwt(token);
  if (!parsed) {
    return reject(sinks, 'google', sourceId, 'malformed JWT');
  }

  // (2) Signature against Google certs.
  if (!verifyJwtSignature(parsed, jwks)) {
    return reject(sinks, 'google', sourceId, 'JWT signature verification failed (RS256 / JWKS)');
  }

  // (3) Audience — wrong aud → 401 (AC-0.WHK.003.1). Read expected aud from webhook_secrets.
  const expectedAud = sinks.readSecret('google', 'expected_audience');
  if (parsed.claims.aud !== expectedAud) {
    return reject(
      sinks,
      'google',
      sourceId,
      `JWT audience mismatch (aud=${parsed.claims.aud ?? '∅'} ≠ expected)`,
    );
  }

  // (4) Expiry / not-before.
  if (typeof parsed.claims.exp === 'number' && now >= parsed.claims.exp) {
    return reject(sinks, 'google', sourceId, 'JWT expired (exp passed)');
  }
  if (typeof parsed.claims.nbf === 'number' && now < parsed.claims.nbf) {
    return reject(sinks, 'google', sourceId, 'JWT not yet valid (nbf in future)');
  }

  // Verified → replay-dedup by Pub/Sub message ID.
  const body = ingress.parsed() as { message?: { messageId?: string; message_id?: string } } | undefined;
  const eventId =
    body?.message?.messageId ?? body?.message?.message_id ?? `google-${parsed.signature.toString('hex').slice(0, 16)}`;
  const { replay } = checkEventReplay(sinks, 'google', eventId, sourceId, now);
  if (replay) {
    return replayDrop(sinks, 'google', eventId, 'google push replayed (message ID already seen)');
  }

  return accept(sinks, 'google', eventId, 'google push verified', body);
}
