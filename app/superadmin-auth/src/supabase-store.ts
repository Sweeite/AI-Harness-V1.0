// ISSUE-014 — the LIVE SuperAdminAuthStore adapter (pg, against the client-owned silo Supabase). It is the
// only module that imports `pg`. It implements the same port as InMemorySuperAdminAuthStore against the real
// DDL. Per ISSUE-014 §5 there is NO net-new app table and NO migration:
//   - the security events are written into the existing append-only `event_log` (0001_baseline.sql L483) using
//     the 7 auth `event_type` values added by migration 0007 (ISSUE-013 owns 0007; this slice REUSES them,
//     does NOT re-add). The cast `$1::event_type` makes an unknown value raise LOUD until 0007 is applied
//     (invalid_text_representation) — never a silent skip (#3). payload is jsonb → `$4::jsonb` fails loud too.
//   - the Super-Admin alert is emitted as an `event_log` row too (there is no separate alert table and this
//     slice adds none — the alert is an observable security event; the notification transport is C7's).
//   - the per-account / 2FA soft-lock counter is APP-LAYER runtime state (in the app process — this is what
//     "no net-new app table; the soft-lock counter is app-layer state keyed off auth.users" means, and what
//     the AF-077 ISSUE-005 spike proved). It is NOT persisted to a DB table by this slice. This adapter
//     therefore keeps the soft-lock counters in a process-local map (same shape as the in-memory fake) and
//     writes ONLY the event_log/alert rows to Postgres. A future durable-lock store (survive a process
//     restart) would be its own OD, not a silent net-new table here.
//
// ⚠️ NOT YET RUN LIVE. Two live proofs are owed to onboarding (🧑 you-present) and are NOT faked here:
//   (a) the brute-force attack simulation (scripted single-account + multi-IP) against a throwaway Supabase
//       Auth project — the definitive AF-077 proof. AF-077 is already 🟢 from the ISSUE-005 spike; this is
//       the re-confirmation against THIS build's thresholds.
//   (b) TOTP enrollment + a real 6-digit code verified against a throwaway project (AF-075: Microsoft
//       Authenticator compatibility is 🔴 unverified — do NOT name it as guaranteed on UI-2FA-ENROLL).
// The InMemorySuperAdminAuthStore is the proven reference model. Do NOT claim these code paths verified until
// onboarding records live evidence.

import pg from 'pg';
import type {
  SuperAdminAuthStore,
  SecurityEventRow,
  NewSecurityEvent,
  SuperAdminAlert,
  SoftLockState,
} from './store.js';

export class SupabaseSuperAdminAuthStore implements SuperAdminAuthStore {
  private pool: pg.Pool;
  private seq = 0;
  // App-layer soft-lock counters (see header): process-local, NOT a DB table. Same shape as the fake.
  private softLocks = new Map<string, SoftLockState>();

  constructor(connectionString: string) {
    const ssl = /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: false };
    this.pool = new pg.Pool({ connectionString, ssl });
  }

  private key(dimension: 'account' | 'mfa', account: string): string {
    return `${dimension}:${account}`;
  }

  async logEvent(row: NewSecurityEvent, _now: number): Promise<SecurityEventRow> {
    // entity_ids is uuid[] in the DDL; the user_id (a uuid) is the natural entity. created_at defaults now().
    // event_type is CAST to ::event_type — the 7 auth values were added by migration 0007 (ISSUE-013); an
    // unknown value raises invalid_text_representation LOUD, never a silent skip (#3). payload is jsonb.
    const entityIds = row.user_id ? [row.user_id] : [];
    const res = await this.pool.query<{ id: string; created_at: string }>(
      `insert into event_log (task_id, event_type, entity_ids, summary, payload)
       values (null, $1::event_type, $2, $3, $4::jsonb)
       returning id, created_at`,
      [row.event_type, entityIds, row.summary, JSON.stringify(row.detail)],
    );
    return { id: res.rows[0]!.id, created_at: res.rows[0]!.created_at, ...row };
  }

  async raiseAlert(
    kind: SuperAdminAlert['kind'],
    account: string,
    summary: string,
    now: number,
  ): Promise<SuperAdminAlert> {
    // The alert is emitted as an event_log security event (there is no separate alert table and this slice
    // adds none — §5). identity_rejected is the security-event value for a lockout trip (never silent — #3).
    const ev = await this.logEvent(
      { event_type: 'identity_rejected', user_id: null, summary: `super-admin alert: ${summary}`, detail: { alert_kind: kind, account } },
      now,
    );
    this.seq += 1;
    return { id: `alert-${String(this.seq).padStart(4, '0')}`, kind, account, summary, created_at: ev.created_at };
  }

  async getSoftLock(dimension: 'account' | 'mfa', account: string): Promise<SoftLockState> {
    const existing = this.softLocks.get(this.key(dimension, account));
    return existing ? { ...existing } : { consecutive_failures: 0, locked_until: null };
  }

  async setSoftLock(dimension: 'account' | 'mfa', account: string, state: SoftLockState): Promise<void> {
    this.softLocks.set(this.key(dimension, account), { ...state });
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}
