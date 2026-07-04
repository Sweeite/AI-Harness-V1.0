// ISSUE-005 build order step 1 (declared config — the defense profile + the platform reality).
//
// Two kinds of thing live here, both CONTESTABLE BY DESIGN (mirrors ISSUE-002's config.ts):
//
//  1. THE APP-LAYER THRESHOLDS the spike measures the defense at (`account_lockout_threshold`,
//     `account_lockout_minutes`, `mfa_softlock_threshold`, `captcha_enabled`,
//     `leaked_password_protection`). The spec names these CFG-auth params (component-00-login
//     CFG table) but sets NO hard constant for the lockout pair — so these are sensible spike
//     defaults, and the CONFIRMED values the build should adopt are what the evidence records.
//
//  2. THE PLATFORM FACTS this spike proves the app-layer AGAINST (feasibility-register Block J /
//     [SA16]): Supabase has NO per-account lockout and NO separate password-grant limit. The
//     only native brake is IP-level rate limiting. A distributed multi-IP attack defeats those,
//     which is WHY the defense must lean on CAPTCHA + leaked-password + the per-account soft-lock.
//     These are declared as constants so the harness (and the reader) reason against the real
//     platform, not an imagined one.

import 'dotenv/config';

function envInt(name: string, dflt: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return dflt;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) throw new Error(`${name} must be an integer, got: ${v}`);
  return n;
}

function envBool(name: string, dflt: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return dflt;
  return v.toLowerCase() === 'true' || v === '1';
}

// ---------------------------------------------------------------------------
// (1) The app-layer defense thresholds under test (CFG-auth.*, component-00-login).
// ---------------------------------------------------------------------------
export const DEFENSE = {
  // Per-account soft-lock (the thing Supabase does NOT provide natively — AF-077). After this
  // many consecutive failed password attempts on ONE account, that account's password path is
  // temporarily locked and a Super-Admin alert fires (AC-0.AUTH.009.1).
  ACCOUNT_LOCKOUT_THRESHOLD: envInt('ACCOUNT_LOCKOUT_THRESHOLD', 5),
  // How long the temporary lock holds before the counter resets / the path unlocks.
  ACCOUNT_LOCKOUT_MINUTES: envInt('ACCOUNT_LOCKOUT_MINUTES', 15),
  // 2FA-challenge soft-lock: a 6th consecutive wrong code locks the challenge (AC-0.AUTH.007.3).
  // The spec FIXES this one at 5 (mfa_softlock_threshold=5) — kept as the default, overridable
  // only to demonstrate the boundary, never below.
  MFA_SOFTLOCK_THRESHOLD: envInt('MFA_SOFTLOCK_THRESHOLD', 5),

  // Form-level platform controls (dashboard-configured; asserted present, not owned by the app).
  CAPTCHA_ENABLED: envBool('CAPTCHA_ENABLED', false), // AC-0.AUTH.009.2 (CAPTCHA half)
  // Pro+ ONLY. On a non-Pro project this can only be asserted as config-intended (see PLAN).
  LEAKED_PASSWORD_PROTECTION: envBool('LEAKED_PASSWORD_PROTECTION', false), // AC-0.AUTH.009.2 (leaked half)

  // The single-account credential-stuffing battery length (password list loop).
  ATTACK_PASSWORD_ATTEMPTS: envInt('ATTACK_PASSWORD_ATTEMPTS', 200),
} as const;

// ---------------------------------------------------------------------------
// (2) The platform reality — Supabase Auth (feasibility-register Block J / [SA16]).
//     Declared so the harness reasons against the REAL platform. These are the facts the
//     app-layer soft-lock exists to compensate for.
// ---------------------------------------------------------------------------
export const PLATFORM = {
  // NO per-account lockout, and NO separate password-grant limit beyond the shared IP caps.
  // This is the whole reason AF-077 is a launch gate: without the app-layer soft-lock there is
  // NOTHING per-account stopping a credential-stuffing loop under the IP ceiling.
  NATIVE_PER_ACCOUNT_LOCKOUT: false,
  NATIVE_PASSWORD_GRANT_LIMIT: false,

  // The ONLY native brakes — IP-level, per hour, per IP (with burst where noted).
  IP_LIMIT_VERIFY_PER_HOUR: 360, // password login (/verify), burst 30
  IP_LIMIT_VERIFY_BURST: 30,
  IP_LIMIT_TOKEN_PER_HOUR: 1800, // /token + refresh
  IP_LIMIT_MFA_PER_HOUR: 15, // MFA challenge verify

  // A distributed multi-IP attack spreads across enough source IPs that no single IP crosses
  // these — which is exactly why IP limits ALONE are insufficient and the per-account soft-lock
  // + CAPTCHA + leaked-password are the real backstop.
  DISTRIBUTED_DEFEATS_IP_LIMITS: true,
} as const;

// The plan tier gates whether leaked-password protection can be ENFORCED (Pro+) vs only
// CONFIG-INTENDED (free). The evidence reports this honestly.
export function planTier(): string {
  return (process.env.SUPABASE_PLAN ?? 'free').toLowerCase();
}

export function isProPlan(): boolean {
  const t = planTier();
  return t !== 'free' && t !== '';
}
