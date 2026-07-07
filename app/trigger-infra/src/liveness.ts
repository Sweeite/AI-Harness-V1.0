// ISSUE-037 §8.5/§8.6/§8.7 — the LIVENESS SPINE: proactive watch re-arm (FR-3.TRIG.005) + event-gap
// detection & watermark reconciliation (FR-3.TRIG.006). This is the load-bearing #3 guarantee for the
// whole trigger component: without it, an expired watch or a dropped/auto-disabled subscription looks
// IDENTICAL to a genuinely quiet channel and inbound knowledge silently stops. Every failure path here
// resolves to a LOUD `degraded` condition + an event_log row — never a silent stop.
//
// TESTABILITY: no real scheduler and no live vendor calls. Time is an INJECTED `now` (epoch seconds).
// The vendor effects (re-arm a watch; read history since a watermark) are INJECTED effect functions, so
// fault injection (a re-arm that throws; a history read that returns a gap; a 404 that forces full-sync)
// is pure and deterministic. The concrete vendor wiring is ISSUE-039/040/041; this ships the mechanism.
//
// AF GATING: the SLACK gap-reconciliation arm is viability-gated on AF-084/AF-083 and the GOOGLE watch
// arms on AF-108/AF-109. The generic re-arm + sweep MECHANISM ships now; a caller must pass a concrete
// effect only for a connector whose arm is GREEN. A held arm has no effect wired → the job records that
// it cannot act rather than pretending success (#3).

import type { Connector } from './seam.js';
import {
  type TriggerStore,
  type WatchState,
  EVT_WATCH_REARMED,
  EVT_WATCH_REARM_FAILED,
  EVT_EVENT_GAP_DETECTED,
  EVT_EVENT_GAP_RECONCILED,
  EVT_DELIVERY_DEGRADED,
  EVT_RECONCILE_SWEEP_FAILED,
} from './store.js';
import { CFG_WATCH_REARM_LEAD_MINUTES } from './config.js';

// ── Watch re-arm (FR-3.TRIG.005) ─────────────────────────────────────────────────────────────────────

/** An injected re-arm effect: (re)create the vendor watch, returning the NEW channel + expiry (epoch s).
 *  Throws on failure — the job catches it and moves the connector to `degraded` (fail-loud, AC.005.2). */
export type RearmEffect = (w: WatchState, now: number) => Promise<{ channelId: string; resourceId: string; expiresAt: number }>;

export interface RearmReport {
  scanned: number;
  rearmed: number;
  failed: number;
  /** channels moved to degraded this run (missed/failed re-arm). */
  degraded: string[];
}

/** The scheduled re-arm job (mirrors FR-3.TOK.002's token-refresh job). Finds watches expiring within the
 *  per-connector lead window and re-arms them; a re-arm that FAILS or a watch already LAPSED (past expiry)
 *  moves the connector to `degraded` + logs `watch_rearm_failed` — never a silent stop.
 *
 * @param effects  per-connector re-arm effect; a connector with no effect (held arm) whose watch needs
 *                 re-arming is treated as a FAILED re-arm (it cannot be re-armed here) → degraded (#3).
 */
