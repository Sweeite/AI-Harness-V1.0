// ISSUE-005 §8 — the REAL Supabase auth calls (the attack surface under test). This is the only
// module that talks to the operator's live throwaway project; everything else reasons over its
// results. Nothing here is hard-coded — every value comes from the validated env (see requireEnv).
//
// Two paths, both real:
//   - signInWithPassword — the password-grant login the credential-stuffing battery hammers.
//   - the AAL2 TOTP challenge/verify path — the 2FA-challenge the mfa_softlock battery hammers
//     with real WRONG codes (and one RIGHT code, to prove even a valid code is refused once the
//     challenge is soft-locked).
//
// A distributed multi-IP battery needs a *different source IP per request*, which the Supabase
// JS client cannot itself rotate. We model the source IP via a per-request client bound to an
// optional proxy endpoint (real-proxy mode) OR a logical label (simulated mode) — see attack.ts.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as OTPAuth from 'otpauth';

export interface Env {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
  account: string;
  password: string;
  totpSecret: string;
  plan: string;
  captchaEnabled: boolean;
  captchaProvider?: string;
  captchaTestSitekey?: string;
  captchaTestSecret?: string;
  proxyEndpoints: string[];
}

/**
 * Validate + collect every operator-provided value. Returns { ok:false, missing } listing the
 * REQUIRED vars that are absent — main.ts refuses to run and prints them (never a silent pass).
 */
export function requireEnv():
  | { ok: true; env: Env }
  | { ok: false; missing: string[] } {
  const need = (name: string) => {
    const v = process.env[name];
    return v === undefined || v.trim() === '' ? name : null;
  };
  const missing = [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'TEST_ACCOUNT_EMAIL',
    'TEST_ACCOUNT_PASSWORD',
    'TEST_ACCOUNT_TOTP_SECRET',
  ]
    .map(need)
    .filter((x): x is string => x !== null);

  if (missing.length > 0) return { ok: false, missing };

  const proxies = (process.env.PROXY_ENDPOINTS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return {
    ok: true,
    env: {
      url: process.env.SUPABASE_URL!,
      anonKey: process.env.SUPABASE_ANON_KEY!,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
      account: process.env.TEST_ACCOUNT_EMAIL!,
      password: process.env.TEST_ACCOUNT_PASSWORD!,
      totpSecret: process.env.TEST_ACCOUNT_TOTP_SECRET!,
      plan: (process.env.SUPABASE_PLAN ?? 'free').toLowerCase(),
      captchaEnabled: (process.env.CAPTCHA_ENABLED ?? 'false').toLowerCase() === 'true',
      captchaProvider: process.env.CAPTCHA_PROVIDER,
      captchaTestSitekey: process.env.CAPTCHA_TEST_SITEKEY,
      captchaTestSecret: process.env.CAPTCHA_TEST_SECRET,
      proxyEndpoints: proxies,
    },
  };
}

// A logical outcome of a single real password-login attempt against the live project.
export interface PasswordAttemptResult {
  // A session token was minted — i.e. the ATTACKER WON. The whole spike exists to prove this
  // never happens for a wrong password, and never happens for the right password once locked.
  sessionMinted: boolean;
  // Supabase said the credentials were bad (the normal failed-login case).
  invalidCredentials: boolean;
  // Supabase's own IP rate limiter tripped (429 / "rate limit") — a platform brake, distinct
  // from the app-layer soft-lock the spike is measuring.
  platformRateLimited: boolean;
  // CAPTCHA was demanded by the platform ("captcha protection" / captcha_token required) —
  // proves AC-0.AUTH.009.2's CAPTCHA half is live on the form.
  captchaRequired: boolean;
  // Leaked-password protection refused the credential (Pro+; "password is known to be leaked").
  leakedPasswordRefused: boolean;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * The real password-grant call. `captchaToken` carries the provider TEST token when CAPTCHA is
 * on. `client` is the per-request client (bound to a proxy / source-IP label by the caller).
 */
export async function attemptPasswordLogin(
  client: SupabaseClient,
  email: string,
  password: string,
  captchaToken?: string,
): Promise<PasswordAttemptResult> {
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
    options: captchaToken ? { captchaToken } : undefined,
  });

  if (error) {
    const msg = error.message ?? '';
    const lower = msg.toLowerCase();
    return {
      sessionMinted: false,
      invalidCredentials: lower.includes('invalid') || error.status === 400,
      platformRateLimited: error.status === 429 || lower.includes('rate limit'),
      captchaRequired: lower.includes('captcha'),
      leakedPasswordRefused: lower.includes('leaked') || lower.includes('pwned') || lower.includes('compromised'),
      errorCode: error.status != null ? String(error.status) : error.code,
      errorMessage: msg,
    };
  }

  // No error → did a session actually come back? That is the breach ground-truth.
  const sessionMinted = Boolean(data?.session?.access_token);
  return {
    sessionMinted,
    invalidCredentials: false,
    platformRateLimited: false,
    captchaRequired: false,
    leakedPasswordRefused: false,
  };
}

