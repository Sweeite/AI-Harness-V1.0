// ISSUE-026 (C2 ING) — the LIVE/BOOT config this slice reads. Canonical values live in
// spec/02-config/config-registry.md (Rule 0 — read there, not here); these are the shipped DEFAULTS the fake +
// tests use and a loader overrides from config_values at runtime. The `check` gate (index.ts) asserts every one of
// these rows is present + the correct edit-class in the registry, so a drift between this contract and the registry
// is caught offline (a #3 silent config divergence), never only live.

export interface IngestionConfig {
  /** CFG-hr_content_enabled (BOOT, default false — the FR-10.LEG.001 legal-review gate; NFR-CMP.010). With this OFF
   *  the default reviewer decision for HR-flagged content is Exclude and an Include of HR content is refused. It is
   *  NEVER on without an explicit per-client legal decision (AC-NFR-CMP.010.2). */
  hrContentEnabled: boolean;
  /** CFG-ingest_defer_resurface_days (LIVE, default 14) — a Deferred item auto-resurfaces after this cadence. When
   *  unknown (unreadable), Defer is refused (a Defer that cannot guarantee its resurface would be a silent hold, #3). */
  ingestDeferResurfaceDays: number;
  /** CFG-review_escalation_days (LIVE, default 7) — a queue item un-actioned past this is escalated (AC-2.ING.003.3). */
  reviewEscalationDays: number;
  /** CFG-chunk_size_tokens (LIVE, default 300, int 200–400) — Pipeline 2 chunk size (AC-2.ING.007.1). */
  chunkSizeTokens: number;
  /** CFG-rate_limit_memory_writes_per_minute (LIVE, default 30) — the write-rate an Include/pipeline store is subject
   *  to (enforced inside the ISSUE-024 writer; carried here as context, ADR-004). */
  rateLimitMemoryWritesPerMinute: number;
  /** Filter-1 trust-window keys (Phase 2). While the window is active (AF-043 not yet GREEN), a Filter-1 would-drop is
   *  SHADOW-RETAINED (state=shadow_dropped), not discarded (AC-2.ING.001.2). After graduation to live-discard, a
   *  sampled audit continues so the gate cannot silently drift. */
  filter1TrustWindowActive: boolean;
  /** Post-graduation sampled-audit rate (fraction of live drops audited — default 0.05 = 5%). */
  filter1SampledAuditRate: number;
  /** Post-graduation weekly minimum sampled drops (default 20/week) — the floor even when 5% is fewer. */
  filter1SampledAuditMinWeekly: number;
}

/** The shipped defaults (config-registry.md). A loader replaces these from config_values at runtime. */
export const DEFAULT_INGESTION_CONFIG: IngestionConfig = {
  hrContentEnabled: false,
  ingestDeferResurfaceDays: 14,
  reviewEscalationDays: 7,
  chunkSizeTokens: 300,
  rateLimitMemoryWritesPerMinute: 30,
  filter1TrustWindowActive: true, // launch behaviour: shadow-retain until AF-043 GREEN (OD-036)
  filter1SampledAuditRate: 0.05,
  filter1SampledAuditMinWeekly: 20,
};

/** The CFG keys the `check` gate asserts are registered with the right edit-class.
 *  hr_content_enabled is BOOT (legal gate); the rest are LIVE (read at review/pipeline time). */
export const REQUIRED_LIVE_CFG_KEYS: readonly string[] = [
  'ingest_defer_resurface_days',
  'review_escalation_days',
  'chunk_size_tokens',
  'rate_limit_memory_writes_per_minute',
];
export const REQUIRED_BOOT_CFG_KEYS: readonly string[] = ['hr_content_enabled'];
