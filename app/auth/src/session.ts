// ISSUE-013 §8 steps 4–6 — the session mechanism as a pure, deterministic reference model.
//
// This is the heart of the SESS slice. It is authored offline against a modelled JWT + a modelled Supabase
// Auth session store, because the platform's real token minting is a live-checkpoint proof — but every RULE
// the platform enforces (TTL expiry, single-use rotation, 10s reuse tolerance, reuse-detection whole-session
// revocation, inactivity + absolute bounds enforced LAZILY at refresh, JWKS-local vs getUser revocation
// checks, mid-task service_role continuation) is a decision this model makes and the AC tests exercise.
//
// Determinism (house discipline): every method takes a logical `now` in epoch seconds. No Date.now(), no
// random — a test supplies time, so windows are exact and results are reproducible.
//
// Mapping to the three non-negotiables:
//   #1 never lose knowledge: a rotated refresh token is PERSISTED every rotation (FR-0.SESS.003) — losing it
//      would silently break session continuity; here it is an explicit stored field.
//   #2 never do what it shouldn't: an expired/reused/bounded token is REFUSED (no session granted on stale
//      credentials); getUser() sees server-side logout that a local getClaims() cannot (FR-0.SESS.008).
//   #3 never fail silently: every refusal returns a typed reason (never a silent hang); a benign expiry does
//      not kill a running task — it continues as service_role and surfaces a re-auth prompt (FR-0.SESS.006/007).

import type { AuthConfig } from './config.js';

/** The modelled access JWT — the claims a local JWKS verify (getClaims) reads without an Auth round-trip. */
export interface AccessJwt {
  sub: string; // subject = profiles.id / auth.users.id
  session_id: string;
  issued_at: number; // epoch seconds
  expires_at: number; // issued_at + access_token_ttl (FR-0.SESS.002)
  aal: 'aal1' | 'aal2';
}

/** The opaque single-use rotating refresh token (FR-0.SESS.001/003). */
export interface RefreshToken {
  token: string; // opaque handle
  session_id: string;
  generation: number; // increments each rotation; the store tracks the latest
}

export type StorageKind = 'cookie' | 'localStorage';

/** The HttpOnly posture (FR-0.SESS.005 / AF-073). Either HttpOnly is forced, or the documented fallback. */
export interface CookiePosture {
  storage: StorageKind; // MUST be 'cookie' — localStorage is rejected outright regardless of AF-073.
  httpOnly: boolean;
  // Fallback mitigations that MUST be active when httpOnly is false (AF-073 fallback: CSP + short TTL).
  cspStrict: boolean;
  accessTokenTtl: number;
}

export type SessionState = 'active' | 'revoked' | 'expired';

export type RevokeReason = 'reuse_detected' | 'server_logout' | 'inactivity' | 'absolute_timeout';

export interface SessionRecord {
  session_id: string;
  user_id: string;
  aal: 'aal1' | 'aal2';
  state: SessionState;
  started_at: number; // absolute time-box anchor (FR-0.SESS.004)
  last_activity_at: number; // inactivity anchor, advanced on each successful refresh (FR-0.SESS.004)
  current_refresh_generation: number; // the ONLY generation accepted (single-use rotation)
  current_refresh_token: string; // the persisted rotated token (FR-0.SESS.003 — #1)
  last_rotated_at: number; // supports the 10s reuse-interval tolerance
  server_logged_out: boolean; // set by a server-side logout; only getUser() sees it (FR-0.SESS.008)
  revoke_reason: RevokeReason | null;
}

export const REUSE_INTERVAL_SECONDS = 10; // [SA3] the race-tolerance window for a just-rotated token.

export type RefreshOutcome =
  | { ok: true; access: AccessJwt; refresh: RefreshToken }
  | { ok: false; revoked: true; reason: RevokeReason }
  | { ok: false; revoked: false; reason: 'unknown_session' };

