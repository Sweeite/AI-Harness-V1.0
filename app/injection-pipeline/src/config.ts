// ISSUE-059 — the four injection/escalation CFG keys + their validation constraint. These keys already
// live in spec/02-config/config-registry.md (rows for approval_escalation_timeout,
// injection_semantic_detection_enabled, injection_semantic_threshold, injection_quarantine_threshold);
// this module is the runtime shape the pipeline consumes + the boot-default + the constraint validator.
//
// The thresholds are SIGNAL-TUNING KNOBS, NOT SAFETY DIALS (ADR-007 §6). The security boundary is code-
// enforced capability containment (hard limits / RBAC / approval gates), never a threshold (ADR-007 §1).
// The two invariants this module guards:
//   - injection_semantic_detection_enabled defaults to FALSE at boot (ADR-007 §3 / AC-6.INJ.003.1 /
//     AC-NFR-SEC.006.3) — a fresh deployment must never boot with the semantic scan on.
//   - injection_semantic_threshold ≤ injection_quarantine_threshold (config-registry constraint) — the
//     flag bar can never sit above the quarantine bar, or content could quarantine before it flags.

export interface InjectionConfig {
  /** OFF at boot (ADR-007 §3). The embedding semantic scan is an additive signal, never an autonomous gate. */
  injection_semantic_detection_enabled: boolean;
  /** The flag bar for the semantic scan (signal knob). Must be ≤ quarantine threshold. */
  injection_semantic_threshold: number;
  /** The route-to-human quarantine bar (signal knob). Must be ≥ semantic threshold. */
  injection_quarantine_threshold: number;
  /** Reused from ISSUE-056: how long a flagged/quarantine review may sit before it escalates (seconds). */
  approval_escalation_timeout_seconds: number;
}

/** The registry defaults (config-registry.md §rows). approval_escalation_timeout ships as 4h. */
export const BOOT_DEFAULTS: InjectionConfig = {
  injection_semantic_detection_enabled: false, // ADR-007 §3 — OFF at boot, non-negotiable
  injection_semantic_threshold: 0.85,
  injection_quarantine_threshold: 0.95,
  approval_escalation_timeout_seconds: 4 * 60 * 60, // 4 h
};

export class InjectionConfigError extends Error {}

/**
 * Validate a candidate config against the registry constraints. Throws InjectionConfigError on any breach
 * (fail-closed, #2/#3 — an invalid config never silently becomes a live posture). Returns a frozen copy.
 */
export function validateConfig(cfg: InjectionConfig): Readonly<InjectionConfig> {
  const { injection_semantic_threshold: sem, injection_quarantine_threshold: quar } = cfg;
  for (const [name, v] of [
    ['injection_semantic_threshold', sem],
    ['injection_quarantine_threshold', quar],
  ] as const) {
    if (!(typeof v === 'number' && Number.isFinite(v)) || v < 0 || v > 1) {
      throw new InjectionConfigError(`${name} must be a float in [0,1] (got ${String(v)})`);
    }
  }
  if (sem > quar) {
    // config-registry constraint: injection_semantic_threshold ≤ injection_quarantine_threshold.
    throw new InjectionConfigError(
      `injection_semantic_threshold (${sem}) must be ≤ injection_quarantine_threshold (${quar}) — the flag bar cannot exceed the quarantine bar`,
    );
  }
  if (!(cfg.approval_escalation_timeout_seconds >= 60)) {
    throw new InjectionConfigError(
      `approval_escalation_timeout_seconds must be ≥ 60 (registry: duration ≥ 1 min), got ${cfg.approval_escalation_timeout_seconds}`,
    );
  }
  return Object.freeze({ ...cfg });
}

/** The boot config: the validated registry defaults. Asserts semantic detection OFF (AC-6.INJ.003.1). */
export function bootConfig(): Readonly<InjectionConfig> {
  const cfg = validateConfig(BOOT_DEFAULTS);
  if (cfg.injection_semantic_detection_enabled) {
    // Defensive: a fresh deployment must never boot with the semantic scan on (ADR-007 §3).
    throw new InjectionConfigError('boot invariant violated: injection_semantic_detection_enabled must be false at boot');
  }
  return cfg;
}
