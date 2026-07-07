// ISSUE-075 §8 steps 2,4,5,7,8 — the alert-delivery ENGINE that ties the seven rules to routing,
// escalation, durable persistence, best-effort Slack fan-out, and the every-alert-logged audit path. This
// is the FR spine of the slice; every ordering here upholds a #3 invariant:
//
//   • dashboard-persisted-FIRST + independently, BEFORE any Slack fan-out (FR-7.ALR.006 / NFR-OBS.009)
//   • event_log row appended INDEPENDENT of delivery outcome (FR-7.ALR.004 / NFR-OBS.016)
//   • route-by-type through the C1 role model; an unresolvable target ESCALATES, never drops
//     (FR-7.ALR.003 → NFR-OBS.008); if it resolves to NO deliverable destination at all, raise the distinct
//     "alert delivery misconfigured" CRITICAL to Super Admin + carry it on the mgmt-plane push
//     (AC-7.ALR.009.1, reusing the watchdog health-bit path)
//   • escalation-window → secondary alert on no-ack; a critical/hard-limit alert is NEVER auto-resolved
//     by timeout (FR-7.ALR.005); ALL window/staleness math uses ONE server-authoritative clock (AC-7.ALR.005.3)
//   • quiet-hours suppresses ONLY non-critical alerts (AC-7.ALR.009.2)
//   • a failed / runtime-invalid Slack webhook is surfaced as a delivery-failure, dashboard unaffected
//     (AC-7.ALR.006.2 / AC-7.ALR.009.4)

import type {
  AlertConfig,
  AlertEventType,
  AlertType,
  DeliveryState,
  NotificationRow,
  RoleResolver,
  Severity,
} from "./types.ts";
import { isCriticalType, resolveContact } from "./types.ts";
import {
  type AlertConfigStore,
  type AlertEventLogStore,
  type NotificationStore,
  type SlackClient,
  SlackDeliveryFailure,
} from "./store.ts";
import type { RaisedAlert } from "./rules.ts";
import { hasResolvableDestination, quietHoursSuppresses } from "./config-validation.ts";

/** The mgmt-plane health-bit channel (ISSUE-011 pattern) — a misconfigured/unroutable silo latches a bit
 *  the ADR-001 §7 push CARRIES, so a fully-mis-configured silo still surfaces on the Super Admin grid. */
export interface HealthBitChannel {
  set(bit: "alert_delivery_misconfigured", value: boolean): void;
  snapshot(): { alert_delivery_misconfigured: boolean };
}

export class InMemoryHealthBitChannel implements HealthBitChannel {
  private bit = false;
  set(_bit: "alert_delivery_misconfigured", value: boolean): void {
    this.bit = value;
  }
  snapshot(): { alert_delivery_misconfigured: boolean } {
    return { alert_delivery_misconfigured: this.bit };
  }
}

export interface EngineDeps {
  notifications: NotificationStore;
  eventLog: AlertEventLogStore;
  configStore: AlertConfigStore;
  roles: RoleResolver;
  slack: SlackClient;
  health: HealthBitChannel;
  /** server-authoritative clock (ms). The SINGLE source of window/staleness truth (AC-7.ALR.005.3 / AF-120). */
  now: () => number;
  /** deterministic id generator. */
  newId: () => string;
}

/** The map alert_type → the event_log event_type this slice appends (FR-7.ALR.004). */
const EVENT_TYPE_FOR: Record<AlertType, AlertEventType> = {
  task_failure_spike: "task_failure_spike",
  queue_backup: "queue_backup",
  memory_confidence_drop: "memory_confidence_drop",
  approval_queue_stale: "approval_queue_stale",
  cost_threshold_breach: "cost_threshold_breach",
  loop_missed: "loop_missed",
  hard_limit_hit: "guardrail_hit", // the hard-limit's event_log counterpart (paired with guardrail_log)
  proactive: "loop_missed", // not raised by this slice's rules; mapped defensively
  alert_delivery_misconfigured: "guardrail_hit", // the misconfigured-critical still audits
  alert_engine_stalled: "guardrail_hit",
};

