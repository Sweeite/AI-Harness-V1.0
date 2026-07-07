// ISSUE-010 §8 step 3 — the config-key → PERM-config.<group> map, the TS mirror of the SQL
// `config_key_group(key)` in app/silo/migrations/0003_config_values_rls.sql.
//
// WHY A MIRROR: the RLS policy enforces the group scope in the DB (the ground truth for the authenticated
// read path); the config-audit READ + EXPORT path (ISSUE-010 §8 step 5) runs as the postgres owner (RLS-bypass)
// and must therefore re-apply the SAME key-prefix scope in app code — otherwise an owner (RLS-bypass) export
// would return rows outside the caller's PERM-config.* nodes (a #2 breach). Keeping the two in ONE
// explicit map, tested for divergence over EVERY registry key, is the house discipline.
//
// THIS IS AN EXPLICIT KEY→NODE MAP transcribed EXACTLY from spec/02-config/config-registry.md §§A–N —
// NOT a content-prefix heuristic. The earlier heuristic version (greedy `rate_`/`cost_`/`risk_`/
// `anomaly_`/`backoff_` prefixes) MIS-ROUTED real registry keys (a #2 leak). Only THREE key families are
// uniform-prefixed → PERM-config.auth: `auth.*` (EXCEPT the `auth.smtp_*` group-N secrets, which never
// reach config_values), `webhook.*`, `support.*`. Every other key is an EXPLICIT entry in KEY_NODE_MAP.
// An unmapped key → PERM-config.infra (fail-closed, Super-Admin-only; OD-181).

export type ConfigPermNode =
  | 'PERM-config.auth'
  | 'PERM-config.memory'
  | 'PERM-config.tools'
  | 'PERM-config.prompts'
  | 'PERM-config.loops'
  | 'PERM-config.guardrails'
  | 'PERM-config.observability'
  | 'PERM-config.agents'
  | 'PERM-config.proactive'
  | 'PERM-config.infra';

