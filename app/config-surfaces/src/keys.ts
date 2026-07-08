// ISSUE-086 — the CONFIG SURFACE key catalog: the edit-face model of every registry knob the two config
// surfaces render. Each key carries its section, owning PERM-config.* node, edit class (LIVE/BOOT/REBUILD),
// and any read-only floor (locked / hard-limit). This is the SURFACE mirror of config-registry.md §§A–N; the
// `check` gate (index.ts) parses the registry and rejects any drift (a key the surface renders that the
// registry doesn't define, a class mismatch, or a registry key the surface would silently NOT render — the
// last is the #1/#3 case: a new knob invisible to the only screen that can edit it).
//
// SECRET-class keys (group N) are NOT here — they never live in config_values and are never editable (they
// render on #secrets as presence + last_rotated only, secrets.ts). Their absence from this editable catalog
// is the structural guarantee behind AC-7.LOG.008.5 / AC-7.LOG.005.1 (a SECRET value can never reach Save →
// never produces a config_audit_log row).

import { SECTION_NODE, type ConfigPermNode, type SectionId } from './sections.ts';

/** The four edit classes (standards/config-edit-taxonomy.md). SECRET is intentionally not in the editable
 *  catalog — it is modelled separately (secrets.ts) as read-only presence. */
export type EditClass = 'LIVE' | 'BOOT' | 'REBUILD';

/** Why a row is read-only despite being a config_values key. */
export type LockReason =
  | 'hard_limit' // one of the seven ADR-007/OD-047/OD-060 prohibitions (defensive fallback)
  | 'autonomy_floor' // action_autonomy_matrix — every sub-type floored at hard_approval-or-Prepare (OD-161)
  | 'v1_locked'; // deployment_region — v1 locked to ap-southeast-2 (surface-01 #infra)

/** A special confirm dialog a dirtied row triggers on Save (beyond the BOOT redeploy dialog). */
export type ConfirmKind =
  | 'rebuild' // REBUILD (embedding_model) — always confirm before write (taxonomy rule 5)
  | 'irreversible'; // slack_token_rotation_enabled false→true — irreversible (OD-040)

export interface KeySpec {
  key: string;
  section: SectionId;
  node: ConfigPermNode;
  editClass: EditClass;
  /** Read-only floor: rendered with a text-cue badge, never a save control; server-rejected on write. */
  lock?: LockReason;
  /** A special confirm the row triggers when dirtied into the Save batch. */
  confirm?: ConfirmKind;
}

// ─────────────────────────────────────────────────────────────────────────────
// The editable key catalog (config-registry.md §§A–M, non-secret). Class transcribed from the registry's
// Class column; the `check` gate asserts byte-parity so this never silently drifts from the registry.
// ─────────────────────────────────────────────────────────────────────────────
const L = 'LIVE' as const;
const B = 'BOOT' as const;

// Compact section blocks → flattened to KEY_CATALOG below.
const AUTH: ReadonlyArray<readonly [string, EditClass]> = [
  ['auth.oauth_enabled', B],
  ['auth.oauth_provider', B],
  ['auth.two_factor_required', B],
  ['auth.access_token_ttl', L],
  ['auth.session_absolute_timeout', L],
  ['auth.session_inactivity_timeout', L],
  ['auth.invite_link_ttl', B],
  ['auth.seed_setup_link_ttl', B],
  ['auth.account_lockout_threshold', L],
  ['auth.account_lockout_minutes', L],
  ['auth.mfa_softlock_threshold', L],
  ['auth.mfa_softlock_minutes', L],
  ['auth.captcha_enabled', L],
  ['auth.leaked_password_protection', L],
  ['webhook.replay_window_seconds', L],
  ['webhook.replay_cache_window', L],
  ['webhook.secret_rotation_window', L],
  ['webhook.google_expected_audience', B],
  ['webhook.accept_rate_limit', L],
  ['webhook.failure_alert_threshold', L],
  ['support.stale_request_minutes', L],
];