export interface DeliveryOutcome {
  notification: NotificationRow;
  /** the recipient the alert resolved to, or null when it was unroutable (→ misconfigured critical raised). */
  resolvedRecipient: string | null;
  slackAttempted: boolean;
  slackOk: boolean;
  slackError: string | null;
  /** set when the unroutable-fails-loud path fired: the id of the raised misconfigured-critical. */
  misconfiguredCriticalId?: string;
  /** true when quiet-hours suppressed the fan-out (dashboard row still persisted). */
  quietSuppressed: boolean;
}

export class AlertEngine {
  constructor(private readonly deps: EngineDeps) {}

  private iso(nowMs: number): string {
    return new Date(nowMs).toISOString();
  }

  /**
   * Deliver ONE raised alert end-to-end. The ordering is load-bearing:
   *   1. persist the durable dashboard notification (FIRST, independent of anything downstream)
   *   2. append the event_log audit row (independent of delivery outcome)
   *   3. resolve the recipient via routing; if unroutable → raise the misconfigured-critical (fails loud)
   *   4. quiet-hours gate (only non-critical suppressed)
   *   5. best-effort Slack fan-out off the persisted row; a failure is surfaced, never fatal
   */
  async deliver(alert: RaisedAlert, opts: { nowMin?: number } = {}): Promise<DeliveryOutcome> {
    const nowMs = this.deps.now();
    const config = await this.deps.configStore.read();

    // ── 1. dashboard-first persist (FR-7.ALR.006 / NFR-OBS.009.1) ──────────────────────────────────
    const recipient = this.resolveRecipient(alert, config);
    const row = await this.deps.notifications.create(
      {
        type: alert.type,
        severity: alert.severity,
        title: alert.title,
        body: alert.body,
        recipient: recipient ?? null,
        recipient_role: config.alert_routing_rules[alert.type]?.role ?? null,
      },
      this.deps.newId(),
      this.iso(nowMs),
    );

    // ── 2. event_log audit row — independent of delivery (FR-7.ALR.004 / NFR-OBS.016) ─────────────
    await this.deps.eventLog.append({
      id: this.deps.newId(),
      task_id: null,
      event_type: EVENT_TYPE_FOR[alert.type],
      entity_ids: alert.entityId ? [alert.entityId] : null,
      summary: `Alert raised: ${alert.title} (${alert.type}) — logged independent of delivery.`,
      payload: { alert_type: alert.type, severity: alert.severity, notification_id: row.id },
      duration_ms: null,
      cost_tokens: null,
      cost_unknown: false,
      answer_mode: null,
      redacted_at: null,
      created_at: this.iso(nowMs),
    });

    const outcome: DeliveryOutcome = {
      notification: row,
      resolvedRecipient: recipient,
      slackAttempted: false,
      slackOk: false,
      slackError: null,
      quietSuppressed: false,
    };

    // ── 3. unroutable → FAIL LOUD (AC-7.ALR.009.1 / AC-NFR-OBS.008.1) ──────────────────────────────
    // The alert itself already persists on the always-present dashboard (step 1). If it has NO deliverable
    // destination, raise a DISTINCT misconfigured critical to Super Admin + latch the mgmt-plane bit.
    // logic-sweep fix (engine.ts:156): the `recipient` computed at step 1 is the GROUND TRUTH of routability —
    // it already covers the direct-to-reviewer stale-approval path (resolveRecipient short-circuits on
    // approvalReviewer). hasResolvableDestination only inspects the routing rule + escalation chain and IGNORES
    // that direct recipient, so a correctly-delivered stale-approval with no (non-required) approval_queue_stale
    // rule would spuriously trip this #2/#3 critical. Gate on recipient === null — matching the DeliveryOutcome
    // contract (resolvedRecipient is null iff unroutable). Only a genuinely-unroutable alert fails loud here.
    if (recipient === null && !hasResolvableDestination(alert.type, config, this.deps.roles)) {
      const critId = await this.raiseMisconfiguredCritical(alert, nowMs);
      outcome.misconfiguredCriticalId = critId;
      // A misconfigured NON-critical alert is not itself further delivered; the loud signal is the critical.
      return outcome;
    }

    // ── 4. quiet-hours gate — only non-critical suppressed (AC-7.ALR.009.2) ────────────────────────
    if (opts.nowMin !== undefined && quietHoursSuppresses(alert.type, config, opts.nowMin)) {
      outcome.quietSuppressed = true; // dashboard row already persisted; fan-out withheld for noise-control
      return outcome;
    }

    // ── 5. best-effort Slack fan-out off the persisted row (AC-7.ALR.006 / AC-7.ALR.009.4) ─────────
    await this.fanOutSlack(row, alert, config, outcome);
    return outcome;
  }

