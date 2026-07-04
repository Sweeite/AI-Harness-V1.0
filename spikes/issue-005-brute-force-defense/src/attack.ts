// ISSUE-005 §8.4 — the attack battery.
//
// Two batteries, both driving REAL Supabase auth calls at the operator's throwaway project:
//   (a) SINGLE-ACCOUNT credential-stuffing from ONE source IP: a password-list loop against
//       signInWithPassword. The per-account soft-lock must halt it before any session mints.
//   (b) DISTRIBUTED MULTI-IP: the same account attacked from many source IPs so no single IP
//       crosses Supabase's per-IP caps (the caps are defeated by design). Two honest modes:
//         - real-proxy   : if PROXY_ENDPOINTS given, drive real requests through them (truly
//                          different egress IPs). This is the real thing.
//         - simulated    : if NO proxies, we CANNOT rotate egress IPs, so we honestly simulate
//                          the multi-IP case by DISABLING the harness per-IP counter — proving
//                          the per-account soft-lock + CAPTCHA + leaked-password are the real
//                          backstop once IP limits are out of the picture. The evidence LABELS
//                          which mode ran (never presents simulated as real).
//
// Plus the 2FA-challenge battery (mfa_softlock): real WRONG TOTP codes until the challenge locks,
// then one real RIGHT code to prove the lock ignores code correctness (AC-0.AUTH.007.3).
//
// The battery calls the soft-lock GATE before each real attempt, so a locked account never even
// reaches the password grant — the defense actually stops traffic, it doesn't just annotate it.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  attemptPasswordLogin,
  attemptTotpVerify,
  clientForSource,
  correctTotpCode,
  wrongTotpCode,
  type Env,
} from './auth.js';
import { DEFENSE } from './config.js';
import { EventLog } from './eventlog.js';
import { SoftLock } from './softlock.js';

export type MultiIpMode = 'real-proxy' | 'simulated';

export interface AttemptRecord {
  n: number;
  sourceIp: string;
  gatedByAppLayer: boolean; // the app-layer soft-lock refused before Supabase was even called
  sessionMinted: boolean;
  invalidCredentials: boolean;
  platformRateLimited: boolean;
  captchaRequired: boolean;
  leakedPasswordRefused: boolean;
}

export interface BatteryResult {
  name: string;
  mode?: MultiIpMode;
  attempts: AttemptRecord[];
  sessionEverMinted: boolean; // the breach ground-truth: did the attacker EVER get a session?
  haltedAtAttempt: number | null; // first attempt the app-layer soft-lock blocked at
  captchaObserved: boolean; // Supabase demanded CAPTCHA at least once (real form control live)
  leakedObserved: boolean; // leaked-password protection refused at least once
}

// A short throwaway password list (credential-stuffing simulation). NONE is the real password —
// the real one is never guessed, which is the point: the loop should be stopped by the soft-lock
// long before it could exhaust a real list.
function passwordList(count: number): string[] {
  const list: string[] = [];
  for (let i = 0; i < count; i += 1) list.push(`Wrong-Password-${i}!aA9`);
  return list;
}

/** Build a per-request client bound to a source. In real-proxy mode we attach an undici dispatcher. */
async function makeSourceClient(env: Env, ipLabel: string, proxyUrl?: string): Promise<SupabaseClient> {
  const source: { ipLabel: string; proxyUrl?: string; dispatcher?: unknown } = { ipLabel };
  if (proxyUrl) {
    source.proxyUrl = proxyUrl;
    // Lazy import so the harness has no hard undici dependency when no proxies are used.
    const undici = (await import('undici')) as unknown as { ProxyAgent: new (u: string) => unknown };
    source.dispatcher = new undici.ProxyAgent(proxyUrl);
  }
  return clientForSource(env, source);
}

// (a) Single-account, single-IP credential-stuffing.
export async function singleAccountBattery(env: Env, lock: SoftLock, log: EventLog): Promise<BatteryResult> {
  const sourceIp = '203.0.113.10'; // one fixed source
  const client = await makeSourceClient(env, sourceIp);
  const captchaToken = env.captchaEnabled ? env.captchaTestSitekey && env.captchaTestSecret ? 'test-captcha-token' : undefined : undefined;
  const attempts: AttemptRecord[] = [];
  let sessionEverMinted = false;
  let haltedAt: number | null = null;
  let captchaObserved = false;
  let leakedObserved = false;

  const pwds = passwordList(DEFENSE.ATTACK_PASSWORD_ATTEMPTS);
  for (let i = 0; i < pwds.length; i += 1) {
    // The defense gate — a locked account never reaches Supabase.
    if (lock.passwordGate(env.account) === 'locked') {
      if (haltedAt === null) haltedAt = i + 1;
      attempts.push(blockedRecord(i + 1, sourceIp));
      // Keep looping a few more to prove the lock HOLDS across further attempts, then stop.
      if (i > (haltedAt ?? 0) + 3) break;
      continue;
    }
    const r = await attemptPasswordLogin(client, env.account, pwds[i], captchaToken);
    lock.recordPasswordOutcome(env.account, sourceIp, r.sessionMinted);
    if (r.sessionMinted) sessionEverMinted = true;
    if (r.captchaRequired) captchaObserved = true;
    if (r.leakedPasswordRefused) leakedObserved = true;
    attempts.push({
      n: i + 1,
      sourceIp,
      gatedByAppLayer: false,
      sessionMinted: r.sessionMinted,
      invalidCredentials: r.invalidCredentials,
      platformRateLimited: r.platformRateLimited,
      captchaRequired: r.captchaRequired,
      leakedPasswordRefused: r.leakedPasswordRefused,
    });
    if (r.sessionMinted) break; // attacker won — stop and let the assertion fail loudly
  }

  return { name: 'single-account credential-stuffing (1 IP)', attempts, sessionEverMinted, haltedAtAttempt: haltedAt, captchaObserved, leakedObserved };
}

