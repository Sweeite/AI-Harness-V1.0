// ISSUE-014 §8 steps 2→6 — the Super-Admin login orchestrator. It joins the password grant (password.ts),
// the per-account brute-force soft-lock (softlock.ts), the same-page TOTP challenge (totp.ts) + its 2FA
// soft-lock, and the event_log/alert sink (store.ts) into the single external-Super-Admin sign-in path.
//
// The load-bearing invariants this file realises (the three non-negotiables in this slice):
//   #2 never do what it shouldn't: the soft-lock is checked BEFORE the credential/verify path, so a locked
//      account is refused before any check — an attacker's (N+1)th attempt never reaches Supabase and NO
//      session is minted; a correct code/password during a live lock is still denied.
//   #3 never fail silently: every failure, soft-lock trip, and rejection writes an event_log security event;
//      a lock trip ALSO fires a Super-Admin alert. A lock is shown/logged, never a silent reject.
//   #1 never lose knowledge: the event_log sink is append-only; the soft-lock counters persist across
//      attempts (a streak spanning many requests/IPs is remembered — the IP-independent defense).
//
// This slice does NOT mint the session itself — session establishment is ISSUE-013's (app/auth). On a fully
// passed password+2FA it returns `granted` with the aal2 marker; the caller (or ISSUE-013's SessionManager)
// establishes the session. Determinism: `now` is injected (epoch seconds) everywhere.

import type { SuperAdminAuthConfig } from './config.js';
import type { SuperAdminAuthStore } from './store.js';
import {
  attemptPasswordGrant,
  type CaptchaState,
  type PasswordPolicy,
  type SuperAdminAccount,
} from './password.js';
import { gate, recordFailure, recordSuccess, type SoftLockConfig } from './softlock.js';
import { challengeTotp, type TotpFactor } from './totp.js';

export type PasswordStepResult =
  | { ok: true; next: 'totp_challenge'; user_id: string } // creds correct → advance same-page to the challenge
  | { ok: false; stage: 'password'; reason: string; locked?: { retry_after_seconds: number } };

export type ChallengeStepResult =
  | { ok: true; granted: true; user_id: string; aal: 'aal2' } // 2FA passed → session may be established (aal2)
  | { ok: false; stage: 'challenge'; reason: string; locked?: { retry_after_seconds: number } };

/**
 * FR-0.AUTH.005 + FR-0.AUTH.009 — the password step. Order: per-account soft-lock GATE first (a locked
 * account is refused before any credential check — #2), then the password grant (CAPTCHA fail-closed,
 * leaked-password, credential verify). A failure records against the per-account soft-lock and, on the
 * threshold-crossing edge, trips the lock + fires the Super-Admin alert + writes the security event.
 * Correct credentials RESET the streak and advance to the challenge (NO session yet — FR-0.AUTH.005).
 */
export async function passwordStep(args: {
  cfg: SuperAdminAuthConfig;
  store: SuperAdminAuthStore;
  policy: PasswordPolicy;
  captcha: CaptchaState;
  email: string;
  password: string;
  account: SuperAdminAccount | null;
  leakedLookup: (password: string) => boolean;
  now: number;
}): Promise<PasswordStepResult> {
  const { cfg, store, policy, captcha, email, password, account, leakedLookup, now } = args;
  const accountKey = account?.user_id ?? email; // IP-INDEPENDENT: keyed on the account, never the source IP.
  const lockCfg: SoftLockConfig = { threshold: cfg.account_lockout_threshold, minutes: cfg.account_lockout_minutes };

  // 1. Soft-lock gate FIRST — a locked account is refused before any credential check (#2). The attack halts
  //    here before any session can be minted, even across many IPs (the counter is per-account).
  const state = await store.getSoftLock('account', accountKey);
  const g = gate(state, now);
  if (!g.allowed) {
    await store.logEvent(
      { event_type: 'identity_rejected', user_id: account?.user_id ?? null, summary: 'password attempt on a soft-locked account', detail: { email, retry_after_seconds: g.retry_after_seconds } },
      now,
    );
    return { ok: false, stage: 'password', reason: 'account_soft_locked', locked: { retry_after_seconds: g.retry_after_seconds } };
  }

  // 2. The password grant (CAPTCHA fail-closed → account lookup → leaked-password → credential verify).
  const grant = attemptPasswordGrant({ policy, captcha, email, password, account, leakedLookup });
  if (!grant.ok) {
    // Record the failure against the per-account soft-lock; trip + alert on the threshold-crossing edge.
    const fr = recordFailure(state, lockCfg, now);
    await store.setSoftLock('account', accountKey, fr.next);
    await store.logEvent(
      { event_type: 'sign_in_failure', user_id: account?.user_id ?? null, summary: `password grant failed: ${grant.reason}`, detail: { email, reason: grant.reason, consecutive_failures: fr.next.consecutive_failures } },
      now,
    );
    if (fr.tripped) {
      // FR-0.AUTH.009 — the threshold was crossed: lock + Super-Admin alert + security event (never silent #3).
      await store.raiseAlert('account_lockout', accountKey, `account temporarily locked after ${cfg.account_lockout_threshold} failed password attempts`, now);
      await store.logEvent(
        { event_type: 'verification_failure', user_id: account?.user_id ?? null, summary: 'account brute-force soft-lock tripped', detail: { email, locked_until: fr.next.locked_until, threshold: cfg.account_lockout_threshold } },
        now,
      );
      return { ok: false, stage: 'password', reason: 'account_soft_locked', locked: { retry_after_seconds: (fr.next.locked_until ?? now) - now } };
    }
    return { ok: false, stage: 'password', reason: grant.reason };
  }

  // 3. Correct credentials — reset the streak; advance SAME-PAGE to the TOTP challenge. NO session here.
  await store.setSoftLock('account', accountKey, recordSuccess());
  return { ok: true, next: 'totp_challenge', user_id: grant.user_id };
}

