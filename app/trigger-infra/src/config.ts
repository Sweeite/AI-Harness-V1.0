// ISSUE-037 §8.3/§8.4 — the no-code trigger config + runtime condition-matching (FR-3.TRIG.002) and the
// per-connector default trigger set (FR-3.TRIG.003), plus the CFG defaults for the liveness jobs.
//
// This is the "Layer 2 / dashboard config" half. It owns the config DATA + runtime EVALUATION, not the
// screen (the UI is a Phase-3 surface). Rule authoring is Admin/authorized, default-deny, audited — the
// RBAC gate itself is homed in C1; this slice records the actor + writes the audit row (issue §5 PERM).

import type { Connector } from './seam.js';
import type { NormalizedEvent, TriggerCondition, TriggerRule } from './store.js';

// ── CFG defaults (issue §5 CFG) ──────────────────────────────────────────────────────────────────────
// Per-connector defaults MUST sit below the shortest watch TTL (Drive `files` = 1 day) so a re-arm always
// fires with margin (FR-3.TRIG.005 / CFG-watch_rearm_lead_minutes). Expressed in minutes.
export const CFG_WATCH_REARM_LEAD_MINUTES: Readonly<Record<Connector, number>> = {
  // Google is the only expiring family. 6h lead vs the 1-day Drive `files` TTL → comfortable margin.
  google: 6 * 60,
  // Slack Events + GHL app-webhook do NOT expire; no re-arm job runs → lead is irrelevant (0 = n/a).
  slack: 0,
  ghl: 0,
};
export const CFG_EVENT_RECONCILIATION_SWEEP_MINUTES: Readonly<Record<Connector, number>> = {
  slack: 15, // periodic conversations.history sweep from the ts watermark
  google: 30, // history.list / changes reconciliation cadence
  ghl: 0, // GHL durable-queue webhook; no history sweep in this slice
};

// ── Default trigger set (FR-3.TRIG.003) — shipped per connector, each individually toggleable ────────
// The availableFields list is the CONTRACT a user rule validates against at save (a rule referencing a
// field the event cannot carry is a save-time error, not a runtime surprise — AC-3.TRIG.002 edge).
export interface DefaultTriggerSpec {
  eventName: string;
  availableFields: readonly string[];
}
export const DEFAULT_TRIGGER_SET: Readonly<Record<Connector, readonly DefaultTriggerSpec[]>> = {
  ghl: [
    { eventName: 'ContactCreate', availableFields: ['locationId', 'contactId', 'tag'] },
    { eventName: 'OpportunityStageUpdate', availableFields: ['locationId', 'pipelineId', 'pipelineStageId'] },
    { eventName: 'ContactTagUpdate', availableFields: ['locationId', 'contactId', 'tag'] },
    { eventName: 'TaskOverdue', availableFields: ['locationId', 'taskId', 'status'] },
  ],
  slack: [
    { eventName: 'message', availableFields: ['channel', 'user', 'channel_type', 'subtype', 'team'] },
    { eventName: 'message.im', availableFields: ['channel', 'user', 'channel_type', 'team'] },
  ],
  google: [
    { eventName: 'new_email', availableFields: ['emailAddress', 'historyId'] },
    { eventName: 'calendar_event_created', availableFields: ['calendarId', 'resourceId'] },
    { eventName: 'calendar_event_starting', availableFields: ['calendarId', 'resourceId'] },
    { eventName: 'drive_file_created', availableFields: ['fileId', 'resourceId', 'resourceState'] },
    { eventName: 'drive_file_updated', availableFields: ['fileId', 'resourceId', 'resourceState'] },
  ],
};

// ── Rule validation (save-time — FR-3.TRIG.002 edge) ─────────────────────────────────────────────────
export type RuleValidation = { ok: true } | { ok: false; errors: string[] };

/** Validate a user rule against the connector's default-trigger contract at SAVE time:
 *   - the eventName must be a known default trigger for the connector;
 *   - every condition field must be an availableField of that trigger (no reference to a missing field);
 *   - eq/neq/in require a non-empty value; `in` value must be a non-empty comma set;
 *   - the taskName must be non-empty.
 *  Overlap is permitted (multiple rules may match one event — all fire); the invalid case we reject is a
 *  rule that CAN NEVER match because it references a field the event does not carry (a silent dead rule). */
export function validateRule(
  connector: Connector,
  eventName: string,
  conditions: readonly TriggerCondition[],
  taskName: string,
): RuleValidation {
  const errors: string[] = [];
  const spec = DEFAULT_TRIGGER_SET[connector]?.find((d) => d.eventName === eventName);
  if (!spec) {
    errors.push(`unknown event '${eventName}' for connector ${connector} — not a default trigger`);
  }
  if (!taskName || taskName.trim() === '') errors.push('taskName must be non-empty');
  for (const c of conditions) {
    if (spec && !spec.availableFields.includes(c.field)) {
      errors.push(`condition field '${c.field}' is not carried by event '${eventName}' (available: ${spec.availableFields.join(', ')})`);
    }
    if ((c.op === 'eq' || c.op === 'neq') && (c.value === undefined || c.value === '')) {
      errors.push(`condition on '${c.field}' with op '${c.op}' requires a value`);
    }
    if (c.op === 'in') {
      const parts = (c.value ?? '').split(',').map((s) => s.trim()).filter((s) => s !== '');
      if (parts.length === 0) errors.push(`condition on '${c.field}' with op 'in' requires a non-empty comma set`);
    }
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

// ── Runtime condition matching (FR-3.TRIG.002) ──────────────────────────────────────────────────────
/** Evaluate ONE condition against a normalized event's fields. Missing-field semantics are SAFE: an
 *  absent field never matches eq/neq/in and is `exists:false` — a rule simply does not fire, it never
 *  throws (a runtime throw would be a silent-loss risk). External content is only ever compared. */
export function matchesCondition(cond: TriggerCondition, ev: NormalizedEvent): boolean {
  const actual = ev.fields[cond.field]; // undefined if absent
  switch (cond.op) {
    case 'exists':
      return actual !== undefined;
    case 'eq':
      return actual !== undefined && actual === cond.value;
    case 'neq':
      // neq is TRUE only when the field is present and differs — an absent field is not a "not-equal"
      // match (that would fire a rule on every event missing the field, a footgun). Present-and-differs.
      return actual !== undefined && actual !== cond.value;
    case 'in': {
      if (actual === undefined) return false;
      // logic-sweep fix: filter empty segments to match save-time validateRule (L84), else a stray
      // comma (',vip') would let an empty-string field spuriously match ('' ∈ ['','vip']) — #2 fire-on-wrong-event.
      const set = (cond.value ?? '').split(',').map((s) => s.trim()).filter((s) => s !== '');
      return set.includes(actual);
    }
    default: {
      // Exhaustiveness: an unknown op is a bug — fail LOUD, never silently "no match" (#3).
      const _never: never = cond.op;
      throw new Error(`unknown condition op '${String(_never)}'`);
    }
  }
}

/** A rule matches iff ALL its conditions match (AND semantics). Zero conditions = the event-name alone
 *  fires (an unconditional trigger). */
export function ruleMatches(rule: TriggerRule, ev: NormalizedEvent): boolean {
  return rule.conditions.every((c) => matchesCondition(c, ev));
}
