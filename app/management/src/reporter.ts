// ISSUE-012 — the outbound health-reporter job (FR-7.MGM.001), the C7 half of the ADR-001 §7 push seam.
//
// This job runs INSIDE each client deployment. It:
//   1. assembles an operational-metadata-ONLY snapshot — the allow-list is enforced HERE too, so a
//      business-data field never even leaves the silo (AC-7.MGM.001.1; defence-in-depth with the ingest).
//   2. POSTs it to the management-plane ingest on interval AND on significant events (NFR-INF.010 /
//      AC-NFR-INF.010.1) — the model is push, never pull (AC-7.MGM.001.2).
//   3. logs EVERY push attempt AND failure to the deployment's LOCAL event_log (AC-7.MGM.001.3) — so a
//      deployment that cannot reach the management plane surfaces the condition on ITS OWN dashboard, not
//      only (invisibly) by absence on the Super Admin grid.
//
// The reporter is a pure function of (raw metrics, transport, local-log sink, trigger). The transport is
// injected so the offline test drives it with a fake (the LIVE post to the real ingest is the orchestrator's
// live proof). Business data at assembly is DROPPED (pickOperational) — the reporter cannot send it — while
// the ingest independently REJECTS it; both together are the seam.

import { pickOperational, offendingFields, type OperationalSnapshot } from './allowlist.ts';

/** Why a push fired — interval tick or a significant event (NFR-INF.010: interval + event-driven). */
export type PushTrigger = 'interval' | 'event';

/** The deployment-LOCAL append-only event_log (schema owned by ISSUE-011; this slice only WRITES to it). */
export interface LocalEventLog {
  append(entry: {
    event_type: string; // e.g. 'health_push.attempt' | 'health_push.failure'
    level: 'info' | 'warn' | 'error';
    detail: string;
    at: number; // deployment-local epoch seconds (the LOCAL log; the mgmt store stamps its own server time)
  }): void;
}

/** The transport that actually POSTs to the ingest. Returns the ingest's accept/reject; throws on a
 *  transport failure (unreachable management plane) — which the reporter logs locally, never swallows. */
export interface IngestTransport {
  post(body: { bearer: string; payload: OperationalSnapshot; delivery_id: string }): Promise<{ accepted: boolean; detail: string }>;
}

export interface ReporterConfig {
  bearer: string; // this deployment's internal_token (from its Railway env)
  /** deployment_staleness_window must be ≥ this push interval (config-registry §J invariant). Informational
   *  here; the reporter's cadence is driven by the scheduler, this documents the contract it must honour. */
  push_interval_s: number; // config: polling_interval_health_metrics_s (default 30, LIVE)
}

export interface PushOutcome {
  attempted: true;
  accepted: boolean;
  trigger: PushTrigger;
  delivery_id: string;
  detail: string;
}

let __delivery = 0;
const nextDeliveryId = () => `push-${String(++__delivery).padStart(6, '0')}`;

/** Assemble + push one operational-metadata snapshot. `rawMetrics` may contain anything the deployment knows;
 *  pickOperational strips it to the allow-list BEFORE send (a business-data key never leaves the silo). Every
 *  attempt and every failure is logged to the LOCAL event_log (AC-7.MGM.001.3). */
export async function pushHealthSnapshot(
  rawMetrics: Record<string, unknown>,
  cfg: ReporterConfig,
  transport: IngestTransport,
  localLog: LocalEventLog,
  trigger: PushTrigger,
  at: number,
): Promise<PushOutcome> {
  // (1) Allow-list at the reporter — business-data fields are dropped, never sent (AC-7.MGM.001.1).
  const dropped = offendingFields(rawMetrics);
  const snapshot = pickOperational(rawMetrics);
  const delivery_id = nextDeliveryId();

  // Log the ATTEMPT locally (so even a push that then fails is visible on the deployment's own dashboard).
  localLog.append({
    event_type: 'health_push.attempt',
    level: 'info',
    detail:
      `outbound health push (${trigger}); delivery=${delivery_id}` +
      (dropped.length ? `; dropped non-operational field(s) before send: [${dropped.join(', ')}]` : ''),
    at,
  });

  try {
    const res = await transport.post({ bearer: cfg.bearer, payload: snapshot, delivery_id });
    if (!res.accepted) {
      // The ingest rejected us (e.g. our token was rotated away, or a boundary violation slipped through) —
      // a FAILURE, logged locally so it surfaces on our own dashboard (AC-7.MGM.001.3).
      localLog.append({
        event_type: 'health_push.failure',
        level: 'warn',
        detail: `management plane rejected the push (delivery=${delivery_id}): ${res.detail}`,
        at,
      });
      return { attempted: true, accepted: false, trigger, delivery_id, detail: res.detail };
    }
    return { attempted: true, accepted: true, trigger, delivery_id, detail: res.detail };
  } catch (e) {
    // Transport failure — the management plane is UNREACHABLE. This is exactly the condition that must not be
    // invisible: log it locally so the deployment's OWN operations dashboard shows it (AC-7.MGM.001.3).
    localLog.append({
      event_type: 'health_push.failure',
      level: 'error',
      detail: `management plane UNREACHABLE (delivery=${delivery_id}): ${(e as Error).message}`,
      at,
    });
    return { attempted: true, accepted: false, trigger, delivery_id, detail: `unreachable: ${(e as Error).message}` };
  }
}
