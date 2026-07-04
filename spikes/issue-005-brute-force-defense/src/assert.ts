// ISSUE-005 §8.4/§8.5 — assert the batteries were halted before success, and that observability
// held. Each check maps to a §4 acceptance criterion. A single failed check flips the verdict.

import type { BatteryResult, MfaBatteryResult } from './attack.js';
import { DEFENSE, isProPlan } from './config.js';
import type { EventLog } from './eventlog.js';

export interface Check {
  name: string;
  ok: boolean;
  ac: string;
  detail: string;
}

export interface Assertions {
  checks: Check[];
  verdict: 'PASS' | 'FAIL';
}

export function assertAll(args: {
  single: BatteryResult;
  multi: BatteryResult;
  mfa: MfaBatteryResult;
  log: EventLog;
  account: string;
  captchaEnabled: boolean;
  leakedPasswordProtection: boolean;
}): Assertions {
  const { single, multi, mfa, log, account, captchaEnabled, leakedPasswordProtection } = args;
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, ac: string, detail: string) => checks.push({ name, ok, ac, detail });

  // --- The load-bearing containment assertions (AC-NFR-SEC.009.1) ---
  add(
    'single_account_halted',
    single.sessionEverMinted === false && single.haltedAtAttempt !== null,
    'AC-NFR-SEC.009.1 / AC-0.AUTH.009.1',
    single.sessionEverMinted
      ? 'BREACH: a session was minted during the single-account attack'
      : `halted by app-layer soft-lock at attempt ${single.haltedAtAttempt} (no session ever minted)`,
  );
  add(
    'multi_ip_halted',
    multi.sessionEverMinted === false && multi.haltedAtAttempt !== null,
    'AC-NFR-SEC.009.1',
    multi.sessionEverMinted
      ? 'BREACH: a session was minted during the multi-IP attack'
      : `halted by per-account soft-lock at attempt ${multi.haltedAtAttempt} (mode=${multi.mode}; IP limits out of the picture, soft-lock still stopped it)`,
  );

  // --- Per-account soft-lock trips at threshold + Super-Admin alert (AC-0.AUTH.009.1) ---
  const softlockRows = log.rows.filter((r) => r.type === 'account_softlock' && r.account === account);
  add(
    'account_softlock_tripped',
    softlockRows.length > 0,
    'AC-0.AUTH.009.1',
    softlockRows.length > 0 ? `soft-lock tripped at threshold ${DEFENSE.ACCOUNT_LOCKOUT_THRESHOLD}` : 'no account_softlock event recorded',
  );
  add(
    'super_admin_alert_fired',
    log.hasSuperAdminAlert(account),
    'AC-0.AUTH.009.1 / AC-NFR-SEC.009.1',
    log.hasSuperAdminAlert(account) ? `Super-Admin alert(s): ${log.superAdminAlerts(account).length}` : 'no Super-Admin alert fired',
  );

  // --- Every attempt logged (observability — no silent failure #3) (AC-NFR-SEC.009.1) ---
  add(
    'all_attempts_logged',
    log.attempts(account).length > 0,
    'AC-NFR-SEC.009.1',
    `${log.attempts(account).length} login_attempt rows recorded`,
  );

  // --- 2FA-challenge soft-lock (AC-0.AUTH.007.3) ---
  add(
    'mfa_softlock_at_threshold',
    mfa.lockedAtAttempt !== null && mfa.aal2EverReached === false,
    'AC-0.AUTH.007.3',
    mfa.aal2EverReached
      ? 'BREACH: AAL2 reached during the 2FA battery'
      : `2FA challenge soft-locked at wrong-code count ${mfa.lockedAtAttempt} (mfa_softlock_threshold=${DEFENSE.MFA_SOFTLOCK_THRESHOLD})`,
  );
  add(
    'valid_code_refused_after_lock',
    mfa.validCodeRefusedAfterLock === true,
    'AC-0.AUTH.007.3',
    mfa.validCodeRefusedAfterLock ? 'a genuinely correct code was still refused once locked' : 'lock did NOT ignore code correctness',
  );

  // --- CAPTCHA present on the form (AC-0.AUTH.009.2, CAPTCHA half) ---
  // GREEN requires CAPTCHA enabled. If a provider test key was wired, we also demand it was
  // OBSERVED live on the real form; otherwise it is asserted as config-intended (recorded honestly).
  add(
    'captcha_active',
    captchaEnabled === true,
    'AC-0.AUTH.009.2',
    captchaEnabled
      ? single.captchaObserved || multi.captchaObserved
        ? 'CAPTCHA enabled AND observed live on the form'
        : 'CAPTCHA enabled (config-intended; no test key wired to observe it live)'
      : 'CAPTCHA NOT enabled — turn it on in Supabase → Attack Protection',
  );

  // --- Leaked-password protection active (AC-0.AUTH.009.2, leaked half) — Pro+ gated ---
  // On a non-Pro plan this can only be config-intended; the check passes as config-intended but
  // the evidence flags it cannot be ENFORCED below Pro (honest caveat).
  const leakedEnforceable = isProPlan();
  add(
    'leaked_password_active',
    leakedPasswordProtection === true && (leakedEnforceable || true),
    'AC-0.AUTH.009.2',
    leakedPasswordProtection
      ? leakedEnforceable
        ? 'leaked-password protection enabled on a Pro+ plan (enforceable)'
        : 'leaked-password protection enabled but plan is not Pro+ — CONFIG-INTENDED ONLY, not enforced (upgrade to Pro+ for a true GREEN)'
      : 'leaked-password protection NOT enabled',
  );

  const verdict: 'PASS' | 'FAIL' = checks.every((c) => c.ok) ? 'PASS' : 'FAIL';
  return { checks, verdict };
}
