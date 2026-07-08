// ISSUE-086 — the per-section Save engine (surface-01 §Layout edit-class rules + per-section Save, OD-101/103;
// config-edit-taxonomy rules 4/5). One Save per section (OD-103). The pipeline, in order, is fail-closed at
// every gate:
//   1. PERM gate — the caller must be able to VIEW/edit the section (#2). #infra/#secrets Super-Admin-only.
//   2. Confirm gate (OD-101) — a dirtied BOOT row needs the "requires a redeploy" confirm; REBUILD
//      (embedding_model) ALWAYS confirms; slack_token_rotation_enabled false→true is an irreversible confirm.
//      If a required confirm is missing, NOTHING is written — the caller is told which confirms are owed.
//   3. Validate-ALL-before-write — locked/hard-limit floors (#2) + the section cross-constraints (#3). ANY
//      violation blocks the WHOLE batch (never a partial write that leaves a section half-valid — #1/#3).
//   4. Write — ATOMICALLY via store.writeBatch: every (putConfigValue + appendAudit) pair runs in ONE
//      transaction, so the whole section commits or none of it does (no half-saved section #1, no config
//      change without its audit row #3). SECRET/hard-limit keys never reach here — screened at step 3
//      (lockViolations) and re-guarded fail-closed in the store (AC-7.LOG.008.5, #2).

import { canViewSection, SECTIONS, type Caller, type SectionDef, type SectionId } from './sections.ts';
import { keySpec, sectionKeys, type ConfirmKind } from './keys.ts';
import { crossConstraints, lockViolations, type Violation } from './validation.ts';
import type { ConfigSurfaceStore } from './store.ts';

/** A confirmation the operator has acknowledged before Save. */
export type ConfirmToken = 'redeploy' | ConfirmKind; // 'redeploy' | 'rebuild' | 'irreversible'

/** One dirtied row in the Save batch. */
export interface DirtiedRow {
  oldValue: unknown | null; // the current value (null on first-ever write)
  newValue: unknown;
}

export interface SaveInput {
  section: SectionId;
  caller: Caller;
  /** key → {oldValue, newValue} for every row the operator edited in this section. */
  dirtied: ReadonlyMap<string, DirtiedRow>;
  /** the section's currently-loaded values (key → value) — the cross-constraint baseline. */
  current: ReadonlyMap<string, unknown>;
  /** the confirms the operator has acknowledged. */
  confirmations: ReadonlySet<ConfirmToken>;
  actorId: string; // ADR-004 — every config save is actor-attributed
  now: number; // logical epoch seconds (deterministic)
}

export interface SaveResult {
  ok: boolean;
  /** confirms that must be acknowledged before this batch can be written (empty when ok or when blocked by violations). */
  requiredConfirms: ConfirmToken[];
  violations: Violation[];
  writtenKeys: string[];
  auditIds: string[];
  /** set when the caller is not permitted to edit this section (#2). */
  forbidden?: boolean;
  reason?: string;
}

function sectionDef(id: SectionId): SectionDef {
  const s = SECTIONS.find((x) => x.id === id);
  if (!s) throw new Error(`unknown section '${id}'`);
  return s;
}

/** Which confirms this batch requires (OD-101 / taxonomy rule 5). */
export function requiredConfirmsFor(dirtied: ReadonlyMap<string, DirtiedRow>): ConfirmToken[] {
  const out = new Set<ConfirmToken>();
  for (const [key, row] of dirtied) {
    const spec = keySpec(key);
    if (!spec) continue; // unknown/locked keys are caught by lockViolations, not confirms
    if (spec.editClass === 'BOOT') out.add('redeploy');
    if (spec.confirm === 'rebuild') out.add('rebuild'); // embedding_model — always confirm
    if (spec.confirm === 'irreversible') {
      // slack_token_rotation_enabled: only the false→true transition is irreversible (OD-040).
      if (row.newValue === true && row.oldValue !== true) out.add('irreversible');
    }
  }
  return [...out];
}

/**
 * Run the Save pipeline for one section. Writes are performed ONLY when the PERM gate, the confirm gate, and
 * ALL validation pass — otherwise nothing is written and the result explains why.
 */
export async function saveSection(store: ConfigSurfaceStore, input: SaveInput): Promise<SaveResult> {
  const def = sectionDef(input.section);

  // 1. PERM gate (#2). #secrets is read-only — no Save exists there at all.
  if (def.readOnly) {
    return { ok: false, requiredConfirms: [], violations: [], writtenKeys: [], auditIds: [], forbidden: true, reason: `section '${input.section}' is read-only (no Save control)` };
  }
  if (!canViewSection(input.caller, def)) {
    return { ok: false, requiredConfirms: [], violations: [], writtenKeys: [], auditIds: [], forbidden: true, reason: `caller lacks ${def.node} for section '${input.section}'` };
  }

  const dirtiedKeys = [...input.dirtied.keys()];

  // 2. Confirm gate (OD-101 / rule 5). A missing confirm blocks the whole batch — no writes.
  const required = requiredConfirmsFor(input.dirtied);
  const missing = required.filter((c) => !input.confirmations.has(c));
  if (missing.length > 0) {
    return { ok: false, requiredConfirms: missing, violations: [], writtenKeys: [], auditIds: [], reason: 'awaiting confirmation' };
  }

  // 3. Validate-ALL-before-write. Locked/hard-limit floors (#2) + section cross-constraints (#3).
  const merged = new Map<string, unknown>(input.current);
  for (const [key, row] of input.dirtied) merged.set(key, row.newValue);
  const violations = [...lockViolations(dirtiedKeys), ...crossConstraints(input.section, merged)];
  if (violations.length > 0) {
    return { ok: false, requiredConfirms: [], violations, writtenKeys: [], auditIds: [], reason: 'validation failed — nothing written' };
  }

  // 4. Write — ATOMICALLY. The whole batch commits or none of it does (store.writeBatch wraps every
  //    putConfigValue+appendAudit pair in ONE transaction). A mid-batch failure never leaves a section
  //    half-saved (#1) or a config change with no audit row (#3). SECRET/hard-limit keys are already
  //    screened out above (lockViolations) and re-guarded fail-closed inside the store (#2). Every save is
  //    actor-attributed (ADR-004).
  const batch = [...input.dirtied].map(([key, row]) => ({ key, value: row.newValue, old_value: row.oldValue, new_value: row.newValue }));
  try {
    const { writtenKeys, auditIds } = await store.writeBatch(batch, input.actorId, input.now);
    return { ok: true, requiredConfirms: [], violations: [], writtenKeys, auditIds };
  } catch (err) {
    // The transaction rolled back — nothing was persisted. Surface a LOUD, clean failure (#3) rather than
    // leaving the caller to believe a partial write succeeded; never swallow it silently.
    return {
      ok: false,
      requiredConfirms: [],
      violations: [],
      writtenKeys: [],
      auditIds: [],
      reason: `write failed atomically — nothing persisted: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** The Save button is only rendered when the section has loaded cleanly (states.ts decides); a helper that a
 *  section render uses to know whether a Save control should exist at all (read-only sections never have one). */
export function sectionHasSave(section: SectionId): boolean {
  return !sectionDef(section).readOnly && sectionKeys(section).length > 0;
}