const MEMORY: ReadonlyArray<readonly [string, EditClass]> = [
  ['amber_zone_threshold', L],
  ['confidence_floor', L],
  ['retrieval_confidence_threshold', L],
  ['retrieval_sufficiency_threshold', L],
  ['memories_injected_per_task', L],
  ['rank_recency_half_life_days', L],
  ['merge_similarity_threshold', L],
  ['soft_decay_age_months', L],
  ['soft_decay_multiplier', L],
  ['summarise_episode_trigger', L],
  ['chunk_size_tokens', L],
  ['coverage_stale_window_days', L],
  ['relevance_review_window_days', L],
  ['bulk_drop_alert_count', L],
  ['bulk_drop_alert_window_minutes', L],
  ['ef_search', L],
  ['procedural_boost', L],
  ['review_escalation_days', L],
  ['ingest_defer_resurface_days', L],
  ['hr_content_enabled', B],
  ['ranking_weights', L],
  ['expected_slots', L],
  ['entity_types', B],
  ['haiku_audit_window_days', L],
  ['haiku_gate_disagree_threshold', L],
  ['memory_write_serialization', B],
];

const TOOLS: ReadonlyArray<readonly [string, EditClass]> = [
  ['drive_full_corpus_ingest', B],
  ['backoff_initial_ms', L],
  ['backoff_max_ms', L],
  ['backoff_multiplier', L],
  ['rate_max_calls_per_connector_window', L],
  ['rate_alert_threshold', L],
  ['token_refresh_interval_minutes', L],
  ['token_refresh_lead_minutes', L],
  ['token_expiry_alert_days', L],
  ['connector_disconnection_escalation_window', L],
  ['event_reconciliation_sweep_minutes', L],
  ['watch_rearm_lead_minutes', L],
  ['tool_selection_confidence_threshold', L],
  ['ghl_rate_burst_cap', L],
  ['ghl_rate_daily_cap', L],
  ['ghl_access_token_ttl', L],
  ['ghl_refresh_token_max_idle', L],
  ['ghl_api_version_header', B],
  ['ghl_oauth_scopes', B],
  ['ghl_webhook_pubkey', L],
  ['ghl_dossier_reverify_days', L],
];

const LOOPS: ReadonlyArray<readonly [string, EditClass]> = [
  ['loop_cadence_fast', B],
  ['loop_cadence_medium', B],
  ['loop_cadence_slow', B],
  ['task_priority_scheme', B],
  ['compression_threshold_tokens', L],
  ['parallel_execution_enabled', B],
  ['smart_scheduling_enabled', B],
  ['anomaly_check_cadence', B],
  ['checkpoint_step_threshold', L],
  ['checkpoint_response_timeout_minutes', L],
  ['max_retries_before_dead_letter', L],
  ['dlq_stale_alert_hours', L],
];

const GUARDRAILS: ReadonlyArray<readonly [string, EditClass]> = [
  ['clearance_review_cadence_days', L], // registry group D, gated here
  ['clearance_review_fail_closed', L], // registry group D, gated here
  ['approval_soft_timeout', L],
  ['approval_escalation_timeout', L],
  ['injection_semantic_detection_enabled', L],
  ['injection_semantic_threshold', L],
  ['injection_quarantine_threshold', L],
  ['rate_limit_tool_writes_per_task', L],
  ['rate_limit_external_comms_per_hour', L],
  ['rate_limit_memory_writes_per_minute', L],
  ['rate_limit_concurrent_tasks', L],
  ['approval_pattern_sample_size', L],
  ['cost_ladder_soft_threshold_daily_usd', L],
  ['cost_ladder_soft_threshold_weekly_usd', L],
  ['cost_ladder_throttle_threshold', L],
  ['cost_ladder_hard_kill_threshold', L],
  ['anomaly_thresholds', L],
  ['action_autonomy_matrix', L], // LOCKED (OD-161) — see lock override below
];

const OBSERVABILITY: ReadonlyArray<readonly [string, EditClass]> = [
  ['event_log_retention_window', B],
  ['realtime_connection_headroom_threshold', L],
  ['task_failure_spike_threshold', L],
  ['queue_backup_threshold', L],
  ['approval_staleness_alert_threshold', L],
  ['cost_threshold_alert_limit', L],
  ['task_success_rate_threshold_pct', L],
  ['memory_confidence_drop_threshold', L],
  ['alert_escalation_window_hours', L],
  ['deployment_staleness_window', L],
  ['polling_interval_health_metrics_s', L],
  ['polling_interval_event_log_s', L],
  ['polling_interval_memory_health_s', L],
  ['polling_interval_self_improvement_s', L],
  ['polling_interval_cost_tracking_s', L],
  ['polling_interval_agent_health_s', L],
  ['price_table', L],
  ['alert_routing_rules', L],
  ['escalation_contacts', L],
  ['quiet_hours', L],
  ['alert_email_enabled', L],
];

