// ISSUE-005 §8.3 — the minimal APP-LAYER per-account soft-lock (+ the 2FA-challenge soft-lock).
//
// THIS IS THE THING UNDER TEST. Supabase provides NO per-account lockout (PLATFORM.NATIVE_PER_
// ACCOUNT_LOCKOUT = false, [SA16]); without an app-layer brake there is nothing per-account
// stopping a credential-stuffing loop under the IP ceiling. So the spec commits to an app-layer
// soft-lock, and AF-077 exists to prove THAT actually halts the attack. This is a THROWAWAY
// reconstruction — only enough to MEASURE the defense; the shippable soft-lock is ISSUE-014.
//
// Behaviour (AC-0.AUTH.009.1 / AC-0.AUTH.007.3):
//   - password path: after `account_lockout_threshold` consecutive failures on ONE account, the
//     account's password path is temporarily LOCKED for `account_lockout_minutes`, and a
//     Super-Admin alert fires (once, on the crossing).
//   - 2FA challenge: after `mfa_softlock_threshold` consecutive wrong codes, the challenge is
//     temporarily locked and the event is logged.
//   - Counters are per-account, NOT per-IP — that is the whole point: it survives a distributed
//     multi-IP attack that defeats the IP limits.

import { DEFENSE } from './config.js';
import { EventLog } from './eventlog.js';

export type Gate = 'allow' | 'locked';

interface AccountState {
  consecutiveFailures: number;
  lockedUntil: number | null; // logical clock tick, null = not locked
  alerted: boolean; // Super-Admin alert already fired for the current lock
}

interface ChallengeState {
  consecutiveWrong: number;
  locked: boolean;
}

/**
 * SoftLock — the per-account defense. A single logical clock (tick) models time so lock expiry is
 * testable without wall-clock sleeps: `account_lockout_minutes` maps to a tick budget the harness
 * advances. Every decision is recorded to the EventLog so step 5's observability assertion is
 * provable (every attempt logged; the crossing raises a Super-Admin alert).
 */
export class SoftLock {
  private accounts = new Map<string, AccountState>();
  private challenges = new Map<string, ChallengeState>();
  private clock = 0;

  constructor(
    private readonly log: EventLog,
    private readonly threshold = DEFENSE.ACCOUNT_LOCKOUT_THRESHOLD,
    private readonly lockoutMinutes = DEFENSE.ACCOUNT_LOCKOUT_MINUTES,
    private readonly mfaThreshold = DEFENSE.MFA_SOFTLOCK_THRESHOLD,
  ) {}

  private acct(account: string): AccountState {
    let s = this.accounts.get(account);
    if (!s) {
      s = { consecutiveFailures: 0, lockedUntil: null, alerted: false };
      this.accounts.set(account, s);
    }
    return s;
  }

  /** Advance the logical clock (the harness calls this to simulate `account_lockout_minutes` elapsing). */
  advance(minutes: number): void {
    this.clock += minutes;
  }

  /**
   * Is this account's password path currently allowed? Call BEFORE the real Supabase attempt —
   * a locked account must never even reach the password grant. Auto-unlocks once the lock window
   * (account_lockout_minutes) has elapsed on the logical clock.
   */
  passwordGate(account: string): Gate {
    const s = this.acct(account);
    if (s.lockedUntil !== null) {
      if (this.clock >= s.lockedUntil) {
        // window elapsed → unlock + reset (AC-0.AUTH.009.1 "temporarily locked").
        s.lockedUntil = null;
        s.consecutiveFailures = 0;
        s.alerted = false;
      } else {
        return 'locked';
      }
    }
    return 'allow';
  }

  /**
   * Record the OUTCOME of a real password attempt. A success resets the counter; a failure
   * increments it and, on crossing the threshold, locks the path AND fires the Super-Admin alert
   * exactly once (AC-0.AUTH.009.1). `sourceIp` is logged for traceability only — the counter is
   * per-ACCOUNT, so a distributed attack still trips it.
   */
  recordPasswordOutcome(account: string, sourceIp: string, success: boolean): void {
    const s = this.acct(account);
    this.log.record({
      type: 'login_attempt',
      account,
      sourceIp,
      outcome: success ? 'success' : 'failure',
      detail: success ? 'password accepted' : `failed attempt ${s.consecutiveFailures + (success ? 0 : 1)}`,
    });
    if (success) {
      s.consecutiveFailures = 0;
      return;
    }
    s.consecutiveFailures += 1;
    if (s.consecutiveFailures >= this.threshold && s.lockedUntil === null) {
      s.lockedUntil = this.clock + this.lockoutMinutes;
      if (!s.alerted) {
        s.alerted = true;
        this.log.record({
          type: 'account_softlock',
          account,
          sourceIp,
          outcome: 'blocked',
          detail: `per-account soft-lock: ${s.consecutiveFailures} consecutive failures ≥ threshold ${this.threshold}; locked ${this.lockoutMinutes} min`,
        });
        this.log.record({
          type: 'super_admin_alert',
          account,
          sourceIp,
          outcome: 'alert',
          detail: `Super-Admin alert: account ${account} password path soft-locked after ${s.consecutiveFailures} failed attempts`,
        });
      }
    }
  }

  /** Is this account's 2FA challenge currently allowed? */
  mfaGate(account: string): Gate {
    return this.challenges.get(account)?.locked ? 'locked' : 'allow';
  }

  /**
   * Record a 2FA challenge outcome. After `mfa_softlock_threshold` consecutive wrong codes the
   * challenge locks and the event is logged (AC-0.AUTH.007.3). Note the spec: threshold 5 → the
   * 6th consecutive wrong code is the one that finds the challenge already locked.
   */
  recordMfaOutcome(account: string, sourceIp: string, accepted: boolean): void {
    let s = this.challenges.get(account);
    if (!s) {
      s = { consecutiveWrong: 0, locked: false };
      this.challenges.set(account, s);
    }
    this.log.record({
      type: 'login_attempt',
      account,
      sourceIp,
      outcome: accepted ? 'success' : 'failure',
      detail: accepted ? 'TOTP code accepted' : `wrong TOTP code ${s.consecutiveWrong + 1}`,
    });
    if (accepted) {
      s.consecutiveWrong = 0;
      return;
    }
    s.consecutiveWrong += 1;
    if (s.consecutiveWrong >= this.mfaThreshold && !s.locked) {
      s.locked = true;
      this.log.record({
        type: 'mfa_softlock',
        account,
        sourceIp,
        outcome: 'blocked',
        detail: `2FA challenge soft-lock: ${s.consecutiveWrong} consecutive wrong codes ≥ mfa_softlock_threshold ${this.mfaThreshold}`,
      });
    }
  }

  isPasswordLocked(account: string): boolean {
    return this.acct(account).lockedUntil !== null && this.clock < (this.acct(account).lockedUntil ?? 0);
  }

  isMfaLocked(account: string): boolean {
    return this.challenges.get(account)?.locked ?? false;
  }
}
