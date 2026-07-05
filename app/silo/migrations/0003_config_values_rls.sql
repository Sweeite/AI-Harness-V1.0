-- Client-silo migration 0003 — config_values KEY-PREFIX RLS (ISSUE-010, FR-7.LOG.008 / config-registry §PERM-config)
--
-- SCOPE (Rule 0 + the 008/009/010 boundary): 0001 created the config cluster (config_values,
-- secret_manifest, config_audit_log — all with redacted_at) and bound the t_append_only trigger to
-- config_audit_log; 0001c REVOKEd baseline grants + REVOKEd delete on the four audit sinks; 0002 stood
-- up the RLS helpers (user_perms/user_clearances/user_restricted/user_aal) + the default_deny PERMISSIVE
-- floor on EVERY silo table (config_values, secret_manifest, config_audit_log all in its silo_tables list).
--
-- THIS migration adds the ADDITIVE, PERMISSIVE key-prefix read policies on config_values that COMPOSE on
-- the 0002 default_deny floor (permissive policies OR together — the floor grants nothing, these open a
-- read to the caller's own PERM-config.* group). It re-authors NOTHING from 008/009: no create table, no
-- create type, no re-bind of the trigger, no re-author of the helpers or the default_deny floor. It adds:
--   (1) config_key_group(key) — a SECURITY DEFINER IMMUTABLE helper mapping a config key to its owning
--       PERM-config.<group> node, per spec/02-config/config-registry.md §"Permission gates". Keys are
--       NOT uniformly prefixed (group A/B/C/F/H/M use dotted prefixes; group E/G/I/J/K/L knobs are bare),
--       so the map is prefix-rules-where-they-exist + a FAIL-CLOSED default: an unmapped key maps to
--       PERM-config.infra (Super-Admin-only, never delegable) so a new/unknown key is deny-by-default to
--       everyone below Super Admin rather than silently readable (#2). See the ISSUE-010 report design note
--       OD-CONFIG-KEYGROUP — the authoritative key→group table is the registry; this encodes its group
--       boundaries by prefix, and any key the registry adds without a matching prefix fails closed until
--       its prefix (or an explicit case) is added here.
--   (2) config_values_read — a PERMISSIVE `for select to authenticated` policy: a caller may read a
--       config_values row iff they hold the PERM-config.* node that owns that key's group. Key-prefix RLS.
--   (3) NO write policy — config_values writes are service_role (the config-admin write path, ISSUE-086);
--       service_role bypasses RLS by design (ADR-006 part 6). No requirement may assume RLS guards a
--       service_role write (FR-1.RLS.004).
--
-- SECRET-class keys are NEVER stored in config_values (schema.md L716 + config-edit-taxonomy rule 2) —
-- they live in secret_manifest (presence + last_rotated only). config_values therefore holds only
-- LIVE/BOOT/REBUILD knobs; a SECRET value can never reach this table or its audit sink (AC-7.LOG.008.5).
--
-- The runner wraps this file in a transaction (transactional:true in _journal.json — the orchestrator
-- wires the journal entry). Do NOT add BEGIN/COMMIT. Every statement is re-runnable (migrations.md hard
-- constraint): the helper via `create or replace`, the policy via a pg_policies existence guard.
--
-- ⚠️ NOT YET RUN LIVE. The live proof (a PERM-config.memory holder reads a memory-group key but not a
-- guardrails-group key; a no-perm caller reads nothing) is the ISSUE-010 capstone
-- (app/config-store/results/issue-010-capstone.sql), run by the operator at the Stage-2 checkpoint.

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. config_key_group(key) — map a config key to its owning PERM-config.<group> node
-- ══════════════════════════════════════════════════════════════════════════════
-- SECURITY DEFINER + IMMUTABLE + pinned search_path='' (same discipline as the 0002 helpers). Pure
-- function of the key text (reads no tables), so it is safe and cheap inside the once-per-statement
-- initPlan.
--
-- THIS IS AN EXPLICIT KEY→NODE MAP transcribed EXACTLY from spec/02-config/config-registry.md §§A–N —
-- NOT a content-prefix heuristic. The earlier heuristic version (greedy `rate_%`/`cost_%`/`risk_%`/
-- `anomaly_%`/`backoff_%`) MIS-ROUTED real registry keys (a #2 leak: e.g. `rate_alert_threshold` is a
-- TOOLS key, not guardrails; `backoff_*` are TOOLS keys, not loops; `anomaly_check_cadence` is a LOOPS
-- key, not guardrails; `price_table` is OBSERVABILITY, not guardrails; `risk_floor`/`risk_thresholds`
-- are PROACTIVE, not guardrails; `cost_threshold_alert_limit` is OBSERVABILITY, not guardrails). The
-- registry is the source of truth and it is enumerated per-key, so we enumerate per-key here.
--
-- ONLY three key families are uniform-prefixed → PERM-config.auth: `auth.*` (EXCEPT the `auth.smtp_*`
-- secrets, which are group-N secrets and never reach config_values), `webhook.*`, `support.*`. Every
-- other key is an EXPLICIT `when cfg_key = '…'` case. An unmapped key → PERM-config.infra (fail-closed,
-- Super-Admin-only; OD-181 deny-by-default for future/unknown keys). SECRET keys (group N) never reach
-- config_values, so they never reach this function.
create or replace function public.config_key_group(cfg_key text)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select case
    -- ── Uniform-prefix families → PERM-config.auth (§§A/B/C) ────────────────────
    -- `auth.smtp_*` are group-N secrets (never in config_values); no auth.smtp_* case is needed here
    -- because those keys never reach this function — but if one ever did, it must NOT read as auth, so
    -- it is explicitly excluded from the auth.% prefix below and falls through to the fail-closed infra.
    when cfg_key like 'auth.smtp_%'              then 'PERM-config.infra'
    when cfg_key = 'auth.smtp_bounce_webhook'    then 'PERM-config.infra'
    when cfg_key like 'auth.%'                    then 'PERM-config.auth'
    when cfg_key like 'webhook.%'                 then 'PERM-config.auth'
    when cfg_key like 'support.%'                 then 'PERM-config.auth'

    -- ── PERM-config.memory (§E) ─────────────────────────────────────────────────
    when cfg_key = 'amber_zone_threshold'             then 'PERM-config.memory'
    when cfg_key = 'confidence_floor'                 then 'PERM-config.memory'
    when cfg_key = 'retrieval_confidence_threshold'   then 'PERM-config.memory'
    when cfg_key = 'retrieval_sufficiency_threshold'  then 'PERM-config.memory'
    when cfg_key = 'memories_injected_per_task'       then 'PERM-config.memory'
    when cfg_key = 'rank_recency_half_life_days'      then 'PERM-config.memory'
    when cfg_key = 'merge_similarity_threshold'       then 'PERM-config.memory'
    when cfg_key = 'soft_decay_age_months'            then 'PERM-config.memory'
    when cfg_key = 'soft_decay_multiplier'            then 'PERM-config.memory'
    when cfg_key = 'summarise_episode_trigger'        then 'PERM-config.memory'
    when cfg_key = 'chunk_size_tokens'                then 'PERM-config.memory'
    when cfg_key = 'coverage_stale_window_days'       then 'PERM-config.memory'
    when cfg_key = 'relevance_review_window_days'     then 'PERM-config.memory'
    when cfg_key = 'bulk_drop_alert_count'            then 'PERM-config.memory'
    when cfg_key = 'bulk_drop_alert_window_minutes'   then 'PERM-config.memory'
    when cfg_key = 'ef_search'                        then 'PERM-config.memory'
    when cfg_key = 'procedural_boost'                 then 'PERM-config.memory'
    when cfg_key = 'review_escalation_days'           then 'PERM-config.memory'
    when cfg_key = 'ingest_defer_resurface_days'      then 'PERM-config.memory'
    when cfg_key = 'hr_content_enabled'               then 'PERM-config.memory'
    when cfg_key = 'embedding_model'                  then 'PERM-config.memory'
    when cfg_key = 'ranking_weights'                  then 'PERM-config.memory'
    when cfg_key = 'expected_slots'                   then 'PERM-config.memory'
    when cfg_key = 'entity_types'                     then 'PERM-config.memory'
    when cfg_key = 'haiku_audit_window_days'          then 'PERM-config.memory'
    when cfg_key = 'haiku_gate_disagree_threshold'    then 'PERM-config.memory'
    when cfg_key = 'memory_write_serialization'       then 'PERM-config.memory'

    -- ── PERM-config.tools (§F) ──────────────────────────────────────────────────
    when cfg_key = 'drive_full_corpus_ingest'                then 'PERM-config.tools'
    when cfg_key = 'backoff_initial_ms'                      then 'PERM-config.tools'
    when cfg_key = 'backoff_max_ms'                          then 'PERM-config.tools'
    when cfg_key = 'backoff_multiplier'                      then 'PERM-config.tools'
    when cfg_key = 'rate_max_calls_per_connector_window'     then 'PERM-config.tools'
    when cfg_key = 'rate_alert_threshold'                    then 'PERM-config.tools'
    when cfg_key = 'token_refresh_interval_minutes'          then 'PERM-config.tools'
    when cfg_key = 'token_refresh_lead_minutes'              then 'PERM-config.tools'
    when cfg_key = 'token_expiry_alert_days'                 then 'PERM-config.tools'
    when cfg_key = 'connector_disconnection_escalation_window' then 'PERM-config.tools'
    when cfg_key = 'event_reconciliation_sweep_minutes'      then 'PERM-config.tools'
    when cfg_key = 'watch_rearm_lead_minutes'                then 'PERM-config.tools'
    when cfg_key = 'slack_token_rotation_enabled'            then 'PERM-config.tools'
    when cfg_key = 'tool_selection_confidence_threshold'     then 'PERM-config.tools'
    when cfg_key = 'ghl_rate_burst_cap'                      then 'PERM-config.tools'
    when cfg_key = 'ghl_rate_daily_cap'                      then 'PERM-config.tools'
    when cfg_key = 'ghl_access_token_ttl'                    then 'PERM-config.tools'
    when cfg_key = 'ghl_refresh_token_max_idle'              then 'PERM-config.tools'
    when cfg_key = 'ghl_api_version_header'                  then 'PERM-config.tools'
    when cfg_key = 'ghl_oauth_scopes'                        then 'PERM-config.tools'
    when cfg_key = 'ghl_webhook_pubkey'                      then 'PERM-config.tools'
    when cfg_key = 'ghl_dossier_reverify_days'               then 'PERM-config.tools'

    -- ── PERM-config.prompts (§G) ────────────────────────────────────────────────
    when cfg_key = 'dynamic_field_freshness_threshold'  then 'PERM-config.prompts'

    -- ── PERM-config.loops (§H) ──────────────────────────────────────────────────
    when cfg_key = 'loop_cadence_fast'                   then 'PERM-config.loops'
    when cfg_key = 'loop_cadence_medium'                 then 'PERM-config.loops'
    when cfg_key = 'loop_cadence_slow'                   then 'PERM-config.loops'
    when cfg_key = 'task_priority_scheme'                then 'PERM-config.loops'
    when cfg_key = 'compression_threshold_tokens'        then 'PERM-config.loops'
    when cfg_key = 'parallel_execution_enabled'          then 'PERM-config.loops'
    when cfg_key = 'smart_scheduling_enabled'            then 'PERM-config.loops'
    when cfg_key = 'anomaly_check_cadence'               then 'PERM-config.loops'
    when cfg_key = 'checkpoint_step_threshold'           then 'PERM-config.loops'
    when cfg_key = 'checkpoint_response_timeout_minutes' then 'PERM-config.loops'
    when cfg_key = 'max_retries_before_dead_letter'      then 'PERM-config.loops'
    when cfg_key = 'dlq_stale_alert_hours'               then 'PERM-config.loops'

    -- ── PERM-config.guardrails (§§I + section-D RBAC clearance keys) ─────────────
    when cfg_key = 'approval_soft_timeout'                  then 'PERM-config.guardrails'
    when cfg_key = 'approval_escalation_timeout'            then 'PERM-config.guardrails'
    when cfg_key = 'injection_semantic_detection_enabled'  then 'PERM-config.guardrails'
    when cfg_key = 'injection_semantic_threshold'          then 'PERM-config.guardrails'
    when cfg_key = 'injection_quarantine_threshold'        then 'PERM-config.guardrails'
    when cfg_key = 'rate_limit_tool_writes_per_task'       then 'PERM-config.guardrails'
    when cfg_key = 'rate_limit_external_comms_per_hour'    then 'PERM-config.guardrails'
    when cfg_key = 'rate_limit_memory_writes_per_minute'   then 'PERM-config.guardrails'
    when cfg_key = 'rate_limit_concurrent_tasks'           then 'PERM-config.guardrails'
    when cfg_key = 'approval_pattern_sample_size'          then 'PERM-config.guardrails'
    when cfg_key = 'cost_ladder_soft_threshold_daily_usd'  then 'PERM-config.guardrails'
    when cfg_key = 'cost_ladder_soft_threshold_weekly_usd' then 'PERM-config.guardrails'
    when cfg_key = 'cost_ladder_throttle_threshold'        then 'PERM-config.guardrails'
    when cfg_key = 'cost_ladder_hard_kill_threshold'       then 'PERM-config.guardrails'
    when cfg_key = 'anomaly_thresholds'                    then 'PERM-config.guardrails'
    when cfg_key = 'action_autonomy_matrix'                then 'PERM-config.guardrails'
    when cfg_key = 'clearance_review_cadence_days'         then 'PERM-config.guardrails'
    when cfg_key = 'clearance_review_fail_closed'          then 'PERM-config.guardrails'

    -- ── PERM-config.observability (§J) ──────────────────────────────────────────
    when cfg_key = 'event_log_retention_window'            then 'PERM-config.observability'
    when cfg_key = 'realtime_connection_headroom_threshold' then 'PERM-config.observability'
    when cfg_key = 'task_failure_spike_threshold'          then 'PERM-config.observability'
    when cfg_key = 'queue_backup_threshold'                then 'PERM-config.observability'
    when cfg_key = 'approval_staleness_alert_threshold'    then 'PERM-config.observability'
    when cfg_key = 'cost_threshold_alert_limit'            then 'PERM-config.observability'
    when cfg_key = 'task_success_rate_threshold_pct'       then 'PERM-config.observability'
    when cfg_key = 'memory_confidence_drop_threshold'      then 'PERM-config.observability'
    when cfg_key = 'alert_escalation_window_hours'         then 'PERM-config.observability'
    when cfg_key = 'deployment_staleness_window'           then 'PERM-config.observability'
    when cfg_key = 'polling_interval_health_metrics_s'     then 'PERM-config.observability'
    when cfg_key = 'polling_interval_event_log_s'          then 'PERM-config.observability'
    when cfg_key = 'polling_interval_memory_health_s'      then 'PERM-config.observability'
    when cfg_key = 'polling_interval_self_improvement_s'   then 'PERM-config.observability'
    when cfg_key = 'polling_interval_cost_tracking_s'      then 'PERM-config.observability'
    when cfg_key = 'polling_interval_agent_health_s'       then 'PERM-config.observability'
    when cfg_key = 'price_table'                           then 'PERM-config.observability'
    when cfg_key = 'alert_routing_rules'                   then 'PERM-config.observability'
    when cfg_key = 'escalation_contacts'                   then 'PERM-config.observability'
    when cfg_key = 'quiet_hours'                           then 'PERM-config.observability'
    when cfg_key = 'alert_email_enabled'                   then 'PERM-config.observability'

    -- ── PERM-config.agents (§K) ─────────────────────────────────────────────────
    when cfg_key = 'orchestrator_confidence_threshold' then 'PERM-config.agents'
    when cfg_key = 'chain_depth_limit'                 then 'PERM-config.agents'
    when cfg_key = 'clarification_escalation'          then 'PERM-config.agents'
    when cfg_key = 'drift_threshold'                   then 'PERM-config.agents'
    when cfg_key = 'dead_agent_threshold'              then 'PERM-config.agents'
    when cfg_key = 'default_model'                     then 'PERM-config.agents'
    when cfg_key = 'lightweight_model'                 then 'PERM-config.agents'
    when cfg_key = 'routing_weights'                   then 'PERM-config.agents'
    when cfg_key = 'cache_time_window'                 then 'PERM-config.agents'

    -- ── PERM-config.proactive (§L) ──────────────────────────────────────────────
    when cfg_key = 'cold_start_basic_threshold'        then 'PERM-config.proactive'
    when cfg_key = 'cold_start_proactive_threshold'    then 'PERM-config.proactive'
    when cfg_key = 'cold_start_full_threshold'         then 'PERM-config.proactive'
    when cfg_key = 'scanner_relationship_enabled'      then 'PERM-config.proactive'
    when cfg_key = 'scanner_meeting_prep_enabled'      then 'PERM-config.proactive'
    when cfg_key = 'scanner_document_prep_enabled'     then 'PERM-config.proactive'
    when cfg_key = 'scanner_derisking_enabled'         then 'PERM-config.proactive'
    when cfg_key = 'scanner_opportunity_enabled'       then 'PERM-config.proactive'
    when cfg_key = 'scanner_briefing_enabled'          then 'PERM-config.proactive'
    when cfg_key = 'scanner_pattern_enabled'           then 'PERM-config.proactive'
    when cfg_key = 'briefing_schedule'                 then 'PERM-config.proactive'
    when cfg_key = 'meeting_prep_lead_time'            then 'PERM-config.proactive'
    when cfg_key = 'not_contacted_window'              then 'PERM-config.proactive'
    when cfg_key = 'renewal_lookahead_days'            then 'PERM-config.proactive'
    when cfg_key = 'dismissal_decay'                   then 'PERM-config.proactive'
    when cfg_key = 'risk_floor'                        then 'PERM-config.proactive'
    when cfg_key = 'suggestion_ttl_days'               then 'PERM-config.proactive'
    when cfg_key = 'suggestion_volume_limit'           then 'PERM-config.proactive'
    when cfg_key = 'approval_push_frequency_minutes'   then 'PERM-config.proactive'
    when cfg_key = 'stale_queue_push_hours'            then 'PERM-config.proactive'
    when cfg_key = 'risk_thresholds'                   then 'PERM-config.proactive'
    when cfg_key = 'opportunity_thresholds'            then 'PERM-config.proactive'

    -- ── PERM-config.infra (§M) — also the FAIL-CLOSED default below ──────────────
    when cfg_key = 'client_offboarding_retention_days'   then 'PERM-config.infra'
    when cfg_key = 'data_export_link_expiry_hours'       then 'PERM-config.infra'
    when cfg_key = 'individual_deletion_audit_years'     then 'PERM-config.infra'
    when cfg_key = 'deletion_two_person_auth_required'   then 'PERM-config.infra'
    when cfg_key = 'deploy_max_skew_days'                then 'PERM-config.infra'
    when cfg_key = 'deploy_max_version_skew'             then 'PERM-config.infra'
    when cfg_key = 'canary_soak_minutes'                 then 'PERM-config.infra'
    when cfg_key = 'deployment_region'                   then 'PERM-config.infra'
    when cfg_key = 'recovery_tier'                       then 'PERM-config.infra'

    -- FAIL-CLOSED default (OD-181): an unmapped key is Super-Admin-only (PERM-config.infra), never
    -- readable to a lower gate by omission (#2). A registry key added without an explicit case here
    -- lands on infra until its case is added — deny-by-default, never leak-by-default.
    else 'PERM-config.infra'
  end;
$$;

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. config_values_read — key-prefix-scoped read policy (composes on default_deny)
-- ══════════════════════════════════════════════════════════════════════════════
-- PERMISSIVE `for select to authenticated`: a caller reads a config_values row iff they hold the
-- PERM-config.* node that owns the row's key group. `(select …)`-wrapped so the helper calls evaluate
-- once per statement (auth_rls_initplan / AF-067 — the rls-lint enforces this). ORs with the 0002
-- default_deny floor: default_deny grants nothing, this grants the group read; the union is exactly the
-- caller's own group. No write policy — writes are service_role (RLS-exempt, ISSUE-086 write path).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'config_values' and policyname = 'config_values_read'
  ) then
    create policy config_values_read on public.config_values
      as permissive for select to authenticated
      using (
        (select public.user_perms(auth.uid())) @> array[ (select public.config_key_group(key)) ]
      );
  end if;
end $$;

-- Grant the base SELECT privilege back to `authenticated` (0001c did a blanket `revoke all` on every table).
-- RLS FILTERS rows; it does NOT grant table access — without this GRANT the config_values_read policy above
-- is unreachable ("permission denied for table" before RLS even runs). This is the read half of the human-path
-- model (rls-policies.md rule 2/4): authenticated may REACH config_values, and the policy + the 0002 default_deny
-- floor decide WHICH rows. Writes stay service_role-only (no INSERT/UPDATE/DELETE grant here — ISSUE-086 write
-- path). The `aal2` baseline clause + the full per-table read predicates are ISSUE-020; this is 010's own read
-- reachability. (Surfaced by the Stage-2 checkpoint: 009's live capstone used a freshly-created demo table that
-- auto-received Supabase default-privilege grants, so it never exercised a real revoked-then-policied table.)
grant select on public.config_values to authenticated;
