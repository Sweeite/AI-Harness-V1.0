// @harness/superadmin-auth — ISSUE-014 (C0 Super-Admin password + TOTP 2FA + brute-force defense, app-layer).
// Public surface: the config (seven auth.* knobs read here), the SuperAdminAuthStore port + in-memory fake
// reference model + live pg adapter, the pure soft-lock state machine (per-account brute-force + 2FA),
// the password grant (CAPTCHA fail-closed + leaked-password), TOTP enrollment/challenge, the app-layer aal2
// gate, and the login orchestrator (passwordStep → challengeStep) that writes the event_log security sink +
// Super-Admin alerts. Session establishment is ISSUE-013's (app/auth) — this slice stops at aal2-granted.

export {
  type SuperAdminAuthConfig,
  DEFAULT_SUPERADMIN_AUTH_CONFIG,
  validateSuperAdminAuthConfig,
} from './config.ts';

export {
  type SecurityEventType,
  type SecurityEventRow,
  type NewSecurityEvent,
  type SuperAdminAlert,
  type SoftLockState,
  type SuperAdminAuthStore,
  InMemorySuperAdminAuthStore,
} from './store.ts';

export {
  type SoftLockConfig,
  type GateDecision,
  type FailureResult,
  isLocked,
  gate,
  recordFailure,
  recordSuccess,
} from './softlock.ts';

export {
  type SuperAdminAccount,
  type CaptchaState,
  type PasswordGrantOutcome,
  type PasswordDenyReason,
  type PasswordPolicy,
  checkCaptcha,
  attemptPasswordGrant,
} from './password.ts';

export {
  type EnrollmentOffer,
  type TotpFactor,
  type Aal,
  type ChallengeOutcome,
  RFC6238_COMPATIBLE_APPS_NAMEABLE,
  AF075_UNVERIFIED_APP,
  TOTP_PERIOD_SECONDS,
  TOTP_SKEW_INTERVALS,
  currentTotpCode,
  issueEnrollment,
  verifyTotpCode,
  confirmEnrollment,
  challengeTotp,
} from './totp.ts';

export { type GateAction, gateProtectedSurface } from './gate.ts';

export {
  type PasswordStepResult,
  type ChallengeStepResult,
  passwordStep,
  challengeStep,
} from './login.ts';

export { SupabaseSuperAdminAuthStore } from './supabase-store.ts';
