// ISSUE-057 §8 step 2 — the five anomaly detectors (FR-6.ANM.002). Each reads its threshold from the
// `anomaly_thresholds` config (config.ts) and produces a flag when its condition holds. Detectors are
// PURE (metric + threshold → flag); they do NOT decide disposition — that is FR-6.ANM.003 (pipeline.ts).
//
// The five checks (FR-6.ANM.002 statement, L2795-2801):
//   - confidence     — key memory confidence drops below threshold mid-task           (metric: confidence 0..1, lte)
//   - volume         — about to perform an unusually high number of actions            (metric: planned action count, gte)
//   - contradiction  — LIVE tool data conflicts with STORED memory                     (metric: conflict count, gte)
//   - scope          — task expanded significantly beyond its trigger                   (metric: expansion ratio, gte)
//   - sentiment      — client communication unusually negative or urgent               (metric: negativity/urgency 0..1, gte)
//
// AC-6.ANM.002.2: the CONTRADICTION check is the distinct LIVE-vs-STORED signal — it is NOT the C2
// stored-vs-stored memory-conflict queue (ISSUE-028). We tag its flag `source: 'live_vs_stored'` and
// carry the live + stored values so a consumer can prove it is the retrieval-time live signal.
//
// ⚠️ FEASIBILITY: AF-116 — the volume/scope/sentiment metrics rest on judgments with no DOCS-provable
// threshold; the numbers are EVAL-tuned starting points. Not launch-gating.

import type { AnomalyKind, AnomalyThreshold, AnomalyThresholdsConfig } from './config.js';

/** The observations the harness hands the pre-step check at a step boundary (FR-6.ANM.001). */
export interface StepObservation {
  /** confidence check — the min confidence [0..1] of the key memories this step relies on. */
  keyMemoryConfidence: number;
  /** volume check — the number of side-effecting actions this step is about to perform. */
  plannedActionCount: number;
  /** contradiction check — the LIVE-vs-STORED conflicts detected at retrieval time (see below). */
  liveVsStoredConflicts: LiveVsStoredConflict[];
  /** scope check — how far the task has expanded past its trigger (ratio; 1.0 = unchanged). */
  scopeExpansionRatio: number;
  /** sentiment check — the negativity/urgency score [0..1] of the latest client communication. */
  sentimentScore: number;
}

/** A single live-tool-vs-stored-memory contradiction (AC-6.ANM.002.2 — distinct from C2's queue). */
export interface LiveVsStoredConflict {
  field: string;
  liveValue: unknown;
  storedValue: unknown;
}

/** A produced flag from one detector. `metric` is the observed value that crossed `threshold`. */
export interface AnomalyFlag {
  kind: AnomalyKind;
  metric: number;
  threshold: number;
  /** Human-readable reason, used verbatim in the guardrail_log description (FR-6.ANM.003). */
  reason: string;
  /** Only set for the contradiction check — proves the AC-6.ANM.002.2 live-vs-stored distinction. */
  source?: 'live_vs_stored';
  details?: LiveVsStoredConflict[];
}

/** Compare a metric to a threshold in the direction the threshold declares (config-driven). */
function fires(metric: number, t: AnomalyThreshold): boolean {
  return t.comparator === 'lte' ? metric <= t.threshold : metric >= t.threshold;
}

// Each detector: (observation, its threshold) → flag | null. Pure. No config read here — the caller
// (pipeline) passes the resolved threshold so a config edit is honoured on the very next step.

export function checkConfidence(obs: StepObservation, t: AnomalyThreshold): AnomalyFlag | null {
  if (!fires(obs.keyMemoryConfidence, t)) return null;
  return {
    kind: 'confidence',
    metric: obs.keyMemoryConfidence,
    threshold: t.threshold,
    reason: `key memory confidence ${obs.keyMemoryConfidence} dropped to/below floor ${t.threshold}`,
  };
}

export function checkVolume(obs: StepObservation, t: AnomalyThreshold): AnomalyFlag | null {
  if (!fires(obs.plannedActionCount, t)) return null;
  return {
    kind: 'volume',
    metric: obs.plannedActionCount,
    threshold: t.threshold,
    reason: `about to perform ${obs.plannedActionCount} actions (>= ceiling ${t.threshold})`,
  };
}

export function checkContradiction(obs: StepObservation, t: AnomalyThreshold): AnomalyFlag | null {
  const count = obs.liveVsStoredConflicts.length;
  if (!fires(count, t)) return null;
  // AC-6.ANM.002.2: distinct live-vs-stored signal — NOT the C2 stored-vs-stored queue.
  return {
    kind: 'contradiction',
    metric: count,
    threshold: t.threshold,
    reason: `${count} live-tool-vs-stored-memory contradiction(s) at retrieval time`,
    source: 'live_vs_stored',
    details: obs.liveVsStoredConflicts,
  };
}

export function checkScope(obs: StepObservation, t: AnomalyThreshold): AnomalyFlag | null {
  if (!fires(obs.scopeExpansionRatio, t)) return null;
  return {
    kind: 'scope',
    metric: obs.scopeExpansionRatio,
    threshold: t.threshold,
    reason: `task expanded ${obs.scopeExpansionRatio}× beyond its trigger (>= ${t.threshold}×)`,
  };
}

export function checkSentiment(obs: StepObservation, t: AnomalyThreshold): AnomalyFlag | null {
  if (!fires(obs.sentimentScore, t)) return null;
  return {
    kind: 'sentiment',
    metric: obs.sentimentScore,
    threshold: t.threshold,
    reason: `client communication negativity/urgency ${obs.sentimentScore} (>= ${t.threshold})`,
  };
}

/** Run all five detectors against the observation using the current config. Returns every flag that
 *  fired, in the fixed check order. This is the FR-6.ANM.002 layer — WHAT fired, not the disposition. */
export function runAllDetectors(obs: StepObservation, cfg: AnomalyThresholdsConfig): AnomalyFlag[] {
  const flags: AnomalyFlag[] = [];
  const c = checkConfidence(obs, cfg.confidence);
  if (c) flags.push(c);
  const v = checkVolume(obs, cfg.volume);
  if (v) flags.push(v);
  const k = checkContradiction(obs, cfg.contradiction);
  if (k) flags.push(k);
  const s = checkScope(obs, cfg.scope);
  if (s) flags.push(s);
  const t = checkSentiment(obs, cfg.sentiment);
  if (t) flags.push(t);
  return flags;
}
