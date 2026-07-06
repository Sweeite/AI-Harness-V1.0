// ISSUE-014 §8 step 6 — the APP-LAYER aal2 gate (FR-0.AUTH.008 clause (a) ONLY). Post-login, an aal1 session
// (password passed but 2FA not yet satisfied) is forced to enroll/challenge before ANY protected surface;
// only an aal2 session reaches protected data. This is the app-layer half of deployment-wide 2FA enforcement
// (OD-016: deployment-wide, no per-user exemptions). The COMPLEMENTARY restrictive-RLS `aal='aal2'` coverage
// on every protected table (FR-0.AUTH.008 clause (b) / AC-0.AUTH.008.2 / NFR-SEC.010.1) is ISSUE-020's — this
// slice does NOT author RLS policies. AC-NFR-SEC.010.2 (a below-aal2 human-path query is denied) is expressed
// here as the app-gate half; the RLS predicate that also denies it is ISSUE-020's.
//
// two_factor_required is the harness INTENT flag (not a Supabase setting). When true, the gate binds.

import type { Aal } from './totp.js';

export type GateAction =
  | { allowed: true } // aal2 (or 2FA not required) — the protected surface is reached
  | { allowed: false; force: 'enroll' | 'challenge' }; // aal1 — forced to enroll (no factor) or challenge (factor present)

/**
 * Gate an authenticated session against a protected surface (FR-0.AUTH.008.1). When two_factor_required and
 * the session is below aal2, it is denied the data and forced to the 2FA step: enroll if no factor exists yet,
 * else challenge. Only aal2 passes. When two_factor_required is false the gate is a pass-through (but the
 * deployment default is true, and OD-016 forbids per-user exemptions when it is on).
 */
export function gateProtectedSurface(args: {
  two_factor_required: boolean;
  session_aal: Aal;
  totp_enrolled: boolean;
}): GateAction {
  const { two_factor_required, session_aal, totp_enrolled } = args;
  if (!two_factor_required) return { allowed: true };
  if (session_aal === 'aal2') return { allowed: true };
  // aal1 under a 2FA-required deployment → forced to the 2FA step before any protected data (#2/#3).
  return { allowed: false, force: totp_enrolled ? 'challenge' : 'enroll' };
}