export async function runWatchRearm(
  store: TriggerStore,
  effects: Partial<Record<Connector, RearmEffect>>,
  now: number,
): Promise<RearmReport> {
  const watches = await store.getWatches();
  const report: RearmReport = { scanned: watches.length, rearmed: 0, failed: 0, degraded: [] };

  for (const w of watches) {
    const leadMin = CFG_WATCH_REARM_LEAD_MINUTES[w.connector] ?? 0;
    if (leadMin === 0) continue; // non-expiring transport (Slack/GHL) — no watch lifecycle (FR-3.TRIG.005 branch)
    const leadSeconds = leadMin * 60;
    const lapsed = now >= w.expiresAt; // already expired — a #3 hole if not surfaced
    const dueForRearm = now >= w.expiresAt - leadSeconds;
    if (!dueForRearm) continue; // not yet in the lead window — leave it

    const effect = effects[w.connector];
    if (!effect) {
      // Held arm / no effect wired but the watch is due — we CANNOT re-arm it here. That is not "fine":
      // the watch will lapse. Fail loud → degraded (#3). ISSUE-039/040/041 supply the real effect.
      await failRearm(store, w, now, report, lapsed, `no re-arm effect wired for ${w.connector} (arm held / not configured)`);
      continue;
    }
    try {
      const next = await effect(w, now);
      if (next.expiresAt <= now) {
        // A re-arm that returns an already-expired expiry is a failed re-arm, not a success.
        await failRearm(store, w, now, report, lapsed, `re-arm returned a non-future expiry (${next.expiresAt} <= ${now})`);
        continue;
      }
      await store.upsertWatch({ ...w, channelId: next.channelId, resourceId: next.resourceId, expiresAt: next.expiresAt, degraded: false });
      report.rearmed += 1;
      await store.logEvent(
        {
          task_id: null,
          event_type: EVT_WATCH_REARMED,
          entity_ids: [],
          summary: `watch re-armed [${w.connector}/${w.kind}] channel ${next.channelId} → expires ${new Date(next.expiresAt * 1000).toISOString()}`,
          payload: { connector: w.connector, kind: w.kind, channelId: next.channelId, expiresAt: next.expiresAt },
        },
        now,
      );
    } catch (e) {
      await failRearm(store, w, now, report, lapsed, `re-arm threw: ${(e as Error).message}`);
    }
  }
  return report;
}

async function failRearm(
  store: TriggerStore,
  w: WatchState,
  now: number,
  report: RearmReport,
  lapsed: boolean,
  reason: string,
): Promise<void> {
  report.failed += 1;
  report.degraded.push(`${w.connector}/${w.channelId}`);
  await store.setWatchDegraded(w.connector, w.channelId, true);
  await store.logEvent(
    {
      task_id: null,
      event_type: EVT_WATCH_REARM_FAILED,
      entity_ids: [],
      summary:
        `watch re-arm FAILED [${w.connector}/${w.kind}] channel ${w.channelId} — connector DEGRADED (${lapsed ? 'watch already LAPSED' : 'in lead window'}): ${reason}`,
      payload: { connector: w.connector, kind: w.kind, channelId: w.channelId, lapsed, reason },
    },
    now,
  );
}

// ── Event-gap detection + reconciliation (FR-3.TRIG.006) ─────────────────────────────────────────────

/** An injected history-read effect: read events since `sincePosition` for a channel, returning the events
 *  (opaque) plus the NEW watermark position. `fullSync=true` on the Google 404/410 path (read from
 *  scratch). Throws if the read itself cannot run — the sweep then alerts (the gap is NEVER assumed
 *  empty, AC.006 edge). */
export type HistoryReadEffect = (args: {
  connector: Connector;
  channel: string;
  sincePosition: string | null;
  fullSync: boolean;
  now: number;
}) => Promise<{ events: unknown[]; newPosition: string }>;

/** Slack auto-disables a subscription at >95% delivery FAILURE over 60 min. We flag as we APPROACH it —
 *  i.e. when the success rate drops to/below this floor — as `degraded`, loudly (AC.006.2). */
export const SLACK_SUCCESS_RATE_DEGRADED_FLOOR = 0.1; // 90% success ⇒ 10% failure ⇒ approaching the 95%-fail wall

export interface SweepReport {
  connector: Connector;
  channel: string;
  gapDetected: boolean;
  reconciled: number; // events re-ingested
  deliveryDegraded: boolean;
  sweepFailed: boolean;
}

