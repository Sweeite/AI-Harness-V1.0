// ISSUE-012 — internal_token encryption-at-rest (AC-10.MGT.001.3).
//
// The management DB stores each deployment's internal_token ENCRYPTED, never in plaintext (schema.md §13
// "encrypted; never returned to a surface"). This module is the port's crypto primitive: a real key-managed
// AEAD in production (the live adapter binds a KMS/pgcrypto key), modelled here with node:crypto AES-256-GCM
// so the OFFLINE reference model genuinely encrypts (a stored ciphertext must not equal the plaintext, and
// a round-trip must recover it) rather than faking it. The fake proves the CONTRACT (at-rest ≠ plaintext,
// authenticated, round-trips); the live adapter proves the KEY MANAGEMENT against the mgmt Supabase.

import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';

/** A stored token record — ciphertext + the GCM nonce + auth tag. NEVER the plaintext. This is the exact
 *  shape the management DB persists in client_registry.internal_token (serialised). */
export interface EncryptedToken {
  ciphertext: string; // base64
  iv: string; // base64 (96-bit GCM nonce)
  tag: string; // base64 (128-bit GCM auth tag)
}

/** Mint a fresh, high-entropy internal_token (the value the deployment carries in its Railway env). 256 bits
 *  of randomness, url-safe. The minting AT PROVISIONING is invoked by ISSUE-007; the lifecycle lives here. */
export function mintToken(): string {
  return `it_${randomBytes(32).toString('base64url')}`;
}

/** A stable per-token id used to correlate the two stores (mgmt DB row ↔ Railway env) during rotation. */
export function newTokenId(): string {
  return randomUUID();
}

/** Encrypt a plaintext token under a 32-byte key (AES-256-GCM). Deterministic ONLY in that a fresh random
 *  nonce is drawn each call — so two encryptions of the same token differ (no ECB-style leak). */
export function encryptToken(plaintext: string, key: Buffer): EncryptedToken {
  if (key.length !== 32) throw new Error(`internal_token key must be 32 bytes (got ${key.length})`);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    ciphertext: enc.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

/** Decrypt — authenticated. A tampered ciphertext/tag throws (GCM auth failure) rather than returning
 *  garbage, so a corrupted at-rest token surfaces loudly (#3) instead of silently mis-authenticating (#2). */
export function decryptToken(enc: EncryptedToken, key: Buffer): string {
  if (key.length !== 32) throw new Error(`internal_token key must be 32 bytes (got ${key.length})`);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(enc.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(enc.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(enc.ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

/** A deterministic test/bootstrap key (the live adapter supplies the KMS-managed key instead). */
export function deriveKeyFromSecret(secret: string): Buffer {
  // Not a KDF — the live path uses a managed 32-byte key. For the reference model we pad/truncate a secret
  // deterministically so tests are reproducible. The CONTRACT under test is at-rest≠plaintext + round-trip.
  const b = Buffer.alloc(32);
  Buffer.from(secret, 'utf8').copy(b);
  return b;
}
