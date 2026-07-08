// ISSUE-058 — the five rate-limit caps as a C6 policy set + the config validator (FR-6.RTL.001 / OD-062).
//
// C6 FRAMES all five caps (never-unlimited, meaningful-finite ceiling) and owns the consistent breach
// response; the COUNTER MECHANISM stays with the home owner — this slice re-implements no counters (OD-062):
//   • rate_limit_tool_writes_per_task     → C3 (connector rate-limit tracker, ISSUE-034)
//   • rate_limit_external_comms_per_hour  → C3 (connector rate-limit tracker, ISSUE-034)
//   • rate_limit_memory_writes_per_minute → C2 (ADR-004, ISSUE-024)
//   • rate_limit_concurrent_tasks         → C5 (queue, ISSUE-048)
//   • max_retries_before_dead_letter      → C5 (job runner, ISSUE-052)
//
// AC-6.RTL.001.1 has two teeth: (a) a guardrail can never be disabled — unlimited/zero-guard is rejected
// (#2 — a guardrail is code, never config-overridable, ADR-007); (b) the L2 refinement — the validator
// ALSO enforces a per-cap MEANINGFUL FINITE ceiling, because an absurdly-high-but-finite value (e.g. 10⁹
// external comms/hour) is "not unlimited" yet functionally unguarded. Defaults + ranges are the
// config-registry.md source of truth (rows verified by the index.ts `check` non-drift guard).

export const CAP_IDS = [
  'rate_limit_tool_writes_per_task',
  'rate_limit_external_comms_per_hour',
  'rate_limit_memory_writes_per_minute',
  'rate_limit_concurrent_tasks',
  'max_retries_before_dead_letter',
] as const;
export type CapId = (typeof CAP_IDS)[number];

/** Which component holds the COUNTER for this cap (OD-062). C6 owns policy + breach response for all five. */
export type CapOwner = 'C2' | 'C3' | 'C5';

export interface CapPolicy {
  readonly id: CapId;
  readonly owner: CapOwner; // home of the counter mechanism (OD-062) — NOT re-implemented here
  readonly default: number;
  /** Meaningful floor. Below this is zero-guard and is rejected. (retries=0 is a strong guard, not zero-guard.) */
  readonly min: number;
  /** Meaningful finite ceiling. Above this is "not unlimited yet functionally unguarded" and is rejected (L2). */
  readonly ceiling: number;
  readonly description: string;
}

// Defaults + ranges per config-registry.md (rows L201-204 + L189). The `check` gate re-verifies these against
// the registry so a drift between this policy set and the deployed config keys is caught before integration.
export const CAP_POLICIES: Readonly<Record<CapId, CapPolicy>> = Object.freeze({
  rate_limit_tool_writes_per_task: {
    id: 'rate_limit_tool_writes_per_task',
    owner: 'C3',
    default: 10,
    min: 1,
    ceiling: 200, // ~20× default (config-registry.md L201)
    description: 'Most changes the agent can make to tools in a single task run',
  },
  rate_limit_external_comms_per_hour: {
    id: 'rate_limit_external_comms_per_hour',
    owner: 'C3',
    default: 5,
    min: 1,
    ceiling: 100, // ~20× default (config-registry.md L202)
    description: 'Most outside messages the agent can send per hour',
  },
  rate_limit_memory_writes_per_minute: {
    id: 'rate_limit_memory_writes_per_minute',
    owner: 'C2',
    default: 30,
    min: 1,
    ceiling: 300, // ~10× default (config-registry.md L203)
    description: 'Most updates the agent can make to its memory per minute',
  },
  rate_limit_concurrent_tasks: {
    id: 'rate_limit_concurrent_tasks',
    owner: 'C5',
    default: 5,
    min: 1,
    ceiling: 50, // ~10× default (config-registry.md L204)
    description: 'Most tasks the agent can work on at the same time',
  },
  max_retries_before_dead_letter: {
    id: 'max_retries_before_dead_letter',
    owner: 'C5',
    default: 3,
    min: 0, // 0 retries = immediate dead-letter = a strong guard, not "zero-guard"
    ceiling: 20, // finite ceiling — the config-registry range (`int ≥ 0`) is UNBOUNDED; see sharedSpecEdits
    description: 'How many times a failing task retries before it is set aside for a human',
  },
});

export type CapValidation = { ok: true; value: number } | { ok: false; reason: string };

const UNLIMITED_SENTINELS = new Set(['', 'unlimited', 'none', 'off', 'null', 'inf', 'infinity', '-1']);

/**
 * Validate an operator's attempt to set a cap. Rejects (AC-6.RTL.001.1):
 *   • unlimited / zero-guard — null/undefined, an unlimited sentinel string, a non-finite number, a
 *     non-integer, or a value below the cap's meaningful floor (`min`);
 *   • an absurd-but-finite value above the cap's meaningful ceiling (functionally unguarded — L2 refinement).
 * A guardrail can never be disabled (#2) — this returns a LOUD reason on rejection, never a silent default (#3).
 */
export function validateCapConfig(cap: CapId, raw: unknown): CapValidation {
  const policy = CAP_POLICIES[cap];
  if (raw === null || raw === undefined) {
    return { ok: false, reason: `${cap}: a guardrail cannot be unset/unlimited (got ${String(raw)}) — a cap is never disable-able (#2, ADR-007).` };
  }

  let n: number;
  if (typeof raw === 'number') {
    n = raw;
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim().toLowerCase();
    if (UNLIMITED_SENTINELS.has(trimmed)) {
      return { ok: false, reason: `${cap}: '${raw}' means unlimited/disabled — rejected; a guardrail cannot be turned off (#2).` };
    }
    // Only a clean integer literal is accepted; anything else is not a valid finite cap.
    if (!/^-?\d+$/.test(trimmed)) {
      return { ok: false, reason: `${cap}: '${raw}' is not an integer cap value.` };
    }
    n = Number(trimmed);
  } else {
    return { ok: false, reason: `${cap}: cap must be an integer, got ${typeof raw}.` };
  }

  if (!Number.isFinite(n)) {
    return { ok: false, reason: `${cap}: ${n} is not finite — an infinite cap is unlimited, rejected (#2).` };
  }
  if (!Number.isInteger(n)) {
    return { ok: false, reason: `${cap}: ${n} is not an integer.` };
  }
  if (n < policy.min) {
    return { ok: false, reason: `${cap}: ${n} is below the meaningful floor ${policy.min} — a zero-guard cap is rejected (#2).` };
  }
  if (n > policy.ceiling) {
    return { ok: false, reason: `${cap}: ${n} exceeds the meaningful ceiling ${policy.ceiling} — an absurd-but-finite cap is functionally unguarded (AC-6.RTL.001.1 L2), rejected.` };
  }
  return { ok: true, value: n };
}
