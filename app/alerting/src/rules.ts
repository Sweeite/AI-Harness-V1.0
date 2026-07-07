// ISSUE-075 §8 step 3 — the seven alert rules as an evaluation pass with per-deployment configurable
// thresholds (FR-7.ALR.002). Each rule is a pure function of (signal, threshold, server-now) → whether it
// fires + the notification it would raise. `hard_limit_hit` is ALWAYS-ON and NON-SUPPRESSIBLE
// (AC-7.ALR.002.2). "loop missed" references the C5 catch-up (FR-5.LOP.*), NOT a C7 re-run (AC-7.ALR.002.3).
//
// The rule layer produces a RaisedAlert (type + severity + title/body + the entity it concerns); routing +
// escalation + delivery are downstream (engine.ts). All time math uses a single server-authoritative `now`
// (ms) supplied by the caller — never a client/reporter clock (FR-7.ALR.005.3 / AF-120).

import type { AlertType, RuleType, Severity } from "./types.ts";

// ── per-deployment configurable thresholds (FR-7.ALR.002.1) ──────────────────────────────────────────
export interface RuleThresholds {
  /** task_failure_spike: N failures within X ms. */
  task_failure_spike: { failures: number; window_ms: number };
  /** queue_backup: N pending for X+ ms. */
  queue_backup: { pending: number; for_ms: number };
  /** memory_confidence_drop: avg confidence below this (0..1). */
  memory_confidence_drop: { below: number };
  /** approval_queue_stale: an item waiting longer than this. */
  approval_queue_stale: { after_ms: number };
  /** cost_threshold_breach: daily/weekly spend over these (estimate-grade). */
  cost_threshold_breach: { daily: number; weekly: number };
  /** loop_missed has no numeric threshold — any missed scheduled run fires (references C5 catch-up). */
}

/** hard_limit_hit is deliberately NOT in RuleThresholds — it has no configurable threshold and cannot be
 *  suppressed (AC-7.ALR.002.2); it fires on the C6 event itself (engine.deliverHardLimit). */

// ── the raw signals the rules read (produced by their home components; C7 only evaluates) ────────────
export interface Signals {
  /** task-failure timestamps (ms, server-authoritative) within the recent window. */
  taskFailureTimestamps: readonly number[];
  /** the oldest pending queue item's enqueue time (ms) + current pending count. */
  queue: { pending: number; oldestEnqueuedAtMs: number | null };
  /** current average memory confidence (0..1) or null if unknown. */
  avgMemoryConfidence: number | null;
  /** approval items: id → the reviewer + when it entered awaiting_approval (ms). */
  approvalItems: readonly { itemId: string; reviewer: string | null; awaitingSinceMs: number }[];
  /** running estimate-grade spend (rounded up per ADR-003). */
  spend: { dailyTokens: number; weeklyTokens: number };
  /** loops that missed their scheduled run this pass (C5 owns the catch-up). */
  missedLoops: readonly { loopId: string }[];
}

export interface RaisedAlert {
  type: AlertType;
  severity: Severity;
  title: string;
  body: string;
  /** the entity the alert concerns (task/loop/approval-item id), for routing + audit entity_ids. */
  entityId: string | null;
  /** for a stale-approval alert: the specific reviewer to deliver to (AC-7.ALR.003.1). */
  approvalReviewer?: string | null;
}

const CONFIGURABLE: Record<RuleType, boolean> = {
  task_failure_spike: true,
  queue_backup: true,
  memory_confidence_drop: true,
  approval_queue_stale: true,
  hard_limit_hit: false, // ALWAYS-ON, non-suppressible (AC-7.ALR.002.2)
  cost_threshold_breach: true,
  loop_missed: true,
};

export function isSuppressible(rule: RuleType): boolean {
  return CONFIGURABLE[rule];
}

/**
 * Evaluate the six THRESHOLD rules against the signals at server time `nowMs`. hard_limit_hit is delivered
 * event-driven (not evaluated here — engine.deliverHardLimit). Returns every alert that fired this pass.
 * `suppressed` (a per-deployment on/off set) can silence a CONFIGURABLE rule but is IGNORED for the
 * always-on rule — which isn't evaluated here anyway, closing the "suppress hard_limit" hole by construction.
 */