/** One channel's reconciliation sweep + delivery-health check (FR-3.TRIG.006).
 *
 * @param onReingest  a sink for re-read events → C2 ingestion (FR-2.ING.*, ISSUE-026). Kept injected so
 *                    this slice does not reach into C2; it only DETECTS + hands the gap over.
 * @param fullSync    force a from-scratch read (the Gmail history.list 404 / changes-token-expiry / 410
 *                    path — AC.006.3). Otherwise read from the persisted watermark (the Slack path).
 */
export async function runReconciliationSweep(
  store: TriggerStore,
  args: {
    connector: Connector;
    channel: string;
    read: HistoryReadEffect;
    onReingest: (events: unknown[]) => Promise<number>;
    fullSync: boolean;
    now: number;
  },
): Promise<SweepReport> {
  const { connector, channel, read, onReingest, fullSync, now } = args;
  const report: SweepReport = { connector, channel, gapDetected: false, reconciled: 0, deliveryDegraded: false, sweepFailed: false };

  // 1. Delivery-health check (Slack 2xx-rate monitor, AC.006.2). A sample below the floor → degraded, loud.
  const sample = await store.getDeliverySample(connector);
  if (sample && sample.successRate <= SLACK_SUCCESS_RATE_DEGRADED_FLOOR) {
    report.deliveryDegraded = true;
    await store.logEvent(
      {
        task_id: null,
        event_type: EVT_DELIVERY_DEGRADED,
        entity_ids: [],
        summary: `delivery rate ${(sample.successRate * 100).toFixed(1)}% for ${connector} — approaching the 95%/60min auto-disable wall → DEGRADED (not silent)`,
        payload: { connector, successRate: sample.successRate },
      },
      now,
    );
  }

  // 2. The reconciliation read from the watermark (or full-sync). A read that CANNOT RUN is alerted; the
  //    gap is NEVER assumed empty (AC.006 edge) — we log reconcile_sweep_failed and surface the failure.
  const wm = await store.getWatermark(connector, channel);
  const sincePosition = fullSync ? null : (wm?.position ?? null);
  let result: { events: unknown[]; newPosition: string };
  try {
    result = await read({ connector, channel, sincePosition, fullSync, now });
  } catch (e) {
    report.sweepFailed = true;
    await store.logEvent(
      {
        task_id: null,
        event_type: EVT_RECONCILE_SWEEP_FAILED,
        entity_ids: [],
        summary: `reconciliation sweep FAILED [${connector}/${channel}] — gap NOT assumed empty, alerting: ${(e as Error).message}`,
        payload: { connector, channel, fullSync, reason: (e as Error).message },
      },
      now,
    );
    return report;
  }

  // 3. Any events since the watermark are a detected gap → re-ingest + advance the watermark.
  if (result.events.length > 0) {
    report.gapDetected = true;
    await store.logEvent(
      {
        task_id: null,
        event_type: EVT_EVENT_GAP_DETECTED,
        entity_ids: [],
        summary: `delivery gap detected [${connector}/${channel}] — ${result.events.length} event(s) since watermark ${sincePosition ?? '(full-sync)'}`,
        payload: { connector, channel, count: result.events.length, fullSync },
      },
      now,
    );
    report.reconciled = await onReingest(result.events);
    await store.logEvent(
      {
        task_id: null,
        event_type: EVT_EVENT_GAP_RECONCILED,
        entity_ids: [],
        summary: `gap reconciled [${connector}/${channel}] — ${report.reconciled} event(s) re-ingested → watermark advanced to ${result.newPosition}`,
        payload: { connector, channel, reconciled: report.reconciled, newPosition: result.newPosition },
      },
      now,
    );
  }

  // 4. Advance the watermark to the newest read position (even a zero-gap read advances it so the next
  //    sweep does not re-scan the same window). A watermark that NEVER advances while events are expected
  //    is the never-arriving-webhook signal (OD-104(a)) — surfaced by the degraded/gap paths above.
  await store.setWatermark(connector, channel, result.newPosition, now);
  return report;
}
