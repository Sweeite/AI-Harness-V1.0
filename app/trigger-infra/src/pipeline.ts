// ISSUE-037 §8.1–§8.4 — THE inbound trigger pipeline (FR-3.TRIG.001 handler + FR-3.TRIG.004 scheme gate
// + FR-3.TRIG.003 default-toggle gate + FR-3.TRIG.002 runtime rule evaluation → task launch at the C5
// seam). This is the once-per-connector handler the whole slice converges on.
//
// Order of gates (each fail-closed, #2/#3):
//   1. `verified` defence-in-depth — an event not flagged verified is REFUSED (C0 should never hand one).
//   2. per-vendor ARM gate — a connector whose viability AF is not GREEN is HELD; we do NOT pretend to
//      process it (the generic machinery is proven; the concrete vendor arm is not). Configurable so the
//      generic pipeline is testable without a live arm.
//   3. dedup on the connector's rawEventId (defence-in-depth over C0's replay drop) — a re-delivery fires
//      nothing twice (ADR-004 at-least-once → exactly-once effect).
//   4. parse → NormalizedEvent, else LOG `trigger_parse_failed` + reject (AC-3.TRIG.001.2, never silent).
//   5. default-trigger toggle gate — a disabled default trigger fires nothing (AC-3.TRIG.003.2).
//   6. rule evaluation — every enabled rule whose conditions match launches its task (AC-3.TRIG.002.1);
//      no match ⇒ no launch (AC-3.TRIG.002.2).

import type { Connector, VerifiedEvent } from './seam.js';
import {
  type TriggerStore,
  type NormalizedEvent,
  EVT_TRIGGER_INBOUND,
  EVT_TRIGGER_PARSE_FAILED,
  EVT_TRIGGER_FIRED,
} from './store.js';
import { parserFor } from './parser.js';
import { isArmReady, schemeFor } from './scheme.js';
import { ruleMatches } from './config.js';

/** The C5 launch seam: this slice hands a matched (taskName, normalized event) to task launch (ISSUE-047+).
 *  Injected so this slice never reaches into C5; it only DECIDES to launch and hands off. */
export type LaunchTask = (taskName: string, ev: NormalizedEvent, now: number) => Promise<void>;

export type InboundResult =
  | { outcome: 'refused_unverified' }
  | { outcome: 'arm_held'; connector: Connector; gatingAFs: readonly string[] }
  | { outcome: 'duplicate'; rawEventId: string }
  | { outcome: 'parse_failed'; reason: string }
  | { outcome: 'no_default_trigger'; eventName: string }
  | { outcome: 'default_disabled'; eventName: string }
  | { outcome: 'processed'; eventName: string; launched: string[] };

export interface HandleDeps {
  store: TriggerStore;
  launch: LaunchTask;
  /** Override the per-vendor arm gate for testing the GENERIC pipeline. Default = the SCHEME_TABLE arm
   *  state (all held in this slice). Passing `() => true` proves the generic path end-to-end offline
   *  WITHOUT claiming any vendor arm is live — the arms stay held in the shipped table (#2). */
  armReady?: (connector: Connector) => boolean;
}

export async function handleInbound(ev: VerifiedEvent, deps: HandleDeps, now: number): Promise<InboundResult> {
  const { store, launch } = deps;
  const armReady = deps.armReady ?? isArmReady;

  // 1. Defence-in-depth verified check.
  if (!ev.verified) {
    return { outcome: 'refused_unverified' };
  }

  // 2. Per-vendor arm gate (FR-3.TRIG.004 viability). Held ⇒ do not process (fail-closed).
  if (!armReady(ev.connector)) {
    return { outcome: 'arm_held', connector: ev.connector, gatingAFs: schemeFor(ev.connector).gatingAFs };
  }

  // 3. Dedup (ADR-004). A re-delivered rawEventId fires nothing twice.
  if (await store.seenEvent(ev.connector, ev.rawEventId)) {
    return { outcome: 'duplicate', rawEventId: ev.rawEventId };
  }

  // 4. Parse → normalized event. A malformed payload is rejected + LOGGED, never silently dropped.
  const parsed = parserFor(ev.connector)(ev.verifiedPayload, ev.rawEventId);
  if (!parsed.ok) {
    await store.logEvent(
      {
        task_id: null,
        event_type: EVT_TRIGGER_PARSE_FAILED,
        entity_ids: [],
        summary: `inbound ${ev.connector} event ${ev.rawEventId} REJECTED — malformed payload: ${parsed.reason}`,
        payload: { connector: ev.connector, rawEventId: ev.rawEventId, reason: parsed.reason },
      },
      now,
    );
    // The event id is still marked seen so a retry of the SAME malformed delivery is not re-logged forever
    // — but the rejection is durably recorded above (#3). A genuinely new payload has a new id.
    await store.recordEvent(ev.connector, ev.rawEventId, now);
    return { outcome: 'parse_failed', reason: parsed.reason };
  }
  const normalized = parsed.event;

  await store.recordEvent(ev.connector, ev.rawEventId, now);
  await store.logEvent(
    {
      task_id: null,
      event_type: EVT_TRIGGER_INBOUND,
      entity_ids: [],
      summary: `inbound ${ev.connector} event '${normalized.eventName}' (${ev.rawEventId}) parsed → evaluating triggers`,
      payload: { connector: ev.connector, eventName: normalized.eventName, rawEventId: ev.rawEventId },
    },
    now,
  );

  // 5. Default-trigger toggle gate (AC-3.TRIG.003.2). If this event's default trigger exists and is
  //    DISABLED, nothing fires. If there is no default trigger for the event name, likewise nothing
  //    fires (an event no default trigger covers). A default that IS enabled proceeds to rule eval.
  const defaults = await store.getDefaultTriggers(ev.connector);
  const def = defaults.find((d) => d.eventName === normalized.eventName);
  if (!def) {
    return { outcome: 'no_default_trigger', eventName: normalized.eventName };
  }
  if (!def.enabled) {
    return { outcome: 'default_disabled', eventName: normalized.eventName };
  }

  // 6. Rule evaluation → launch matched tasks (AC-3.TRIG.002.1 / .2).
  const rules = await store.getRules(ev.connector, normalized.eventName);
  const launched: string[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (ruleMatches(rule, normalized)) {
      await launch(rule.taskName, normalized, now);
      launched.push(rule.taskName);
      await store.logEvent(
        {
          task_id: null,
          event_type: EVT_TRIGGER_FIRED,
          entity_ids: [],
          summary: `trigger fired [${ev.connector}/${normalized.eventName}] rule ${rule.id} → launched task '${rule.taskName}'`,
          payload: { connector: ev.connector, eventName: normalized.eventName, ruleId: rule.id, taskName: rule.taskName },
        },
        now,
      );
    }
  }

  return { outcome: 'processed', eventName: normalized.eventName, launched };
}
