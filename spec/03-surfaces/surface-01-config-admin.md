# Surface: UI-config-admin — Config Admin

---

## Context manifest
- **Surface ID:** `UI-config-admin`
- **Owned by:** C2 (Auth/Session keys), C4 (Memory), C5 (Tool layer), C6 (Guardrails/Proactive), C7 (Loops, Observability, Agents, Infra), C1 (RBAC, Secrets)
- **FRs served:**
  - FR-1.PERM.005 — PERM node catalog (this surface consumes 11 new `PERM-config.*` nodes)
  - FR-7.MGM.* — Management-plane config values feed the push payload
  - FR-7.ALR.009 — Alert routing (unroutable alert fails loud); `alert_routing_rules` edited here
- **CFG dependencies:** Every scalar key, secret, and structured-object key in `spec/02-config/config-registry.md` groups A–N (see per-section breakdown below)
- **PERM gates:**
  - Entry: `PERM-config.auth` OR any `PERM-config.*` the caller holds (a user who holds at least one section gate can enter the screen; they see only the sections they are gated for — see Access below)
  - Per-section: each section's `PERM-config.<area>` gate (detailed inline)
  - `PERM-config.infra` — Super Admin only, never delegable (registry note)
  - `PERM-config.secrets` — Super Admin only, read-only presence view; no in-app write
  - `PERM-guardrail.edit_autonomy` — required for edits to `action_autonomy_matrix` within `#guardrails`
- **DATA bindings:**
  - Scalar / object config rows: `config_values.key`, `config_values.value`, `config_values.updated_at`, `config_values.updated_by` (Phase 4 schema stub)
  - Secrets: env/Railway only — surface reads `secret_manifest.key`, `secret_manifest.present`, `secret_manifest.last_rotated` (Phase 4 schema stub; never reads actual secret value)
  - Config audit log: `config_audit_log.key`, `config_audit_log.old_value`, `config_audit_log.new_value`, `config_audit_log.actor_id`, `config_audit_log.changed_at` (Phase 4 schema stub)
- **ADR constraints:**
  - ADR-001 §7 — `X_INTERNAL_TOKEN` required for mgmt-plane push; shown as presence-only in `#secrets`
  - ADR-004 — sole-writer identity; config saves are actor-attributed
  - ADR-007 — seven hard limits are NOT knobs; `injection_semantic_detection_enabled` is off by default

---

## Overview

The Config Admin screen is the single privileged surface where Super Admins (and, for non-sensitive sections, delegated Admins) view and edit every tunable knob in the harness. It presents every scalar key, structured object, and secret presence indicator in the Phase-2 config registry, organised into 11 sections matching the registry's groups A–N. Each saved change is audited (who/when/old→new). LIVE changes take effect immediately; BOOT changes apply on next deploy; REBUILD changes trigger a background pipeline after explicit confirmation.

---

## Access

| Role | Can enter? | Notes |
|---|---|---|
| Super Admin | Yes | All 11 sections visible |
| Admin | Yes | Sections #auth #memory #tools #prompts #loops #guardrails #observability #agents #proactive visible; #infra and #secrets hidden (registry: `PERM-config.infra` and `PERM-config.secrets` are Super Admin only, never delegable) |
| Finance | No | Holds no `PERM-config.*` node by default → redirected to home |
| HR | No | Holds no `PERM-config.*` node by default → redirected to home |
| Account Manager | No | Holds no `PERM-config.*` node by default → redirected to home |
| Standard User | No | Holds no `PERM-config.*` node by default → redirected to home |

**Entry gate:** Caller must hold at least one `PERM-config.*` node. Callers without any such node see a 404. Sections the caller's PERM set does not cover are hidden (not shown as locked — they simply do not render). The section list adapts to the caller's permission set; a Super Admin sees all 11, an Admin sees 9.

---

## Layout

