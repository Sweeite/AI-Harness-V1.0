// ISSUE-006 §8 step 5 — the common reject path. Every failed verify → HTTP 401 + a guardrail_log row
// of type `prompt_injection` (ADR-007: webhook auth is a HARD control; a failed verify is treated as
// prompt-injection-class) + NO downstream task (AC-0.WHK.001.1, AC-NFR-SEC.008.1). Past the
// per-source failure_alert_threshold within the hour → escalate/alert (AC-NFR-SEC.008.1).

import { CFG } from './config.js';
import type { Connector, Sinks } from './sinks.js';

export interface VerifyOutcome {
  status: 200 | 401;
  guardrailLogId?: string;
  alerted?: boolean;
  note: string;
}

// Per-source failure counters (logical, within-the-hour). Real wiring is ISSUE-017; here it is a
// simple in-run counter sufficient to assert the threshold-alert AC.
const failureCounts = new Map<string, number>();
function bumpFailure(sourceKey: string): number {
  const n = (failureCounts.get(sourceKey) ?? 0) + 1;
  failureCounts.set(sourceKey, n);
  return n;
}

export function resetFailureCounts(): void {
  failureCounts.clear();
}

export function reject(
  sinks: Sinks,
  connector: Connector,
  sourceId: string | null,
  reason: string,
): VerifyOutcome {
  const sourceKey = `${connector}:${sourceId ?? 'unknown'}`;
  const failuresThisHour = bumpFailure(sourceKey);
  const pastThreshold = failuresThisHour > CFG.failure_alert_threshold;

  const row = sinks.logGuardrail({
    task_id: null, // no task — a rejected webhook creates NO downstream work
    guardrail_type: 'prompt_injection', // ADR-007: failed webhook verify → prompt_injection class
    description: `webhook verify FAILED [${connector}] ${reason}`,
    action_blocked: true,
    status: 'rejected',
    escalated_at: pastThreshold ? `alert:${sourceKey}` : null,
  });

  // AC-NFR-SEC.008.1: explicitly do NOT create a downstream task on reject.
  return {
    status: 401,
    guardrailLogId: row.id,
    alerted: pastThreshold,
    note: `401 — ${reason}${pastThreshold ? ` (past failure_alert_threshold=${CFG.failure_alert_threshold} for ${sourceKey} → ALERT)` : ''}`,
  };
}

// The accept counterpart — a verified webhook writes an event_log accept row and MAY create the
// downstream task (that task creation is what a forged/replayed event must never reach).
export function accept(
  sinks: Sinks,
  connector: Connector,
  eventId: string,
  summary: string,
  payload: unknown,
): VerifyOutcome {
  sinks.logEvent({
    task_id: null,
    event_type: 'webhook_verified_accept',
    entity_ids: [eventId],
    summary,
    payload,
  });
  sinks.createDownstreamTask(connector, `accepted verified webhook ${eventId}`);
  return { status: 200, note: `200 — verified accept ${eventId}` };
}

// A verified-but-replayed webhook is DROPPED: logged to event_log, but NO downstream task
// (AC-0.WHK.008.1 / AC-NFR-SEC.008.2 — does not re-trigger work).
export function replayDrop(
  sinks: Sinks,
  connector: Connector,
  eventId: string,
  summary: string,
): VerifyOutcome {
  sinks.logEvent({
    task_id: null,
    event_type: 'webhook_replay_drop',
    entity_ids: [eventId],
    summary,
    payload: null,
  });
  // NO createDownstreamTask — the whole point of dedup.
  return { status: 200, note: `dropped (replay) ${eventId} — no downstream work` };
}
