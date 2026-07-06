// ISSUE-016 — the observability + notification sink PORTS this slice EMITS into. Per issue §5 "Out", the
// alert-engine + notification centre (ISSUE-075/076, C7) and the event_log/audit sink schema/retention (C7)
// are NOT owned here — this slice only WRITES the records and relies on those channels. Modelling them as thin
// ports keeps the intake/notify/sweep logic unit-testable offline while the live adapters fan out to the real
// notifications table + event_log + access_audit.
//
// #3 (never fail silently): every sink call is awaited and a DELIVERY FAILURE is itself logged (FR-0.REC.006
// edge). A dropped notification must never hide a stuck user — so notifyAdmins returns a per-recipient
// outcome and the service logs a notification-sent event AND, on any failure, a delivery-failure event.

import type { SupportRequestRow } from './store.ts';

// ── event_type values this slice writes (0001_baseline.sql event_type enum) ─────────────────────────
// NOTE: these three values are NOT yet in the baseline event_type enum — they are PROPOSED additions in
// results/proposed-shared-spec.md (the orchestrator applies the enum ALTER serially). They are modelled as
// string constants here so the fake + live adapter agree on the exact event_type each write uses.
export const EV_SUPPORT_REQUEST_CREATED = 'support_request_created'; // FR-0.REC.002
export const EV_SUPPORT_NOTIFICATION_SENT = 'support_notification_sent'; // FR-0.REC.006
export const EV_SUPPORT_NOTIFICATION_FAILED = 'support_notification_failed'; // FR-0.REC.006 edge (#3)
export const EV_SUPPORT_REESCALATION = 'support_reescalation'; // FR-0.REC.007

/** The alert_type the C7 notification carries. Also a PROPOSED addition (results/proposed-shared-spec.md). */
export const ALERT_SUPPORT_REQUEST = 'support_request';

export interface EventRecord {
  event_type: string;
  entity_ids: string[]; // the support_requests.id(s) the event concerns
  summary: string; // plain-English; NEVER empty (mirrors event_log.summary NOT NULL — AC-7.LOG.002.2)
  at: string;
}

/** Append-only event sink (→ event_log). The fake enforces summary-not-empty EXACTLY as the DDL's NOT NULL. */
export interface EventSink {
  emit(rec: EventRecord): Promise<void>;
}

export class InMemoryEventSink implements EventSink {
  events: EventRecord[] = [];
  async emit(rec: EventRecord): Promise<void> {
    if (!rec.summary || rec.summary.trim().length === 0) {
      throw new Error(`event_log.summary is NOT NULL and never empty (AC-7.LOG.002.2) — event_type=${rec.event_type}`);
    }
    this.events.push({ ...rec, entity_ids: [...rec.entity_ids] });
  }
  ofType(t: string): EventRecord[] {
    return this.events.filter((e) => e.event_type === t);
  }
}

// ── Notification channel (→ notifications table + C7 fan-out) ────────────────────────────────────────
/** The set of admin recipients a support event notifies: ALL Super Admin + Admin users (FR-0.REC.006). The
 *  resolution of "who is Super Admin / Admin right now" is an ISSUE-018/C1 read; this port takes the resolved
 *  recipient id list so this slice stays off the role tables it does not own. */
export interface AdminRecipient {
  user_id: string;
  role: 'Super Admin' | 'Admin';
}

export interface NotifyOutcome {
  user_id: string;
  delivered: boolean;
  error?: string;
}

/** Notification sink → the C7 channel. notifyAdmins fans out to every recipient and returns a per-recipient
 *  outcome so the caller can log a delivery failure (never let a dropped alert hide a stuck user, #3). */
export interface NotificationSink {
  notifyAdmins(recipients: AdminRecipient[], request: SupportRequestRow, escalation: boolean): Promise<NotifyOutcome[]>;
}

export class InMemoryNotificationSink implements NotificationSink {
  sent: Array<{ user_id: string; request_id: string; escalation: boolean }> = [];
  /** Test seam: recipients whose delivery should fail (models a dropped C7 push). */
  failFor = new Set<string>();

  async notifyAdmins(recipients: AdminRecipient[], request: SupportRequestRow, escalation: boolean): Promise<NotifyOutcome[]> {
    return recipients.map((r) => {
      if (this.failFor.has(r.user_id)) {
        return { user_id: r.user_id, delivered: false, error: 'channel_unavailable' };
      }
      this.sent.push({ user_id: r.user_id, request_id: request.id, escalation });
      return { user_id: r.user_id, delivered: true };
    });
  }
}

/** Resolver for the current Super-Admin+Admin recipient set (an ISSUE-018/C1 read; a port here). */
export interface AdminDirectory {
  superAdminsAndAdmins(): Promise<AdminRecipient[]>;
}

export class InMemoryAdminDirectory implements AdminDirectory {
  private admins: AdminRecipient[] = [];
  async superAdminsAndAdmins(): Promise<AdminRecipient[]> {
    return this.admins.map((a) => ({ ...a }));
  }
  add(user_id: string, role: 'Super Admin' | 'Admin'): this {
    this.admins.push({ user_id, role });
    return this;
  }
}
