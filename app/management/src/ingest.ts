// ISSUE-012 — the management-plane ingest endpoint logic (FR-10.MGT.002 + NFR-SEC.002 + NFR-INF.010).
//
// This is the C10 half of the ADR-001 §7 push seam. It:
//   1. bearer-validates the internal_token — rejects + LOGS + ALERTS an anonymous/invalid push
//      (AC-10.MGT.002.2 / AC-NFR-SEC.002.2 / AC-NFR-INF.010.2). No anonymous ingest — ever.
//   2. re-validates the payload against the operational-metadata allow-list, REJECTING any business-data
//      field at the boundary even if a rogue reporter sent it (AC-NFR-SEC.002.1 / AC-10.MGT.003.1 — the #2
//      boundary; defence-in-depth with the reporter-side allow-list).
//   3. is IDEMPOTENT on re-delivery (delivery_id dedup — no double-count).
//   4. writes client_registry.core_version + upserts deployment_health — and NEVER touches status
//      (server-authoritative). There is NO pull path (the stale /api/internal/status L1170-1190 design
//      reference is superseded — AC-10.MGT.002.3).
//
// The endpoint is a PURE function of (request, store, alertSink, serverNow) so it is fully offline-testable.
// A rejection is a loud, logged, alerted event — never a silent 401 (a silent auth failure would hide a
// forged-push probe, a #3 violation).

import { assertOperationalOnly, BusinessDataAtBoundaryError } from './allowlist.ts';
import { type ManagementStore, type IngestResult } from './store.ts';

/** A management-plane alert sink — the cross-deployment alert surface (FR-7.MGM.004). The ingest raises an
 *  alert on a rejected push so a forged/misconfigured deployment is SEEN, not silently dropped. */
export interface AlertSink {
  raise(alert: { kind: string; slug: string | null; detail: string; serverNow: number }): void;
}

/** The append-only management-plane audit/log the ingest writes rejections to (schema.md event-log analog;
 *  the mgmt-plane's own observability, distinct from a silo's local event_log). */
export interface IngestLogSink {
  append(entry: { level: 'info' | 'warn' | 'error'; event: string; slug: string | null; detail: string; serverNow: number }): void;
}

export interface IngestRequest {
  /** the raw Authorization bearer value (the presented internal_token), or null if absent. */
  bearer: string | null;
  /** the pushed payload — validated against the allow-list; a business-data field is rejected. */
  payload: Record<string, unknown>;
  /** the reporter-supplied delivery id (for idempotent re-delivery). */
  delivery_id: string;
}

export type IngestOutcome =
  | { ok: true; result: IngestResult }
  | { ok: false; status: 401 | 400; reason: string; detail: string };

export const REJECT_NO_TOKEN = 'no_token';
export const REJECT_INVALID_TOKEN = 'invalid_token';
export const REJECT_BUSINESS_DATA = 'business_data_at_boundary';

/** Handle one ingest push. Server-authoritative time is supplied (never trusted from the payload — AF-120).
 *  Every rejection is logged AND alerted before returning (AC-NFR-SEC.002.2 / AC-NFR-INF.010.2). */
export async function handleIngest(
  req: IngestRequest,
  store: ManagementStore,
  sinks: { log: IngestLogSink; alert: AlertSink },
  serverNow: number,
): Promise<IngestOutcome> {
  // ── 1. bearer auth — no anonymous ingest ──
  if (!req.bearer) {
    const detail = 'ingest rejected: no internal_token bearer (anonymous push refused)';
    sinks.log.append({ level: 'warn', event: 'ingest.reject.no_token', slug: null, detail, serverNow });
    sinks.alert.raise({ kind: 'ingest_unauthenticated', slug: null, detail, serverNow });
    return { ok: false, status: 401, reason: REJECT_NO_TOKEN, detail };
  }
  const client = await store.authenticate(req.bearer);
  if (!client) {
    const detail = 'ingest rejected: invalid/revoked internal_token (forged or torn-down deployment)';
    sinks.log.append({ level: 'warn', event: 'ingest.reject.invalid_token', slug: null, detail, serverNow });
    sinks.alert.raise({ kind: 'ingest_invalid_token', slug: null, detail, serverNow });
    return { ok: false, status: 401, reason: REJECT_INVALID_TOKEN, detail };
  }

  // ── 2. allow-list re-validation — business data rejected AT THE BOUNDARY (#2) ──
  let snapshot;
  try {
    snapshot = assertOperationalOnly(req.payload);
  } catch (e) {
    if (e instanceof BusinessDataAtBoundaryError) {
      const detail = `ingest rejected from '${client.client_slug}': ${e.message}`;
      sinks.log.append({ level: 'error', event: 'ingest.reject.business_data', slug: client.client_slug, detail, serverNow });
      sinks.alert.raise({ kind: 'boundary_business_data', slug: client.client_slug, detail, serverNow });
      return { ok: false, status: 400, reason: REJECT_BUSINESS_DATA, detail };
    }
    throw e;
  }

  // ── 3 + 4. idempotent write of core_version + deployment_health (never status) ──
  const result = await store.ingest({
    slug: client.client_slug,
    snapshot,
    delivery_id: req.delivery_id,
    serverNow,
  });
  sinks.log.append({
    level: 'info',
    event: result.replayed ? 'ingest.replay' : 'ingest.ok',
    slug: client.client_slug,
    detail: result.replayed ? 'idempotent re-delivery (no re-count)' : 'operational snapshot applied',
    serverNow,
  });
  return { ok: true, result };
}

// A tripwire the boundary test asserts against: the management plane exposes NO pull path. This constant
// documents the superseded design reference so a future reader cannot re-introduce it (AC-10.MGT.002.3).
export const NO_PULL_PATH = {
  supersededReference: 'design-doc L1170-1190 /api/internal/status (PULL model)',
  rule: 'push-only: the management plane reads its own push-fed store and NEVER calls a client endpoint',
} as const;
