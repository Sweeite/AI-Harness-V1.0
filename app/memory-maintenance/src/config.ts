// ISSUE-027 (C2 MNT) — the LIVE config this slice reads. Canonical values live in spec/02-config/config-registry.md
// (Rule 0 — read there, not here); these are the shipped DEFAULTS the fake + tests use and loadConfig() overrides
// from config_values at runtime. The `check` gate (index.ts) asserts every one of these rows is present + LIVE-class
// in the registry, so a drift between this contract and the registry is caught offline (a #3 silent config
// divergence — a job silently keying on a stale threshold is exactly the erosion this slice exists to prevent).

/** The full LIVE maintenance-tuning contract (§5 of ISSUE-027). All ten MNT keys + the two consumed-but-foreign
 *  keys (retrieval_confidence_threshold owned by RET, review_escalation_days owned by ISSUE-026) — every one is
 *  LIVE-class in config-registry.md. */
export interface MaintenanceConfig {
  /** CFG-soft_decay_age_months (6) — how old an unconfirmed memory gets before soft-decay eligibility. */
  softDecayAgeMonths: number;
  /** CFG-soft_decay_multiplier (0.95) — the per-run multiplicative fade toward the floor. */
  softDecayMultiplier: number;
  /** CFG-confidence_floor (0.5) — the lowest confidence decay can reach; a memory is PARKED here, never deleted. */
  confidenceFloor: number;
  /** CFG-amber_zone_threshold (0.75) — flag a memory shaky BEFORE it drops below the retrieval floor (audit H27:
   *  amber MUST fire before, not after, a memory becomes invisible to retrieval). */
  amberZoneThreshold: number;
  /** CFG-bulk_drop_alert_count (10) — how many drops within the window trip a systemic alert. */
  bulkDropAlertCount: number;
  /** CFG-bulk_drop_alert_window_minutes (60) — the burst window for the bulk-drop alert. */
  bulkDropAlertWindowMinutes: number;
  /** CFG-merge_similarity_threshold (0.92) — how alike two same-entity/same-tier rows must be to collapse. */
  mergeSimilarityThreshold: number;
  /** CFG-summarise_episode_trigger (10) — new-episodic count that triggers an episodic→semantic summary. */
  summariseEpisodeTrigger: number;
  /** CFG-coverage_stale_window_days (30) — no-new-memory window before an entity is flagged going stale. */
  coverageStaleWindowDays: number;
  /** CFG-relevance_review_window_days (30) — unused-or-unconfirmed window before a relevance-review flag. */
  relevanceReviewWindowDays: number;
  /** CFG-retrieval_confidence_threshold (0.7) — the RET candidate floor; amber must sit ABOVE it (owned by RET). */
  retrievalConfidenceThreshold: number;
  /** CFG-review_escalation_days (7) — the stuck-ingestion-queue escalation clock (owned by ISSUE-026). */
  reviewEscalationDays: number;
}

/** The shipped defaults (config-registry.md rows). loadConfig() replaces these from config_values at runtime. */
export const DEFAULT_MAINTENANCE_CONFIG: MaintenanceConfig = {
  softDecayAgeMonths: 6,
  softDecayMultiplier: 0.95,
  confidenceFloor: 0.5,
  amberZoneThreshold: 0.75,
  bulkDropAlertCount: 10,
  bulkDropAlertWindowMinutes: 60,
  mergeSimilarityThreshold: 0.92,
  summariseEpisodeTrigger: 10,
  coverageStaleWindowDays: 30,
  relevanceReviewWindowDays: 30,
  retrievalConfidenceThreshold: 0.7,
  reviewEscalationDays: 7,
};

/** The CFG keys the `check` gate asserts are LIVE-class in the registry (the loadConfig contract). */
export const REQUIRED_CFG_KEYS: readonly string[] = [
  'soft_decay_age_months',
  'soft_decay_multiplier',
  'confidence_floor',
  'amber_zone_threshold',
  'bulk_drop_alert_count',
  'bulk_drop_alert_window_minutes',
  'merge_similarity_threshold',
  'summarise_episode_trigger',
  'coverage_stale_window_days',
  'relevance_review_window_days',
  'retrieval_confidence_threshold',
  'review_escalation_days',
];