/** Verify posture at establishment: cookie required; HttpOnly OR the AF-073 fallback must hold. */
export function verifyCookiePosture(p: CookiePosture): { ok: boolean; reason?: string } {
  if (p.storage !== 'cookie') return { ok: false, reason: 'session must be stored in a cookie, never localStorage' };
  if (p.httpOnly) return { ok: true };
  // AF-073 fallback: non-HttpOnly is only acceptable WITH strict CSP + a short access-token TTL.
  if (!p.cspStrict) return { ok: false, reason: 'non-HttpOnly requires strict CSP (AF-073 fallback)' };
  if (p.accessTokenTtl > 900) return { ok: false, reason: 'non-HttpOnly requires a short access-token TTL <=900s (AF-073 fallback)' };
  return { ok: true };
}

/**
 * The pure session manager. Owns the in-memory model of the Supabase Auth session store; the AuthStore port
 * (store.ts) persists the profiles mirror + event_log around it. Time is always injected.
 */
export class SessionManager {
  private sessions = new Map<string, SessionRecord>();
  private seq = 0;
  constructor(private readonly cfg: AuthConfig) {}

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${String(this.seq).padStart(4, '0')}`;
  }

  private mintAccess(rec: SessionRecord, now: number): AccessJwt {
    return {
      sub: rec.user_id,
      session_id: rec.session_id,
      issued_at: now,
      expires_at: now + this.cfg.access_token_ttl, // FR-0.SESS.002
      aal: rec.aal,
    };
  }

  private mintRefresh(rec: SessionRecord): RefreshToken {
    return { token: rec.current_refresh_token, session_id: rec.session_id, generation: rec.current_refresh_generation };
  }

  /** FR-0.SESS.001 — establish a session on successful login: issue access JWT + rotating refresh token. */
  establish(userId: string, aal: 'aal1' | 'aal2', now: number): { access: AccessJwt; refresh: RefreshToken; session_id: string } {
    const session_id = this.nextId('sess');
    const rec: SessionRecord = {
      session_id,
      user_id: userId,
      aal,
      state: 'active',
      started_at: now,
      last_activity_at: now,
      current_refresh_generation: 1,
      current_refresh_token: this.nextId('rt'),
      last_rotated_at: now,
      server_logged_out: false,
      revoke_reason: null,
    };
    this.sessions.set(session_id, rec);
    return { access: this.mintAccess(rec, now), refresh: this.mintRefresh(rec), session_id };
  }

  get(session_id: string): SessionRecord | undefined {
    return this.sessions.get(session_id);
  }

  /**
   * FR-0.SESS.008 — local JWKS verification (getClaims): validate signature+expiry WITHOUT an Auth
   * round-trip. It CANNOT see server-side logout/revocation — that's what getUser() is for. Here: a token
   * is claim-valid iff it is not past its own expiry. (Signature is modelled as trusted issuance.)
   */
  getClaims(access: AccessJwt, now: number): { valid: boolean; reason?: string; claims?: AccessJwt } {
    if (now >= access.expires_at) return { valid: false, reason: 'expired' }; // FR-0.SESS.002
    return { valid: true, claims: access };
  }

  /**
   * FR-0.SESS.008 — getUser(): the Auth-server round-trip used on revocation-sensitive endpoints. It sees
   * server-side logout/session revocation that getClaims() cannot. Denies a claim-valid token whose session
   * was logged out or revoked server-side (#2).
   */
  getUser(access: AccessJwt, now: number): { authenticated: boolean; reason?: string } {
    const local = this.getClaims(access, now);
    if (!local.valid) return { authenticated: false, reason: local.reason };
    const rec = this.sessions.get(access.session_id);
    if (!rec) return { authenticated: false, reason: 'unknown_session' };
    if (rec.server_logged_out) return { authenticated: false, reason: 'server_logout' };
    if (rec.state !== 'active') return { authenticated: false, reason: rec.revoke_reason ?? 'inactive' };
    return { authenticated: true };
  }

  /** A server-side logout (FR-0.SESS.008): the session is revoked server-side; getClaims stays fooled, getUser denies. */
  serverLogout(session_id: string): void {
    const rec = this.sessions.get(session_id);
    if (!rec) return;
    rec.server_logged_out = true;
    rec.state = 'revoked';
    rec.revoke_reason = 'server_logout';
  }

  private revoke(rec: SessionRecord, reason: RevokeReason): void {
    rec.state = 'revoked';
    rec.revoke_reason = reason;
  }

  /**
   * FR-0.SESS.003/004 — exchange a refresh token. Enforces, in order:
   *   (1) reuse-detection: presenting a generation OLDER than current, outside the 10s reuse interval,
   *       revokes the WHOLE session (a stolen-then-rotated token is the classic signal). Within 10s of the
   *       last rotation the stale generation is tolerated as a race (a re-issue, not a revoke).
   *   (2) single-use rotation: the accepted token is rotated — a NEW generation + token is minted and
   *       PERSISTED (#1); the prior token no longer refreshes.
   *   (3) lifetime bounds, enforced LAZILY here (not proactively): inactivity (idle since last_activity_at)
   *       and the absolute time-box (since started_at) each refuse the refresh and require re-auth.
   */
  refresh(presented: RefreshToken, now: number): RefreshOutcome {
    const rec = this.sessions.get(presented.session_id);
    if (!rec) return { ok: false, revoked: false, reason: 'unknown_session' };
    if (rec.state === 'revoked') return { ok: false, revoked: true, reason: rec.revoke_reason ?? 'reuse_detected' };

    // (1) reuse-detection BEFORE bounds — a compromised token must revoke even a fresh session.
    if (presented.generation < rec.current_refresh_generation) {
      const withinReuseInterval = now - rec.last_rotated_at <= REUSE_INTERVAL_SECONDS;
      if (!withinReuseInterval) {
        this.revoke(rec, 'reuse_detected'); // FR-0.SESS.003 — whole-session revocation
        return { ok: false, revoked: true, reason: 'reuse_detected' };
      }
      // within the race window: tolerate — re-issue against the CURRENT generation without rotating again.
      return { ok: true, access: this.mintAccess(rec, now), refresh: this.mintRefresh(rec) };
    }
    if (presented.generation > rec.current_refresh_generation) {
      // a token from the future generation cannot exist — treat as forgery, revoke.
      this.revoke(rec, 'reuse_detected');
      return { ok: false, revoked: true, reason: 'reuse_detected' };
    }
    if (presented.token !== rec.current_refresh_token) {
      // same generation number but a token value that was never issued — forgery.
      this.revoke(rec, 'reuse_detected');
      return { ok: false, revoked: true, reason: 'reuse_detected' };
    }

    // (3) lifetime bounds — lazy, at refresh (FR-0.SESS.004).
    if (now - rec.last_activity_at > this.cfg.session_inactivity_timeout) {
      this.revoke(rec, 'inactivity');
      return { ok: false, revoked: true, reason: 'inactivity' };
    }
    if (now - rec.started_at > this.cfg.session_absolute_timeout) {
      this.revoke(rec, 'absolute_timeout');
      return { ok: false, revoked: true, reason: 'absolute_timeout' };
    }

    // (2) single-use rotation — mint + persist a new generation (#1: persisted every rotation).
    rec.current_refresh_generation += 1;
    rec.current_refresh_token = this.nextId('rt');
    rec.last_rotated_at = now;
    rec.last_activity_at = now;
    return { ok: true, access: this.mintAccess(rec, now), refresh: this.mintRefresh(rec) };
  }

  /**
   * FR-0.SESS.006 — mid-task continuation. A background task started by this session continues as
   * `service_role` (off the RLS path, no auth.uid()) even after the client session expires — a BENIGN
   * expiry does not halt it. (The revocation/deactivation halt that DOES stop a task is NFR-SEC.012 /
   * ISSUE-020, deliberately NOT implemented here.) Returns the run-context the task executes under.
   */
  continueBackgroundTask(session_id: string): { role: 'service_role'; auth_uid: null; halted: boolean } {
    // Benign client-session expiry never halts a running task; it runs as service_role to completion.
    return { role: 'service_role', auth_uid: null, halted: false };
  }
}

/** FR-0.SESS.007 — the re-auth prompt payload: preserves the page state for restore on success. */
export interface ReauthPrompt<TState> {
  trigger: RevokeReason | 'expired';
  preservedState: TState; // restored verbatim on successful re-auth — no data loss (#1)
  backgroundTaskContinues: boolean; // the FR-0.SESS.006 note surfaced to the user
}

export function buildReauthPrompt<TState>(trigger: RevokeReason | 'expired', state: TState, backgroundTaskContinues: boolean): ReauthPrompt<TState> {
  return { trigger, preservedState: state, backgroundTaskContinues };
}