  /** The C6 hard-limit seam (AC-7.ALR.007.1): a C6 event → immediate C7 dashboard + Slack alert, always. */
  async deliverHardLimit(limitName: string, taskId: string | null): Promise<DeliveryOutcome> {
    // never quiet-suppressed (critical), never suppressible — delivered immediately.
    return this.deliver(
      {
        type: "hard_limit_hit",
        severity: "critical",
        title: "Hard limit hit",
        body: `Hard limit '${limitName}' was hit — immediate dashboard + Slack alert (C6 event → C7 delivery).`,
        entityId: taskId,
      },
      {},
    );
  }

  /** The C5 stale-approval seam (AC-7.ALR.007.2 / AC-7.ALR.003.1): to the SPECIFIC reviewer, not broadcast. */
  async deliverStaleApproval(
    itemId: string,
    reviewer: string | null,
    waitedMs: number,
  ): Promise<DeliveryOutcome> {
    return this.deliver({
      type: "approval_queue_stale",
      severity: "warning",
      title: "Approval waiting too long",
      body: `Approval item ${itemId} has waited ${waitedMs} ms; delivered directly to its reviewer.`,
      entityId: itemId,
      approvalReviewer: reviewer,
    });
  }

  /**
   * The escalation-window → secondary-alert chain (FR-7.ALR.005). Given a persisted, still-unactioned
   * notification whose escalation window has expired, fire the NEXT recipient in the chain. A critical /
   * hard-limit alert that exhausts its chain stays persistently unresolved + visibly escalated — NEVER
   * auto-cleared (AC-7.ALR.005.2). Returns the secondary notification raised, or null if none was due.
   *
   * `windowMs` is the configurable escalation window; all math is on the injected server clock (AC-7.ALR.005.3).
   */
  async runEscalation(notificationId: string, windowMs: number): Promise<NotificationRow | null> {
    const nowMs = this.deps.now();
    const row = await this.deps.notifications.get(notificationId);
    if (!row) throw new Error(`notification ${notificationId} not found`);

    // Actioned → nothing to escalate (the human closed it). A critical alert is NEVER auto-resolved by
    // timeout — we only ever ADD a louder alert; we never flip an unactioned critical to resolved.
    if (row.read_state === "actioned") return null;

    const anchorMs = Date.parse(row.escalated_at ?? row.created_at);
    if (nowMs - anchorMs < windowMs) return null; // window not yet expired — no secondary alert

    const config = await this.deps.configStore.read();
    const role = row.recipient_role;
    const chain = role ? config.escalation_contacts[role] ?? [] : [];

    // Which chain step fires next?
    //  • On the FIRST escalation (escalation_state === null) the chain starts explicitly AFTER the primary,
    //    regardless of which holder the primary resolved to. The primary is NOT assumed to be chain[0] — a role
    //    can resolve to a holder that isn't chain[0], so we scan from the top and only skip a leading contact
    //    that resolves to the SAME recipient the primary already reached. Otherwise chain[0] itself would be
    //    silently skipped on the first escalation (AC-7.ALR.005.1).
    //  • On a subsequent escalation, escalation_state encodes the last-fired index; advance by one.
    const nextStep =
      row.escalation_state === null
        ? this.firstChainStepAfterPrimary(chain, row.recipient)
        : parseChainStep(row.escalation_state) + 1;

    if (nextStep >= chain.length) {
      // Chain exhausted. Critical/hard-limit → stay persistently unresolved + visibly escalated (never
      // auto-cleared, AC-7.ALR.005.2). We mark it exhausted-but-open; it remains unread/unactioned.
      if (isCriticalType(row.type)) {
        await this.deps.notifications.escalate(notificationId, "exhausted", this.iso(nowMs));
        return null; // no next recipient, but the alert stays loud + open (not resolved)
      }
      // non-critical, chain exhausted → mark exhausted; leave it open (still not silently dropped).
      await this.deps.notifications.escalate(notificationId, "exhausted", this.iso(nowMs));
      return null;
    }

    // Fire the secondary alert to the next recipient in the chain. A chain entry is a resolvable user id OR a
    // role name (config-validation only guarantees SOME entry in the chain resolves, not every entry) — scan
    // forward from nextStep for the first entry that actually resolves to someone, same fail-closed skip
    // resolveRecipient uses, rather than writing an unresolved role string into the uuid recipient column.
    let fireStep = nextStep;
    let nextRecipient: string | null = null;
    while (fireStep < chain.length) {
      const resolved = resolveContact(chain[fireStep]!, this.deps.roles);
      if (resolved !== null) {
        nextRecipient = resolved;
        break;
      }
      fireStep++;
    }
    if (nextRecipient === null) {
      // No remaining chain entry resolves to anyone — same handling as an exhausted chain.
      await this.deps.notifications.escalate(notificationId, "exhausted", this.iso(nowMs));
      return null;
    }
    // Create the secondary WITH its chain step stamped in the same write (rather than a follow-up UPDATE) —
    // a crash after this call simply never created the secondary (safe to retry next window check); it can
    // no longer leave a persisted secondary row indistinguishable from a fresh, never-escalated primary.
    const secondary = await this.deps.notifications.create(
      {
        type: row.type,
        severity: row.severity,
        title: `Escalated: ${row.title}`,
        body: `No acknowledgement within the escalation window (${windowMs} ms); escalated to ${nextRecipient}.`,
        recipient: nextRecipient,
        recipient_role: role,
        escalation_state: `step:${fireStep}`,
      },
      this.deps.newId(),
      this.iso(nowMs),
    );
    await this.deps.notifications.escalate(notificationId, `step:${fireStep}`, this.iso(nowMs));
    // audit the escalation itself (independent of delivery).
    await this.deps.eventLog.append({
      id: this.deps.newId(),
      task_id: null,
      event_type: EVENT_TYPE_FOR[row.type],
      entity_ids: null,
      summary: `Alert escalated: no ack within ${windowMs} ms → secondary alert to ${nextRecipient}.`,
      // logic-sweep fix: audit the step ACTUALLY fired (fireStep), not the pre-scan nextStep. When a leading
      // chain entry is unresolvable the scan advances fireStep past it; recording nextStep understated the
      // reached step and contradicted the value persisted on the row/secondary (escalation-off-by-one finding).
      payload: { primary: notificationId, secondary: secondary.id, step: fireStep },
      duration_ms: null,
      cost_tokens: null,
      cost_unknown: false,
      answer_mode: null,
      redacted_at: null,
      created_at: this.iso(nowMs),
    });
    // logic-sweep fix: return the step ACTUALLY fired (fireStep), matching what was persisted on line 289 and
    // stamped on the primary — not the pre-scan nextStep, which contradicts the row when a leading entry is skipped.
    return { ...secondary, escalation_state: `step:${fireStep}` };
  }

