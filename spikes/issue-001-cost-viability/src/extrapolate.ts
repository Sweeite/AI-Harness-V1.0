/**
 * Extrapolate measured per-unit costs to $/day against the declared profile (ISSUE-001 steps 4–5).
 *
 * daily = tasks/day × (one task) + survivors/day × (one surviving write)
 *       + (write-events/day − survivors/day) × (one Haiku gate)   [non-survivors: gate only]
 *       + loop idle-gate cost                                     [~0, code-level — ADR-003 lever 3]
 *
 * The whole figure is round-up (ADR-003 §3): per-attempt costs already include retries, and we
 * ceil the daily total to the cent so the estimate is biased ABOVE reality, never below.
 */
import type { WorkloadProfile } from './profile.js';

export interface PerUnitCosts {
  taskUsd: number; // one full multi-agent task
  survivingWriteUsd: number; // one surviving memory write (1 Sonnet + 3 Haiku + 1 embed)
  haikuGateUsd: number; // one Haiku selective-write gate call (the non-survivor cost)
}

export interface DailyEstimate {
  perDayUsd: number;
  breakdown: {
    tasksUsd: number;
    survivingWritesUsd: number;
    nonSurvivingWritesUsd: number;
    loopIdleUsd: number;
  };
  nonSurvivingEvents: number;
}

function ceilCents(usd: number): number {
  return Math.ceil(usd * 100) / 100;
}

export function extrapolateDaily(units: PerUnitCosts, profile: WorkloadProfile): DailyEstimate {
  const tasksUsd = profile.realTasksPerDay * units.taskUsd;
  const survivingWritesUsd = profile.survivingWritesPerDay * units.survivingWriteUsd;
  const nonSurvivingEvents = Math.max(0, profile.writeEventsPerDay - profile.survivingWritesPerDay);
  const nonSurvivingWritesUsd = nonSurvivingEvents * units.haikuGateUsd;
  // Loop idle-gating is a DB/condition pre-check before orchestrator spin-up (ADR-003 §7 lever 3):
  // code-level, no model call. Spin-ups that become real tasks are already counted in realTasksPerDay.
  const loopIdleUsd = 0;

  const raw = tasksUsd + survivingWritesUsd + nonSurvivingWritesUsd + loopIdleUsd;
  return {
    perDayUsd: ceilCents(raw),
    breakdown: {
      tasksUsd: ceilCents(tasksUsd),
      survivingWritesUsd: ceilCents(survivingWritesUsd),
      nonSurvivingWritesUsd: ceilCents(nonSurvivingWritesUsd),
      loopIdleUsd,
    },
    nonSurvivingEvents,
  };
}
