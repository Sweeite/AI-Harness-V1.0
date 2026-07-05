// ISSUE-057 §8 step 1 — the `anomaly_thresholds` structured config object (FR-6.ANM.004).
//
// This is the per-deployment tuning surface for the five pre-step anomaly checks. It is stored as a
// single `config_values` JSON row under key `anomaly_thresholds` (schema.md §12 structured objects).
// Editing it retunes the checks with NO code change (AC-6.ANM.004.1) — the detectors read their
// threshold from here on every step, so a config edit takes effect on the next step.
//
// Per-anomaly it carries BOTH:
//   - a `threshold` (the numeric bar at/over which the check fires), and
//   - a `severity` (`soft` | `hard`) — the OD-063 per-anomaly, per-deployment severity that decides
//     whether a fired anomaly takes the DEFAULT soft path (pause + flag for review, FR-6.ANM.003.1)
//     or the escalated hard-approval path (FR-6.ANM.002/APR.002, FR-6.ANM.003.2).
//
// Plus one deployment-wide `baseline_learning_enabled` knob (FR-6.ANM.005): when off, baselines are
// never computed/proposed; when on, history-derived tighten/loosen proposals are surfaced, and a
// proposal that would flip a GATE outcome still requires admin confirmation (never silent auto-apply).
//
// ⚠️ FEASIBILITY: AF-116 (feasibility-register.md Block Q) — the volume/scope/sentiment thresholds have
// no DOCS-provable value; the shipped numbers are starting points to be tuned by the build-time EVAL
// (per-anomaly precision/recall). AF-116 is NOT launch-gating; it gates the production accuracy claim.
//
// NOTE (Rule 0): the concrete key/shape below is PROPOSED for the shared config registry in
// results/proposed-shared-spec.md — this slice does NOT edit config-registry.md / schema.md.

export const ANOMALY_KINDS = ['confidence', 'volume', 'contradiction', 'scope', 'sentiment'] as const;
export type AnomalyKind = (typeof ANOMALY_KINDS)[number];

/** OD-063: a fired anomaly is soft (default flag-for-review) unless the deployment raised it to hard. */
export type AnomalySeverity = 'soft' | 'hard';

/** How a threshold is compared to the observed metric. Each detector fixes its own direction. */
export type Comparator = 'lte' | 'gte';

export interface AnomalyThreshold {
  /** The numeric bar. Meaning is per-anomaly (see comparator).  */
  threshold: number;
  /** `lte`: fires when metric <= threshold (confidence). `gte`: fires when metric >= threshold. */
  comparator: Comparator;
  /** OD-063 per-anomaly per-deployment severity. `soft` = default review path; `hard` = escalate. */
  severity: AnomalySeverity;
}

export interface AnomalyThresholdsConfig {
  confidence: AnomalyThreshold;
  volume: AnomalyThreshold;
  contradiction: AnomalyThreshold;
  scope: AnomalyThreshold;
  sentiment: AnomalyThreshold;
  /** FR-6.ANM.005 baseline-learning enable/disable knob (deployment-wide). */
  baseline_learning_enabled: boolean;
}

// The comparator per anomaly is fixed by the detector's semantics (a deployment tunes the number +
// severity, never the direction), so it is not itself a tunable field — but it lives in the stored
// object so the detector reads a self-describing threshold rather than hard-coding direction.
const FIXED_COMPARATOR: Record<AnomalyKind, Comparator> = {
  confidence: 'lte', // fires when key-memory confidence DROPS to/below the floor
  volume: 'gte', // fires when action count reaches/exceeds the ceiling
  contradiction: 'gte', // fires when the live-vs-stored conflict score reaches/exceeds the bar
  scope: 'gte', // fires when the scope-expansion ratio reaches/exceeds the bar
  sentiment: 'gte', // fires when the negativity/urgency score reaches/exceeds the bar
};

/**
 * Shipped STARTING-POINT values (FR-6.ANM.004 — "starting points, not permanent"). Every deployment
 * overrides these via the `anomaly_thresholds` config row. All five default to `soft` severity
 * (OD-063 default = flag for review); a deployment escalates a specific check to `hard`.
 *
 * The volume/scope/sentiment numbers are provisional pending AF-116 (they have no DOCS basis).
 */
export const DEFAULT_ANOMALY_THRESHOLDS: AnomalyThresholdsConfig = {
  confidence: { threshold: 0.5, comparator: 'lte', severity: 'soft' },
  volume: { threshold: 20, comparator: 'gte', severity: 'soft' },
  contradiction: { threshold: 1, comparator: 'gte', severity: 'soft' },
  scope: { threshold: 2.0, comparator: 'gte', severity: 'soft' },
  sentiment: { threshold: 0.8, comparator: 'gte', severity: 'soft' },
  baseline_learning_enabled: false,
};

export class ConfigValidationError extends Error {}

/**
 * Validate + normalise a raw `anomaly_thresholds` JSON row into a typed config. Rejects a malformed
 * object loudly (#3 — never fail silently) rather than letting a detector silently read a bad bar.
 * The comparator is normalised to the fixed per-anomaly direction (a stored wrong direction would
 * invert a guardrail = #2), so a hand-edited row can never flip a check's meaning.
 */
export function validateAnomalyThresholds(raw: unknown): AnomalyThresholdsConfig {
  if (raw === null || typeof raw !== 'object') {
    throw new ConfigValidationError('anomaly_thresholds must be an object');
  }
  const obj = raw as Record<string, unknown>;
  const out = {} as AnomalyThresholdsConfig;
  for (const kind of ANOMALY_KINDS) {
    const t = obj[kind];
    if (t === null || typeof t !== 'object') {
      throw new ConfigValidationError(`anomaly_thresholds.${kind} must be an object`);
    }
    const tt = t as Record<string, unknown>;
    if (typeof tt['threshold'] !== 'number' || !Number.isFinite(tt['threshold'])) {
      throw new ConfigValidationError(`anomaly_thresholds.${kind}.threshold must be a finite number`);
    }
    if (tt['severity'] !== 'soft' && tt['severity'] !== 'hard') {
      throw new ConfigValidationError(`anomaly_thresholds.${kind}.severity must be 'soft' or 'hard'`);
    }
    out[kind] = {
      threshold: tt['threshold'],
      comparator: FIXED_COMPARATOR[kind], // normalise: direction is not deployment-tunable
      severity: tt['severity'],
    };
  }
  if (typeof obj['baseline_learning_enabled'] !== 'boolean') {
    throw new ConfigValidationError('anomaly_thresholds.baseline_learning_enabled must be a boolean');
  }
  out.baseline_learning_enabled = obj['baseline_learning_enabled'];
  return out;
}