// Generate a WRONG 6-digit TOTP code (deterministically wrong: offset the current one). Used to
// drive the mfa_softlock battery with real, well-formed but incorrect codes.
export function wrongTotpCode(secret: string): string {
  const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) });
  const right = totp.generate();
  const n = (Number.parseInt(right, 10) + 1) % 1_000_000;
  return String(n).padStart(6, '0');
}

// The genuinely correct TOTP code right now — used to prove a VALID code is still refused once
// the challenge is soft-locked (the lock ignores code correctness).
export function correctTotpCode(secret: string): string {
  const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) });
  return totp.generate();
}

/**
 * A real AAL2 TOTP challenge/verify against the live project: list factors → challenge → verify
 * with the given code. Returns whether the code was accepted (AAL2 reached). Used by the
 * mfa_softlock battery. The per-account/challenge soft-lock is applied in softlock.ts on top of
 * this — Supabase's only native brake here is the 15/hr-per-IP MFA cap.
 */
export async function attemptTotpVerify(
  client: SupabaseClient,
  code: string,
): Promise<{ accepted: boolean; platformRateLimited: boolean; errorMessage?: string }> {
  const factors = await client.auth.mfa.listFactors();
  const factor = factors.data?.totp?.[0];
  if (!factor) {
    return { accepted: false, platformRateLimited: false, errorMessage: 'no enrolled TOTP factor (seed the account first)' };
  }
  const challenge = await client.auth.mfa.challenge({ factorId: factor.id });
  if (challenge.error) {
    const lower = (challenge.error.message ?? '').toLowerCase();
    return { accepted: false, platformRateLimited: challenge.error.status === 429 || lower.includes('rate limit'), errorMessage: challenge.error.message };
  }
  const verify = await client.auth.mfa.verify({
    factorId: factor.id,
    challengeId: challenge.data.id,
    code,
  });
  if (verify.error) {
    const lower = (verify.error.message ?? '').toLowerCase();
    return { accepted: false, platformRateLimited: verify.error.status === 429 || lower.includes('rate limit'), errorMessage: verify.error.message };
  }
  return { accepted: Boolean(verify.data?.access_token), platformRateLimited: false };
}

/**
 * Build a fresh Supabase client bound to a source (proxy endpoint in real-proxy mode, or a
 * logical IP label in simulated mode). A fresh client per source keeps sessions from bleeding
 * between "IPs". In real-proxy mode the proxy is wired via a custom global.fetch; in simulated
 * mode the label is attached to a header for traceability only (Supabase still sees one egress IP
 * — which is exactly why the simulated battery ALSO disables the harness per-IP counter; see
 * attack.ts).
 */
export function clientForSource(env: Env, source: { proxyUrl?: string; ipLabel: string }): SupabaseClient {
  const headers: Record<string, string> = { 'x-spike-source-ip': source.ipLabel };
  const fetchImpl: typeof fetch = async (input, init) => {
    // real-proxy mode: route egress through the operator-provided proxy. Node 18+ fetch honours
    // an undici ProxyAgent via the `dispatcher` option; we pass it through opaquely so this file
    // stays dependency-light. If no proxy, this is a plain fetch.
    if (source.proxyUrl) {
      const merged: RequestInit & { dispatcher?: unknown } = { ...init };
      // The dispatcher is constructed by the caller (attack.ts) and stashed on the source; kept
      // as unknown to avoid a hard undici type dependency in the throwaway harness.
      (merged as { dispatcher?: unknown }).dispatcher = (source as { dispatcher?: unknown }).dispatcher;
      return fetch(input as string, merged as RequestInit);
    }
    return fetch(input as string, init);
  };

  return createClient(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers, fetch: fetchImpl },
  });
}

// A service-role client — used only to read auth state / reset the seeded account. NEVER on the
// attack path.
export function adminClient(env: Env): SupabaseClient {
  return createClient(env.url, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