// The 10 PERM-config nodes config_values RLS can map to (config-registry §PERM-config). `PERM-config.secrets`
// is NOT here — SECRET keys never live in config_values (they are secret_manifest presence rows).
export const CONFIG_PERM_NODES: readonly ConfigPermNode[] = [
  'PERM-config.auth',
  'PERM-config.memory',
  'PERM-config.tools',
  'PERM-config.prompts',
  'PERM-config.loops',
  'PERM-config.guardrails',
  'PERM-config.observability',
  'PERM-config.agents',
  'PERM-config.proactive',
  'PERM-config.infra',
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// The authoritative explicit key→node map (config-registry §§A–N). MUST stay byte-for-byte equivalent
// to the SQL config_key_group CASE. The `check` CLI verifies parity over EVERY key below.
// ─────────────────────────────────────────────────────────────────────────────
export const KEY_NODE_MAP: Readonly<Record<string, ConfigPermNode>> = {
  // ── PERM-config.memory (§E) ──
  amber_zone_threshold: 'PERM-config.memory',
  confidence_floor: 'PERM-config.memory',
  retrieval_confidence_threshold: 'PERM-config.memory',
  retrieval_sufficiency_threshold: 'PERM-config.memory',
  memories_injected_per_task: 'PERM-config.memory',
  rank_recency_half_life_days: 'PERM-config.memory',
  merge_similarity_threshold: 'PERM-config.memory',
  soft_decay_age_months: 'PERM-config.memory',
  soft_decay_multiplier: 'PERM-config.memory',
  summarise_episode_trigger: 'PERM-config.memory',
  chunk_size_tokens: 'PERM-config.memory',
  coverage_stale_window_days: 'PERM-config.memory',
  relevance_review_window_days: 'PERM-config.memory',
  bulk_drop_alert_count: 'PERM-config.memory',
  bulk_drop_alert_window_minutes: 'PERM-config.memory',
  ef_search: 'PERM-config.memory',
  procedural_boost: 'PERM-config.memory',
  review_escalation_days: 'PERM-config.memory',
  ingest_defer_resurface_days: 'PERM-config.memory',
  hr_content_enabled: 'PERM-config.memory',
  embedding_model: 'PERM-config.memory',
  ranking_weights: 'PERM-config.memory',
  expected_slots: 'PERM-config.memory',
  entity_types: 'PERM-config.memory',
  haiku_audit_window_days: 'PERM-config.memory',
  haiku_gate_disagree_threshold: 'PERM-config.memory',
  memory_write_serialization: 'PERM-config.memory',

  // ── PERM-config.tools (§F) ──
  drive_full_corpus_ingest: 'PERM-config.tools',
  backoff_initial_ms: 'PERM-config.tools',
  backoff_max_ms: 'PERM-config.tools',
  backoff_multiplier: 'PERM-config.tools',
  rate_max_calls_per_connector_window: 'PERM-config.tools',
  rate_alert_threshold: 'PERM-config.tools',
  token_refresh_interval_minutes: 'PERM-config.tools',
  token_refresh_lead_minutes: 'PERM-config.tools',
  token_expiry_alert_days: 'PERM-config.tools',
  connector_disconnection_escalation_window: 'PERM-config.tools',
  event_reconciliation_sweep_minutes: 'PERM-config.tools',
  watch_rearm_lead_minutes: 'PERM-config.tools',
  slack_token_rotation_enabled: 'PERM-config.tools',
  tool_selection_confidence_threshold: 'PERM-config.tools',
  ghl_rate_burst_cap: 'PERM-config.tools',
  ghl_rate_daily_cap: 'PERM-config.tools',
  ghl_access_token_ttl: 'PERM-config.tools',
  ghl_refresh_token_max_idle: 'PERM-config.tools',
  ghl_api_version_header: 'PERM-config.tools',
  ghl_oauth_scopes: 'PERM-config.tools',
  ghl_webhook_pubkey: 'PERM-config.tools',
  ghl_dossier_reverify_days: 'PERM-config.tools',

  // ── PERM-config.prompts (§G) ──
  dynamic_field_freshness_threshold: 'PERM-config.prompts',

  // ── PERM-config.loops (§H) ──
  loop_cadence_fast: 'PERM-config.loops',
  loop_cadence_medium: 'PERM-config.loops',
  loop_cadence_slow: 'PERM-config.loops',
  task_priority_scheme: 'PERM-config.loops',
  compression_threshold_tokens: 'PERM-config.loops',
  parallel_execution_enabled: 'PERM-config.loops',
  smart_scheduling_enabled: 'PERM-config.loops',
  anomaly_check_cadence: 'PERM-config.loops',
  checkpoint_step_threshold: 'PERM-config.loops',
  checkpoint_response_timeout_minutes: 'PERM-config.loops',
  max_retries_before_dead_letter: 'PERM-config.loops',
  dlq_stale_alert_hours: 'PERM-config.loops',

  // ── PERM-config.guardrails (§I + section-D RBAC clearance keys) ──
  approval_soft_timeout: 'PERM-config.guardrails',
  approval_escalation_timeout: 'PERM-config.guardrails',
  injection_semantic_detection_enabled: 'PERM-config.guardrails',
  injection_semantic_threshold: 'PERM-config.guardrails',
  injection_quarantine_threshold: 'PERM-config.guardrails',
  rate_limit_tool_writes_per_task: 'PERM-config.guardrails',
  rate_limit_external_comms_per_hour: 'PERM-config.guardrails',
  rate_limit_memory_writes_per_minute: 'PERM-config.guardrails',
  rate_limit_concurrent_tasks: 'PERM-config.guardrails',
  approval_pattern_sample_size: 'PERM-config.guardrails',
  cost_ladder_soft_threshold_daily_usd: 'PERM-config.guardrails',
  cost_ladder_soft_threshold_weekly_usd: 'PERM-config.guardrails',
  cost_ladder_throttle_threshold: 'PERM-config.guardrails',
  cost_ladder_hard_kill_threshold: 'PERM-config.guardrails',
  anomaly_thresholds: 'PERM-config.guardrails',
  action_autonomy_matrix: 'PERM-config.guardrails',
  clearance_review_cadence_days: 'PERM-config.guardrails',
  clearance_review_fail_closed: 'PERM-config.guardrails',

  // ── PERM-config.observability (§J) ──
  event_log_retention_window: 'PERM-config.observability',
  realtime_connection_headroom_threshold: 'PERM-config.observability',
  task_failure_spike_threshold: 'PERM-config.observability',
  queue_backup_threshold: 'PERM-config.observability',
  approval_staleness_alert_threshold: 'PERM-config.observability',
  cost_threshold_alert_limit: 'PERM-config.observability',
  task_success_rate_threshold_pct: 'PERM-config.observability',
  memory_confidence_drop_threshold: 'PERM-config.observability',
  alert_escalation_window_hours: 'PERM-config.observability',
  deployment_staleness_window: 'PERM-config.observability',
  polling_interval_health_metrics_s: 'PERM-config.observability',
  polling_interval_event_log_s: 'PERM-config.observability',
  polling_interval_memory_health_s: 'PERM-config.observability',
  polling_interval_self_improvement_s: 'PERM-config.observability',
  polling_interval_cost_tracking_s: 'PERM-config.observability',
  polling_interval_agent_health_s: 'PERM-config.observability',
  price_table: 'PERM-config.observability',
  alert_routing_rules: 'PERM-config.observability',
  escalation_contacts: 'PERM-config.observability',
  quiet_hours: 'PERM-config.observability',
  alert_email_enabled: 'PERM-config.observability',

  // ── PERM-config.agents (§K) ──
  orchestrator_confidence_threshold: 'PERM-config.agents',
  chain_depth_limit: 'PERM-config.agents',
  clarification_escalation: 'PERM-config.agents',
  drift_threshold: 'PERM-config.agents',
  dead_agent_threshold: 'PERM-config.agents',
  default_model: 'PERM-config.agents',
  lightweight_model: 'PERM-config.agents',
  routing_weights: 'PERM-config.agents',
  cache_time_window: 'PERM-config.agents',

  // ── PERM-config.proactive (§L) ──
  cold_start_basic_threshold: 'PERM-config.proactive',
  cold_start_proactive_threshold: 'PERM-config.proactive',
  cold_start_full_threshold: 'PERM-config.proactive',
  scanner_relationship_enabled: 'PERM-config.proactive',
  scanner_meeting_prep_enabled: 'PERM-config.proactive',
  scanner_document_prep_enabled: 'PERM-config.proactive',
  scanner_derisking_enabled: 'PERM-config.proactive',
  scanner_opportunity_enabled: 'PERM-config.proactive',
  scanner_briefing_enabled: 'PERM-config.proactive',
  scanner_pattern_enabled: 'PERM-config.proactive',
  briefing_schedule: 'PERM-config.proactive',
  meeting_prep_lead_time: 'PERM-config.proactive',
  not_contacted_window: 'PERM-config.proactive',
  renewal_lookahead_days: 'PERM-config.proactive',
  dismissal_decay: 'PERM-config.proactive',
  risk_floor: 'PERM-config.proactive',
  suggestion_ttl_days: 'PERM-config.proactive',
  suggestion_volume_limit: 'PERM-config.proactive',
  approval_push_frequency_minutes: 'PERM-config.proactive',
  stale_queue_push_hours: 'PERM-config.proactive',
  risk_thresholds: 'PERM-config.proactive',
  opportunity_thresholds: 'PERM-config.proactive',

  // ── PERM-config.infra (§M) ──
  client_offboarding_retention_days: 'PERM-config.infra',
  data_export_link_expiry_hours: 'PERM-config.infra',
  individual_deletion_audit_years: 'PERM-config.infra',
  deletion_two_person_auth_required: 'PERM-config.infra',
  deploy_max_skew_days: 'PERM-config.infra',
  deploy_max_version_skew: 'PERM-config.infra',
  canary_soak_minutes: 'PERM-config.infra',
  deployment_region: 'PERM-config.infra',
  recovery_tier: 'PERM-config.infra',
} as const;

/**
 * Map a config key to its owning PERM-config.<group> node. MUST stay equivalent to the SQL
 * `config_key_group` CASE. Only auth./webhook./support. are uniform-prefixed (with the auth.smtp_*
 * group-N secrets carved out to fail-closed); every other key is an explicit KEY_NODE_MAP entry.
 * Unmapped → PERM-config.infra (fail-closed, OD-181).
 */
export function configKeyGroup(key: string): ConfigPermNode {
  // Uniform-prefix families → auth. `auth.smtp_*` are group-N secrets (never in config_values); if one
  // ever reached here it must NOT read as auth, so carve it out to fail-closed infra before the auth.%
  // prefix matches.
  if (key.startsWith('auth.smtp_') || key === 'auth.smtp_bounce_webhook') {
    return 'PERM-config.infra';
  }
  if (key.startsWith('auth.') || key.startsWith('webhook.') || key.startsWith('support.')) {
    return 'PERM-config.auth';
  }
  // Explicit per-key map.
  const node = KEY_NODE_MAP[key];
  if (node !== undefined) return node;
  // FAIL-CLOSED default — Super-Admin-only, never leak-by-default (#2 / OD-181).
  return 'PERM-config.infra';
}

/** True if the caller's held PERM-config nodes include the node owning this key's group. */
export function callerCanReadKey(key: string, heldPerms: readonly string[]): boolean {
  return heldPerms.includes(configKeyGroup(key));
}
