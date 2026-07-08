// ISSUE-086 — surface-01b render logic: the Config-Change Timeline row, the Change Detail drawer, and the
// Compliance Export orchestration. All read-only over config_audit_log (this surface never writes the trail).
// The load-bearing disciplines:
//   - a redaction-tombstoned actor (actor_id null / redacted_at set) renders "redacted (erased user)" while
//     the change record + key/old→new/changed_at still render (AC-7.LOG.008.4);
//   - the Change Detail carries a tamper-evidence indicator (AC-7.LOG.008.3) and NEVER offers an edit/delete
//     of an audit row (the surface has no such action);
//   - the Compliance Export returns every row in range or fails loudly — never a silent partial (AC-7.LOG.008.1).

import { configKeyGroup, keySpec, editClassBadge } from './keys.ts';
import { SECTIONS, type SectionId } from './sections.ts';
import type { ActorInfo, ConfigAuditRow, ConfigSurfaceStore, ExportRequest } from './store.ts';

export const REDACTED_ACTOR = 'redacted (erased user)' as const;
export const UNRESOLVED_ACTOR = 'actor unresolved' as const;
export const FIRST_SET = '(first set)' as const;

/** How an actor renders on a change row. A tombstoned actor (null id / redacted_at) is "redacted (erased
 *  user)"; an un-tombstoned actor we simply couldn't resolve is "actor unresolved" (partial); else name+role. */
export function renderActor(row: ConfigAuditRow, actor: ActorInfo | null): string {
  if (row.actor_id === null || row.redacted_at !== null) return REDACTED_ACTOR;
  if (actor === null) return UNRESOLVED_ACTOR;
  return `${actor.name} (${actor.role})`;
}

/** The surface-01 section a key belongs to — the target of the "Edit this config →" link. Falls back to the
 *  key-prefix group's section for a key not in the editable catalog. */
export function owningSection(key: string): SectionId {
  const spec = keySpec(key);
  if (spec) return spec.section;
  const node = configKeyGroup(key);
  const s = SECTIONS.find((x) => x.node === node);
  return (s?.id ?? '#infra') as SectionId;
}

/** Field-level old→new diff. `old_value` null → "(first set)"; objects diffed field-by-field; a sub-field
 *  that is undefined on one side reads "unavailable"/"unset" explicitly, never a blank that looks like unset. */
export function renderDiff(oldValue: unknown | null, newValue: unknown): string {
  if (oldValue === null || oldValue === undefined) return `${FIRST_SET} → ${JSON.stringify(newValue)}`;
  const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (isObj(oldValue) && isObj(newValue)) {
    const keys = [...new Set([...Object.keys(oldValue), ...Object.keys(newValue)])].sort();
    const parts: string[] = [];
    for (const k of keys) {
      const o = k in oldValue ? JSON.stringify(oldValue[k]) : 'unset';
      const n = k in newValue ? JSON.stringify(newValue[k]) : 'unset';
      if (o !== n) parts.push(`${k}: ${o} → ${n}`);
    }
    return parts.length ? parts.join('; ') : '(no field changed)';
  }
  return `${JSON.stringify(oldValue)} → ${JSON.stringify(newValue)}`;
}

export interface ChangeRow {
  id: string;
  key: string;
  section: SectionId;
  editClassBadge: string; // text cue (never colour-only)
  changedAt: string;
  actorLabel: string;
  diffSummary: string;
  editLink: { label: string; section: SectionId }; // "Edit this config →" → surface-01
}

export interface ChangeDetail extends ChangeRow {
  tamperEvidence: string; // AC-7.LOG.008.3 integrity indicator
  /** The surface offers NO edit/delete of an audit row — always false, asserted structurally. */
  canMutateAuditRow: false;
}

/** Resolve one change row for the timeline (actor resolved via the store). */
export async function renderChangeRow(store: ConfigSurfaceStore, row: ConfigAuditRow): Promise<ChangeRow> {
  const actor = await store.resolveActor(row.actor_id);
  const spec = keySpec(row.key);
  const section = owningSection(row.key);
  return {
    id: row.id,
    key: row.key,
    section,
    editClassBadge: spec ? editClassBadge(spec) : 'unknown class',
    changedAt: row.changed_at,
    actorLabel: renderActor(row, actor),
    diffSummary: renderDiff(row.old_value, row.new_value),
    editLink: { label: 'Edit this config →', section },
  };
}

/** The full Change Detail drawer for one row (Section B), including the tamper-evidence indicator. */
export async function renderChangeDetail(store: ConfigSurfaceStore, row: ConfigAuditRow): Promise<ChangeDetail> {
  const base = await renderChangeRow(store, row);
  const ok = await store.verifyIntegrity(row);
  return {
    ...base,
    tamperEvidence: ok
      ? 'Integrity verified — this entry is unmodified since it was recorded (append-only).'
      : 'INTEGRITY CHECK FAILED — this entry may have been modified after it was recorded (AC-7.LOG.008.3).',
    canMutateAuditRow: false,
  };
}

export interface ExportResult {
  rowCount: number;
  from: string;
  to: string;
  /** the attestation line the export carries (AC-7.LOG.008.1 — states range + row count). */
  attestation: string;
  rows: ConfigAuditRow[];
}

/**
 * The Compliance Export (Section C). ALL-OR-NOTHING: returns every row in range+scope with an attestation, or
 * THROWS (the caller surfaces the Error state "Export couldn't complete — no partial file was produced"). It
 * never returns a truncated set as if complete. Gated by PERM-compliance.download_records (enforced in the store).
 */
export async function exportTrail(store: ConfigSurfaceStore, req: ExportRequest): Promise<ExportResult> {
  const rows = await store.exportAudit(req); // throws on missing perm OR any integrity failure (all-or-fail)
  return {
    rowCount: rows.length,
    from: req.filter.from,
    to: req.filter.to,
    attestation: `Config-change audit export — ${rows.length} row(s) over ${req.filter.from} … ${req.filter.to}, scoped to your permitted config sections. Complete export (no truncation).`,
    rows,
  };
}
