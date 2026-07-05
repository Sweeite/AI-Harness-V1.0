// ISSUE-080 §8 step 3 — the smoke battery as the promotion gate's behavioral check (NFR-INF.008 /
// FR-10.PRV.003). This slice WIRES the battery result into the promotion gate; it does NOT author the
// synthetic corpus (ISSUE-007 seeds the fixture) nor the check bodies (their coverage adequacy is the
// AF-066 EVAL fast-follow — the battery only catches what its fixtures assert, ADR-005 §6 honest limit).
//
// AC-NFR-INF.008.1: the battery must exercise boot + migration + connector wiring + the behavioral
// checks (retrieval / contradiction / routing) against the synthetic corpus. We pin that REQUIRED shape
// here so a battery missing a category is caught as an incomplete gate, not silently passed.

/** The categories a canary smoke battery MUST exercise (AC-NFR-INF.008.1). */
export const REQUIRED_BATTERY_CHECKS = [
  "boot",
  "migration",
  "connector_wiring",
  "retrieval",
  "contradiction",
  "routing",
] as const;
export type BatteryCheck = (typeof REQUIRED_BATTERY_CHECKS)[number];

export interface CheckResult {
  check: BatteryCheck;
  passed: boolean;
  detail: string;
}

export interface BatteryResult {
  /** True iff every REQUIRED check ran AND passed. A missing category => green:false (incomplete gate). */
  green: boolean;
  results: CheckResult[];
  /** Categories that never ran (a coverage gap — treated as a failed gate, not a pass). */
  missing: BatteryCheck[];
  reason: string;
}

/**
 * The runner PORT — the live implementation executes each check against the seeded synthetic corpus on
 * the canary Supabase (the two-party capstone exercises it live). Kept behind a port so the gate wiring
 * is unit-testable with a reference double (house port+fake pattern — cf. app/silo, app/webhook-auth).
 */
export interface SmokeBatteryRunner {
  run(): Promise<CheckResult[]>;
}

/** Aggregate raw check results into the battery verdict: green iff all required checks ran AND passed. */
export function summarizeBattery(results: readonly CheckResult[]): BatteryResult {
  const ran = new Set(results.map((r) => r.check));
  const missing = REQUIRED_BATTERY_CHECKS.filter((c) => !ran.has(c));
  const failed = results.filter((r) => !r.passed).map((r) => r.check);
  const green = missing.length === 0 && failed.length === 0;

  let reason: string;
  if (green) {
    reason = `smoke battery green — all ${REQUIRED_BATTERY_CHECKS.length} checks passed`;
  } else {
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`missing checks: ${missing.join(", ")}`);
    if (failed.length > 0) parts.push(`failed checks: ${failed.join(", ")}`);
    reason = `smoke battery RED — ${parts.join("; ")}`;
  }
  return { green, results: [...results], missing, reason };
}

export async function runBattery(runner: SmokeBatteryRunner): Promise<BatteryResult> {
  return summarizeBattery(await runner.run());
}