The Config Admin screen is a **top-level sidebar item labelled "System Config"** (OD-098 resolved: top-level, not nested). The screen uses a **sectioned sidebar-plus-content** layout: a left rail lists the 11 section anchors (#auth, #memory, #tools, #prompts, #loops, #guardrails, #observability, #agents, #proactive, #infra, #secrets); the right content area renders the selected section. Sections not permitted for the caller's PERM set are omitted from the rail entirely (not shown as locked).

A sticky header carries: screen title ("Config Admin"), the caller's role indicator, and a global "Unsaved changes" badge that appears when any field in the current section has a pending edit not yet saved.

Each section renders its keys as a table of rows: key name · **plain-English helper line** · current value · edit control · edit class badge (LIVE / BOOT / REBUILD / SECRET). **Save is per-section** (OD-103 resolved: one "Save [Section]" button per section; no per-key inline save; no global save).

**Plain-English helper text (binds to the registry).** Every key renders the **"What it does (plain English)"** description from its `config-registry.md` row directly beneath the key name as muted helper text — so a non-technical admin understands each knob without reading the spec. The registry is the single source of this text (the `config_values` row carries no separate description; the surface reads the canonical registry description per key). A key with no plain-English description is a registry defect, not a surface fallback.

Edit-class rules applied globally:
- **LIVE** rows: change takes effect immediately after save — no dialog.
- **BOOT** rows: change requires a redeploy. If the save batch contains at least one dirtied BOOT row, a confirm dialog appears before write: *"One or more changes require a redeploy to take effect. Proceed?"* (OD-101 resolved: dialog only when a BOOT row was dirtied; not on LIVE-only saves). After save, affected rows display an inline "applies next deploy" badge.
- **REBUILD** rows: change triggers a background pipeline rerun. A confirm dialog always appears before write: *"This change will trigger a background rebuild. Proceed?"*
- **SECRET** rows: read-only presence indicator only; no in-app write or rotation. Section displays *"Rotation is managed in Railway/CI. Values are never readable here."* (OD-102 resolved: `secret_manifest` table populated by deploy hook — not inferred from audit log).

Every save appends to `config_audit_log` (old value → new value, actor, timestamp). A "View audit log →" link at the top of each section navigates to `UI-config-audit-log` (OD-099 resolved: separate surface added to Phase 3 list).

**Mobile (OD-100 resolved):** On viewports < 768 px, a sticky banner reads *"Config Admin is optimised for desktop. Some features may be limited on this device."* The section rail collapses to a dropdown; section content stacks to a card layout. Full mobile redesign is not in scope.

---

## Sections

---

### #auth — Auth, Webhook & Support

**Purpose:** Configures authentication/session parameters (group A), webhook ingress controls (group B), and support/recovery timing (group C).

**PERM gate:** `PERM-config.auth`

**Data bindings:**

| Element | Source | Notes |
|---|---|---|
| `auth.oauth_enabled` | `config_values.value` WHERE key = 'auth.oauth_enabled' | bool toggle; BOOT |
| `auth.oauth_provider` | `config_values.value` WHERE key = 'auth.oauth_provider' | enum select {google, microsoft}; BOOT |
| `auth.two_factor_required` | `config_values.value` WHERE key = 'auth.two_factor_required' | bool toggle; BOOT; app-enforced |
| `auth.access_token_ttl` | `config_values.value` WHERE key = 'auth.access_token_ttl' | duration input; LIVE; Supabase fixed 1 h — UI warns if operator sets > 1 h (Supabase ignores it) |
| `auth.session_absolute_timeout` | `config_values.value` WHERE key = 'auth.session_absolute_timeout' | duration input; LIVE; Pro+ only; must be > inactivity timeout |
| `auth.session_inactivity_timeout` | `config_values.value` WHERE key = 'auth.session_inactivity_timeout' | duration input; LIVE; Pro+ only |
| `auth.invite_link_ttl` | `config_values.value` WHERE key = 'auth.invite_link_ttl' | duration input; BOOT; validation ≤ 24 h (Supabase hard cap AF-074) |
| `auth.seed_setup_link_ttl` | `config_values.value` WHERE key = 'auth.seed_setup_link_ttl' | duration input; BOOT; validation ≤ 24 h |
| `auth.account_lockout_threshold` | `config_values.value` WHERE key = 'auth.account_lockout_threshold' | int input ≥ 1; LIVE |
| `auth.account_lockout_minutes` | `config_values.value` WHERE key = 'auth.account_lockout_minutes' | int input ≥ 1; LIVE |
| `auth.mfa_softlock_threshold` | `config_values.value` WHERE key = 'auth.mfa_softlock_threshold' | int input ≥ 1; LIVE |
| `auth.mfa_softlock_minutes` | `config_values.value` WHERE key = 'auth.mfa_softlock_minutes' | int input ≥ 1; LIVE |
| `auth.captcha_enabled` | `config_values.value` WHERE key = 'auth.captcha_enabled' | bool toggle; LIVE |
| `auth.leaked_password_protection` | `config_values.value` WHERE key = 'auth.leaked_password_protection' | bool toggle; LIVE; Pro+ |
| `webhook.replay_window_seconds` | `config_values.value` WHERE key = 'webhook.replay_window_seconds' | int input 60–900; LIVE |
| `webhook.replay_cache_window` | `config_values.value` WHERE key = 'webhook.replay_cache_window' | duration input; LIVE; must be ≥ replay_window_seconds |
| `webhook.secret_rotation_window` | `config_values.value` WHERE key = 'webhook.secret_rotation_window' | duration input; LIVE |
| `webhook.google_expected_audience` | `config_values.value` WHERE key = 'webhook.google_expected_audience' | URL input; BOOT; required when Google connector enabled |
| `webhook.accept_rate_limit` | `config_values.value` WHERE key = 'webhook.accept_rate_limit' | int input ≥ 1 per source per minute; LIVE |
| `webhook.failure_alert_threshold` | `config_values.value` WHERE key = 'webhook.failure_alert_threshold' | int input ≥ 1 per source per hour; LIVE |
| `support.stale_request_minutes` | `config_values.value` WHERE key = 'support.stale_request_minutes' | int input ≥ 1; LIVE |
| Last updated / actor | `config_values.updated_at`, `config_values.updated_by` | Shown per row as "Last saved [datetime] by [actor]" |

**Actions:**

| Action (label) | What it does | PERM gate |
|---|---|---|
| Save Auth | Validates all LIVE and BOOT rows in this section; rejects cross-constraint violations; writes passing rows to `config_values`; appends to `config_audit_log`; LIVE changes take effect immediately; BOOT changes are flagged "applies next deploy" | `PERM-config.auth` |

**Real-time / poll:** Static on page load. No subscription. Operator triggers an explicit save; LIVE changes apply immediately after write; BOOT changes apply on next deploy.

**States:**
- **Loading:** Skeleton rows (key name visible, value field shows a grey placeholder bar) while `config_values` rows are fetched.
- **Empty:** Should not occur — this section always has keys. If it does (schema gap): "No configuration keys found for this section. Contact support." No save button rendered.
- **Error:** "Failed to load auth configuration. Values shown may be stale. [Retry]" — retry re-fetches; save is disabled until a successful load.
- **Partial:** If some rows fail to load, loaded rows are editable and show their current value; failed rows show "— (load error)" in the value column with a per-row retry icon; the Save button is disabled until all rows have loaded values (prevents saving a partial state that could overwrite good values with empty).
- **Offline / stale:** If network is lost after initial load, a sticky banner reads "You are viewing config values loaded at [timestamp]. Changes cannot be saved until connectivity is restored." Save is disabled. Loaded values remain visible.

---

### #memory — Memory

**Purpose:** Configures the memory subsystem: confidence thresholds, retrieval tuning, decay, embedding model, and ranking weights.

**PERM gate:** `PERM-config.memory`

**Data bindings:**

| Element | Source | Notes |
|---|---|---|
| `amber_zone_threshold` | `config_values.value` WHERE key = 'amber_zone_threshold' | float 0–1; LIVE; cross-constraint: ≥ confidence_floor |
| `confidence_floor` | `config_values.value` WHERE key = 'confidence_floor' | float 0–1; LIVE; cross-constraint: ≤ amber_zone_threshold |
| `retrieval_confidence_threshold` | `config_values.value` WHERE key = 'retrieval_confidence_threshold' | float 0–1; LIVE |
| `retrieval_sufficiency_threshold` | `config_values.value` WHERE key = 'retrieval_sufficiency_threshold' | float 0–1; LIVE |
| `memories_injected_per_task` | `config_values.value` WHERE key = 'memories_injected_per_task' | int 1–50; LIVE; labelled "(token-cost lever)" |
| `merge_similarity_threshold` | `config_values.value` WHERE key = 'merge_similarity_threshold' | float 0–1; LIVE |
| `soft_decay_age_months` | `config_values.value` WHERE key = 'soft_decay_age_months' | int ≥ 1; LIVE |
| `soft_decay_multiplier` | `config_values.value` WHERE key = 'soft_decay_multiplier' | float 0–1; LIVE |
| `summarise_episode_trigger` | `config_values.value` WHERE key = 'summarise_episode_trigger' | int ≥ 2; LIVE |
| `chunk_size_tokens` | `config_values.value` WHERE key = 'chunk_size_tokens' | int 200–400; LIVE |
| `coverage_stale_window_days` | `config_values.value` WHERE key = 'coverage_stale_window_days' | int ≥ 1; LIVE |
| `relevance_review_window_days` | `config_values.value` WHERE key = 'relevance_review_window_days' | int ≥ 1; LIVE |
| `bulk_drop_alert_count` | `config_values.value` WHERE key = 'bulk_drop_alert_count' | int ≥ 1; LIVE |
| `bulk_drop_alert_window_minutes` | `config_values.value` WHERE key = 'bulk_drop_alert_window_minutes' | int ≥ 1; LIVE |
| `ef_search` | `config_values.value` WHERE key = 'ef_search' | int 10–500; LIVE; labelled "(recall/latency dial)" |
| `procedural_boost` | `config_values.value` WHERE key = 'procedural_boost' | float ≥ 1.0; LIVE |
| `review_escalation_days` | `config_values.value` WHERE key = 'review_escalation_days' | int ≥ 1; LIVE |
| `ingest_defer_resurface_days` | `config_values.value` WHERE key = 'ingest_defer_resurface_days' | int ≥ 1; LIVE |
| `hr_content_enabled` | `config_values.value` WHERE key = 'hr_content_enabled' | bool toggle; BOOT; labelled "(requires legal review gate)" |
| `embedding_model` | `config_values.value` WHERE key = 'embedding_model' | enum select; **REBUILD** — changing this triggers full re-embed + HNSW rebuild; requires rebuild confirm dialog |
| `ranking_weights` | `config_values.value` WHERE key = 'ranking_weights' | Structured sub-table (4 float fields: recency · confidence · entity_match · vector_similarity); LIVE; sum must = 1.0 at write, else rejected |
| `expected_slots` | `config_values.value` WHERE key = 'expected_slots' | Structured sub-table keyed by entity type → slot name array (5–8 per type); LIVE |
| `entity_types` | `config_values.value` WHERE key = 'entity_types' | Array list; BOOT; unique strings; soft-disable only (no delete); "Internal Org" locked-present (delete rejected) |
| `haiku_audit_window_days` | `config_values.value` WHERE key = 'haiku_audit_window_days' | int days ≥ 7; LIVE; shadow-retain trust window before the cheap retention gate is trusted to act autonomously (OD-036) |
| `haiku_gate_disagree_threshold` | `config_values.value` WHERE key = 'haiku_gate_disagree_threshold' | float 0–1; LIVE |
| Last updated / actor | `config_values.updated_at`, `config_values.updated_by` | Shown per row |

**Actions:**

| Action (label) | What it does | PERM gate |
|---|---|---|
| Save Memory | Validates all rows; enforces cross-constraints (confidence_floor ≤ amber_zone_threshold; ranking_weights sum = 1.0; entity_types "Internal Org" present); writes to `config_values`; appends audit log; LIVE immediate; BOOT flagged; REBUILD rows blocked until confirm dialog | `PERM-config.memory` |
| Confirm Rebuild (dialog) | For `embedding_model` change: modal warns "Changing embedding model will re-embed all memories and rebuild the HNSW index. This may take significant time and cannot be cancelled mid-run. Confirm?" — operator must explicitly confirm before write proceeds | `PERM-config.memory` |

**Real-time / poll:** Static on page load. Explicit save.

**States:**
- **Loading:** Skeleton rows; structured sub-tables show placeholder grids.
- **Empty:** Should not occur. If it does: "No memory configuration keys found." No save rendered.
- **Error:** "Failed to load memory configuration. [Retry]" Save disabled.
- **Partial:** Loaded rows editable; failed rows show "— (load error)"; Save disabled until all rows loaded.
- **Offline / stale:** Sticky banner "Viewing config loaded at [timestamp]. Save disabled until connectivity restored."

---

### #tools — Tool Layer / Connectors

**Purpose:** Configures connector-level behaviour: backoff, rate limits, token refresh, reconnection escalation, and reconciliation cadences.

**PERM gate:** `PERM-config.tools`

**Data bindings:**

| Element | Source | Notes |
|---|---|---|
| `drive_full_corpus_ingest` | `config_values.value` WHERE key = 'drive_full_corpus_ingest' | bool toggle; BOOT; labelled "(enables scope escalation + CASA requirement)" |
| `backoff_initial_ms` | `config_values.value` WHERE key = 'backoff_initial_ms' | int ≥ 1; LIVE; cross-constraint: ≤ backoff_max_ms |
| `backoff_max_ms` | `config_values.value` WHERE key = 'backoff_max_ms' | int; LIVE; cross-constraint: ≥ backoff_initial_ms |
| `backoff_multiplier` | `config_values.value` WHERE key = 'backoff_multiplier' | float > 1.0; LIVE |
| `rate_max_calls_per_connector_window` | `config_values.value` WHERE key = 'rate_max_calls_per_connector_window' | Structured sub-table per connector (GHL / Google / Slack); int ≥ 1 each; LIVE |
| `rate_alert_threshold` | `config_values.value` WHERE key = 'rate_alert_threshold' | float 0–1; LIVE |
| `token_refresh_interval_minutes` | `config_values.value` WHERE key = 'token_refresh_interval_minutes' | int ≥ 1; LIVE |
| `token_refresh_lead_minutes` | `config_values.value` WHERE key = 'token_refresh_lead_minutes' | int ≥ 1; LIVE |
| `token_expiry_alert_days` | `config_values.value` WHERE key = 'token_expiry_alert_days' | int ≥ 1; LIVE |
| `connector_disconnection_escalation_window` | `config_values.value` WHERE key = 'connector_disconnection_escalation_window' | duration; LIVE |
| `event_reconciliation_sweep_minutes` | `config_values.value` WHERE key = 'event_reconciliation_sweep_minutes' | int ≥ 1; LIVE |
| `watch_rearm_lead_minutes` | `config_values.value` WHERE key = 'watch_rearm_lead_minutes' | int per connector; LIVE; must be < shortest watch TTL per connector |
| `slack_token_rotation_enabled` | `config_values.value` WHERE key = 'slack_token_rotation_enabled' | bool toggle; BOOT; labelled "Irreversible once enabled (OD-040)" — UI shows a permanent warning label when value is false; on-save confirm when changing from false to true |
| `tool_selection_confidence_threshold` | `config_values.value` WHERE key = 'tool_selection_confidence_threshold' | float 0–1; LIVE |
| Last updated / actor | `config_values.updated_at`, `config_values.updated_by` | Shown per row |

**Actions:**

| Action (label) | What it does | PERM gate |
|---|---|---|
| Save Tools | Validates all rows; enforces backoff cross-constraint; writes to `config_values`; appends audit log; LIVE immediate; BOOT flagged | `PERM-config.tools` |
| Confirm Slack Rotation (dialog) | When `slack_token_rotation_enabled` toggled false→true: modal "Enabling Slack token rotation is irreversible. Confirm?" — must confirm before write | `PERM-config.tools` |

**Real-time / poll:** Static on page load. Explicit save.

**States:**
- **Loading:** Skeleton rows.
- **Empty:** Should not occur. If it does: "No tool configuration keys found." No save rendered.
- **Error:** "Failed to load tool configuration. [Retry]" Save disabled.
- **Partial:** Loaded rows editable; failed rows show "— (load error)"; Save disabled until all loaded.
- **Offline / stale:** Sticky banner with timestamp; Save disabled.

---

### #prompts — Prompt Architecture

**Purpose:** Configures the prompt subsystem's single scalar tunable: dynamic field freshness threshold.

**PERM gate:** `PERM-config.prompts`

**Data bindings:**

| Element | Source | Notes |
|---|---|---|
| `dynamic_field_freshness_threshold` | `config_values.value` WHERE key = 'dynamic_field_freshness_threshold' | duration (default 30 d); LIVE |
| Last updated / actor | `config_values.updated_at`, `config_values.updated_by` | Shown per row |

**Actions:**

| Action (label) | What it does | PERM gate |
|---|---|---|
| Save Prompts | Validates row; writes to `config_values`; appends audit log; LIVE immediate | `PERM-config.prompts` |

**Real-time / poll:** Static on page load. Explicit save.

**States:**
- **Loading:** Single skeleton row.
- **Empty:** Should not occur. If it does: "No prompt configuration keys found." No save rendered.
- **Error:** "Failed to load prompt configuration. [Retry]" Save disabled.
- **Partial:** N/A (only one key; either loads or errors).
- **Offline / stale:** Sticky banner with timestamp; Save disabled.

---

### #loops — Agent Harness / Loops

**Purpose:** Configures loop cadences, task scheduling, parallelism, anomaly check cadence, and checkpoint/retry parameters.

**PERM gate:** `PERM-config.loops`

**Data bindings:**

| Element | Source | Notes |
|---|---|---|
| `loop_cadence_fast` | `config_values.value` WHERE key = 'loop_cadence_fast' | cron string; BOOT; valid range 5–15 min |
| `loop_cadence_medium` | `config_values.value` WHERE key = 'loop_cadence_medium' | cron string; BOOT; valid range 1–4 h |
| `loop_cadence_slow` | `config_values.value` WHERE key = 'loop_cadence_slow' | cron string; BOOT; valid range daily/weekly |
| `task_priority_scheme` | `config_values.value` WHERE key = 'task_priority_scheme' | enum select {fifo, priority-then-fifo}; BOOT |
| `compression_threshold_tokens` | `config_values.value` WHERE key = 'compression_threshold_tokens' | int ≥ 1000; LIVE |
| `parallel_execution_enabled` | `config_values.value` WHERE key = 'parallel_execution_enabled' | bool toggle; BOOT; labelled "(safety default: off; opt-in)" |
| `smart_scheduling_enabled` | `config_values.value` WHERE key = 'smart_scheduling_enabled' | bool toggle; BOOT |
| `anomaly_check_cadence` | `config_values.value` WHERE key = 'anomaly_check_cadence' | enum select {per-step, per-ai-call}; BOOT |
| `checkpoint_step_threshold` | `config_values.value` WHERE key = 'checkpoint_step_threshold' | int ≥ 1; LIVE |
| `checkpoint_response_timeout_minutes` | `config_values.value` WHERE key = 'checkpoint_response_timeout_minutes' | int ≥ 1; LIVE |
| `max_retries_before_dead_letter` | `config_values.value` WHERE key = 'max_retries_before_dead_letter' | int ≥ 0; LIVE |
| `dlq_stale_alert_hours` | `config_values.value` WHERE key = 'dlq_stale_alert_hours' | int hours ≥ 1; LIVE |
| Last updated / actor | `config_values.updated_at`, `config_values.updated_by` | Shown per row |

**Actions:**

| Action (label) | What it does | PERM gate |
|---|---|---|
| Save Loops | Validates all rows; writes to `config_values`; appends audit log; LIVE immediate; BOOT flagged "applies next deploy" | `PERM-config.loops` |

**Real-time / poll:** Static on page load. Explicit save.

**States:**
- **Loading:** Skeleton rows.
- **Empty:** Should not occur. If it does: "No loop configuration keys found." No save rendered.
- **Error:** "Failed to load loop configuration. [Retry]" Save disabled.
- **Partial:** Loaded rows editable; failed rows show "— (load error)"; Save disabled.
- **Offline / stale:** Sticky banner with timestamp; Save disabled.

---

### #guardrails — Guardrails

**Purpose:** Configures approval timeouts, injection detection, rate limits, cost ladder thresholds, anomaly thresholds, action autonomy matrix, and the RBAC clearance review cadence.

**PERM gate:** `PERM-config.guardrails` (entry and all keys except `action_autonomy_matrix` edits, which additionally require `PERM-guardrail.edit_autonomy`)

**Data bindings:**

| Element | Source | Notes |
|---|---|---|
| `clearance_review_cadence_days` | `config_values.value` WHERE key = 'clearance_review_cadence_days' | int ≥ 1; LIVE (registry group D, gated here per D row's gate assignment) |
| `approval_soft_timeout` | `config_values.value` WHERE key = 'approval_soft_timeout' | duration ≥ 1 min; LIVE |
| `approval_escalation_timeout` | `config_values.value` WHERE key = 'approval_escalation_timeout' | duration ≥ 1 min; LIVE |
| `injection_semantic_detection_enabled` | `config_values.value` WHERE key = 'injection_semantic_detection_enabled' | bool toggle; LIVE; default off (ADR-007) |
| `injection_semantic_threshold` | `config_values.value` WHERE key = 'injection_semantic_threshold' | float 0–1; LIVE; cross-constraint: ≤ injection_quarantine_threshold |
| `injection_quarantine_threshold` | `config_values.value` WHERE key = 'injection_quarantine_threshold' | float 0–1; LIVE; cross-constraint: ≥ injection_semantic_threshold |
| `rate_limit_tool_writes_per_task` | `config_values.value` WHERE key = 'rate_limit_tool_writes_per_task' | int ≥ 1; LIVE; never unlimited |
| `rate_limit_external_comms_per_hour` | `config_values.value` WHERE key = 'rate_limit_external_comms_per_hour' | int ≥ 1; LIVE; never unlimited; cross-constraint: ≥ autonomy matrix Act rate_cap for any configured action |
| `rate_limit_memory_writes_per_minute` | `config_values.value` WHERE key = 'rate_limit_memory_writes_per_minute' | int ≥ 1; LIVE; never unlimited |
| `rate_limit_concurrent_tasks` | `config_values.value` WHERE key = 'rate_limit_concurrent_tasks' | int ≥ 1; LIVE; never unlimited |
| `approval_pattern_sample_size` | `config_values.value` WHERE key = 'approval_pattern_sample_size' | int ≥ 1; LIVE |
| `cost_ladder_soft_threshold_daily_usd` | `config_values.value` WHERE key = 'cost_ladder_soft_threshold_daily_usd' | currency ≥ 0; LIVE; must be < throttle threshold |
| `cost_ladder_soft_threshold_weekly_usd` | `config_values.value` WHERE key = 'cost_ladder_soft_threshold_weekly_usd' | currency ≥ 0; LIVE; independently editable — deliberately not 7× daily (ADR-003, OD-164) |
| `cost_ladder_throttle_threshold` | `config_values.value` WHERE key = 'cost_ladder_throttle_threshold' | currency; LIVE; must be between soft and hard |
| `cost_ladder_hard_kill_threshold` | `config_values.value` WHERE key = 'cost_ladder_hard_kill_threshold' | currency; LIVE; must be > throttle |
| `anomaly_thresholds` | `config_values.value` WHERE key = 'anomaly_thresholds' | Structured sub-table (5 checks: confidence · volume · contradiction · scope_expansion · sentiment); each: threshold (typed) + severity {soft_alert, hard_approval}; LIVE |
| `action_autonomy_matrix` | `config_values.value` WHERE key = 'action_autonomy_matrix' | Structured sub-table; LIVE; **all sub-types LOCKED at hard-approval-or-Prepare** (`low_risk_external_nonclient` · existing_client_external · system_of_record_comms · financial_operation · confidential_restricted_action) — per **OD-161**, no sub-type may reach autonomous Act; the `act_requires_trust_period`/`act_trust_period_days`/`act_rate_cap_per_hour` fields are retired (they gated a capability that no longer exists); rendered read-only with a "Locked (hard_approval-or-Prepare)" badge; writes rejected at server; `PERM-guardrail.edit_autonomy` no longer has a configurable row to edit here (retained on the node catalog for any future non-floor use) |
| Last updated / actor | `config_values.updated_at`, `config_values.updated_by` | Shown per row |

**Hard limits note:** The seven hard limits (ADR-007/OD-047/OD-060) are NOT rendered as editable rows. If a hard limit key accidentally appears in `config_values`, it is shown read-only with a "Hard limit — not editable" badge. The UI must never render a save control for hard limit keys.

**Actions:**

| Action (label) | What it does | PERM gate |
|---|---|---|
| Save Guardrails | Validates all rows; enforces cross-constraints (injection thresholds; cost ladder ordering; floored autonomy rows reject any downgrade below hard-approval-or-Prepare); writes to `config_values`; appends audit log; LIVE immediate | `PERM-config.guardrails` |
| ~~Edit Autonomy Matrix (configurable row)~~ | **Retired (OD-161, 2026-07-02)** — every `action_autonomy_matrix` sub-type is now LOCKED at hard-approval-or-Prepare (see the `action_autonomy_matrix` row above); there is no configurable row left to edit. `PERM-guardrail.edit_autonomy` has no action bound to it here (retained on the node catalog for any future non-floor use). | — |

**Real-time / poll:** Static on page load. Explicit save.

**States:**
- **Loading:** Skeleton rows; structured sub-tables show placeholder grids.
- **Empty:** Should not occur. If it does: "No guardrail configuration keys found." No save rendered.
- **Error:** "Failed to load guardrail configuration. [Retry]" Save disabled.
- **Partial:** Loaded rows editable; failed rows show "— (load error)"; Save disabled.
- **Offline / stale:** Sticky banner with timestamp; Save disabled.

---

### #observability — Observability

**Purpose:** Configures event log retention, realtime thresholds, alert triggers, polling intervals, the price table for cost tracking, and alert routing rules.

**PERM gate:** `PERM-config.observability`

**Data bindings:**

| Element | Source | Notes |
|---|---|---|
| `event_log_retention_window` | `config_values.value` WHERE key = 'event_log_retention_window' | duration; BOOT; validation ≥ legal/audit floor (C10) |
| `realtime_connection_headroom_threshold` | `config_values.value` WHERE key = 'realtime_connection_headroom_threshold' | int 1–100 (percent); LIVE |
| `task_failure_spike_threshold` | `config_values.value` WHERE key = 'task_failure_spike_threshold' | compound: int count + int minutes; LIVE |
| `queue_backup_threshold` | `config_values.value` WHERE key = 'queue_backup_threshold' | compound: int count + int minutes; LIVE |
| `approval_staleness_alert_threshold` | `config_values.value` WHERE key = 'approval_staleness_alert_threshold' | duration ≥ 1 min; LIVE |
| `cost_threshold_alert_limit` | `config_values.value` WHERE key = 'cost_threshold_alert_limit' | currency per day + per week; LIVE |
| `task_success_rate_threshold_pct` | `config_values.value` WHERE key = 'task_success_rate_threshold_pct' | int 1–100; LIVE |
| `memory_confidence_drop_threshold` | `config_values.value` WHERE key = 'memory_confidence_drop_threshold' | float 0–1; LIVE |
| `alert_escalation_window_hours` | `config_values.value` WHERE key = 'alert_escalation_window_hours' | int ≥ 1; LIVE |
| `deployment_staleness_window` | `config_values.value` WHERE key = 'deployment_staleness_window' | duration ≥ push interval; LIVE |
| `polling_interval_health_metrics_s` | `config_values.value` WHERE key = 'polling_interval_health_metrics_s' | int ≥ 5; LIVE |
| `polling_interval_event_log_s` | `config_values.value` WHERE key = 'polling_interval_event_log_s' | int ≥ 5; LIVE |
| `polling_interval_memory_health_s` | `config_values.value` WHERE key = 'polling_interval_memory_health_s' | int ≥ 5; LIVE |
| `polling_interval_self_improvement_s` | `config_values.value` WHERE key = 'polling_interval_self_improvement_s' | int ≥ 5; LIVE |
| `polling_interval_cost_tracking_s` | `config_values.value` WHERE key = 'polling_interval_cost_tracking_s' | int ≥ 5; LIVE |
| `polling_interval_agent_health_s` | `config_values.value` WHERE key = 'polling_interval_agent_health_s' | int ≥ 5; LIVE |
| `price_table` | `config_values.value` WHERE key = 'price_table' | Structured sub-table: vendor×model→{input, output} $/1k tokens (+ embedding $/unit); all floats ≥ 0; LIVE; operator-editable (estimate-grade) |
| `alert_routing_rules` | `config_values.value` WHERE key = 'alert_routing_rules' | Structured sub-table: alert-type → {role, channel}; LIVE; unroutable alert fails loud per FR-7.ALR.009 — UI validates every alert type has a resolvable route before save |
| `escalation_contacts` | `config_values.value` WHERE key = 'escalation_contacts' | Structured sub-table: role → contact list; LIVE; must resolve (non-empty per role) — empty contact list rejected (#3) |
| `quiet_hours` | `config_values.value` WHERE key = 'quiet_hours' | Structured sub-table: time window(s); LIVE; critical alerts never suppressed — UI shows "Critical alerts bypass quiet hours" warning label |
| `alert_email_enabled` | `config_values.value` WHERE key = 'alert_email_enabled' | bool toggle; LIVE |
| Last updated / actor | `config_values.updated_at`, `config_values.updated_by` | Shown per row |

**Actions:**

| Action (label) | What it does | PERM gate |
|---|---|---|
| Save Observability | Validates all rows; enforces alert_routing_rules resolvability (rejects unroutable alert types — FR-7.ALR.009); validates escalation_contacts non-empty per role; validates quiet_hours does not suppress critical alerts; writes to `config_values`; appends audit log; LIVE immediate; BOOT flagged | `PERM-config.observability` |

**Real-time / poll:** Static on page load. Explicit save.

**States:**
- **Loading:** Skeleton rows; structured sub-tables show placeholder grids.
- **Empty:** Should not occur. If it does: "No observability configuration keys found." No save rendered.
- **Error:** "Failed to load observability configuration. [Retry]" Save disabled.
- **Partial:** Loaded rows editable; failed rows show "— (load error)"; Save disabled.
- **Offline / stale:** Sticky banner with timestamp; Save disabled.

---

### #agents — Agent Design / Routing

**Purpose:** Configures agent orchestration: confidence and drift thresholds, chain depth, model selection, routing weights, and per-agent-type cache windows.

**PERM gate:** `PERM-config.agents`

**Data bindings:**

| Element | Source | Notes |
|---|---|---|
| `orchestrator_confidence_threshold` | `config_values.value` WHERE key = 'orchestrator_confidence_threshold' | float 0–1; LIVE |
| `chain_depth_limit` | `config_values.value` WHERE key = 'chain_depth_limit' | int ≥ 1; LIVE |
| `clarification_escalation` | `config_values.value` WHERE key = 'clarification_escalation' | duration; LIVE |
| `drift_threshold` | `config_values.value` WHERE key = 'drift_threshold' | float 0–1; LIVE |
| `dead_agent_threshold` | `config_values.value` WHERE key = 'dead_agent_threshold' | float 0–1; LIVE |
| `default_model` | `config_values.value` WHERE key = 'default_model' | enum select (model id); BOOT |
| `lightweight_model` | `config_values.value` WHERE key = 'lightweight_model' | enum select (model id); BOOT |
| `routing_weights` | `config_values.value` WHERE key = 'routing_weights' | Structured sub-table (4 floats: domain_match · complexity_fit · memory_scope_fit · tool_scope_fit); LIVE; sum must = 1.0 at write |
| `cache_time_window` | `config_values.value` WHERE key = 'cache_time_window' | Structured sub-table: per agent type → int minutes ≥ 1 (research · client · campaign · comms · ops · finance · insight); LIVE |
| Last updated / actor | `config_values.updated_at`, `config_values.updated_by` | Shown per row |

**Actions:**

| Action (label) | What it does | PERM gate |
|---|---|---|
| Save Agents | Validates all rows; enforces routing_weights sum = 1.0; writes to `config_values`; appends audit log; LIVE immediate; BOOT flagged | `PERM-config.agents` |

**Real-time / poll:** Static on page load. Explicit save.

**States:**
- **Loading:** Skeleton rows; structured sub-tables show placeholder grids.
- **Empty:** Should not occur. If it does: "No agent configuration keys found." No save rendered.
- **Error:** "Failed to load agent configuration. [Retry]" Save disabled.
- **Partial:** Loaded rows editable; failed rows show "— (load error)"; Save disabled.
- **Offline / stale:** Sticky banner with timestamp; Save disabled.

---

### #proactive — Proactive Intelligence

**Purpose:** Configures cold-start thresholds, scanner enables, briefing schedule, relationship/risk/opportunity parameters, suggestion volume and TTL, and per-type risk and opportunity thresholds.

**PERM gate:** `PERM-config.proactive`

**Data bindings:**

| Element | Source | Notes |
|---|---|---|
| `cold_start_basic_threshold` | `config_values.value` WHERE key = 'cold_start_basic_threshold' | int 0–100 (percent); LIVE; cross-constraint: ≤ cold_start_proactive_threshold |
| `cold_start_proactive_threshold` | `config_values.value` WHERE key = 'cold_start_proactive_threshold' | int 0–100; LIVE; cross-constraint: between basic and full |
| `cold_start_full_threshold` | `config_values.value` WHERE key = 'cold_start_full_threshold' | int 0–100; LIVE; cross-constraint: ≥ cold_start_proactive_threshold |
| `scanner_relationship_enabled` | `config_values.value` WHERE key = 'scanner_relationship_enabled' | bool toggle; LIVE |
| `scanner_meeting_prep_enabled` | `config_values.value` WHERE key = 'scanner_meeting_prep_enabled' | bool toggle; LIVE |
| `scanner_document_prep_enabled` | `config_values.value` WHERE key = 'scanner_document_prep_enabled' | bool toggle; LIVE |
| `scanner_derisking_enabled` | `config_values.value` WHERE key = 'scanner_derisking_enabled' | bool toggle; LIVE; labelled "(surfacing only; C6 safety unaffected)" |
| `scanner_opportunity_enabled` | `config_values.value` WHERE key = 'scanner_opportunity_enabled' | bool toggle; LIVE |
| `scanner_briefing_enabled` | `config_values.value` WHERE key = 'scanner_briefing_enabled' | bool toggle; LIVE |
| `scanner_pattern_enabled` | `config_values.value` WHERE key = 'scanner_pattern_enabled' | bool toggle; LIVE |
| `briefing_schedule` | `config_values.value` WHERE key = 'briefing_schedule' | cron/time input (default 07:00 daily); LIVE |
| `meeting_prep_lead_time` | `config_values.value` WHERE key = 'meeting_prep_lead_time' | duration input; LIVE |
| `not_contacted_window` | `config_values.value` WHERE key = 'not_contacted_window' | int days ≥ 1; LIVE |
| `renewal_lookahead_days` | `config_values.value` WHERE key = 'renewal_lookahead_days' | int days ≥ 1; LIVE |
| `dismissal_decay` | `config_values.value` WHERE key = 'dismissal_decay' | float 0–1 per 30 d; LIVE |
| `risk_floor` | `config_values.value` WHERE key = 'risk_floor' | float 0–1; LIVE; labelled "suppression cannot go below this" |
| `suggestion_ttl_days` | `config_values.value` WHERE key = 'suggestion_ttl_days' | int days ≥ 1; LIVE |
| `suggestion_volume_limit` | `config_values.value` WHERE key = 'suggestion_volume_limit' | int ≥ 1 per cycle; LIVE |
| `approval_push_frequency_minutes` | `config_values.value` WHERE key = 'approval_push_frequency_minutes' | int ≥ 1; LIVE |
| `stale_queue_push_hours` | `config_values.value` WHERE key = 'stale_queue_push_hours' | int ≥ 1; LIVE |
| `risk_thresholds` | `config_values.value` WHERE key = 'risk_thresholds' | Structured sub-table per risk type (sentiment_drop · payment_overdue · campaign_underperform · capacity_stretched · renewal_approaching) → {threshold, owner_role}; owner_role ∈ C1 roles; LIVE |
| `opportunity_thresholds` | `config_values.value` WHERE key = 'opportunity_thresholds' | Structured sub-table per opp type (client_growth · new_service_fit · referral · market_signal) → {threshold, confidence_floor}; LIVE |
| Last updated / actor | `config_values.updated_at`, `config_values.updated_by` | Shown per row |

**Actions:**

| Action (label) | What it does | PERM gate |
|---|---|---|
| Save Proactive | Validates all rows; enforces cold_start ordering constraint (basic ≤ proactive ≤ full); validates risk_thresholds owner_role values against C1 role list; writes to `config_values`; appends audit log; LIVE immediate; BOOT flagged | `PERM-config.proactive` |

**Real-time / poll:** Static on page load. Explicit save.

**States:**
- **Loading:** Skeleton rows; structured sub-tables show placeholder grids.
- **Empty:** Should not occur. If it does: "No proactive configuration keys found." No save rendered.
- **Error:** "Failed to load proactive configuration. [Retry]" Save disabled.
- **Partial:** Loaded rows editable; failed rows show "— (load error)"; Save disabled.
- **Offline / stale:** Sticky banner with timestamp; Save disabled.

---

### #infra — Infrastructure & Compliance

**Purpose:** Configures offboarding retention, deletion audit requirements, two-person auth for deletions, deployment skew limits, canary soak time, and deployment region. Super Admin only; never delegable.

**PERM gate:** `PERM-config.infra` — Super Admin only; hidden from Admin callers (not shown as locked, simply absent from the section rail for non-Super-Admin callers)

**Data bindings:**

| Element | Source | Notes |
|---|---|---|
| `client_offboarding_retention_days` | `config_values.value` WHERE key = 'client_offboarding_retention_days' | int days ≥ legal minimum; BOOT |
| `data_export_link_expiry_hours` | `config_values.value` WHERE key = 'data_export_link_expiry_hours' | int hours ≥ 1; LIVE |
| `individual_deletion_audit_years` | `config_values.value` WHERE key = 'individual_deletion_audit_years' | int years ≥ legal minimum; BOOT |
| `deletion_two_person_auth_required` | `config_values.value` WHERE key = 'deletion_two_person_auth_required' | bool toggle; LIVE; for Restricted/Personal (distinct authoriser); labelled "Two-person auth for restricted/personal deletions" |
| `deploy_max_skew_days` | `config_values.value` WHERE key = 'deploy_max_skew_days' | int days ≥ 1; LIVE |
| `deploy_max_version_skew` | `config_values.value` WHERE key = 'deploy_max_version_skew' | int ≥ 1; LIVE |
| `canary_soak_minutes` | `config_values.value` WHERE key = 'canary_soak_minutes' | int ≥ 1; LIVE |
| `deployment_region` | `config_values.value` WHERE key = 'deployment_region' | enum select; BOOT; v1 locked to ap-southeast-2 (Sydney) — rendered read-only with "Locked for v1" badge unless multi-region is unlocked in a future phase |
| `recovery_tier` | `config_values.value` WHERE key = 'recovery_tier' | enum select {daily_in_project, hourly_off_platform, pitr}; BOOT; moving to `daily_in_project` (below hourly) requires a logged downgrade exception per `change-control.md` — never a silent default (`backup-dr.md` NFR-DR.001; PITR = paid upsell) |
| Last updated / actor | `config_values.updated_at`, `config_values.updated_by` | Shown per row |

**Actions:**

| Action (label) | What it does | PERM gate |
|---|---|---|
| Save Infra | Validates all rows; enforces legal minimums for retention/audit fields; writes to `config_values`; appends audit log; LIVE immediate; BOOT flagged | `PERM-config.infra` |

**Real-time / poll:** Static on page load. Explicit save.

**States:**
- **Loading:** Skeleton rows.
- **Empty:** Should not occur. If it does: "No infrastructure configuration keys found." No save rendered.
- **Error:** "Failed to load infrastructure configuration. [Retry]" Save disabled.
- **Partial:** Loaded rows editable; failed rows show "— (load error)"; Save disabled.
- **Offline / stale:** Sticky banner with timestamp; Save disabled.

---

### #secrets — Platform Secrets

**Purpose:** Shows presence and last-rotation date for all 11 platform secrets. No values are ever shown or editable in-app; rotation is performed in env/Railway. Deployment boot status for required secrets is shown.

**PERM gate:** `PERM-config.secrets` — Super Admin only; hidden from Admin callers

**Data bindings:**

| Element | Source | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` presence | `secret_manifest.present` WHERE key = 'ANTHROPIC_API_KEY' | bool; Required. Shows "Present" / "MISSING — boot blocked" |
| `ANTHROPIC_API_KEY` last rotated | `secret_manifest.last_rotated` WHERE key = 'ANTHROPIC_API_KEY' | datetime or "Unknown" |
| `OPENAI_API_KEY` presence | `secret_manifest.present` WHERE key = 'OPENAI_API_KEY' | bool; Required (embeddings) |
| `OPENAI_API_KEY` last rotated | `secret_manifest.last_rotated` WHERE key = 'OPENAI_API_KEY' | datetime or "Unknown" |
| `INNGEST_API_KEY` presence | `secret_manifest.present` WHERE key = 'INNGEST_API_KEY' | bool; Required (loops/queue) |
| `INNGEST_API_KEY` last rotated | `secret_manifest.last_rotated` WHERE key = 'INNGEST_API_KEY' | datetime or "Unknown" |
| `X_INTERNAL_TOKEN` presence | `secret_manifest.present` WHERE key = 'X_INTERNAL_TOKEN' | bool; Required (mgmt-plane push auth, ADR-001 §7) |
| `X_INTERNAL_TOKEN` last rotated | `secret_manifest.last_rotated` WHERE key = 'X_INTERNAL_TOKEN' | datetime or "Unknown" |
| `SLACK_SIGNING_SECRET` presence | `secret_manifest.present` WHERE key = 'SLACK_SIGNING_SECRET' | bool; Required if Slack connector enabled |
| `SLACK_SIGNING_SECRET` last rotated | `secret_manifest.last_rotated` WHERE key = 'SLACK_SIGNING_SECRET' | datetime or "Unknown" |
| `SLACK_WEBHOOK_URL` presence | `secret_manifest.present` WHERE key = 'SLACK_WEBHOOK_URL' | bool; Required if alert_email_enabled=false or Slack alert routing used (OD-097) |
| `SLACK_WEBHOOK_URL` last rotated | `secret_manifest.last_rotated` WHERE key = 'SLACK_WEBHOOK_URL' | datetime or "Unknown" |
| `GOHIGHLEVEL_WEBHOOK_SECRET` presence | `secret_manifest.present` WHERE key = 'GOHIGHLEVEL_WEBHOOK_SECRET' | bool; Required if GHL connector enabled; Ed25519 (OD-046) |
| `GOHIGHLEVEL_WEBHOOK_SECRET` last rotated | `secret_manifest.last_rotated` WHERE key = 'GOHIGHLEVEL_WEBHOOK_SECRET' | datetime or "Unknown" |
| `GOOGLE_OAUTH_CLIENT_SECRET` presence | `secret_manifest.present` WHERE key = 'GOOGLE_OAUTH_CLIENT_SECRET' | bool; Required if Google connector enabled |
| `GOOGLE_OAUTH_CLIENT_SECRET` last rotated | `secret_manifest.last_rotated` WHERE key = 'GOOGLE_OAUTH_CLIENT_SECRET' | datetime or "Unknown" |
| `GOOGLE_PUBSUB_SERVICE_ACCOUNT_KEY` presence | `secret_manifest.present` WHERE key = 'GOOGLE_PUBSUB_SERVICE_ACCOUNT_KEY' | bool; Required if Google push enabled; service-account JSON |
| `GOOGLE_PUBSUB_SERVICE_ACCOUNT_KEY` last rotated | `secret_manifest.last_rotated` WHERE key = 'GOOGLE_PUBSUB_SERVICE_ACCOUNT_KEY' | datetime or "Unknown" |
| `auth.smtp_*` presence | `secret_manifest.present` WHERE key = 'auth.smtp_bundle' | bool; Required in prod (host/port/user/pass/sender); encrypted |
| `auth.smtp_*` last rotated | `secret_manifest.last_rotated` WHERE key = 'auth.smtp_bundle' | datetime or "Unknown" |
| `auth.smtp_bounce_webhook` presence | `secret_manifest.present` WHERE key = 'auth.smtp_bounce_webhook' | bool; Optional (URL or empty) |
| `auth.smtp_bounce_webhook` last rotated | `secret_manifest.last_rotated` WHERE key = 'auth.smtp_bounce_webhook' | datetime or "Unknown" |

**Actions:**

| Action (label) | What it does | PERM gate |
|---|---|---|
| (none) | This section is read-only. No in-app save or rotate actions. Rotation is performed in env/Railway outside the app. | `PERM-config.secrets` |

**Real-time / poll:** Static on page load. No write actions; no save button rendered.

**States:**
- **Loading:** Skeleton rows (key names visible; presence and last-rotated columns show placeholder bars).
- **Empty:** Should not occur — the secret manifest is fixed at deployment. If no rows: "Secret manifest unavailable. Contact infrastructure." No actions rendered.
- **Error:** "Failed to load secret manifest. [Retry]" — the manifest read failed; retry re-fetches presence data. Required secrets that cannot be confirmed are shown as "Status unknown — verify in Railway."
- **Partial:** If some secret entries fail to load, loaded entries show their status; failed entries show "— (status unknown)". No save action exists so partial load does not block any user action.
- **Offline / stale:** Sticky banner "Viewing secret manifest loaded at [timestamp]. Connectivity lost — status may be stale."

---

## Navigation / transitions

| Trigger | Destination |
|---|---|
| Section rail link (#auth, #memory, etc.) | Scrolls to / activates that section within UI-config-admin |
| "View audit log" link (per section or global) | UI-config-audit-log (Phase 3 surface — if specced; otherwise OD-099 below) |
| Back / breadcrumb | Admin home / dashboard |

---

## Mobile

**OD-100 resolved (b):** On narrow viewports (< 768 px) a sticky banner reads *"Config Admin is optimised for desktop. Some features may be limited on this device."* The section rail collapses to a dropdown; section data tables switch to stacked card layout. Save actions, confirm dialogs, and validation behaviour are functionally identical to desktop. Full responsive redesign is not in scope.

---

## Open decisions

All resolved (operator: "take your recs", 2026-06-28).

| # | Question | Resolution |
|---|---|---|
| OD-098 🟢 | Nav label and placement | **(a)** "System Config" — top-level sidebar item |
| OD-099 🟢 | Audit log surface | **(a)** Separate `UI-config-audit-log` surface — linked from each section's "View audit log →". Added to Phase 3 surface list. |
| OD-100 🟢 | Mobile treatment | **(b)** "Optimised for desktop" banner + graceful degradation; full responsive not in scope |
| OD-101 🟢 | BOOT confirm dialog | **(c)** Dialog only when the current save batch contains at least one dirtied BOOT row |
| OD-102 🟢 | `last_rotated` source | **(a)** Dedicated `secret_manifest` table populated by Railway/CI deploy hook |
| OD-103 🟢 | Save scope | **(a)** Per-section save (one "Save [Section]" button per section) |

---

## Phase 4 data binding notes

The following `table.field` references are DATA stubs — Phase 4 must define schema, RLS policy, and index for each:

| Table.Field | Surface consumer | Type / nullability notes |
|---|---|---|
| `config_values.key` | All sections | TEXT NOT NULL UNIQUE; primary lookup key |
| `config_values.value` | All sections | JSONB NOT NULL (supports scalar + object values); empty object vs NULL matters for partial-load empty state |
| `config_values.updated_at` | All sections (per-row audit display) | TIMESTAMPTZ NOT NULL; index for audit log ordering |
| `config_values.updated_by` | All sections (per-row audit display) | UUID FK → users; NOT NULL; actor attribution (ADR-004) |
| `config_audit_log.key` | All sections (audit trail) | TEXT NOT NULL |
| `config_audit_log.old_value` | All sections | JSONB NULLABLE (NULL on first-ever write) |
| `config_audit_log.new_value` | All sections | JSONB NOT NULL |
| `config_audit_log.actor_id` | All sections | UUID FK → users NOT NULL |
| `config_audit_log.changed_at` | All sections | TIMESTAMPTZ NOT NULL; index |
| `secret_manifest.key` | #secrets section | TEXT NOT NULL UNIQUE |
| `secret_manifest.present` | #secrets section | BOOL NOT NULL; false = missing (boot-blocking for required keys) |
| `secret_manifest.last_rotated` | #secrets section | TIMESTAMPTZ NULLABLE ("Unknown" rendered when NULL); populated by deploy hook (OD-102) |

RLS policy guidance: `config_values` and `config_audit_log` must be accessible only to callers whose `PERM-config.*` node covers the row's key prefix. `secret_manifest` must be accessible only to Super Admin (`PERM-config.secrets`). Cross-section reads (e.g. a caller holding only `PERM-config.auth` must not read `PERM-config.infra` rows) require row-level filtering by key prefix tied to the caller's permission set — Phase 4 must spec this policy explicitly.
