/**
 * The DECLARED typical-volume workload profile — ISSUE-001 build-order step 0.
 *
 * ADR-003 supplies loop *cadence* only (§5: 144 fast/day, ~24 medium, 1 slow). It does NOT
 * state the task/write volume that dominates cost, and no manifest file quantifies it. So the
 * spike must DECLARE this profile and record it as part of the evidence (step 0/7c) — the
 * $/day number is only meaningful relative to it, and a re-run must be reproducible.
 *
 * These numbers are a defensible default anchored to the ≤~20-user/silo envelope
 * (test-strategy.md §1) and ADR-003 §5 cadence. They are INTENTIONALLY contestable: if the
 * profile itself is disputed, that is an EVAL follow-up under the AF-040/041 threshold-realism
 * umbrella (ISSUE-001 step 0). This spike proves the target holds *for this declared profile*.
 */
export interface WorkloadProfile {
  /** Real multi-agent tasks (orchestrator→research→specialists) per day. */
  realTasksPerDay: number;
  /** Memory events that ENTER the write path per day (before the gate filters them). */
  writeEventsPerDay: number;
  /** Of those, how many SURVIVE to a full write (1 Sonnet + pre-checks + embedding) per day. */
  survivingWritesPerDay: number;
  /** Loop runs/day by cadence (ADR-003 §5). Idle-gated runs cost ~0 model (lever 3). */
  loops: { fast: number; medium: number; slow: number };
  /** Rationale, recorded verbatim into the evidence block. */
  rationale: string;
}

export const TYPICAL_PROFILE: WorkloadProfile = {
  realTasksPerDay: 50,
  writeEventsPerDay: 500,
  survivingWritesPerDay: 100,
  loops: { fast: 144, medium: 24, slow: 1 },
  rationale: [
    'Anchored to a healthy ≤~20-user silo (test-strategy §1) + ADR-003 §5 cadence.',
    '• 50 real multi-agent tasks/day ≈ ~2–3 substantive tasks per active user/day plus a small',
    '  share of loop spin-ups. Loop runs themselves (144 fast + 24 medium + 1 slow = 169/day) are',
    '  idle-gated to ~0 model cost (ADR-003 §7 lever 3: DB/condition pre-check before spin-up);',
    '  the spin-ups that DO become tasks are counted inside the 50.',
    '• 500 write-path events/day, of which ~100 survive (≈20% survival). The other ~400 are',
    '  charged one Haiku gate call each (round-up: we assume they reach the Haiku gate rather than',
    '  dying free at the code filter). 100 survivors ≈ 1–2 durable memories per task.',
    'Contestable by design — dispute routes to an AF-040/041 threshold-realism EVAL, not to this gate.',
  ].join('\n'),
};
