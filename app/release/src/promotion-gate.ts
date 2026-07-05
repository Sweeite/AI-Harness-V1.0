// ISSUE-080 §8 step 3 — the canary → fleet promotion gate (FR-10.DEP.002, NFR-INF.001).
//
// Promotion (a deliberate operator fast-forward of `release`→`main`, which auto-deploys the fleet) is
// allowed ONLY when ALL FOUR gates are green:
//   1. tests green         — the CI merge-gate suite passed on the candidate commit.
//   2. clean canary migration — the schema migration applied cleanly on the canary's own Supabase.
//   3. green smoke battery — the synthetic-corpus battery passed (NFR-INF.008 / FR-10.PRV.003).
//   4. elapsed soak        — `canary_soak_minutes` have passed since the canary deployed.
// Any red gate BLOCKS promotion and the failing gate(s) are SURFACED (never silently promoted — #3).
//
// In v1 promotion is a DELIBERATE OPERATOR ACTION (OD-094): an automatic/every-commit trigger is refused.
// Automated promotion is deferred until trust is established (config flag later).
//
// This is pure build-time logic — the "promote" mechanism is Git (Railway has no native promote
// primitive, OD-173): "promote" = fast-forward `release`→`main`; a red gate is realised as a BLOCKING
// GitHub status check that stops that fast-forward merge. The live Wait-for-CI scope spike (OD-173 /
// AF-064) is the two-party capstone — see README §Live capstone.

export type Gate = "tests" | "canary_migration" | "smoke_battery" | "soak";

/** Observed state of the candidate release on the canary. Times are epoch-ms (injectable for tests). */
export interface CanaryState {
  testsGreen: boolean;
  canaryMigrationClean: boolean;
  smokeBatteryGreen: boolean;
  /** When the candidate deployed to the canary (epoch ms). null = not yet deployed → soak cannot start. */
  canaryDeployedAt: number | null;
}

export interface GateResult {
  gate: Gate;
  passed: boolean;
  detail: string;
}

export interface PromotionDecision {
  promoted: boolean;
  /** Every gate's result, always all four — so a surfaced refusal names exactly what is red. */
  gates: GateResult[];
  /** The gates that are red (empty iff promoted). */
  failing: Gate[];
  /** Human-surfaced summary (#3 — the failing gate is never silent). */
  reason: string;
}

/** How the promotion was triggered. v1 requires a deliberate operator action (OD-094). */
export type PromotionTrigger = "operator" | "automatic";

export interface PromotionRequest {
  canary: CanaryState;
  config: { canary_soak_minutes: number };
  /** Wall-clock at evaluation (epoch ms). Injected so the soak gate is deterministic in tests. */
  now: number;
  trigger: PromotionTrigger;
}

function evaluateGates(canary: CanaryState, soakMinutes: number, now: number): GateResult[] {
  const soakElapsedMs =
    canary.canaryDeployedAt === null ? 0 : Math.max(0, now - canary.canaryDeployedAt);
  const soakNeededMs = soakMinutes * 60_000;
  const soakPassed = canary.canaryDeployedAt !== null && soakElapsedMs >= soakNeededMs;
  const soakMinsElapsed = Math.floor(soakElapsedMs / 60_000);

  return [
    {
      gate: "tests",
      passed: canary.testsGreen,
      detail: canary.testsGreen ? "test suite green" : "test suite RED",
    },
    {
      gate: "canary_migration",
      passed: canary.canaryMigrationClean,
      detail: canary.canaryMigrationClean ? "canary migration applied cleanly" : "canary migration FAILED",
    },
    {
      gate: "smoke_battery",
      passed: canary.smokeBatteryGreen,
      detail: canary.smokeBatteryGreen ? "smoke battery green" : "smoke battery RED",
    },
    {
      gate: "soak",
      passed: soakPassed,
      detail:
        canary.canaryDeployedAt === null
          ? "soak not started (canary not deployed)"
          : soakPassed
            ? `soak complete (${soakMinsElapsed} ≥ ${soakMinutes} min)`
            : `soak INCOMPLETE (${soakMinsElapsed}/${soakMinutes} min elapsed)`,
    },
  ];
}

/**
 * Decide whether to promote the canary to the fleet. Refuses (with a surfaced reason) on any red gate
 * OR on a non-operator trigger in v1. Never throws — a refusal is a first-class result, not an error.
 */
export function evaluatePromotion(req: PromotionRequest): PromotionDecision {
  const gates = evaluateGates(req.canary, req.config.canary_soak_minutes, req.now);
  const failing = gates.filter((g) => !g.passed).map((g) => g.gate);

  // v1: promotion must be a deliberate operator action (OD-094 / AC-10.DEP.002.2). An automatic trigger
  // is refused even if every gate is green — automated promotion is deferred.
  if (req.trigger !== "operator") {
    return {
      promoted: false,
      gates,
      failing,
      reason:
        "promotion refused — v1 requires a deliberate operator action; automated promotion is deferred (OD-094)",
    };
  }

  if (failing.length > 0) {
    const surfaced = gates
      .filter((g) => !g.passed)
      .map((g) => `${g.gate}: ${g.detail}`)
      .join("; ");
    return {
      promoted: false,
      gates,
      failing,
      reason: `promotion refused — ${failing.length} gate(s) red: ${surfaced}`,
    };
  }

  return {
    promoted: true,
    gates,
    failing: [],
    reason: "promoted — all four gates green (tests + clean canary migration + smoke battery + soak)",
  };
}