/** Raised when a live config is internally inconsistent — surfaced LOUD, never silently coerced (#3). A drifted
 *  amber threshold that sat BELOW the retrieval floor would let a memory go invisible before it was ever flagged
 *  shaky (audit H27) — that is a silent-erosion bug this guard refuses to run with. */
export class MaintenanceConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MaintenanceConfigError';
  }
}

/**
 * Validate the ordering invariants the maintenance jobs rely on (mirrors the config-registry constraint column):
 *   • confidence_floor ≤ amber_zone_threshold (a memory decays toward the floor, flagged amber on the way down).
 *   • amber_zone_threshold > retrieval_confidence_threshold (audit H27 — amber fires BEFORE the retrieval floor).
 *   • the multiplier is a genuine fade in (0,1); the age/count/window knobs are ≥ their registry minima.
 * Called by BOTH the fake's loadConfig and the live adapter's loadConfig so offline + live reject an ill-ordered
 * config identically (R10). Pure.
 */
export function validateMaintenanceConfig(cfg: MaintenanceConfig): void {
  const fail = (m: string) => {
    throw new MaintenanceConfigError(m);
  };
  if (!(cfg.softDecayMultiplier > 0 && cfg.softDecayMultiplier < 1)) fail(`soft_decay_multiplier ${cfg.softDecayMultiplier} must be a fade in (0,1)`);
  if (!(cfg.confidenceFloor >= 0 && cfg.confidenceFloor <= 1)) fail(`confidence_floor ${cfg.confidenceFloor} out of [0,1]`);
  if (!(cfg.amberZoneThreshold >= 0 && cfg.amberZoneThreshold <= 1)) fail(`amber_zone_threshold ${cfg.amberZoneThreshold} out of [0,1]`);
  if (!(cfg.confidenceFloor <= cfg.amberZoneThreshold)) fail(`confidence_floor ${cfg.confidenceFloor} must be ≤ amber_zone_threshold ${cfg.amberZoneThreshold}`);
  if (!(cfg.amberZoneThreshold > cfg.retrievalConfidenceThreshold)) {
    fail(`amber_zone_threshold ${cfg.amberZoneThreshold} must be > retrieval_confidence_threshold ${cfg.retrievalConfidenceThreshold} (audit H27 — amber must fire before a memory drops below the retrieval floor)`);
  }
  if (!(cfg.mergeSimilarityThreshold > 0 && cfg.mergeSimilarityThreshold <= 1)) fail(`merge_similarity_threshold ${cfg.mergeSimilarityThreshold} out of (0,1]`);
  if (!(Number.isInteger(cfg.summariseEpisodeTrigger) && cfg.summariseEpisodeTrigger >= 2)) fail(`summarise_episode_trigger ${cfg.summariseEpisodeTrigger} must be an int ≥ 2`);
  if (!(Number.isInteger(cfg.bulkDropAlertCount) && cfg.bulkDropAlertCount >= 1)) fail(`bulk_drop_alert_count ${cfg.bulkDropAlertCount} must be an int ≥ 1`);
  if (!(cfg.bulkDropAlertWindowMinutes >= 1)) fail(`bulk_drop_alert_window_minutes ${cfg.bulkDropAlertWindowMinutes} must be ≥ 1`);
  if (!(cfg.softDecayAgeMonths >= 1)) fail(`soft_decay_age_months ${cfg.softDecayAgeMonths} must be ≥ 1`);
  if (!(cfg.coverageStaleWindowDays >= 1)) fail(`coverage_stale_window_days ${cfg.coverageStaleWindowDays} must be ≥ 1`);
  if (!(cfg.relevanceReviewWindowDays >= 1)) fail(`relevance_review_window_days ${cfg.relevanceReviewWindowDays} must be ≥ 1`);
  if (!(cfg.reviewEscalationDays >= 1)) fail(`review_escalation_days ${cfg.reviewEscalationDays} must be ≥ 1`);
}
