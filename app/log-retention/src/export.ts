// ISSUE-077 §8 step 3 — the guardrail_log client-presentable export (FR-7.LOG.007.1 / NFR-CMP.009).
//
// The export is the client's TRUST EVIDENCE (design L2902): a faithful, COMPLETE extract of the selected date
// window. Two hard invariants:
//   • ALL-OR-NOTHING (NFR-CMP.009 / AC-NFR-CMP.009.1): the export reconciles the fetched rows against an
//     INDEPENDENT COUNT(*) over the same window. On ANY shortfall it FAILS LOUD — it never emits a partial file
//     that claims to be complete, and never silently truncates. (AF-133 covers this at scale.)
//   • PERM-GATED (AC-7.LOG.007.1): the export action requires PERM-compliance.download_records — Super Admin,
//     UNSEEDED by default (PERMISSION_NODES.md L110; cited at use in component-07-observability.md L398). An
//     unpermitted caller is refused; the export never runs.
//
// The redaction-tombstone (FR-7.LOG.007.4) keeps an export COMPLETE while a subject is unidentifiable: a
// tombstoned row is STILL exported (its security event + audit metadata survive), with `description` = the
// scrub sentinel. So an erasure never creates a "missing event" hole in the trust evidence.

import type { GuardrailLogRow } from "./types.ts";
import type { GuardrailLogStore } from "./store.ts";

/** The permission node that authorises the guardrail_log export (PERMISSION_NODES.md L110). */
export const PERM_DOWNLOAD_RECORDS = "PERM-compliance.download_records";

export class ExportPermissionDenied extends Error {
  constructor() {
    super(
      `guardrail_log export refused: caller lacks ${PERM_DOWNLOAD_RECORDS} (Super Admin, unseeded by default — ` +
        `PERMISSION_NODES.md L110). The export is client trust evidence and is authority-gated (#2).`,
    );
    this.name = "ExportPermissionDenied";
  }
}

export class ExportReconciliationShortfall extends Error {
  constructor(
    public expected: number,
    public got: number,
  ) {
    super(
      `guardrail_log export FAILED: reconciliation shortfall — expected ${expected} row(s) in the window but ` +
        `assembled ${got}. All-or-nothing (NFR-CMP.009): refusing to emit a silently-truncated "complete" file (#1/#3).`,
    );
    this.name = "ExportReconciliationShortfall";
  }
}

/** A single presentable export record — a faithful projection of a guardrail_log row (no business-content
 *  invention). A redaction-tombstoned row exports with its scrubbed description sentinel, never omitted. */
export interface GuardrailExportRecord {
  id: string;
  task_id: string | null;
  guardrail_type: GuardrailLogRow["guardrail_type"];
  description: string; // "[redacted]" if the subject was erased — the event is still present
  action_blocked: boolean;
  status: GuardrailLogRow["status"];
  reviewed_by: string | null;
  reviewed_at: string | null;
  escalated_at: string | null;
  redacted: boolean; // surfaced so the client can see an authorized erasure occurred (not a hidden gap)
  created_at: string;
}

export interface GuardrailExport {
  window: { from: string; to: string };
  generated_at: string; // ISO-8601, server-authoritative
  row_count: number; // == records.length, reconciled against the independent count
  complete: true; // only ever set on a reconciled, all-or-nothing export (else we throw before constructing it)
  records: GuardrailExportRecord[];
}

export interface ExportCaller {
  /** The permission nodes the caller holds (from C1 RBAC — this slice consumes, it does not seed the catalog). */
  permissions: ReadonlySet<string>;
}

/** Produce a complete, reconciled guardrail_log export over [from, to], gated on PERM-compliance.download_records.
 *  Throws ExportPermissionDenied if unauthorised; throws ExportReconciliationShortfall on ANY count mismatch. */
export async function exportGuardrailLog(
  store: GuardrailLogStore,
  caller: ExportCaller,
  fromIso: string,
  toIso: string,
  now: () => Date,
): Promise<GuardrailExport> {
  // (1) PERM gate — Super Admin (unseeded). No authority ⇒ no export (AC-7.LOG.007.1).
  if (!caller.permissions.has(PERM_DOWNLOAD_RECORDS)) throw new ExportPermissionDenied();

  // (2) Fetch the window AND an independent count, then reconcile (all-or-nothing — AC-NFR-CMP.009.1 / AF-133).
  const rows = await store.inRange(fromIso, toIso);
  const expected = await store.countInRange(fromIso, toIso);
  if (rows.length !== expected) throw new ExportReconciliationShortfall(expected, rows.length);

  // (3) Only NOW — after a clean reconciliation — do we construct the complete export. A tombstoned row is
  //     present (never omitted), surfacing that an authorized redaction occurred.
  const records: GuardrailExportRecord[] = rows.map((r) => ({
    id: r.id,
    task_id: r.task_id,
    guardrail_type: r.guardrail_type,
    description: r.description,
    action_blocked: r.action_blocked,
    status: r.status,
    reviewed_by: r.reviewed_by,
    reviewed_at: r.reviewed_at,
    escalated_at: r.escalated_at,
    redacted: r.redacted_at !== null,
    created_at: r.created_at,
  }));

  return {
    window: { from: fromIso, to: toIso },
    generated_at: now().toISOString(),
    row_count: records.length,
    complete: true,
    records,
  };
}
