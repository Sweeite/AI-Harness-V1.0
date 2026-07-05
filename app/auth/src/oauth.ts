// ISSUE-013 §8 step 3 — the OAuth login-identity path + its offline test doubles.
//
// The REAL provider handshake (Google/Microsoft IdP round-trip) is a 💻 live proof deferred to the
// Stage-3 checkpoint — it cannot run offline. What IS provable offline, and is proven here, is everything
// downstream of "the IdP returned an identity claim set": provider→slug branching (FR-0.AUTH.001), the
// identity-hardening rules that decide accept-vs-reject (FR-0.AUTH.004), and the fact that OAuth is the
// ONLY client-tenant path (FR-0.AUTH.002). We model the IdP's output as a plain claims object (an
// `IdpIdentity`) — the same shape Supabase Auth surfaces post-exchange — and a `FakeOAuthProvider` double
// that returns one. No network, no crypto handshake; the hardening logic is the unit under test.
//
// Identity hardening (FR-0.AUTH.004, the C0 expression of non-negotiable #2 "never let the wrong person in"):
//   - Azure (microsoft): the identity's `tenant_id` (the `tid` claim) MUST equal the configured single
//     tenant; the `email` scope must be present; `xms_edov=true` proves the email domain is verified.
//     Without the tenant pin, "Sign in with Microsoft" would admit ANY Microsoft account — a real hole.
//   - Google: `email_verified` MUST be true.
//   - Either provider: a missing/empty email is rejected (no verified identity → no session).

import type { OAuthProvider } from './config.js';
import { supabaseProviderSlug } from './config.js';

/** The identity claim set Supabase Auth surfaces after the provider token exchange (modelled shape). */
export interface IdpIdentity {
  provider: 'google' | 'azure'; // Supabase slug (microsoft → azure)
  subject: string; // stable IdP subject id (→ auth.users.id seam)
  email: string;
  email_verified: boolean; // Google: id_token email_verified
  tenant_id?: string; // Azure: the `tid` claim (which AAD tenant the identity is from)
  xms_edov?: boolean; // Azure: email-domain-owner-verified claim (FR-0.AUTH.004)
  scopes: string[]; // granted OAuth scopes (must include 'email')
}

export type RejectReason =
  | 'oauth_disabled'
  | 'provider_mismatch'
  | 'no_email'
  | 'email_unverified'
  | 'missing_email_scope'
  | 'wrong_tenant'
  | 'edov_unverified';

export type IdentityDecision =
  | { ok: true; identity: IdpIdentity }
  | { ok: false; reason: RejectReason };

export interface HardeningPolicy {
  oauth_enabled: boolean;
  provider: OAuthProvider;
  /** The single Azure tenant this deployment is pinned to (required when provider=microsoft). */
  azure_tenant_id?: string;
}

/**
 * The pure accept/reject gate applied to an IdP identity (FR-0.AUTH.001/002/004). This is the security
 * decision — everything above it is transport. Fail-closed: any unmet hardening condition rejects.
 */
export function evaluateIdentity(policy: HardeningPolicy, id: IdpIdentity): IdentityDecision {
  // FR-0.AUTH.002: OAuth is the only client-tenant path; disabled → no session at all.
  if (!policy.oauth_enabled) return { ok: false, reason: 'oauth_disabled' };

  const expectedSlug = supabaseProviderSlug(policy.provider);
  if (id.provider !== expectedSlug) return { ok: false, reason: 'provider_mismatch' };

  // The `email` scope must have been granted or we cannot assert an identity email at all.
  if (!id.scopes.includes('email')) return { ok: false, reason: 'missing_email_scope' };
  if (!id.email || id.email.trim() === '') return { ok: false, reason: 'no_email' };

  if (expectedSlug === 'azure') {
    // Tenant pinning — the load-bearing #2 control. A pin must be configured AND must match.
    if (!policy.azure_tenant_id) return { ok: false, reason: 'wrong_tenant' };
    if (id.tenant_id !== policy.azure_tenant_id) return { ok: false, reason: 'wrong_tenant' };
    // xms_edov proves the email domain is verified/owned by the tenant (FR-0.AUTH.004).
    if (id.xms_edov !== true) return { ok: false, reason: 'edov_unverified' };
  } else {
    // Google: require a verified email.
    if (id.email_verified !== true) return { ok: false, reason: 'email_unverified' };
  }
  return { ok: true, identity: id };
}

/**
 * A fake Supabase-OAuth provider double. `signIn` stands in for the completed provider handshake: it
 * returns whatever identity the test seeded for that provider, or null (IdP returned no/invalid token —
 * FR-0.AUTH.002 edge). It performs NO hardening — evaluateIdentity does. This lets a test drive both the
 * happy path and every rejection branch without a live IdP.
 */
export class FakeOAuthProvider {
  private next: IdpIdentity | null = null;
  private lastSlug: 'google' | 'azure' | null = null;

  /** Seed the identity the next handshake will yield (or null to simulate a failed/empty token). */
  seedIdentity(id: IdpIdentity | null): void {
    this.next = id;
  }

  /** The Supabase slug the last signIn was routed to — proves provider→slug branching (FR-0.AUTH.001). */
  routedSlug(): 'google' | 'azure' | null {
    return this.lastSlug;
  }

  /** Model the completed provider exchange for a configured provider. */
  signIn(provider: OAuthProvider): IdpIdentity | null {
    this.lastSlug = supabaseProviderSlug(provider);
    return this.next;
  }
}
