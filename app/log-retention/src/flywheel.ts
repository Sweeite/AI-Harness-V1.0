// ISSUE-077 §8 step 8 — the feedback-flywheel + benchmarking substrate (FR-7.OPT.001 / FR-7.OPT.002).
//
// FR-7.OPT.001: every approval, rejection, memory flag, and task failure is CAPTURED as a durable, retrievable
// review signal (via event_log / guardrail_log / memory-flag records / the self-improvement panel). C7's
// obligation is that the four signal classes are captured and surfaced, NEVER lost (AC-7.OPT.001.1). (The
// weekly-review discipline itself is a human process, not a software requirement.)
//
// FR-7.OPT.002: v1 captures the per-deployment benchmarkable substrate (cost-per-task-type, outcome/health) that
// deployment benchmarking WOULD compare (AC-7.OPT.002.1). Cross-deployment outcome comparison is deferred to v2
// (OOS-029) — v1 must NOT silently imply it exists (AC-7.OPT.002.2).

// ── FR-7.OPT.001 — the four review-signal classes ─────────────────────────────────────────────────────

export const REVIEW_SIGNAL_CLASSES = ["approval", "rejection", "memory_flag", "task_failure"] as const;
export type ReviewSignalClass = (typeof REVIEW_SIGNAL_CLASSES)[number];
export function isReviewSignalClass(v: string): v is ReviewSignalClass {
  return (REVIEW_SIGNAL_CLASSES as readonly string[]).includes(v);
}

export interface ReviewSignal {
  id: string;
  class: ReviewSignalClass;
  source_ref: string; // the event_log / guardrail_log / memory-flag row this signal derives from (never orphaned)
  task_id: string | null;
  captured_at: string; // ISO-8601, server-authoritative
  reviewed: boolean; // surfaced-for-review state; a signal is retrievable whether or not yet reviewed
  detail: string;
}

/** A durable, retrievable store for the four review-signal classes (AC-7.OPT.001.1). Append + query by class;
 *  a captured signal is never silently dropped. Mirrors a live query over the underlying sinks — this substrate
 *  does NOT introduce a new C7 table (§8 build note: no new C7 table); it INDEXES the existing sink rows. */
export interface ReviewSignalStore {
  capture(input: { class: ReviewSignalClass; source_ref: string; task_id: string | null; detail: string }, id: string, at: string): Promise<ReviewSignal>;
  byClass(cls: ReviewSignalClass): Promise<ReviewSignal[]>;
  all(): Promise<ReviewSignal[]>;
}

export class InvalidReviewSignalClass extends Error {
  constructor(v: string) {
    super(`review signal class '${v}' is outside the four-class set (approval/rejection/memory_flag/task_failure) — rejected, not coerced`);
    this.name = "InvalidReviewSignalClass";
  }
}

export class InMemoryReviewSignalStore implements ReviewSignalStore {
  private readonly rows: ReviewSignal[] = [];
  async capture(
    input: { class: ReviewSignalClass; source_ref: string; task_id: string | null; detail: string },
    id: string,
    at: string,
  ): Promise<ReviewSignal> {
    if (!isReviewSignalClass(input.class)) throw new InvalidReviewSignalClass(input.class);
    if (!input.source_ref) throw new Error("a review signal must reference its source row (never orphaned) — #1");
    const row: ReviewSignal = { id, class: input.class, source_ref: input.source_ref, task_id: input.task_id, captured_at: at, reviewed: false, detail: input.detail };
    this.rows.push(row);
    return { ...row };
  }
  async byClass(cls: ReviewSignalClass): Promise<ReviewSignal[]> {
    return this.rows.filter((r) => r.class === cls).map((r) => ({ ...r }));
  }
  async all(): Promise<ReviewSignal[]> {
    return this.rows.map((r) => ({ ...r }));
  }
}

/** AC-7.OPT.001.1 — assert all four signal classes are represented (captured + retrievable). Returns the
 *  missing classes; empty ⇒ the flywheel substrate is complete. */
export async function missingSignalClasses(store: ReviewSignalStore): Promise<ReviewSignalClass[]> {
  const present = new Set((await store.all()).map((s) => s.class));
  return REVIEW_SIGNAL_CLASSES.filter((c) => !present.has(c));
}

// ── FR-7.OPT.002 — the v1 per-deployment benchmarking substrate ───────────────────────────────────────

/** A per-deployment benchmarkable substrate record: cost-per-task-type (COST.002) + outcome/health signals.
 *  This is v1 — PER DEPLOYMENT only. It carries NO cross-deployment field (OOS-029 held). */
export interface BenchmarkSubstrateRow {
  task_type: string;
  cost_per_task_estimate: number; // estimate-grade (ADR-003 / COST.001) — never billed/actual
  cost_grade: "estimate";
  success_rate: number; // outcome signal in [0,1]
  health_score: number | null;
  sample_size: number;
  captured_at: string;
}

export interface BenchmarkSubstrate {
  scope: "per_deployment"; // v1 is per-deployment ONLY (AC-7.OPT.002.1)
  cross_deployment_comparison: "deferred_oos_029"; // NEVER "live" — v1 does not imply v2 exists (AC-7.OPT.002.2)
  rows: BenchmarkSubstrateRow[];
}

/** Build the v1 benchmarking substrate from per-task-type aggregates. It is structurally per-deployment and
 *  explicitly marks cross-deployment comparison as OOS-029-deferred, so no surface can read it as "live". */
export function buildBenchmarkSubstrate(rows: BenchmarkSubstrateRow[]): BenchmarkSubstrate {
  return { scope: "per_deployment", cross_deployment_comparison: "deferred_oos_029", rows: rows.map((r) => ({ ...r })) };
}

/** AC-7.OPT.002.2 — a surface must NOT claim cross-deployment benchmarking is live. This asserts a substrate's
 *  marker is the OOS-029 deferral, never a "live" claim. Any surface object built from the substrate inherits
 *  this marker; a value other than the deferral marker is a #3 false-capability claim. */
export function assertNoCrossDeploymentClaim(s: BenchmarkSubstrate): void {
  if (s.scope !== "per_deployment" || s.cross_deployment_comparison !== "deferred_oos_029") {
    throw new Error(
      "benchmark substrate claims (or implies) cross-deployment comparison — it is deferred to v2 (OOS-029); a " +
        "v1 surface must not imply it exists (AC-7.OPT.002.2 / #3)",
    );
  }
}
