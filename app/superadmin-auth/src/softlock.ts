// ISSUE-014 §8 steps 4+5 — the pure soft-lock state machine, shared by the per-account brute-force lock
// (FR-0.AUTH.009) and the 2FA-challenge soft-lock (FR-0.AUTH.007). This is the load-bearing #2 defense:
// it must halt an attack BEFORE any session is minted, and it must be IP-INDEPENDENT (keyed on the account,
// not the source IP) so it survives the multi-IP / distributed credential-stuffing case that defeats the
// per-IP `/token` rate cap (AF-077 confirmed this is the real hole Supabase leaves open — no native
// per-account lockout). Determinism: time is always injected as epoch seconds; no Date.now()/random.
//
// Threshold semantics (matched to AC-0.AUTH.007.3 / AC-0.AUTH.009.1 + the AF-077 spike):
//   threshold = N ⇒ after N consecutive failures the account is locked, and the (N+1)th attempt is BLOCKED
//   before it reaches the credential/verify path. With the confirmed default N=5, the 6th consecutive wrong
//   attempt is the first blocked one (the spike observed "attempt 6 blocked before reaching Supabase").
//   A success (correct password / correct code) RESETS the streak — a legit user is never punished for the
//   attacker's old failures. A tripped lock HOLDS until `locked_until`, even for a correct credential (#2).

import type { SoftLockState } from './store.js';

/** Is this account currently locked at `now`? A lock in the past has elapsed (auto-clears on next read). */
export function isLocked(state: SoftLockState, now: number): boolean {
  return state.locked_until !== null && now < state.locked_until;
}

export interface SoftLockConfig {
  threshold: number; // consecutive failures that trip the lock
  minutes: number; // how long the lock holds once tripped
}

/** The decision returned when an attempt is GATED (checked before touching the credential/verify path). */
export type GateDecision =
  | { allowed: true } // not locked — proceed to check the credential / TOTP code
  | { allowed: false; locked_until: number; retry_after_seconds: number }; // locked — refuse before any check

/**
 * Gate an attempt BEFORE the credential/verify path runs (FR-0.AUTH.007 / FR-0.AUTH.009). If the account is
 * locked, the attempt is refused here — it never reaches Supabase, so even a correct code/password is denied
 * while the lock holds (#2). If a prior lock has elapsed, it auto-clears and the attempt is allowed through.
 */
export function gate(state: SoftLockState, now: number): GateDecision {
  if (isLocked(state, now)) {
    const locked_until = state.locked_until!;
    return { allowed: false, locked_until, retry_after_seconds: locked_until - now };
  }
  return { allowed: true };
}

/** The result of recording one FAILED attempt: the next state + whether THIS failure tripped the lock. */
export interface FailureResult {
  next: SoftLockState;
  tripped: boolean; // true exactly on the transition into a locked state (so the caller alerts+logs once)
}

/**
 * Record a failed attempt (wrong password / wrong TOTP code). Increments the streak; if the streak reaches
 * the threshold it trips the lock for `minutes`. `tripped` is true ONLY on the transition edge, so the
 * caller fires the Super-Admin alert + the security event_log write EXACTLY once per lock (never a silent
 * lock — #3; never a duplicate-alert storm).
 */
export function recordFailure(state: SoftLockState, cfg: SoftLockConfig, now: number): FailureResult {
  // If already locked, a further failure does not extend the lock or re-trip it (idempotent while locked).
  if (isLocked(state, now)) {
    return { next: { ...state }, tripped: false };
  }
  const consecutive = state.consecutive_failures + 1;
  if (consecutive >= cfg.threshold) {
    const locked_until = now + cfg.minutes * 60;
    return { next: { consecutive_failures: consecutive, locked_until }, tripped: true };
  }
  return { next: { consecutive_failures: consecutive, locked_until: null }, tripped: false };
}

/**
 * Record a SUCCESSFUL attempt — resets the streak to a clean slate. Only reachable when the gate allowed the
 * attempt through (a locked account never gets here — the lock is checked first), so a success during a live
 * lock is impossible by construction (#2).
 */
export function recordSuccess(): SoftLockState {
  return { consecutive_failures: 0, locked_until: null };
}
