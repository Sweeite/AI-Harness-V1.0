// ISSUE-017 §8 step 4/5 — the common outcome paths, productionised from the AF-078 spike's reject.ts
// with the real store-backed alert + throttle wiring the spike deferred to this issue.
//
//   reject()     — a failed verify → HTTP 401 + guardrail_log(`prompt_injection`) (ADR-007) + NO
//                  downstream task (AC-0.WHK.001.1 / AC-NFR-SEC.008.1). Bumps the per-source
//                  failure count; PAST `failure_alert_threshold`/hour → alert all Super Admins +
//                  auto-throttle the source (AC-0.WHK.005.2).
//   accept()     — a verified webhook → event_log accept row → hand the verified payload downstream
//                  (the C2/C3 seam). Bumps the per-source accept count; OVER `accept_rate_limit`/min
//                  → throttle the source + log a rate_throttle event, and DO NOT hand off the excess
//                  (AC-0.WHK.008.2).
//   replayDrop() — a verified-but-replayed event → event_log drop row, NO downstream task
//                  (AC-0.WHK.008.1 / AC-NFR-SEC.008.2).
//   throttled()  — the source is currently auto-throttled → 429, no verification work, no task.

import type { Connector, WebhookStore } from './store.js';
import type { WebhookConfig } from './config.js';

export type HttpStatus = 200 | 401 | 429;

export interface VerifyOutcome {
  status: HttpStatus;
  /** The verified payload, handed off to the ingesting component (C2/C3) — present only on accept. */
  verifiedPayload?: unknown;
  connector: Connector;
  eventId?: string;
  guardrailLogId?: string;
  alerted: boolean;
  throttled: boolean;
  note: string;
}

// The auto-throttle duration when a threshold is breached. Sources stay throttled for the trailing
// window they misbehaved in (an hour for failure floods, matching the failure counter window).
const THROTTLE_SECONDS = 3600;

export async function reject(
  store: WebhookStore,
  cfg: WebhookConfig,
  connector: Connector,
  sourceId: string,
  now: number,
  reason: string,
): Promise<VerifyOutcome> {
  const failuresThisHour = await store.bumpFailure(sourceId, now);
  const pastThreshold = failuresThisHour > cfg.failure_alert_threshold; // "> 3" — alert on the 4th

  const row = await store.logGuardrail({
    task_id: null, // a rejected webhook creates NO downstream work
    guardrail_type: 'prompt_injection', // ADR-007: a failed webhook verify is injection-class
    // The source identity + reason live in the description; escalated_at is a timestamptz (schema.md
    // L505), set to the escalation time when past threshold — NOT a label.
    description: `webhook verify FAILED [${connector}] source=${sourceId} — ${reason}`,
    action_blocked: true,
    status: 'rejected',
    escalated_at: pastThreshold ? new Date(now * 1000).toISOString() : null,
  });

  if (pastThreshold) {
    await store.alertSuperAdmins({ source_id: sourceId, connector, failures_this_hour: failuresThisHour, reason });
    await store.throttleSource(sourceId, now, THROTTLE_SECONDS);
  }

  return {
    status: 401,
    connector,
    guardrailLogId: row.id,
    alerted: pastThreshold,
    throttled: pastThreshold,
    note:
      `401 — ${reason}` +
      (pastThreshold ? ` (>${cfg.failure_alert_threshold} failures/hr for ${sourceId} → Super-Admin ALERT + auto-throttle)` : ''),
  };
}

export async function accept(
  store: WebhookStore,
  cfg: WebhookConfig,
  connector: Connector,
  sourceId: string,
  now: number,
  eventId: string,
  payload: unknown,
): Promise<VerifyOutcome> {
  const acceptsThisMinute = await store.bumpAccept(sourceId, now);
  if (acceptsThisMinute > cfg.accept_rate_limit) {
    // Over the per-source accept-rate limit — throttle + log; the excess is NOT handed downstream.
    await store.throttleSource(sourceId, now, 60);
    await store.logEvent({
      task_id: null,
      event_type: 'webhook_rate_throttled', // event_type enum value — added via change-control OD-179
      entity_ids: [eventId],
      summary: `verified webhook from ${sourceId} exceeded accept_rate_limit=${cfg.accept_rate_limit}/min — throttled`,
      payload: null,
    });
    return {
      status: 429,
      connector,
      eventId,
      alerted: false,
      throttled: true,
      note: `429 — verified but over accept_rate_limit=${cfg.accept_rate_limit}/min for ${sourceId} → throttled, not handed off`,
    };
  }

  await store.logEvent({
    task_id: null,
    event_type: 'webhook_verified', // event_type enum value — added via change-control OD-179
    entity_ids: [eventId],
    summary: `verified webhook accepted [${connector}] ${eventId}`,
    payload,
  });
  return {
    status: 200,
    connector,
    eventId,
    verifiedPayload: payload, // ← the seam: handed to the ingesting component (ISSUE-037/026)
    alerted: false,
    throttled: false,
    note: `200 — verified accept ${eventId}`,
  };
}

export async function replayDrop(
  store: WebhookStore,
  connector: Connector,
  eventId: string,
  summary: string,
): Promise<VerifyOutcome> {
  await store.logEvent({
    task_id: null,
    event_type: 'webhook_replay_dropped', // event_type enum value — added via change-control OD-179
    entity_ids: [eventId],
    summary,
    payload: null,
  });
  // NO downstream task — the whole point of dedup (AC-0.WHK.008.1 / AC-NFR-SEC.008.2).
  return { status: 200, connector, eventId, alerted: false, throttled: false, note: `dropped (replay) ${eventId} — no downstream work` };
}

export function throttled(connector: Connector, sourceId: string): VerifyOutcome {
  return {
    status: 429,
    connector,
    alerted: false,
    throttled: true,
    note: `429 — source ${sourceId} is auto-throttled; request dropped without verification work`,
  };
}
