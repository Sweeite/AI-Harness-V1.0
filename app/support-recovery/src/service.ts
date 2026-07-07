// ISSUE-016 — the REC service layer: the intake path (FR-0.REC.001/.002), the notification fan-out
// (FR-0.REC.006), the status machine wrapper, and the scheduled stale-request re-escalation (FR-0.REC.007).
// Orchestrates the SupportStore + the EventSink / NotificationSink / AdminDirectory ports. Pure w.r.t. those
// ports (all side effects go through them), so the whole area is exercised offline against the in-memory fakes.

import {
  type SupportStore,
  type SupportRequestRow,
  type SupportStatus,
} from './store.ts';
import {
  type EventSink,
  type NotificationSink,
  type AdminDirectory,
  type NotifyOutcome,
  EV_SUPPORT_REQUEST_CREATED,
  EV_SUPPORT_NOTIFICATION_SENT,
  EV_SUPPORT_NOTIFICATION_FAILED,
  EV_SUPPORT_REESCALATION,
} from './sinks.ts';

/** The default stale threshold (minutes) for CFG-support.stale_request_minutes. The key itself is already
 *  registered in the ISSUE-010 config store (PERM-config.auth-gated); this is the fallback the sweep uses when
 *  no override is set. 30 min = a stuck user is re-surfaced within half an hour, never silently abandoned. */
export const CFG_SUPPORT_STALE_REQUEST_MINUTES = 'support.stale_request_minutes';
export const DEFAULT_STALE_REQUEST_MINUTES = 30;

export interface SupportServiceDeps {
  store: SupportStore;
  events: EventSink;
  notifications: NotificationSink;
  admins: AdminDirectory;
}

export interface IntakeResult {
  request: SupportRequestRow;
  notified: NotifyOutcome[];
}

export interface SweepResult {
  reescalated: SupportRequestRow[]; // the pending rows that were re-alerted this run
  notified: Map<string, NotifyOutcome[]>; // request_id → per-recipient outcome
}

export class SupportService {
  constructor(private deps: SupportServiceDeps) {}

  /**
   * FR-0.REC.002 + .006 — the public 3-field intake. Validates + inserts a `pending` row (store enforces the
   * three NOT NULL text fields), emits support_request_created, then notifies ALL Super Admin + Admin. A
   * notification delivery failure is logged (support_notification_failed) but does NOT roll back the request —
   * the row is filed and the failure is visible, never silent (#3). This is PUBLIC (pre-auth) — no authz gate.
   */
  async submitTroubleSigningIn(
    input: { email: string; name: string; issue_description: string },
    now: string,
  ): Promise<IntakeResult> {
    const request = await this.deps.store.insertRequest(input, now);
    await this.deps.events.emit({
      event_type: EV_SUPPORT_REQUEST_CREATED,
      entity_ids: [request.id],
      summary: `Login-support request from ${request.email} filed (pending)`,
      at: now,
    });
    const notified = await this.notify(request, /* escalation */ false, now);
    return { request, notified };
  }

  /**
   * FR-0.REC.006 — notify every current Super Admin + Admin. Emits support_notification_sent for each
   * delivered recipient and support_notification_failed for each drop (so a dropped alert can never hide a
   * stuck user). Returns the per-recipient outcomes.
   */
  private async notify(request: SupportRequestRow, escalation: boolean, now: string): Promise<NotifyOutcome[]> {
    const recipients = await this.deps.admins.superAdminsAndAdmins();
    const outcomes = await this.deps.notifications.notifyAdmins(recipients, request, escalation);
    const delivered = outcomes.filter((o) => o.delivered).map((o) => o.user_id);
    const failed = outcomes.filter((o) => !o.delivered);
    if (delivered.length > 0) {
      await this.deps.events.emit({
        event_type: EV_SUPPORT_NOTIFICATION_SENT,
        entity_ids: [request.id],
        summary: `${escalation ? 'Re-escalation' : 'New-request'} notification delivered to ${delivered.length} admin(s) for support request ${request.id}`,
        at: now,
      });
    }
    for (const f of failed) {
      // Never swallow a dropped alert (#3) — one failure event per undelivered recipient.
      await this.deps.events.emit({
        event_type: EV_SUPPORT_NOTIFICATION_FAILED,
        entity_ids: [request.id],
        summary: `Notification delivery FAILED to admin ${f.user_id} for support request ${request.id} (${f.error ?? 'unknown'}) — stuck user must not be hidden`,
        at: now,
      });
    }
    return outcomes;
  }

  /**
   * FR-0.REC.005 — the status transition wrapper. Delegates the PERM-support.resolve gate + the legal-move /
   * immutable-history enforcement to the store; the actor + timestamp are recorded in the transition history.
   */
  async transition(actorId: string, requestId: string, to: SupportStatus, now: string): Promise<SupportRequestRow> {
    return this.deps.store.transition(actorId, requestId, to, now);
  }

  /**
   * FR-0.REC.007 — the scheduled stale-request re-escalation. Over every `pending` request older than
   * `staleMinutes` (CFG-support.stale_request_minutes), re-alert all Super Admin + Admin (escalation) and emit
   * support_reescalation. Read-only over the requests (never mutates status) so a never-picked-up request
   * KEEPS re-alerting each run rather than vanishing silently (#3, bounded by the sweep cadence). Runs as
   * the postgres owner (RLS-bypass) (no auth.uid()) off the RLS path (ADR-006 — runtime role = postgres owner per OD-193).
   */
  async runStaleSweep(now: string, staleMinutes: number = DEFAULT_STALE_REQUEST_MINUTES): Promise<SweepResult> {
    const cutoff = new Date(new Date(now).getTime() - staleMinutes * 60_000).toISOString();
    const stale = await this.deps.store.pendingOlderThan(cutoff);
    const notified = new Map<string, NotifyOutcome[]>();
    for (const request of stale) {
      await this.deps.events.emit({
        event_type: EV_SUPPORT_REESCALATION,
        entity_ids: [request.id],
        summary: `Support request ${request.id} still pending past ${staleMinutes}m — re-escalating to Super Admin + Admin`,
        at: now,
      });
      const outcomes = await this.notify(request, /* escalation */ true, now);
      notified.set(request.id, outcomes);
    }
    return { reescalated: stale, notified };
  }
}
