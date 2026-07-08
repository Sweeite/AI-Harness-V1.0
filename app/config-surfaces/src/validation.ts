// ISSUE-086 — per-section Save validation: the cross-key constraints the surface enforces at WRITE time
// (config-registry.md §"Cross-key constraints" + surface-01 per-section Save + FR-7.ALR.009). A violation is
// REJECTED, never silently clamped (#3). This module returns the constraint violations for a section given
// the merged (current ∪ dirtied) values; the Save engine (save.ts) also enforces the locked/hard-limit
// floors (those live here too, as `lockViolations`, so one call surfaces every reason a Save is blocked).

import { isReadOnlyKey, readOnlyBadge } from './keys.ts';
import { isSecretKey } from './redaction.ts';
import type { SectionId } from './sections.ts';

export interface Violation {
  key: string;
  message: string;
}

type Values = ReadonlyMap<string, unknown>;

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** ranking_weights / routing_weights: every field 0–1 and the sum == 1.0 (within float epsilon). */
function weightsSumToOne(v: unknown): boolean {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const vals = Object.values(v as Record<string, unknown>);
  if (vals.length === 0) return false;
  let sum = 0;
  for (const x of vals) {
    const n = num(x);
    if (n === null || n < 0 || n > 1) return false;
    sum += n;
  }
  return Math.abs(sum - 1) < 1e-9;
}

// ── Alert-routing resolvability (FR-7.ALR.009 / AC-7.ALR.009.1/.3) ────────────────────────────────────
// alert_routing_rules: { [alertType]: { role, channel } }; escalation_contacts: { [role]: string[] };
// quiet_hours: { windows: [...], suppress_critical?: boolean }. A route is RESOLVABLE iff its role has a
// non-empty contact list. A CRITICAL alert type left unroutable is rejected at config time (AC-7.ALR.009.3);
// quiet_hours can never suppress a critical alert (AC-7.ALR.009.2).
export const CRITICAL_ALERT_TYPES: readonly string[] = ['hard_limit_hit', 'loop_missed', 'alert_delivery_misconfigured'];

interface Route {
  role?: unknown;
  channel?: unknown;
}

function contactsFor(escalation: unknown, role: string): unknown[] {
  if (escalation === null || typeof escalation !== 'object' || Array.isArray(escalation)) return [];
  const list = (escalation as Record<string, unknown>)[role];
  return Array.isArray(list) ? list : [];
}

function validateObservability(values: Values): Violation[] {
  const out: Violation[] = [];
  const routing = values.get('alert_routing_rules');
  const escalation = values.get('escalation_contacts');
  const quiet = values.get('quiet_hours');

  // escalation_contacts: every declared role must have a non-empty contact list (#3 — empty = unroutable).
  if (escalation !== undefined && escalation !== null && typeof escalation === 'object' && !Array.isArray(escalation)) {
    for (const [role, list] of Object.entries(escalation as Record<string, unknown>)) {
      if (!Array.isArray(list) || list.length === 0) {
        out.push({ key: 'escalation_contacts', message: `role '${role}' has an empty contact list — an alert to it would evaporate (FR-7.ALR.009, #3)` });
      }
    }
  }

  // alert_routing_rules: every route must resolve to a non-empty contact list; a CRITICAL type left
  // unroutable is rejected (AC-7.ALR.009.1/.3).
  if (routing !== undefined && routing !== null && typeof routing === 'object' && !Array.isArray(routing)) {
    for (const [alertType, r] of Object.entries(routing as Record<string, Route>)) {
      const role = typeof r?.role === 'string' ? r.role : null;
      const resolvable = role !== null && contactsFor(escalation, role).length > 0 && typeof r?.channel === 'string' && (r.channel as string).length > 0;
      if (!resolvable) {
        const critical = CRITICAL_ALERT_TYPES.includes(alertType);
        out.push({
          key: 'alert_routing_rules',
          message: `alert type '${alertType}' resolves to no deliverable destination${critical ? ' (CRITICAL — write rejected, AC-7.ALR.009.3)' : ' (unroutable, FR-7.ALR.009)'}`,
        });
      }
    }
    // Every critical alert type must be present AND routable (you cannot configure a critical alert into
    // having nowhere to go — AC-7.ALR.009.3).
    for (const crit of CRITICAL_ALERT_TYPES) {
      const r = (routing as Record<string, Route>)[crit];
      if (r === undefined) {
        out.push({ key: 'alert_routing_rules', message: `critical alert type '${crit}' has no routing rule — it would have nowhere to go (AC-7.ALR.009.3)` });
      }
    }
  }

  // quiet_hours can never suppress a critical/hard-limit alert (AC-7.ALR.009.2).
  if (quiet !== null && typeof quiet === 'object' && !Array.isArray(quiet)) {
    if ((quiet as Record<string, unknown>).suppress_critical === true) {
      out.push({ key: 'quiet_hours', message: `quiet_hours must never suppress critical/hard-limit alerts (AC-7.ALR.009.2, #2/#3)` });
    }
  }
  return out;
}

