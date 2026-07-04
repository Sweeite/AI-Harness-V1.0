// ISSUE-005 §8.5 (assertion target) — a faithful in-harness model of the `event_log` sink that
// records every login attempt + the threshold-crossing Super-Admin alert.
//
// Why in-harness, not the durable table: ISSUE-005 §5 scopes `event_log` as OBSERVED/ASSERTED —
// "the spike observes/asserts these writes; the durable schema is C7 / ISSUE-011". So this
// reproduces the SHAPE the observability assertion (step 5) reads against — every attempt logged,
// and a Super-Admin alert event raised on the soft-lock trip — and nothing more. Append-only:
// nothing is ever deleted (a security log that can drop rows is a #1/#3 violation).

export type EventType =
  | 'login_attempt' // one password-grant attempt (success or failure)
  | 'account_softlock' // per-account soft-lock tripped
  | 'mfa_softlock' // 2FA-challenge soft-lock tripped
  | 'super_admin_alert'; // the alert fired to the Super Admin on a lockout

export interface EventRow {
  seq: number;
  type: EventType;
  account: string; // the target account (email) — never the password
  sourceIp: string; // logical source-IP label (real or simulated multi-IP)
  outcome: 'success' | 'failure' | 'blocked' | 'alert';
  detail: string;
  at: string; // monotonic logical clock (durable rows are server-timestamptz, ISSUE-011)
}

/**
 * EventLog — append-only observability sink. Every login attempt lands here; a soft-lock trip
 * raises both a *_softlock row AND a super_admin_alert row. The red-team asserts BOTH:
 *   1. every attempt is logged (no silent failure — #3);
 *   2. the threshold crossing raised a Super-Admin alert (AC-0.AUTH.009.1 / AC-NFR-SEC.009.1).
 */
export class EventLog {
  private seq = 0;
  readonly rows: EventRow[] = [];

  private stamp(): string {
    return `t+${String(this.seq).padStart(4, '0')}`;
  }

  record(row: Omit<EventRow, 'seq' | 'at'>): EventRow {
    this.seq += 1;
    const full: EventRow = { seq: this.seq, at: this.stamp(), ...row };
    this.rows.push(full);
    return full;
  }

  // Convenience readers the assertions use.
  attempts(account?: string): EventRow[] {
    return this.rows.filter((r) => r.type === 'login_attempt' && (!account || r.account === account));
  }

  superAdminAlerts(account?: string): EventRow[] {
    return this.rows.filter((r) => r.type === 'super_admin_alert' && (!account || r.account === account));
  }

  hasSuperAdminAlert(account: string): boolean {
    return this.superAdminAlerts(account).length > 0;
  }
}
