// ISSUE-077 §8 step 2 — the redaction-tombstone (OD-074 / FR-7.LOG.006.3 / FR-7.LOG.007.4 / NFR-CMP.007).
//
// A compliance erasure of a subject scrubs the PII fields of the matching rows IN PLACE (via redacted_at) while
// retaining the row + audit metadata (created_at, event_type/guardrail_type, task_id, outcome). The audit trail
// survives ("an event happened here"); the subject becomes unidentifiable. Key properties:
//   • it is the ONE sanctioned in-place mutation on an append-only sink (NFR-CMP.006 — the trigger permits ONLY
//     null→non-null redacted_at + the whitelisted scrub; nothing else).
//   • after the tombstone, the tamper-evidence integrity check STILL PASSES (AC-7.LOG.007.3) — an authorized
//     redaction is distinguishable from tampering because the digest is recomputed over the post-scrub row
//     (which includes redacted_at); a covert content rewrite (description changed, redacted_at still null) would
//     NOT re-verify.
//   • the erasure is itself LOGGED, and the log must NOT re-embed the erased PII (AC-7.LOG.006.3).
//
// This module is the C7-side scrub-in-place mechanism the C2/C10 transitive erasure walk (ISSUE-029/082)
// INVOKES. AF-137 gates completeness ACROSS the C10→C2→C7 sink boundary (owed to a live transitive-walk spike);
// this slice proves the C7-sink half.

import type { EventLogRow, GuardrailLogRow } from "./types.ts";
import type { EventLogStore, GuardrailLogStore, EventWriteSink } from "./store.ts";
import { guardrailIntegrityDigest } from "./store.ts";

export interface ErasureResult {
  sink: "event_log" | "guardrail_log";
  redacted: string[]; // ids tombstoned
  already_tombstoned: string[]; // ids matched but already redacted (idempotent)
}

interface ErasureCommonDeps {
  now: () => Date;
  writer: EventWriteSink;
}

/** Apply the redaction-tombstone across event_log rows matching `matches` (e.g. by subject entity_id). */
export async function eraseEventLogSubject(
  deps: ErasureCommonDeps & { store: EventLogStore },
  matches: (row: EventLogRow) => boolean,
): Promise<ErasureResult> {
  const { store, now, writer } = deps;
  const redactedAt = now().toISOString();
  const redacted: string[] = [];
  const already: string[] = [];

  for (const row of await store.all()) {
    if (!matches(row)) continue;
    if (row.redacted_at !== null) {
      already.push(row.id);
      continue;
    }
    await store.redactTombstone(row.id, redactedAt);
    redacted.push(row.id);
  }

  await logErasure(writer, "event_log", redacted.length, redactedAt);
  return { sink: "event_log", redacted, already_tombstoned: already };
}

/** Apply the SAME redaction-tombstone across guardrail_log rows — scrub `description`, retain the security event
 *  + audit metadata, so a guardrail export stays complete (no missing events) while the subject is
 *  unidentifiable (AC-7.LOG.007.4). */
export async function eraseGuardrailLogSubject(
  deps: ErasureCommonDeps & { store: GuardrailLogStore },
  matches: (row: GuardrailLogRow) => boolean,
): Promise<ErasureResult> {
  const { store, now, writer } = deps;
  const redactedAt = now().toISOString();
  const redacted: string[] = [];
  const already: string[] = [];

  for (const row of await store.all()) {
    if (!matches(row)) continue;
    if (row.redacted_at !== null) {
      already.push(row.id);
      continue;
    }
    await store.redactTombstone(row.id, redactedAt);
    redacted.push(row.id);
  }

  await logErasure(writer, "guardrail_log", redacted.length, redactedAt);
  return { sink: "guardrail_log", redacted, already_tombstoned: already };
}

/**
 * Verify the tamper-evidence integrity of a guardrail_log row against a previously-recorded baseline digest,
 * telling an AUTHORIZED redaction apart from TAMPERING (AC-7.LOG.007.3 / AC-7.LOG.007.4). Contract:
 *   - if the row's current digest equals `baselineDigest` → intact (never modified).
 *   - else if the ONLY change is an authorized tombstone (redacted_at went null→non-null AND description was
 *     scrubbed to the sentinel) → AUTHORIZED redaction, still trusted.
 *   - else → TAMPERED (a covert content rewrite; the integrity check flags it).
 */
export function verifyGuardrailIntegrity(
  current: GuardrailLogRow,
  baseline: GuardrailLogRow,
  baselineDigest: string,
): { ok: boolean; classification: "intact" | "authorized_redaction" | "tampered"; detail: string } {
  if (guardrailIntegrityDigest(baseline) !== baselineDigest) {
    // The caller handed us a baseline that doesn't match its own digest — a #3 misuse; fail loud.
    return { ok: false, classification: "tampered", detail: "baseline row does not match its recorded digest" };
  }
  if (guardrailIntegrityDigest(current) === baselineDigest) {
    return { ok: true, classification: "intact", detail: "integrity digest unchanged — row never modified" };
  }
  const onlyTombstoneChanged =
    baseline.redacted_at === null &&
    current.redacted_at !== null &&
    current.description === "[redacted]" &&
    // every OTHER immutable field is unchanged
    current.id === baseline.id &&
    current.task_id === baseline.task_id &&
    current.guardrail_type === baseline.guardrail_type &&
    current.action_blocked === baseline.action_blocked &&
    current.status === baseline.status &&
    current.reviewed_by === baseline.reviewed_by &&
    current.reviewed_at === baseline.reviewed_at &&
    current.escalated_at === baseline.escalated_at &&
    current.created_at === baseline.created_at;
  if (onlyTombstoneChanged) {
    return {
      ok: true,
      classification: "authorized_redaction",
      detail: "the ONLY change is an authorized redaction-tombstone (redacted_at set, description scrubbed) — trusted",
    };
  }
  return {
    ok: false,
    classification: "tampered",
    detail: "a non-tombstone content change was detected — TAMPERING (fails the integrity check, AC-7.LOG.007.3)",
  };
}

async function logErasure(writer: EventWriteSink, sink: string, count: number, redactedAt: string): Promise<void> {
  // The erasure is itself a logged operation — but it must NOT re-embed the erased PII (AC-7.LOG.006.3).
  await writer.writeSummary({
    event_type: "reporter_push",
    summary: `compliance erasure applied: ${count} ${sink} row(s) redaction-tombstoned`,
    payload: { op: "compliance_erasure", sink, redacted_count: count, redacted_at: redactedAt },
  });
}
