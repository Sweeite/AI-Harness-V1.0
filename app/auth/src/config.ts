// ISSUE-013 §8 step 2 — the five CFG-auth.* session/OAuth knobs this slice registers. These mirror the
// proposed shared-spec keys in results/proposed-shared-spec.md (NOT written to the shared config-registry —
// that edit is the orchestrator's per the fan-out contract). Defaults are the FR-cited values:
//   oauth_enabled            FR-0.AUTH.001 precondition (login surface leads with OAuth when true)
//   oauth_provider           FR-0.AUTH.001/003 — 'google' | 'microsoft'; microsoft binds the Supabase 'azure' slug
//   access_token_ttl         FR-0.SESS.002 — default 3600s; rec floor 300s; >3600 discouraged [SA2]
//   session_inactivity_timeout  FR-0.SESS.004 — idle bound, enforced LAZILY at next refresh (OD-012)
//   session_absolute_timeout    FR-0.SESS.004 — hard time-box from session start, also lazy at refresh
//
// All durations are SECONDS (epoch-second arithmetic everywhere in this package — deterministic, no
// Date.now()). The gate `oauth_enabled`/`oauth_provider` edit is PERM-auth.provider_toggle (FR-0.AUTH.003) —
// modelled here as a boolean caller capability so the offline test can prove the deny path without C1.

export type OAuthProvider = 'google' | 'microsoft';

/** The Supabase provider slug for a configured provider (FR-0.AUTH.001 branch: microsoft → azure). */
export function supabaseProviderSlug(p: OAuthProvider): 'google' | 'azure' {
  return p === 'microsoft' ? 'azure' : 'google';
}

export interface AuthConfig {
  oauth_enabled: boolean;
  oauth_provider: OAuthProvider;
  access_token_ttl: number; // seconds (FR-0.SESS.002 default 3600)
  session_inactivity_timeout: number; // seconds idle (FR-0.SESS.004)
  session_absolute_timeout: number; // seconds from session start (FR-0.SESS.004)
}

export const DEFAULT_AUTH_CONFIG: AuthConfig = {
  oauth_enabled: true,
  oauth_provider: 'google',
  access_token_ttl: 3600, // FR-0.SESS.002 default 3600s
  session_inactivity_timeout: 14 * 24 * 3600, // ~14d idle (OD-012 inactivity model)
  session_absolute_timeout: 30 * 24 * 3600, // 30d absolute time-box
};

const ACCESS_TTL_FLOOR = 300; // [SA2] recommended floor 5 min — a lower value is a #2/#3 config error.

/** Validate a config edit. Returns [] if sound; the messages are the deny reasons. */
export function validateAuthConfig(c: AuthConfig): string[] {
  const errs: string[] = [];
  if (c.oauth_provider !== 'google' && c.oauth_provider !== 'microsoft') {
    errs.push(`oauth_provider must be google|microsoft (got '${c.oauth_provider}')`);
  }
  if (!Number.isFinite(c.access_token_ttl) || c.access_token_ttl < ACCESS_TTL_FLOOR) {
    errs.push(`access_token_ttl must be >= ${ACCESS_TTL_FLOOR}s (got ${c.access_token_ttl})`);
  }
  if (c.session_inactivity_timeout <= 0) errs.push('session_inactivity_timeout must be > 0');
  if (c.session_absolute_timeout <= 0) errs.push('session_absolute_timeout must be > 0');
  // Absolute time-box below inactivity is incoherent (the box would never bind) — a silent misconfig (#3).
  if (c.session_absolute_timeout < c.session_inactivity_timeout) {
    errs.push('session_absolute_timeout must be >= session_inactivity_timeout (else the box never binds)');
  }
  return errs;
}
