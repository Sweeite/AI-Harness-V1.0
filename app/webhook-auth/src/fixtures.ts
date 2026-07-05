// ISSUE-017 — deterministic test fixtures. Generates the vendor key material a real deployment would
// hold in webhook_secrets: a Slack signing secret, an Ed25519 keypair standing in for GHL's published
// signer, and an RSA keypair + JWKS standing in for Google's certs. These exercise the verifier LOGIC
// end to end (valid/tampered/replayed); the LIVE per-connector confirmation against real vendor keys
// is owed at onboarding (OD-172). Adapted from the AF-078 spike's keygen.ts.

import { generateKeyPairSync, randomBytes, createSign, createHmac, sign as edSign, type KeyObject } from 'node:crypto';
import { Buffer } from 'node:buffer';
import type { Jwk, Jwks } from './verifiers/google.js';

export function generateSlackSigningSecret(): string {
  return randomBytes(32).toString('hex');
}

export interface Ed25519Pair {
  publicKeyPem: string;
  privateKey: KeyObject;
}
export function generateEd25519Pair(): Ed25519Pair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(), privateKey };
}
export function signEd25519(privateKey: KeyObject, signingInput: Buffer): string {
  return edSign(null, signingInput, privateKey).toString('base64');
}

export interface RsaJwksPair {
  privateKey: KeyObject;
  jwks: Jwks;
  kid: string;
}
export function generateRsaJwks(kid = 'test-key-1'): RsaJwksPair {
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
export function mintRs256Jwt(privateKey: KeyObject, kid: string, claims: Record<string, unknown>): string {
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }), 'utf8'));
  const payload = b64url(Buffer.from(JSON.stringify(claims), 'utf8'));
  const signingInput = Buffer.from(`${header}.${payload}`, 'utf8');
  const sig = createSign('RSA-SHA256').update(signingInput).sign(privateKey);
  return `${header}.${payload}.${b64url(sig)}`;
}

// Build the Slack signature headers for a raw body + timestamp (mirrors what Slack sends).
export function signSlackHeaders(secret: string, timestamp: string, rawBody: Buffer): Record<string, string> {
  const mac = createHmac('sha256', secret)
    .update(Buffer.concat([Buffer.from(`v0:${timestamp}:`, 'utf8'), rawBody]))
    .digest('hex');
  return { 'x-slack-request-timestamp': timestamp, 'x-slack-signature': `v0=${mac}` };
}
