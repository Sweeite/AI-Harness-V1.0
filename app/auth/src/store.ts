// ISSUE-013 — the AuthStore PORT. Every live side effect of the login/session slice that touches the DB
// goes through here: the `profiles` mirror (upsert on first login, read-own, last_active_at bump), the
// auth `event_log` writes (sign-in success/failure, session establishment, rejected-identity security
// event, reuse-detection revocation, task-continuation, verification failure — §8 step 7), and the
// PERM-auth.provider_toggle gate on an oauth_enabled/oauth_provider config edit (FR-0.AUTH.003). This keeps
// the OAuth + session logic (oauth.ts / session.ts) unit-testable with NO live DB (the house port+fake
// pattern — cf. app/webhook-auth/src/store.ts, app/config-store/src/store.ts).
//
// The in-memory fake below is the test double AND the reference model — it enforces every invariant the DB
// (0006_profiles_mirror.sql owner-reads-own RLS + the profiles DDL) would:
//   1. profiles.id is keyed to auth.users(id); a login mirrors the identity into profiles (id, email).
//   2. owner-reads-own: readProfile(caller, target) returns a row ONLY when caller === target (the
//      auth.uid()=id RLS predicate). A cross-user read returns null — never another user's row (#2).
//   3. last_active_at is monotonic-forward (a session-activity bump never moves it backwards).
//   4. event_log is APPEND-ONLY (no update/delete) — the auth audit trail (#1/#3).
//   5. the provider-toggle edit is DENIED without PERM-auth.provider_toggle (FR-0.AUTH.003; default-deny).

import type { OAuthProvider } from './config.js';

/** profiles row (schema.md §1 — app-side user mirror keyed to auth.users(id)). */
export interface ProfileRow {
  id: string; // = auth.users(id)
  email: string;
  name: string | null;
  active: boolean; // deactivation ≠ delete (FR-1.USR.002; consumed, not owned here)
  created_at: string;
  last_active_at: string | null;
}

/** The auth event_log rows this slice emits (§8 step 7). event_type values are auth-domain strings. */
export type AuthEventType =
  | 'sign_in_success'
  | 'sign_in_failure'
  | 'session_established'
  | 'identity_rejected' // security event (FR-0.AUTH.004)
  | 'reuse_detection_revocation' // security event (FR-0.SESS.003)
  | 'task_continuation' // FR-0.SESS.006
  | 'verification_failure'; // FR-0.SESS.008

export interface AuthEventRow {
  id: string;
  event_type: AuthEventType;
  user_id: string | null; // null when the identity was rejected pre-mirror
  summary: string;
  detail: unknown;
  created_at: string;
}

export type NewAuthEvent = Omit<AuthEventRow, 'id' | 'created_at'>;

export interface AuthStore {
  /** Upsert the profiles mirror on a verified login (FR-0.AUTH.001 → the auth.uid() seam). */
  upsertProfile(id: string, email: string, name: string | null, now: number): Promise<ProfileRow>;
  /** Owner-reads-own: returns the row ONLY if caller === target (the 0006 RLS predicate). */
  readProfile(callerId: string, targetId: string): Promise<ProfileRow | null>;
  /** Bump last_active_at forward on session activity (monotonic; never backwards). */
  touchLastActive(id: string, now: number): Promise<void>;
  /** Deactivate/reactivate (consumed by C1/ISSUE-018; here to keep the mirror faithful). */
  setActive(id: string, active: boolean): Promise<void>;
  logEvent(row: NewAuthEvent, now: number): Promise<AuthEventRow>;
  /** FR-0.AUTH.003: persist an oauth_enabled/oauth_provider edit — GATED by PERM-auth.provider_toggle. */
  setProviderConfig(
    caller: { canToggleProvider: boolean },
    next: { oauth_enabled?: boolean; oauth_provider?: OAuthProvider },
    now: number,
  ): Promise<{ oauth_enabled: boolean; oauth_provider: OAuthProvider }>;
  /** Read the current provider config (governs NEW logins only — FR-0.AUTH.003 edge). */
  getProviderConfig(): Promise<{ oauth_enabled: boolean; oauth_provider: OAuthProvider }>;
}

