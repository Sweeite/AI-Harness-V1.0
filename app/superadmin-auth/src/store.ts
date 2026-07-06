// ISSUE-014 — the SuperAdminAuthStore PORT + its in-memory fake (the test double AND the reference model).
//
// Every live side effect of this slice goes through here. Per ISSUE-014 §5 there is NO net-new app table:
//   - the external Super-Admin credential lives in Supabase-managed `auth.users` (referenced, not migrated);
//   - the enrolled TOTP factor lives in Supabase-managed `auth.mfa_factors` (referenced, not migrated);
//   - the security events are written into the C7 `event_log` sink (owned by ISSUE-011; the 7 auth
//     event_type values were added by migration 0007 — reused here, NOT re-added);
//   - the per-account brute-force soft-lock counter + the 2FA soft-lock counter are APP-LAYER STATE keyed
//     off the account (email / auth.users.id). No `client_slug` anywhere (ADR-001).
//
// The in-memory fake enforces every invariant the live side would:
//   1. event_log is APPEND-ONLY (never spliced/edited) — the security audit trail (#1/#3).
//   2. a soft-lock counter is monotonic within a failure streak and RESETS on a success (so a legit user is
//      never punished for old failures) — but the lock, once tripped, HOLDS until its window elapses (#2).
//   3. the lock decision is time-driven off an injected logical `now` (epoch seconds) — deterministic, no
//      Date.now()/random, so a test proves exact windows.

/** The 7 auth event_type values this slice emits — identical set to migration 0007 (ISSUE-013 added them). */
export type SecurityEventType =
  | 'sign_in_success' // password+2FA fully passed → session about to be minted
  | 'sign_in_failure' // wrong password / wrong-or-skipped TOTP code
  | 'session_established' // aal2 session established after the challenge
  | 'identity_rejected' // account soft-locked / mfa soft-locked / captcha fail-closed / leaked password (security event)
  | 'reuse_detection_revocation' // (owned by ISSUE-013; part of the shared enum — not emitted here)
  | 'task_continuation' // (owned by ISSUE-013 — not emitted here)
  | 'verification_failure'; // a defense check refused (soft-lock trip / captcha unavailable) — the "never silent" signal

export interface SecurityEventRow {
  id: string;
  event_type: SecurityEventType;
  user_id: string | null; // the auth.users(id) when known; null when the account is identified only by email pre-mirror
  summary: string;
  detail: unknown;
  created_at: string;
}

export type NewSecurityEvent = Omit<SecurityEventRow, 'id' | 'created_at'>;

/** A Super-Admin alert dispatched on a per-account lockout trip (FR-0.AUTH.009 — "a Super Admin alert fires"). */
export interface SuperAdminAlert {
  id: string;
  kind: 'account_lockout' | 'mfa_softlock';
  account: string; // email or user_id — the locked account
  summary: string;
  created_at: string;
}

/** App-layer soft-lock counter state for one account+dimension (brute-force OR 2FA). No net-new table — app state. */
export interface SoftLockState {
  consecutive_failures: number;
  locked_until: number | null; // epoch seconds; null = not locked
}

export interface SuperAdminAuthStore {
  /** Append a security event to the C7 event_log sink (append-only). */
  logEvent(row: NewSecurityEvent, now: number): Promise<SecurityEventRow>;
  /** Dispatch a Super-Admin alert (FR-0.AUTH.009 lockout trip). */
  raiseAlert(kind: SuperAdminAlert['kind'], account: string, summary: string, now: number): Promise<SuperAdminAlert>;
  /** Read the current soft-lock state for an account in a given dimension (defaults to a clean slate). */
  getSoftLock(dimension: 'account' | 'mfa', account: string): Promise<SoftLockState>;
  /** Persist an updated soft-lock state for an account in a given dimension. */
  setSoftLock(dimension: 'account' | 'mfa', account: string, state: SoftLockState): Promise<void>;
}

// ───────────────────────────────────────────────────────────────────────────────────
// In-memory fake — the reference model. Deterministic: caller supplies logical `now` (epoch seconds).
// ───────────────────────────────────────────────────────────────────────────────────
export class InMemorySuperAdminAuthStore implements SuperAdminAuthStore {
  private seq = 0;
  readonly eventLog: SecurityEventRow[] = [];
  readonly alerts: SuperAdminAlert[] = [];
  private softLocks = new Map<string, SoftLockState>();

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${String(this.seq).padStart(4, '0')}`;
  }
  private iso(now: number): string {
    return new Date(now * 1000).toISOString();
  }
  private key(dimension: 'account' | 'mfa', account: string): string {
    return `${dimension}:${account}`;
  }

  async logEvent(row: NewSecurityEvent, now: number): Promise<SecurityEventRow> {
    const full: SecurityEventRow = { id: this.nextId('ev'), created_at: this.iso(now), ...row };
    this.eventLog.push(full); // append-only — the array is never spliced/edited
    return full;
  }

  async raiseAlert(
    kind: SuperAdminAlert['kind'],
    account: string,
    summary: string,
    now: number,
  ): Promise<SuperAdminAlert> {
    const alert: SuperAdminAlert = { id: this.nextId('alert'), kind, account, summary, created_at: this.iso(now) };
    this.alerts.push(alert);
    return alert;
  }

  async getSoftLock(dimension: 'account' | 'mfa', account: string): Promise<SoftLockState> {
    const existing = this.softLocks.get(this.key(dimension, account));
    // return a COPY so a caller mutating the result cannot silently corrupt stored state (#1).
    return existing ? { ...existing } : { consecutive_failures: 0, locked_until: null };
  }

  async setSoftLock(dimension: 'account' | 'mfa', account: string, state: SoftLockState): Promise<void> {
    this.softLocks.set(this.key(dimension, account), { ...state });
  }
}
