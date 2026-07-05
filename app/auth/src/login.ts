// ISSUE-013 §8 step 3+4 — the login orchestrator: it joins the OAuth identity gate (oauth.ts), the
// session mechanism (session.ts) and the AuthStore port (store.ts) into the single sign-in path.
// FR-0.AUTH.001 (OAuth success establishes a session) → FR-0.SESS.001 (session issuance) is the seam
// this function realises. On rejection it writes the security event and grants NO session (#2/#3).

import type { OAuthProvider } from './config.js';
import { FakeOAuthProvider, evaluateIdentity, type HardeningPolicy } from './oauth.js';
import { SessionManager, type AccessJwt, type RefreshToken } from './session.js';
import type { AuthStore } from './store.js';

export type LoginResult =
  | { ok: true; user_id: string; session_id: string; access: AccessJwt; refresh: RefreshToken }
  | { ok: false; reason: string };

/** The login-surface control a client-tenant user leads with (UI-LOGIN). */
export type LeadControl = 'oauth' | 'password';

/**
 * FR-0.AUTH.001 — the leading login control for a client-tenant user, resolved from live config with NO
 * deploy: OAuth leads when `oauth_enabled` (the only client-tenant path), otherwise the password control.
 * The single source of this rule so the AC test asserts the SHIPPED logic, not a re-implementation (no
 * tautology). The password path itself is external-admin-only + ISSUE-014's — see `clientTenantPaths`.
 */
export function resolveLeadControl(cfg: { oauth_enabled: boolean }): LeadControl {
  return cfg.oauth_enabled ? 'oauth' : 'password';
}

/**
 * FR-0.AUTH.002 — the login paths OFFERED to a client-tenant user. When OAuth is enabled the ONLY path is
 * OAuth; the email+password path is reserved to external admins (ISSUE-014) and is never offered to a
 * client-tenant user here (#2 — no silent extra path). When OAuth is disabled no client-tenant path exists.
 */
export function clientTenantPaths(cfg: { oauth_enabled: boolean }): readonly LeadControl[] {
  return cfg.oauth_enabled ? (['oauth'] as const) : ([] as const);
}

/**
 * Drive one OAuth login. `aal` is the assurance the IdP asserted (OAuth users reach aal2-equivalent via
 * IdP MFA per OD-016 — modelled as an input here; the aal2 RLS enforcement is ISSUE-020's).
 */
export async function oauthLogin(args: {
  provider: OAuthProvider;
  policy: HardeningPolicy;
  idp: FakeOAuthProvider;
  sessions: SessionManager;
  store: AuthStore;
  aal: 'aal1' | 'aal2';
  now: number;
}): Promise<LoginResult> {
  const { provider, policy, idp, sessions, store, aal, now } = args;

  // 1. Completed provider handshake (the real IdP round-trip is the live-checkpoint proof).
  const identity = idp.signIn(provider);
  if (identity === null) {
    // FR-0.AUTH.002 edge: IdP returned no/invalid token → no session.
    await store.logEvent({ event_type: 'sign_in_failure', user_id: null, summary: 'oauth token missing/invalid', detail: { provider } }, now);
    return { ok: false, reason: 'no_oauth_token' };
  }

  // 2. Identity hardening (FR-0.AUTH.004) — the accept/reject security decision.
  const decision = evaluateIdentity(policy, identity);
  if (!decision.ok) {
    await store.logEvent(
      { event_type: 'identity_rejected', user_id: null, summary: `identity rejected: ${decision.reason}`, detail: { provider, reason: decision.reason, email: identity.email } },
      now,
    );
    return { ok: false, reason: decision.reason };
  }

  // 3. Mirror the identity into profiles (FR-0.AUTH.001 → auth.uid() seam) and establish the session.
  const userId = decision.identity.subject;
  await store.upsertProfile(userId, decision.identity.email, null, now);
  const { access, refresh, session_id } = sessions.establish(userId, aal, now); // FR-0.SESS.001
  await store.touchLastActive(userId, now);
  await store.logEvent({ event_type: 'sign_in_success', user_id: userId, summary: 'oauth sign-in', detail: { provider } }, now);
  await store.logEvent({ event_type: 'session_established', user_id: userId, summary: 'session established', detail: { session_id } }, now);
  return { ok: true, user_id: userId, session_id, access, refresh };
}
