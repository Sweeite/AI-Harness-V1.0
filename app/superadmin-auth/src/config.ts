// ISSUE-014 §8 step 1 — the seven `auth.*` knobs the Super-Admin password/2FA/brute-force slice reads.
// These MIRROR keys that already exist in `spec/02-config/config-registry.md` § auth (L72, L78–83) — this
// slice registers NO new key. The parity check lives in results/proposed-shared-spec.md. Defaults are the
// registry defaults, which the AF-077 spike (ISSUE-005, 🟢 2026-07-04) CONFIRMED as the build values:
//   account_lockout_threshold=5 · account_lockout_minutes=15 · mfa_softlock_threshold=5 · mfa_softlock_minutes=15
//   captcha_enabled=true · leaked_password_protection=true · two_factor_required=true.
//
// All keys are read-only in this slice (surface-01 #auth owns editing — FR-0.AUTH.009 config deps). We
// validate a config for coherence so a misconfig fails LOUD, never silently disabling a defense (#2/#3).

export interface SuperAdminAuthConfig {
  /** FR-0.AUTH.009 — consecutive failed password attempts before the per-account soft-lock. Registry default 5. */
  account_lockout_threshold: number;
  /** FR-0.AUTH.009 — minutes the account password path stays locked. Registry default 15. */
  account_lockout_minutes: number;
  /** FR-0.AUTH.007 — consecutive wrong TOTP codes before the 2FA step soft-locks. Registry default 5. */
  mfa_softlock_threshold: number;
  /** FR-0.AUTH.007 — minutes the 2FA challenge stays locked. Registry default 15. */
  mfa_softlock_minutes: number;
  /** FR-0.AUTH.009 — hCaptcha/Turnstile on the password form when true. Registry default true. */
  captcha_enabled: boolean;
  /** FR-0.AUTH.009 — Supabase leaked-password protection (Pro+) enforced when true. Registry default true. */
  leaked_password_protection: boolean;
  /** FR-0.AUTH.008 — the harness-implemented INTENT flag driving the app-layer aal2 gate (NOT a Supabase setting). */
  two_factor_required: boolean;
}

/** Registry defaults (config-registry.md § auth) = AF-077 spike-confirmed build values (ISSUE-005). */
export const DEFAULT_SUPERADMIN_AUTH_CONFIG: SuperAdminAuthConfig = {
  account_lockout_threshold: 5,
  account_lockout_minutes: 15,
  mfa_softlock_threshold: 5,
  mfa_softlock_minutes: 15,
  captcha_enabled: true,
  leaked_password_protection: true,
  two_factor_required: true,
};

/**
 * Validate a config edit for coherence. Returns [] if sound; each message is a deny reason. A threshold of 0
 * would mean "lock after zero failures" (lock everyone out — #2) or "never lock" (no defense — a #2 hole);
 * both are incoherent. Minutes <= 0 would mean a lock that never holds (a silent no-op defense — #3).
 */
export function validateSuperAdminAuthConfig(c: SuperAdminAuthConfig): string[] {
  const errs: string[] = [];
  if (!Number.isInteger(c.account_lockout_threshold) || c.account_lockout_threshold < 1) {
    errs.push(`account_lockout_threshold must be an integer >= 1 (got ${c.account_lockout_threshold})`);
  }
  if (!Number.isInteger(c.account_lockout_minutes) || c.account_lockout_minutes < 1) {
    errs.push(`account_lockout_minutes must be an integer >= 1 (got ${c.account_lockout_minutes})`);
  }
  if (!Number.isInteger(c.mfa_softlock_threshold) || c.mfa_softlock_threshold < 1) {
    errs.push(`mfa_softlock_threshold must be an integer >= 1 (got ${c.mfa_softlock_threshold})`);
  }
  if (!Number.isInteger(c.mfa_softlock_minutes) || c.mfa_softlock_minutes < 1) {
    errs.push(`mfa_softlock_minutes must be an integer >= 1 (got ${c.mfa_softlock_minutes})`);
  }
  return errs;
}