export function evaluateRules(
  signals: Signals,
  t: RuleThresholds,
  nowMs: number,
  suppressed: ReadonlySet<RuleType> = new Set(),
): RaisedAlert[] {
  const out: RaisedAlert[] = [];
  const on = (rule: RuleType) => !suppressed.has(rule); // only ever consulted for configurable rules

  // 1. task_failure_spike — N failures within window_ms of now.
  if (on("task_failure_spike")) {
    const cutoff = nowMs - t.task_failure_spike.window_ms;
    const recent = signals.taskFailureTimestamps.filter((ts) => ts >= cutoff);
    if (recent.length >= t.task_failure_spike.failures) {
      out.push({
        type: "task_failure_spike",
        severity: "warning",
        title: "Task-failure spike",
        body: `${recent.length} task failures in the last ${t.task_failure_spike.window_ms} ms (threshold ${t.task_failure_spike.failures}).`,
        entityId: null,
      });
    }
  }

  // 2. queue_backup — pending ≥ N AND the oldest has waited ≥ for_ms.
  if (on("queue_backup")) {
    const { pending, oldestEnqueuedAtMs } = signals.queue;
    const waited = oldestEnqueuedAtMs === null ? 0 : nowMs - oldestEnqueuedAtMs;
    if (pending >= t.queue_backup.pending && waited >= t.queue_backup.for_ms) {
      out.push({
        type: "queue_backup",
        severity: "warning",
        title: "Queue backup",
        body: `${pending} pending tasks, oldest waiting ${waited} ms (threshold ${t.queue_backup.pending} for ${t.queue_backup.for_ms} ms).`,
        entityId: null,
      });
    }
  }

  // 3. memory_confidence_drop — avg confidence strictly below threshold (unknown never fires a false-green).
  if (on("memory_confidence_drop")) {
    const avg = signals.avgMemoryConfidence;
    if (avg !== null && avg < t.memory_confidence_drop.below) {
      out.push({
        type: "memory_confidence_drop",
        severity: "warning",
        title: "Memory confidence drop",
        body: `Average memory confidence ${avg} below threshold ${t.memory_confidence_drop.below}; flagged for review.`,
        entityId: null,
      });
    }
  }

  // 4. approval_queue_stale — one alert per item waiting longer than after_ms, to its SPECIFIC reviewer.
  if (on("approval_queue_stale")) {
    for (const item of signals.approvalItems) {
      const waited = nowMs - item.awaitingSinceMs;
      if (waited >= t.approval_queue_stale.after_ms) {
        out.push({
          type: "approval_queue_stale",
          severity: "warning",
          title: "Approval waiting too long",
          body: `Approval item ${item.itemId} has waited ${waited} ms (threshold ${t.approval_queue_stale.after_ms} ms).`,
          entityId: item.itemId,
          approvalReviewer: item.reviewer,
        });
      }
    }
  }

  // 5. cost_threshold_breach — daily OR weekly spend over threshold (estimate-grade, ADR-003).
  if (on("cost_threshold_breach")) {
    const overDaily = signals.spend.dailyTokens > t.cost_threshold_breach.daily;
    const overWeekly = signals.spend.weeklyTokens > t.cost_threshold_breach.weekly;
    if (overDaily || overWeekly) {
      out.push({
        type: "cost_threshold_breach",
        severity: "warning",
        title: "Cost threshold breach",
        body: `Estimated spend over threshold (daily ${signals.spend.dailyTokens}/${t.cost_threshold_breach.daily}, weekly ${signals.spend.weeklyTokens}/${t.cost_threshold_breach.weekly}).`,
        entityId: null,
      });
    }
  }

  // 6. loop_missed — any missed scheduled run; references the C5 catch-up, NOT a C7 re-run (AC-7.ALR.002.3).
  if (on("loop_missed")) {
    for (const loop of signals.missedLoops) {
      out.push({
        type: "loop_missed",
        severity: "warning",
        title: "Loop missed its scheduled run",
        body: `Loop ${loop.loopId} missed its scheduled run; catch-up is handled by C5 (FR-5.LOP.*), not a C7 re-run.`,
        // A loop is identified by a human-readable name/slug (e.g. "fast"/"loop-daily"), never a uuid — it
        // cannot go into event_log.entity_ids (uuid[]). The loop name is already carried in `body` above.
        entityId: null,
      });
    }
  }

  return out;
}

/** The hard-limit alert (C6 event → immediate C7 delivery, always). NOT built via evaluateRules — it is
 *  event-driven + non-suppressible, so it can never be config'd off (AC-7.ALR.002.2 / AC-7.ALR.007.1). */
export function hardLimitAlert(limitName: string, taskId: string | null): RaisedAlert {
  return {
    type: "hard_limit_hit",
    severity: "critical",
    title: "Hard limit hit",
    body: `Hard limit '${limitName}' was hit — immediate dashboard + Slack alert (always-on, C6 event → C7 delivery).`,
    entityId: taskId,
  };
}