const AGENTS: ReadonlyArray<readonly [string, EditClass]> = [
  ['orchestrator_confidence_threshold', L],
  ['chain_depth_limit', L],
  ['clarification_escalation', L],
  ['drift_threshold', L],
  ['dead_agent_threshold', L],
  ['default_model', B],
  ['lightweight_model', B],
  ['routing_weights', L],
  ['cache_time_window', L],
];

const PROACTIVE: ReadonlyArray<readonly [string, EditClass]> = [
  ['cold_start_basic_threshold', L],
  ['cold_start_proactive_threshold', L],
  ['cold_start_full_threshold', L],
  ['scanner_relationship_enabled', L],
  ['scanner_meeting_prep_enabled', L],
  ['scanner_document_prep_enabled', L],
  ['scanner_derisking_enabled', L],
  ['scanner_opportunity_enabled', L],
  ['scanner_briefing_enabled', L],
  ['scanner_pattern_enabled', L],
  ['briefing_schedule', L],
  ['meeting_prep_lead_time', L],
  ['not_contacted_window', L],
  ['renewal_lookahead_days', L],
  ['dismissal_decay', L],
  ['risk_floor', L],
  ['suggestion_ttl_days', L],
  ['suggestion_volume_limit', L],
  ['approval_push_frequency_minutes', L],
  ['stale_queue_push_hours', L],
  ['risk_thresholds', L],
  ['opportunity_thresholds', L],
];

const INFRA: ReadonlyArray<readonly [string, EditClass]> = [
  ['client_offboarding_retention_days', B],
  ['data_export_link_expiry_hours', L],
  ['individual_deletion_audit_years', B],
  ['deletion_two_person_auth_required', L],
  ['deploy_max_skew_days', L],
  ['deploy_max_version_skew', L],
  ['canary_soak_minutes', L],
  ['deployment_region', B], // v1_locked — see lock override below
  ['recovery_tier', B],
];

// Per-key overrides layered on top of the (key,class) blocks above.
const LOCK_OVERRIDE: Readonly<Record<string, LockReason>> = {
  action_autonomy_matrix: 'autonomy_floor',
  deployment_region: 'v1_locked',
};
const CONFIRM_OVERRIDE: Readonly<Record<string, ConfirmKind>> = {
  embedding_model: 'rebuild',
  slack_token_rotation_enabled: 'irreversible',
};

// embedding_model (REBUILD) and slack_token_rotation_enabled (BOOT + irreversible confirm) sit in memory/tools
// respectively; they carry a confirm override. embedding_model's class is REBUILD (not in the L/B blocks).
const EXTRA: ReadonlyArray<readonly [string, SectionId, EditClass]> = [
  ['embedding_model', '#memory', 'REBUILD'],
  ['slack_token_rotation_enabled', '#tools', 'BOOT'],
];

function build(): KeySpec[] {
  const blocks: ReadonlyArray<readonly [SectionId, ReadonlyArray<readonly [string, EditClass]>]> = [
    ['#auth', AUTH],
    ['#memory', MEMORY],
    ['#tools', TOOLS],
    ['#loops', LOOPS],
    ['#guardrails', GUARDRAILS],
    ['#observability', OBSERVABILITY],
    ['#agents', AGENTS],
    ['#proactive', PROACTIVE],
    ['#infra', INFRA],
    // #prompts has a single key, added inline below.
  ];
  const out: KeySpec[] = [];
  const push = (key: string, section: SectionId, editClass: EditClass): void => {
    // build() never passes '#secrets' (no editable keys there), so the node is always a ConfigPermNode.
    const spec: KeySpec = { key, section, node: SECTION_NODE[section] as ConfigPermNode, editClass };
    const lock = LOCK_OVERRIDE[key];
    if (lock) spec.lock = lock;
    const confirm = CONFIRM_OVERRIDE[key];
    if (confirm) spec.confirm = confirm;
    out.push(spec);
  };
  for (const [section, rows] of blocks) for (const [key, cls] of rows) push(key, section, cls);
  push('dynamic_field_freshness_threshold', '#prompts', 'LIVE');
  for (const [key, section, cls] of EXTRA) push(key, section, cls);
  return out;
}