/**
 * FR-0.AUTH.007 — the same-page 2FA challenge step, with its own soft-lock. Order mirrors the password step:
 * MFA soft-lock gate first (a locked 2FA step refuses even a correct code — #2), then the TOTP verify. A
 * wrong/skipped code records a failure; the threshold-crossing edge trips the MFA soft-lock + logs the event.
 * A correct current code elevates to aal2 → `granted` (the caller/ISSUE-013 establishes the session).
 */
export async function challengeStep(args: {
  cfg: SuperAdminAuthConfig;
  store: SuperAdminAuthStore;
  user_id: string;
  factor: TotpFactor | null;
  code: string | null;
  now: number;
}): Promise<ChallengeStepResult> {
  const { cfg, store, user_id, factor, code, now } = args;
  const lockCfg: SoftLockConfig = { threshold: cfg.mfa_softlock_threshold, minutes: cfg.mfa_softlock_minutes };

  // 1. MFA soft-lock gate FIRST — once locked, even a genuinely-correct code is refused before verify (#2).
  const state = await store.getSoftLock('mfa', user_id);
  const g = gate(state, now);
  if (!g.allowed) {
    await store.logEvent(
      { event_type: 'identity_rejected', user_id, summary: '2FA code submitted on a soft-locked challenge', detail: { retry_after_seconds: g.retry_after_seconds } },
      now,
    );
    return { ok: false, stage: 'challenge', reason: 'mfa_soft_locked', locked: { retry_after_seconds: g.retry_after_seconds } };
  }

  // 2. Verify the code (correct current code → aal2; wrong/skipped/no-factor → no session).
  const res = challengeTotp(factor, code, now);
  if (!res.ok) {
    const fr = recordFailure(state, lockCfg, now);
    await store.setSoftLock('mfa', user_id, fr.next);
    await store.logEvent(
      { event_type: 'sign_in_failure', user_id, summary: `2FA challenge failed: ${res.reason}`, detail: { reason: res.reason, consecutive_failures: fr.next.consecutive_failures } },
      now,
    );
    if (fr.tripped) {
      await store.raiseAlert('mfa_softlock', user_id, `2FA challenge temporarily locked after ${cfg.mfa_softlock_threshold} wrong codes`, now);
      await store.logEvent(
        { event_type: 'verification_failure', user_id, summary: '2FA soft-lock tripped', detail: { locked_until: fr.next.locked_until, threshold: cfg.mfa_softlock_threshold } },
        now,
      );
      return { ok: false, stage: 'challenge', reason: 'mfa_soft_locked', locked: { retry_after_seconds: (fr.next.locked_until ?? now) - now } };
    }
    return { ok: false, stage: 'challenge', reason: res.reason };
  }

  // 3. Correct code → aal2. Reset the MFA streak; write success events. Session establishment is ISSUE-013's.
  await store.setSoftLock('mfa', user_id, recordSuccess());
  await store.logEvent({ event_type: 'sign_in_success', user_id, summary: 'password+2FA passed', detail: { aal: 'aal2' } }, now);
  await store.logEvent({ event_type: 'session_established', user_id, summary: 'aal2 session established', detail: {} }, now);
  return { ok: true, granted: true, user_id, aal: 'aal2' };
}
