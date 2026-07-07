// ISSUE-037 §8.1 — the once-per-connector inbound handler + payload parser (FR-3.TRIG.001).
//
// The parser is the "Layer 1 / dev infra" half: it turns C0's already-verified opaque payload into a
// NormalizedEvent for trigger evaluation. Per FR-3.TRIG.001 the parser VARIES per connector (transport +
// payload shape differ) but the CONTRACT is uniform: (verified payload) → NormalizedEvent | ParseError.
//
// #3 CONTRACT (AC-3.TRIG.001.2): a malformed / unparseable payload is REJECTED and LOGGED — never
// silently dropped. `parse` returns a discriminated result; the pipeline (index handleInbound) logs the
// `trigger_parse_failed` event on the error arm. The parser NEVER throws for a bad payload (a throw could
// be swallowed by a caller) — it returns a typed error the pipeline is forced to handle.
//
// ADR-007: every parsed field is EXTERNAL, UNTRUSTED content. The NormalizedEvent carries
// `boundary_tagged: true`; downstream condition-matching only ever COMPARES these strings, never executes
// them. That is the boundary-tag posture homed into the trigger layer.

import type { Connector } from './seam.js';
import type { NormalizedEvent } from './store.js';

export type ParseResult =
  | { ok: true; event: NormalizedEvent }
  | { ok: false; reason: string };

/** A per-connector parser: verified opaque payload → normalized event or a typed parse error. */
export type ConnectorParser = (payload: unknown, rawEventId: string) => ParseResult;

// ── shared helpers ───────────────────────────────────────────────────────────────────────────────────
function asObject(payload: unknown): Record<string, unknown> | null {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null;
  return payload as Record<string, unknown>;
}
/** Coerce a scalar to a match string; objects/arrays/undefined → absent (not a stringified '[object]'). */
function fieldStr(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return undefined; // nested object/array is not a flat match field
}

// ── GHL parser (default triggers: lead created, stage change, tag added, task overdue) ───────────────
const parseGhl: ConnectorParser = (payload, rawEventId) => {
  const o = asObject(payload);
  if (!o) return { ok: false, reason: 'ghl: payload is not a JSON object' };
  const eventName = fieldStr(o.type ?? o.eventType);
  if (!eventName) return { ok: false, reason: 'ghl: missing event type field (`type`)' };
  const fields: Record<string, string> = {};
  for (const key of ['locationId', 'contactId', 'tag', 'pipelineStageId', 'pipelineId', 'taskId', 'status'] as const) {
    const s = fieldStr(o[key]);
    if (s !== undefined) fields[key] = s;
  }
  return { ok: true, event: mk('ghl', eventName, rawEventId, fields) };
};

// ── Slack parser (default triggers: message, DM) ─────────────────────────────────────────────────────
const parseSlack: ConnectorParser = (payload, rawEventId) => {
  const outer = asObject(payload);
  if (!outer) return { ok: false, reason: 'slack: payload is not a JSON object' };
  // Slack Events API wraps the real event under `event`; some deliveries are top-level.
  const ev = asObject(outer.event) ?? outer;
  const eventName = fieldStr(ev.type);
  if (!eventName) return { ok: false, reason: 'slack: missing event.type' };
  const fields: Record<string, string> = {};
  for (const key of ['channel', 'user', 'channel_type', 'subtype', 'team'] as const) {
    const s = fieldStr(ev[key]);
    if (s !== undefined) fields[key] = s;
  }
  return { ok: true, event: mk('slack', eventName, rawEventId, fields) };
};

// ── Google parser (Gmail new email; Calendar created/starting; Drive created/updated) ────────────────
const parseGoogle: ConnectorParser = (payload, rawEventId) => {
  const o = asObject(payload);
  if (!o) return { ok: false, reason: 'google: payload is not a JSON object' };
  // Gmail Pub/Sub delivers {emailAddress, historyId}; Drive/Calendar channel callbacks carry resource
  // state headers normalized upstream into the payload as `eventName`/`resourceState`.
  const eventName = fieldStr(o.eventName ?? o.resourceState ?? (o.historyId !== undefined ? 'new_email' : undefined));
  if (!eventName) return { ok: false, reason: 'google: cannot determine event name (no eventName/resourceState/historyId)' };
  const fields: Record<string, string> = {};
  for (const key of ['emailAddress', 'historyId', 'resourceId', 'resourceState', 'calendarId', 'fileId'] as const) {
    const s = fieldStr(o[key]);
    if (s !== undefined) fields[key] = s;
  }
  return { ok: true, event: mk('google', eventName, rawEventId, fields) };
};

function mk(connector: Connector, eventName: string, rawEventId: string, fields: Record<string, string>): NormalizedEvent {
  return { connector, eventName, rawEventId, fields, boundary_tagged: true };
}

export const PARSERS: Readonly<Record<Connector, ConnectorParser>> = {
  ghl: parseGhl,
  slack: parseSlack,
  google: parseGoogle,
};

export function parserFor(connector: Connector): ConnectorParser {
  const p = PARSERS[connector];
  if (!p) throw new Error(`no parser for connector '${connector}' (FR-3.TRIG.001)`);
  return p;
}
