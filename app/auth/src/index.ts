// @harness/auth — ISSUE-013 (C0 OAuth login + session lifecycle). Public surface: the AuthStore port +
// in-memory fake reference model, the live pg adapter, the OAuth identity-hardening gate + fake provider
// double, and the pure session state machine. The invite/seed path (ISSUE-015) consumes oauthLogin's
// session-establishment seam; the support-recovery intake (ISSUE-016) hangs off UI-LOGIN; the aal2 RLS
// enforcement + the revocation mid-task HALT (ISSUE-020) compose on top of this slice's benign-expiry
// continuation — those are the seams this package stops at.

export {
  type OAuthProvider,
  type AuthConfig,
  DEFAULT_AUTH_CONFIG,
  supabaseProviderSlug,
  validateAuthConfig,
} from './config.ts';

export {
  type IdpIdentity,
  type RejectReason,
  type IdentityDecision,
  type HardeningPolicy,
  evaluateIdentity,
  FakeOAuthProvider,
} from './oauth.ts';

export {
  type AccessJwt,
  type RefreshToken,
  type CookiePosture,
  type SessionRecord,
  type SessionState,
  type RevokeReason,
  type RefreshOutcome,
  type ReauthPrompt,
  SessionManager,
  REUSE_INTERVAL_SECONDS,
  verifyCookiePosture,
  buildReauthPrompt,
} from './session.ts';

export {
  type ProfileRow,
  type AuthEventRow,
  type AuthEventType,
  type NewAuthEvent,
  type AuthStore,
  InMemoryAuthStore,
  ERR_PROVIDER_TOGGLE_DENIED,
} from './store.ts';

export { type LoginResult, oauthLogin } from './login.ts';
export { SupabaseAuthStore } from './supabase-store.ts';