function ordered(out: Violation[], values: Values, lo: string, hi: string, rel: '<=' | '<', label: string): void {
  const rawA = values.get(lo);
  const rawB = values.get(hi);
  const a = num(rawA);
  const b = num(rawB);
  // A side that is PRESENT (non-null) but not a finite number is a type error the cross-key layer must
  // reject rather than silently skip — otherwise an out-of-range/wrong-type scalar could be saved unchecked
  // (#3). An absent (undefined) or null side is left to first-write/field-level handling.
  if (rawA != null && a === null) out.push({ key: lo, message: `${lo} must be a finite number (got ${typeof rawA})` });
  if (rawB != null && b === null) out.push({ key: hi, message: `${hi} must be a finite number (got ${typeof rawB})` });
  if (a === null || b === null) return; // a genuinely-missing side is handled elsewhere (first write / registry)
  const ok = rel === '<=' ? a <= b : a < b;
  if (!ok) out.push({ key: lo, message: `${lo} must be ${rel} ${hi} (${label})` });
}

/**
 * The named cross-key constraints for a section (config-registry.md §"Cross-key constraints"). Returns every
 * violation; an empty array means the section's cross-constraints hold. Per-row type/range validation is the
 * registry's job at the field level; this is the CROSS-key layer the surface must enforce before write.
 */
export function crossConstraints(section: SectionId, values: Values): Violation[] {
  const out: Violation[] = [];
  switch (section) {
    case '#memory':
      ordered(out, values, 'confidence_floor', 'amber_zone_threshold', '<=', 'a memory must be flagged amber before it drops below the floor');
      ordered(out, values, 'retrieval_confidence_threshold', 'amber_zone_threshold', '<', 'audit H27 — amber must fire before the retrieval floor');
      if (values.has('ranking_weights') && !weightsSumToOne(values.get('ranking_weights'))) {
        out.push({ key: 'ranking_weights', message: 'ranking_weights must each be 0–1 and sum to 1.0 (rejected at write)' });
      }
      break;
    case '#tools':
      ordered(out, values, 'backoff_initial_ms', 'backoff_max_ms', '<=', 'initial backoff cannot exceed the max');
      break;
    case '#guardrails':
      ordered(out, values, 'injection_semantic_threshold', 'injection_quarantine_threshold', '<=', 'flag threshold cannot exceed quarantine threshold');
      ordered(out, values, 'cost_ladder_soft_threshold_daily_usd', 'cost_ladder_throttle_threshold', '<', 'soft daily must be below throttle');
      ordered(out, values, 'cost_ladder_throttle_threshold', 'cost_ladder_hard_kill_threshold', '<', 'throttle must be below hard-kill');
      break;
    case '#observability':
      out.push(...validateObservability(values));
      break;
    case '#agents':
      if (values.has('routing_weights') && !weightsSumToOne(values.get('routing_weights'))) {
        out.push({ key: 'routing_weights', message: 'routing_weights must each be 0–1 and sum to 1.0 (rejected at write)' });
      }
      break;
    case '#proactive':
      ordered(out, values, 'cold_start_basic_threshold', 'cold_start_proactive_threshold', '<=', 'basic ≤ proactive');
      ordered(out, values, 'cold_start_proactive_threshold', 'cold_start_full_threshold', '<=', 'proactive ≤ full');
      break;
    default:
      break;
  }
  return out;
}

/** Any dirtied key that must be rejected before the write loop even runs — a SECRET-class platform secret,
 *  a locked floor, or a hard-limit prohibition. Each is a #2 write attempt that MUST be rejected at the
 *  server regardless of what the client sent (surface-01 §"Hard limits note" / OD-161 / AC-7.LOG.008.5).
 *  SECRET keys are screened HERE — not only at the store — so a crafted batch mixing a secret with a valid
 *  key produces a clean forbidden SaveResult instead of a half-written section + an uncaught store throw. */
export function lockViolations(dirtiedKeys: readonly string[]): Violation[] {
  const out: Violation[] = [];
  for (const key of dirtiedKeys) {
    if (isSecretKey(key)) {
      // A SECRET-class platform secret is never editable via config Save (presence-only on #secrets). Reject
      // it up front, fail-closed, so it never reaches config_values / config_audit_log (#2, AC-7.LOG.008.5).
      out.push({ key, message: `'${key}' is a SECRET-class platform secret — never editable via config Save (#2, AC-7.LOG.008.5)` });
      continue;
    }
    if (isReadOnlyKey(key)) {
      const badge = readOnlyBadge(key) ?? 'read-only';
      out.push({ key, message: `'${key}' is read-only (${badge}) — write rejected at server (#2)` });
    }
  }
  return out;
}
