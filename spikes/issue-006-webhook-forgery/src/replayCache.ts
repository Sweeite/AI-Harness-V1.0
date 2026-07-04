// ISSUE-006 §8 step 6 — replay cache for the event-ID-based connectors (GHL/Google). A verified
// webhook whose event ID has already been seen within `replay_cache_window` is a REPLAY: drop + log,
// do NOT re-trigger work (AC-0.WHK.008.1, AC-NFR-SEC.008.2).
//
// NOTE the ordering split, which is deliberate and per the ACs:
//   - Slack replay defense is a TIMESTAMP window checked BEFORE the signature (AC-0.WHK.004.1) —
//     it lives in the Slack verifier, not here (a stale forgery must be cheap to reject).
//   - GHL/Google replay defense is a seen-event-ID cache checked AFTER a VALID signature — you only
//     dedup events you have authenticated. That is this module.

import { CFG } from './config.js';
import type { Connector, Sinks } from './sinks.js';

export interface ReplayCheck {
  replay: boolean;
}

// Check-and-record a seen event ID for GHL/Google. Only ever called on an already-signature-verified
// event. `now` is a logical epoch-seconds clock supplied by the battery (deterministic).
export function checkEventReplay(
  sinks: Sinks,
  connector: Connector,
  eventId: string,
  sourceId: string | null,
  now: number,
): ReplayCheck {
  return sinks.recordOrDetectReplay(connector, eventId, sourceId, now, CFG.replay_cache_window);
}