// (b) Distributed multi-IP attack.
export async function multiIpBattery(env: Env, lock: SoftLock, log: EventLog): Promise<BatteryResult> {
  const mode: MultiIpMode = env.proxyEndpoints.length > 0 ? 'real-proxy' : 'simulated';
  const captchaToken = env.captchaEnabled ? env.captchaTestSitekey && env.captchaTestSecret ? 'test-captcha-token' : undefined : undefined;
  const attempts: AttemptRecord[] = [];
  let sessionEverMinted = false;
  let haltedAt: number | null = null;
  let captchaObserved = false;
  let leakedObserved = false;

  // Source pool: real proxy endpoints, or synthetic labels (each a distinct logical IP).
  const N = DEFENSE.ATTACK_PASSWORD_ATTEMPTS;
  const sources: Array<{ ipLabel: string; proxyUrl?: string }> =
    mode === 'real-proxy'
      ? Array.from({ length: N }, (_, i) => ({ ipLabel: `proxy-${i % env.proxyEndpoints.length}`, proxyUrl: env.proxyEndpoints[i % env.proxyEndpoints.length] }))
      : Array.from({ length: N }, (_, i) => ({ ipLabel: `198.51.100.${i % 254}` }));

  const pwds = passwordList(N);
  for (let i = 0; i < pwds.length; i += 1) {
    const src = sources[i];
    // The per-ACCOUNT soft-lock is IP-independent — it must still trip even though every request
    // is a "new IP" (which is exactly what defeats Supabase's per-IP caps). In simulated mode this
    // is the whole proof: the per-IP counter is out of the picture (we never consult one), so the
    // ONLY thing that can stop the attack is the per-account soft-lock + CAPTCHA + leaked-password.
    if (lock.passwordGate(env.account) === 'locked') {
      if (haltedAt === null) haltedAt = i + 1;
      attempts.push(blockedRecord(i + 1, src.ipLabel));
      if (i > (haltedAt ?? 0) + 3) break;
      continue;
    }
    const client = await makeSourceClient(env, src.ipLabel, src.proxyUrl);
    const r = await attemptPasswordLogin(client, env.account, pwds[i], captchaToken);
    lock.recordPasswordOutcome(env.account, src.ipLabel, r.sessionMinted);
    if (r.sessionMinted) sessionEverMinted = true;
    if (r.captchaRequired) captchaObserved = true;
    if (r.leakedPasswordRefused) leakedObserved = true;
    attempts.push({
      n: i + 1,
      sourceIp: src.ipLabel,
      gatedByAppLayer: false,
      sessionMinted: r.sessionMinted,
      invalidCredentials: r.invalidCredentials,
      platformRateLimited: r.platformRateLimited,
      captchaRequired: r.captchaRequired,
      leakedPasswordRefused: r.leakedPasswordRefused,
    });
    if (r.sessionMinted) break;
  }

  return { name: 'distributed multi-IP attack', mode, attempts, sessionEverMinted, haltedAtAttempt: haltedAt, captchaObserved, leakedObserved };
}

export interface MfaBatteryResult {
  wrongCodesSubmitted: number;
  lockedAtAttempt: number | null;
  validCodeRefusedAfterLock: boolean; // a genuinely correct code was still refused once locked
  aal2EverReached: boolean; // the attacker EVER got AAL2 (breach)
}

// The 2FA-challenge battery: real wrong codes until the challenge soft-locks, then a real RIGHT
// code that must still be refused (AC-0.AUTH.007.3).
export async function mfaBattery(env: Env, lock: SoftLock, log: EventLog): Promise<MfaBatteryResult> {
  const sourceIp = '203.0.113.10';
  const client = await makeSourceClient(env, sourceIp);
  let wrong = 0;
  let lockedAt: number | null = null;
  let aal2EverReached = false;

  // threshold + 2 wrong codes so we clearly cross the boundary (the (threshold+1)th finds it locked).
  const rounds = DEFENSE.MFA_SOFTLOCK_THRESHOLD + 2;
  for (let i = 0; i < rounds; i += 1) {
    if (lock.mfaGate(env.account) === 'locked') {
      if (lockedAt === null) lockedAt = i + 1;
      continue;
    }
    const r = await attemptTotpVerify(client, wrongTotpCode(env.totpSecret));
    wrong += 1;
    lock.recordMfaOutcome(env.account, sourceIp, r.accepted);
    if (r.accepted) aal2EverReached = true;
  }

  // Now submit a genuinely CORRECT code — the lock must ignore correctness and still refuse.
  let validRefused = false;
  if (lock.mfaGate(env.account) === 'locked') {
    validRefused = true; // app-layer refuses before Supabase is even asked
  } else {
    const r = await attemptTotpVerify(client, correctTotpCode(env.totpSecret));
    validRefused = !r.accepted;
    if (r.accepted) aal2EverReached = true;
  }

  return { wrongCodesSubmitted: wrong, lockedAtAttempt: lockedAt, validCodeRefusedAfterLock: validRefused, aal2EverReached };
}

function blockedRecord(n: number, sourceIp: string): AttemptRecord {
  return {
    n,
    sourceIp,
    gatedByAppLayer: true,
    sessionMinted: false,
    invalidCredentials: false,
    platformRateLimited: false,
    captchaRequired: false,
    leakedPasswordRefused: false,
  };
}
