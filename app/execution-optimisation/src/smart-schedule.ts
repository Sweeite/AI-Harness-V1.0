// ISSUE-054 (C5 OPT) — FR-5.OPT.002 Smart scheduling. Build order step 3. When smart_scheduling_enabled is ON,
// eligible NON-URGENT scheduled tasks defer to a quiet-queue window instead of dispatching into a busy queue; when
// OFF they run on their plain cadence (AC-5.OPT.002.1). This is queue-window deferral of scheduled tasks — NOT loop
// registration (that is C5 LOP / ISSUE-051) and NOT priority ordering (task_priority_scheme, ISSUE-048). It reads
// task_queue.priority/status via an INJECTED queue-state port (task_queue owned by ISSUE-048); it defers DISPATCH,
// never mutating the row's status here.
//
// Invariant: an URGENT task is NEVER deferred — congestion avoidance must not delay urgent work (#2/#3). "Eligible"
// = non-urgent AND schedulable-later. The FLAG-OFF path is the plain cadence, proving the layer is additive.

import type { OptConfig } from './config.ts';
import { resolveConfig } from './config.ts';

/** A scheduled task as the smart scheduler sees it (subset of task_queue). */
export interface ScheduledTask {
  task_id: string;
  /** urgent tasks bypass deferral entirely — they always run on cadence (#2/#3). */
  urgent: boolean;
  /** the task's plain next-run time (its cadence tick) — the fallback when not deferred. */
  cadence_run_at: number; // epoch ms
  /** OPTIONAL latest-safe-run deadline (epoch ms). "Schedulable-later" means a deferral still lands on-or-before
   * this bound; if deferring to the quiet window would push the task PAST it, the task is NOT deferred — it runs on
   * cadence instead. This keeps a non-urgent-but-time-sensitive task from being starved by an indefinitely distant
   * quiet window (#3: no silent, unbounded hold). Absent ⇒ no deadline, defer freely. */
  latest_safe_run_at?: number;
}

/** A snapshot of queue pressure + the next quiet window — supplied by the injected queue-state port (task_queue). */
export interface QueueState {
  /** is the queue currently busy (congested)? Derived from task_queue depth/running count by the caller. */
  busy: boolean;
  /** the start of the next quiet window (epoch ms) — where a deferred task is rescheduled to. */
  next_quiet_window_at: number;
}

export type ScheduleAction = 'run_now' | 'defer';

export interface ScheduleDecision {
  action: ScheduleAction;
  /** when the task should run: its cadence tick (run_now) or the quiet-window start (defer). */
  run_at: number;
  /** plain-English reason — a visible decision, never a silent hold (#3). */
  reason: string;
}

/** Decide whether a scheduled task runs on cadence or defers to the next quiet window. Eligible-to-defer =
 * non-urgent AND schedulable-later (the quiet window still lands on-or-before any latest-safe-run deadline).
 *   • flag OFF                                 → run on plain cadence (additive layer; AC-5.OPT.002.1 disabled arm);
 *   • flag ON + urgent                         → run on cadence (urgent is never deferred, #2/#3);
 *   • flag ON + non-urgent + busy + fits       → DEFER to the next quiet window (AC-5.OPT.002.1 enabled arm);
 *   • flag ON + non-urgent + busy + OVERSHOOTS → run on cadence — deferral would miss the deadline (no starvation, #3);
 *   • flag ON + non-urgent + quiet             → run now (no congestion to avoid). */
export function decideSchedule(task: ScheduledTask, queue: QueueState, cfg: Partial<OptConfig> = {}): ScheduleDecision {
  const config: OptConfig = resolveConfig(cfg);
  if (!config.smartSchedulingEnabled) {
    return { action: 'run_now', run_at: task.cadence_run_at, reason: 'smart_scheduling_enabled off — plain cadence' };
  }
  if (task.urgent) {
    return { action: 'run_now', run_at: task.cadence_run_at, reason: 'urgent task — never deferred (#2/#3)' };
  }
  if (queue.busy) {
    // Only defer if the task is still schedulable-later: the quiet window must not overshoot its latest-safe-run
    // deadline. Otherwise run on cadence — a non-urgent task is never starved in an indefinitely distant window (#3).
    if (task.latest_safe_run_at !== undefined && queue.next_quiet_window_at > task.latest_safe_run_at) {
      return {
        action: 'run_now',
        run_at: task.cadence_run_at,
        reason: 'non-urgent task + busy queue, but the next quiet window is past its latest-safe-run deadline — run on cadence (no starvation, #3)',
      };
    }
    return {
      action: 'defer',
      run_at: queue.next_quiet_window_at,
      reason: 'non-urgent task + busy queue — deferred to the next quiet window (FR-5.OPT.002)',
    };
  }
  return { action: 'run_now', run_at: task.cadence_run_at, reason: 'non-urgent task + quiet queue — run now' };
}
