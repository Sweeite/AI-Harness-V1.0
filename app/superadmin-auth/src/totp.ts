// ISSUE-014 §8 step 3 — TOTP enrollment (FR-0.AUTH.006) + the same-page 2FA challenge verify (FR-0.AUTH.007).
//
// The REAL factor lifecycle lives in Supabase-managed `auth.mfa_factors` and the real RFC-6238 code
// derivation is the platform's — the LIVE proof (enroll an authenticator app against a throwaway project,
// verify a real code) is a 🧑 you-present onboarding step, and AF-075 (Microsoft Authenticator named
// compatibility) is 🔴 unverified. What IS provable offline, and is proven here, is the enrollment CONTRACT
// (an otpauth:// secret is issued with QR + manual-entry fallback; a valid current code enrolls the factor →
// account becomes aal2-capable) and the challenge LOGIC (correct current code elevates to aal2; wrong/skipped
// code grants no session; the ±1 interval skew tolerance [SA7]). The code-matching is modelled deterministically
// so a test can drive "the current code" without a real clock or HMAC.

/** SA8/AF-075: we may NOT name Microsoft Authenticator as guaranteed until it is enrolled against a live project. */
export const RFC6238_COMPATIBLE_APPS_NAMEABLE = ['Google Authenticator', 'Authy', '1Password', 'Apple Keychain'] as const;
export const AF075_UNVERIFIED_APP = 'Microsoft Authenticator'; // compatibility rests on the open standard, not a vendor statement — do NOT name as guaranteed.

export const TOTP_PERIOD_SECONDS = 30; // [SA7] 30 s interval
export const TOTP_SKEW_INTERVALS = 1; // [SA7] ±1 interval skew tolerance

/** An issued-but-not-yet-confirmed enrollment offer (surface-00 UI-2FA-ENROLL). */
export interface EnrollmentOffer {
  user_id: string;
  secret: string; // the shared TOTP secret (base32 in reality; opaque here)
  otpauth_uri: string; // otpauth://totp/... — what the QR encodes (FR-0.AUTH.006)
  manual_entry_secret: string; // the same secret shown for manual entry when the QR can't be scanned (UI-2FA-ENROLL Partial)
}

/** A confirmed, enrolled TOTP factor (models an `auth.mfa_factors` row). aal2-capable once present. */
export interface TotpFactor {
  user_id: string;
  secret: string;
  verified: boolean; // a confirmed factor (a live code matched at enrollment)
}

/**
 * Model the code an RFC-6238 authenticator shows for `secret` at time `now`. Deterministic stand-in for the
 * HMAC-SHA1 derivation: the "code" is the interval counter for the secret. A real app/live project computes
 * the actual 6-digit code; the challenge LOGIC (current-interval match + ±1 skew) is what we prove offline.
 */
export function currentTotpCode(secret: string, now: number): string {
  const counter = Math.floor(now / TOTP_PERIOD_SECONDS);
  // A trivial deterministic derivation — NOT cryptographic; it stands in for "the code this secret shows now".
  return `${secret}:${counter}`;
}

/** FR-0.AUTH.006 — issue the enrollment offer: an otpauth:// secret rendered as QR + manual-entry fallback. */
export function issueEnrollment(user_id: string, secret: string, issuer = 'AI-Harness', label = 'super-admin'): EnrollmentOffer {
  const otpauth_uri = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&period=${TOTP_PERIOD_SECONDS}&digits=6`;
  return { user_id, secret, otpauth_uri, manual_entry_secret: secret };
}

/**
 * Does `code` match the TOTP for `secret` at `now`, within the ±1 interval skew tolerance ([SA7])? The skew
 * accepts a code from the previous or next 30 s window so a slightly-off client clock still verifies.
 */
export function verifyTotpCode(secret: string, code: string, now: number): boolean {
  for (let d = -TOTP_SKEW_INTERVALS; d <= TOTP_SKEW_INTERVALS; d++) {
    if (code === currentTotpCode(secret, now + d * TOTP_PERIOD_SECONDS)) return true;
  }
  return false;
}

/**
 * FR-0.AUTH.006 — confirm enrollment: the user enters a code from their app; a valid CURRENT code enrolls the
 * factor and the account becomes aal2-capable. A wrong code does NOT enroll (retry, unlimited at this step —
 * the gate is the later challenge's soft-lock, not enrollment; surface-00 UI-2FA-ENROLL Error).
 */
export function confirmEnrollment(offer: EnrollmentOffer, code: string, now: number): TotpFactor | null {
  if (!verifyTotpCode(offer.secret, code, now)) return null; // wrong code → not enrolled
  return { user_id: offer.user_id, secret: offer.secret, verified: true };
}

/** The AAL a session has reached. aal1 = password-only (or pre-challenge); aal2 = 2FA-elevated. */
export type Aal = 'aal1' | 'aal2';

export type ChallengeOutcome =
  | { ok: true; aal: 'aal2' } // correct current code → elevate to aal2 → session may be minted
  | { ok: false; reason: 'no_code' | 'wrong_code' | 'no_factor' }; // no session (FR-0.AUTH.007)

/**
 * FR-0.AUTH.007 — verify a submitted code on the same-page challenge. A correct current code elevates to
 * aal2. A wrong code, a skipped/omitted code (`null`), or a challenge against an un-enrolled account grants
 * NO session (no bypass — the load-bearing clause). The soft-lock counting is the caller's (softlock.ts) —
 * this function is the pure verify.
 */
export function challengeTotp(factor: TotpFactor | null, code: string | null, now: number): ChallengeOutcome {
  if (!factor || !factor.verified) return { ok: false, reason: 'no_factor' };
  if (code === null || code === '') return { ok: false, reason: 'no_code' }; // skipped/omitted → no session (no bypass)
  if (!verifyTotpCode(factor.secret, code, now)) return { ok: false, reason: 'wrong_code' };
  return { ok: true, aal: 'aal2' };
}
