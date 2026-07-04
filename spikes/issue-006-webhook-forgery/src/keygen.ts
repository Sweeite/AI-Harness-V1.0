// ISSUE-006 — MODE M key/secret material. Self-contained mechanics: the harness generates its own
// Slack signing secret, a throwaway Ed25519 keypair to SIMULATE GHL's signer, and an RSA keypair +
// local JWKS to mint/verify Google JWTs. NONE of this is operator infra — MODE M with these keys
// proves the verifier LOGIC but CANNOT resolve AF-090 (the real GHL signing base string). That debt
// is flagged loudly by main.ts and the report.

import {
  generateKeyPairSync,
  randomBytes,
  createSign,
  sign as edSign,
  createPublicKey,
  type KeyObject,
} from 'node:crypto';
import { Buffer } from 'node:buffer';
import type { Jwk, Jwks } from './verifiers/google.js';

// ── Slack: a signing secret (fully self-signable — no gap) ─────────────────────────
export function generateSlackSigningSecret(): string {
  return randomBytes(32).toString('hex');
}

// ── GHL: a throwaway Ed25519 keypair to SIMULATE GHL's signer (MODE M only) ─────────
export interface Ed25519Pair {
  publicKeyPem: string;
  privateKey: KeyObject;
}
export function generateEd25519Pair(): Ed25519Pair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKey,
  };
}
export function signEd25519(privateKey: KeyObject, signingInput: Buffer): string {
  // Ed25519: single-shot sign, algorithm null (encoded in key). Return base64.
  return edSign(null, signingInput, privateKey).toString('base64');
}

// ── Google: RSA keypair + local JWKS to mint/verify RS256 JWTs (MODE M only) ────────
export interface RsaJwksPair {
  privateKey: KeyObject;
  jwks: Jwks;
  kid: string;
}
export function generateRsaJwks(): RsaJwksPair {
  const kid = 'spike-local-key-1';
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' }) as Jwk;
  jwk.kid = kid;
  jwk.alg = 'RS256';
  jwk.use = 'sig';
  return { privateKey, jwks: { keys: [jwk] }, kid };
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Mint an RS256 JWT for the local JWKS (MODE M valid-case Google token).
export function mintRs256Jwt(
  privateKey: KeyObject,
  kid: string,
  claims: Record<string, unknown>,
): string {
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }), 'utf8'));
  const payload = b64url(Buffer.from(JSON.stringify(claims), 'utf8'));
  const signingInput = Buffer.from(`${header}.${payload}`, 'utf8');
  const sig = createSign('RSA-SHA256').update(signingInput).sign(privateKey);
  return `${header}.${payload}.${b64url(sig)}`;
}

// Re-export for callers that need to build a public key object from a JWK.
export { createPublicKey };