export const ERR_PROVIDER_TOGGLE_DENIED =
  'PERM-auth.provider_toggle required to edit oauth_enabled/oauth_provider (default-deny)';

// ───────────────────────────────────────────────────────────────────────────────────
// In-memory fake — the test double AND the reference model. Deterministic: a logical `now`
// (epoch seconds) is supplied by the caller; no Date.now()/random.
// ───────────────────────────────────────────────────────────────────────────────────
export class InMemoryAuthStore implements AuthStore {
  private seq = 0;
  readonly profiles = new Map<string, ProfileRow>();
  readonly eventLog: AuthEventRow[] = [];
  private providerConfig: { oauth_enabled: boolean; oauth_provider: OAuthProvider };

  constructor(initial?: { oauth_enabled?: boolean; oauth_provider?: OAuthProvider }) {
    this.providerConfig = {
      oauth_enabled: initial?.oauth_enabled ?? true,
      oauth_provider: initial?.oauth_provider ?? 'google',
    };
  }

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${String(this.seq).padStart(4, '0')}`;
  }
  private iso(now: number): string {
    return new Date(now * 1000).toISOString();
  }

  async upsertProfile(id: string, email: string, name: string | null, now: number): Promise<ProfileRow> {
    const existing = this.profiles.get(id);
    if (existing) {
      existing.email = email; // keep the mirror current
      if (name !== null) existing.name = name;
      return existing;
    }
    const row: ProfileRow = {
      id,
      email,
      name,
      active: true,
      created_at: this.iso(now),
      last_active_at: this.iso(now),
    };
    this.profiles.set(id, row);
    return row;
  }

  async readProfile(callerId: string, targetId: string): Promise<ProfileRow | null> {
    // owner-reads-own (the 0006 RLS predicate: auth.uid() = id). A cross-user read returns nothing.
    if (callerId !== targetId) return null;
    return this.profiles.get(targetId) ?? null;
  }

  async touchLastActive(id: string, now: number): Promise<void> {
    const row = this.profiles.get(id);
    if (!row) throw new Error(`touchLastActive: no profile ${id}`);
    const nextIso = this.iso(now);
    // monotonic forward: never move last_active_at backwards (out-of-order events must not regress it).
    if (row.last_active_at === null || nextIso > row.last_active_at) row.last_active_at = nextIso;
  }

  async setActive(id: string, active: boolean): Promise<void> {
    const row = this.profiles.get(id);
    if (!row) throw new Error(`setActive: no profile ${id}`);
    row.active = active;
  }

  async logEvent(row: NewAuthEvent, now: number): Promise<AuthEventRow> {
    const full: AuthEventRow = { id: this.nextId('ev'), created_at: this.iso(now), ...row };
    this.eventLog.push(full); // append-only — the array is never spliced/edited
    return full;
  }

  async setProviderConfig(
    caller: { canToggleProvider: boolean },
    next: { oauth_enabled?: boolean; oauth_provider?: OAuthProvider },
    _now: number,
  ): Promise<{ oauth_enabled: boolean; oauth_provider: OAuthProvider }> {
    if (!caller.canToggleProvider) throw new Error(ERR_PROVIDER_TOGGLE_DENIED);
    if (next.oauth_enabled !== undefined) this.providerConfig.oauth_enabled = next.oauth_enabled;
    if (next.oauth_provider !== undefined) this.providerConfig.oauth_provider = next.oauth_provider;
    return { ...this.providerConfig };
  }

  async getProviderConfig(): Promise<{ oauth_enabled: boolean; oauth_provider: OAuthProvider }> {
    return { ...this.providerConfig };
  }
}
