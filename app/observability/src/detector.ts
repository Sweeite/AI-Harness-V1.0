// ISSUE-011 §8 steps 4 + 6 — the silent-failure detector + the cross-sink reconciliation. These are the
// load-bearing #3 data signals: a terminal task with no terminal event (step 4, AC-7.LOG.003.1 /
// NFR-OBS.001), and a guardrail_log row without its event_log guardrail_hit counterpart (step 6,
// AC-7.LOG.003.3 / NFR-OBS.003). They produce the FINDINGS; the failure-health VIEW is Phase 3 (ISSUE-078).

import { isTerminalEventType } from "./types.ts";
import type { EventLogRow, GuardrailLogRow, TaskTerminalRow } from "./types.ts";

// ── Silent-failure detector (terminal task_queue status ⋈ terminal event_log event) ─────────────────

export type SilentFailureKind =
  | "missing_terminal_event" // terminal task status, but NO terminal event — the canonical silent failure
  | "multiple_terminal_events"; // > 1 terminal event for one task — the append-only invariant broke

export interface SilentFailureFinding {
  task_id: string;
  kind: SilentFailureKind;
  detail: string;
  /** The terminal task_queue status that was expected to have a matching terminal event. */
  task_status: string;
  terminal_event_count: number;
}

/**
 * Join terminal task_queue rows against terminal event_log rows. AC-7.LOG.003.1 / AC-NFR-OBS.001.1/.2:
 *   - exactly ONE terminal event per task_id (0 → missing gap; ≥2 → invariant break)
 *   - a terminal task status with zero terminal events is FLAGGED (not silently ignored)
 */
export function detectSilentFailures(
  terminalTasks: readonly TaskTerminalRow[],
  events: readonly EventLogRow[],
): SilentFailureFinding[] {
  // Count terminal events per task_id.
  const terminalEventCount = new Map<string, number>();
  for (const e of events) {
    if (e.task_id !== null && isTerminalEventType(e.event_type)) {
      terminalEventCount.set(e.task_id, (terminalEventCount.get(e.task_id) ?? 0) + 1);
    }
  }

  const findings: SilentFailureFinding[] = [];
  for (const t of terminalTasks) {
    const count = terminalEventCount.get(t.task_id) ?? 0;
    if (count === 0) {
      findings.push({
        task_id: t.task_id,
        kind: "missing_terminal_event",
        detail:
          `task ${t.task_id} reached terminal task_queue status '${t.status}' but has NO terminal ` +
          `event_log event — a silent failure (#3), flagged not ignored`,
        task_status: t.status,
        terminal_event_count: 0,
      });
    } else if (count > 1) {
      findings.push({
        task_id: t.task_id,
        kind: "multiple_terminal_events",
        detail:
          `task ${t.task_id} has ${count} terminal event_log events — the "exactly one terminal event ` +
          `per task" invariant broke (AC-7.LOG.003.1)`,
        task_status: t.status,
        terminal_event_count: count,
      });
    }
  }
  return findings;
}

/**
 * The build-time terminal-event invariant (AC-7.LOG.003.1, the "+ invariant test" in §9): across ALL tasks
 * that have any terminal event, each has exactly one. Returns the offending task_ids (empty = invariant holds).
 */
export function terminalEventInvariantViolations(events: readonly EventLogRow[]): string[] {
  const counts = new Map<string, number>();
  for (const e of events) {
    if (e.task_id !== null && isTerminalEventType(e.event_type)) {
      counts.set(e.task_id, (counts.get(e.task_id) ?? 0) + 1);
    }
  }
  return [...counts.entries()].filter(([, c]) => c !== 1).map(([id]) => id);
}

// ── Cross-sink reconciliation (event_log ⋈ guardrail_log) ────────────────────────────────────────────

export type ReconciliationSide = "guardrail_without_event" | "event_without_guardrail";

export interface ReconciliationFinding {
  side: ReconciliationSide;
  task_id: string;
  detail: string;
}

/**
 * Flag any guardrail_log row without its event_log `guardrail_hit` counterpart, and vice-versa
 * (AC-7.LOG.003.3 / AC-NFR-OBS.003.1). Pairing is per task_id — every guardrail hit on a task must have a
 * matching `guardrail_hit` event on that task, and every `guardrail_hit` event must have a guardrail_log row.
 * The two append-only sinks cannot silently diverge (#3).
 */
export function reconcileSinks(
  events: readonly EventLogRow[],
  guardrailRows: readonly GuardrailLogRow[],
): ReconciliationFinding[] {
  const guardrailHitTasks = new Map<string, number>();
  for (const e of events) {
    if (e.event_type === "guardrail_hit" && e.task_id !== null) {
      guardrailHitTasks.set(e.task_id, (guardrailHitTasks.get(e.task_id) ?? 0) + 1);
    }
  }
  const guardrailLogTasks = new Map<string, number>();
  for (const g of guardrailRows) {
    if (g.task_id !== null) {
      guardrailLogTasks.set(g.task_id, (guardrailLogTasks.get(g.task_id) ?? 0) + 1);
    }
  }

  const findings: ReconciliationFinding[] = [];
  // guardrail_log rows with no event_log guardrail_hit counterpart.
  for (const [taskId, gCount] of guardrailLogTasks) {
    const eCount = guardrailHitTasks.get(taskId) ?? 0;
    if (eCount < gCount) {
      findings.push({
        side: "guardrail_without_event",
        task_id: taskId,
        detail:
          `task ${taskId}: ${gCount} guardrail_log row(s) but only ${eCount} event_log 'guardrail_hit' ` +
          `event(s) — a guardrail hit is missing from the event_log (completeness gap, #3)`,
      });
    }
  }
  // event_log guardrail_hit events with no guardrail_log counterpart.
  for (const [taskId, eCount] of guardrailHitTasks) {
    const gCount = guardrailLogTasks.get(taskId) ?? 0;
    if (gCount < eCount) {
      findings.push({
        side: "event_without_guardrail",
        task_id: taskId,
        detail:
          `task ${taskId}: ${eCount} event_log 'guardrail_hit' event(s) but only ${gCount} guardrail_log ` +
          `row(s) — the guardrail_log is missing a row the event_log recorded (completeness gap, #3)`,
      });
    }
  }
  return findings;
}