  // ── internals ──────────────────────────────────────────────────────────────────────────────────────

  /**
   * The chain index the FIRST escalation should fire — explicitly the step AFTER the primary recipient,
   * regardless of which holder the primary resolved to. We do NOT assume the primary is chain[0]: a routed
   * role can resolve to a holder that is not chain[0] (or the primary came via a later chain entry). We skip a
   * leading run of chain contacts that resolve to the SAME recipient the primary already reached, and return
   * the first index whose recipient differs — so chain[0] is never silently skipped when it wasn't the primary.
   */
  private firstChainStepAfterPrimary(chain: readonly string[], primary: string | null): number {
    let i = 0;
    while (i < chain.length && resolveContact(chain[i]!, this.deps.roles) === primary) i++;
    return i;
  }

  private resolveRecipient(alert: RaisedAlert, config: AlertConfig): string | null {
    // stale-approval routes to the SPECIFIC reviewer (AC-7.ALR.003.1), never broadcast.
    if (alert.type === "approval_queue_stale" && alert.approvalReviewer) {
      return alert.approvalReviewer;
    }
    const rule = config.alert_routing_rules[alert.type];
    if (!rule) return null;
    const holders = this.deps.roles.usersForRole(rule.role);
    if (holders.length > 0) return holders[0]!; // first holder of the routed role (C1 owns who)
    // role unresolvable → try the escalation chain's first contact that resolves to an ACTUAL recipient
    // (escalate-don't-drop). A role-shaped dead string nobody holds resolves to null and is SKIPPED — a
    // critical alert is never silently routed to a string no one holds (fail-closed; AC-NFR-OBS.008.1).
    const chain = config.escalation_contacts[rule.role] ?? [];
    for (const contact of chain) {
      const resolved = resolveContact(contact, this.deps.roles);
      if (resolved !== null) return resolved;
    }
    return null; // genuinely unroutable → the caller raises the misconfigured critical
  }