export const KEY_CATALOG: readonly KeySpec[] = build();

const BY_KEY: ReadonlyMap<string, KeySpec> = new Map(KEY_CATALOG.map((k) => [k.key, k]));

/** Look up a key's surface spec (undefined = not a known editable config key). */
export function keySpec(key: string): KeySpec | undefined {
  return BY_KEY.get(key);
}

/** Every editable key that belongs to a section (the section's render/save set). */
export function sectionKeys(section: SectionId): KeySpec[] {
  return KEY_CATALOG.filter((k) => k.section === section);
}

/**
 * Map ANY config key to its owning PERM-config.<group> node — the key-prefix scope for the audit timeline
 * and export (surface-01b §Access). Mirror of app/config-store keygroup.ts / SQL config_key_group: only
 * auth./webhook./support. are uniform-prefixed → PERM-config.auth (with auth.smtp_* carved to infra, since
 * those are group-N secrets that must never read as auth); every catalogued key uses its section's node; an
 * UNKNOWN key fails CLOSED to PERM-config.infra (Super-Admin-only, OD-181) so a stray/renamed key never
 * leaks into a lower section's scope (#2).
 */
export function configKeyGroup(key: string): ConfigPermNode {
  if (key.startsWith('auth.smtp_') || key === 'auth.smtp_bounce_webhook') return 'PERM-config.infra';
  if (key.startsWith('auth.') || key.startsWith('webhook.') || key.startsWith('support.')) return 'PERM-config.auth';
  const spec = BY_KEY.get(key);
  if (spec) return spec.node;
  return 'PERM-config.infra'; // fail-closed
}

/** True if the caller's held PERM-config nodes cover this key's group (the row-visibility gate). */
export function callerCanSeeKey(key: string, heldPerms: ReadonlySet<string>): boolean {
  return heldPerms.has(configKeyGroup(key));
}

// ── The seven hard limits (ADR-007 / OD-047 / OD-060, design L2053–2066) ───────────────────────────────
// These are CODE-ENFORCED prohibitions, never config_values rows — so by construction they are never
// editable and never appear as knobs. The surface renders any hard-limit sentinel key that ACCIDENTALLY
// lands in config_values read-only ("Hard limit — not editable", no save control, server-reject on write)
// as a defensive fallback (surface-01 §"Hard limits note"). We enumerate them by a stable sentinel id so the
// defensive path is testable.
export const HARD_LIMIT_KEYS: readonly string[] = [
  'hard_limit.autonomous_external_email',
  'hard_limit.autonomous_financial_transaction',
  'hard_limit.autonomous_delete_system_of_record',
  'hard_limit.cross_client_data_share',
  'hard_limit.impersonate_named_human',
  'hard_limit.self_approve_queued_action',
  'hard_limit.treat_monitored_content_as_instructions',
] as const;

const HARD_LIMIT_SET = new Set(HARD_LIMIT_KEYS);

/** True if this key is one of the seven code-enforced hard-limit prohibitions (defensive read-only path). */
export function isHardLimitKey(key: string): boolean {
  return HARD_LIMIT_SET.has(key);
}

/** True if this key is read-only on the surface (locked floor OR a hard-limit sentinel). */
export function isReadOnlyKey(key: string): boolean {
  if (isHardLimitKey(key)) return true;
  const spec = BY_KEY.get(key);
  return spec?.lock !== undefined;
}

/** The read-only badge text for a key — a TEXT cue (never colour-only; AC-NFR-A11Y.001.2). null = editable. */
export function readOnlyBadge(key: string): string | null {
  if (isHardLimitKey(key)) return 'Hard limit — not editable';
  const spec = BY_KEY.get(key);
  switch (spec?.lock) {
    case 'autonomy_floor':
      return 'Locked (hard_approval-or-Prepare)';
    case 'v1_locked':
      return 'Locked for v1';
    default:
      return null;
  }
}

/** The edit-class badge text — always carries the class WORD (text cue, not colour-only). */
export function editClassBadge(spec: KeySpec): string {
  switch (spec.editClass) {
    case 'LIVE':
      return 'LIVE — applies immediately';
    case 'BOOT':
      return 'BOOT — applies next deploy';
    case 'REBUILD':
      return 'REBUILD — triggers a background rebuild';
  }
}