  private async raiseMisconfiguredCritical(source: RaisedAlert, nowMs: number): Promise<string> {
    // Route the misconfigured critical to Super Admin explicitly; latch the mgmt-plane bit so a fully
    // mis-configured silo still surfaces on the Super Admin grid (AC-7.ALR.009.1, watchdog path).
    const id = this.deps.newId();
    await this.deps.notifications.create(
      {
        type: "alert_delivery_misconfigured",
        severity: "critical",
        title: "Alert delivery misconfigured",
        body:
          `An alert of type '${source.type}' resolved to NO deliverable destination — routing is misconfigured. ` +
          `The original alert persists on the dashboard; this critical is routed to Super Admin and carried on the mgmt-plane push.`,
        recipient: null,
        recipient_role: "super_admin",
      },
      id,
      this.iso(nowMs),
    );
    await this.deps.eventLog.append({
      id: this.deps.newId(),
      task_id: null,
      event_type: "guardrail_hit",
      entity_ids: null,
      summary: `Alert delivery misconfigured: '${source.type}' had no deliverable destination — critical raised to Super Admin.`,
      payload: { source_type: source.type, misconfigured_critical: id },
      duration_ms: null,
      cost_tokens: null,
      cost_unknown: false,
      answer_mode: null,
      redacted_at: null,
      created_at: this.iso(nowMs),
    });
    this.deps.health.set("alert_delivery_misconfigured", true); // carried on the mgmt-plane push
    return id;
  }

  private async fanOutSlack(
    row: NotificationRow,
    _alert: RaisedAlert,
    config: AlertConfig,
    outcome: DeliveryOutcome,
  ): Promise<void> {
    const rule = config.alert_routing_rules[row.type];
    const wantsSlack = rule?.channels.includes("slack") ?? false;
    if (!wantsSlack) return; // this type isn't configured to fan out to Slack — dashboard is enough.
    if (!config.slack_webhook_present) {
      // configured-to-slack but no webhook present → a delivery-failure condition, surfaced (AC-7.ALR.009.4).
      await this.surfaceSlackFailure(row, "SLACK_WEBHOOK_URL missing", outcome);
      return;
    }
    outcome.slackAttempted = true;
    try {
      await this.deps.slack.send(row.title, row.body);
      outcome.slackOk = true;
      const state: DeliveryState = { slack_attempted: true, slack_ok: true, slack_error: null };
      await this.deps.notifications.setDeliveryState(row.id, state);
    } catch (err) {
      const cause = err instanceof SlackDeliveryFailure ? err.message : String(err);
      await this.surfaceSlackFailure(row, cause, outcome);
    }
  }

  /** A failed / invalid Slack delivery is SURFACED onto the durable row's delivery_state — the dashboard
   *  notification is untouched (AC-7.ALR.006.1/.2 / AC-7.ALR.009.4). Never silently swallowed. */
  private async surfaceSlackFailure(
    row: NotificationRow,
    cause: string,
    outcome: DeliveryOutcome,
  ): Promise<void> {
    outcome.slackAttempted = true;
    outcome.slackOk = false;
    outcome.slackError = cause;
    const state: DeliveryState = { slack_attempted: true, slack_ok: false, slack_error: cause };
    await this.deps.notifications.setDeliveryState(row.id, state);
  }
}

function parseChainStep(escalationState: string): number {
  // "step:N" → N; "exhausted" or anything else → treat as the last known step (no restart).
  const m = /^step:(\d+)$/.exec(escalationState);
  return m ? Number(m[1]) : 0;
}

// re-export severities used by callers building RaisedAlerts.
export type { Severity };
