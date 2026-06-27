# Phase 2 — Config Registry (authoritative)

Every tunable knob (Tier 2) and secret (Tier 3) in the harness, classified · defaulted · validated ·
permission-gated · surfaced. This is the Phase-2 deliverable. Plain-English descriptions for every key
also live in `_HARVEST.md` (the working artifact that produced this).

**Phase-2 done-when:** every row has class + default + validation + `PERM-` + `UI-`; **zero `???`**.
Where Phase 1 gave no default, a **(proposed)** default is set here — operator may adjust; proposed
defaults do not block, they're flagged for a light confirm pass.

---

## Conventions (decided once, applied to every row)

### Edit classes (`standards/config-edit-taxonomy.md`)
**SECRET** env-only, never shown · **BOOT** on-screen, applies next deploy · **LIVE** on-screen,
immediate · **REBUILD** on-screen, triggers a background migration/index rebuild on save.

### Permission gates — the `PERM-config.*` family (all default **Super Admin only**)
Config is sensitive; every edit gate defaults to Super Admin. These nodes are **new — they must be
added to `PERMISSION_NODES.md`** (C1 FR-1.PERM.005; a gate with no catalog entry is a #3 defect).

| Gate | Covers groups | Notes |
|---|---|---|
| `PERM-config.auth` | A (auth/session), B (webhooks), C (support) | |
| `PERM-config.memory` | E | |
| `PERM-config.tools` | F (connectors) | |
| `PERM-config.prompts` | G | |
| `PERM-config.loops` | H (harness/loops) | |
| `PERM-config.guardrails` | I (guardrails, anomaly, rate, cost ladder, injection) | |
| `PERM-guardrail.edit_autonomy` | I → `action_autonomy_matrix` only | **pre-existing** node (glossary); floored rows reject downgrade regardless |
| `PERM-config.observability` | J (incl. alert routing) | |
| `PERM-config.agents` | K (routing, models, health) | |
| `PERM-config.proactive` | L (scanners, thresholds, cold-start) | |
| `PERM-config.infra` | M (deploy, residency, retention, deletion policy) | most sensitive; Super Admin only, never delegable |
| `PERM-config.secrets` | N | **read-only presence view**; rotation is env/Railway, not in-app |

### Surface — one Config Admin area, sectioned (full UI spec → Phase 3)
`UI-config-admin` — a single role-gated screen, one section per group: `#auth`, `#memory`, `#tools`,
`#prompts`, `#loops`, `#guardrails`, `#observability`, `#agents`, `#proactive`, `#infra`, `#secrets`.
SECRET rows render under `#secrets` as **presence + last-rotated only** (never the value). Each section
renders its rows per class (LIVE = live field; BOOT = field flagged "applies next boot"; REBUILD = field
behind a confirm-the-rebuild dialog).

### Cross-cutting rules
- **Every LIVE/BOOT/REBUILD change is audited** (who/when/old→new) — config audit log (taxonomy rule 4).
- **REBUILD changes** require explicit confirm + surface rebuild progress (taxonomy rule 5).
- **Validation is enforced at write time** — out-of-range/enum-violating/cross-constraint-breaking
  writes are rejected, never silently clamped (#3).
- **Cross-key constraints** (must hold at write): `confidence_floor ≤ amber_zone_threshold` ·
  `injection_semantic_threshold ≤ injection_quarantine_threshold` ·
  `cold_start_basic ≤ cold_start_proactive ≤ cold_start_full` · `ranking_weights` sum = 1.0 ·
  `routing_weights` sum = 1.0 · `backoff_initial_ms ≤ backoff_max_ms` ·
  autonomy-matrix Act `rate_cap ≤ rate_limit_external_comms_per_hour`.

---

## A. Auth & Session — `PERM-config.auth` · `UI-config-admin#auth`

| Key | Default | Class | Validation |
|---|---|---|---|
| `auth.oauth_enabled` | true | BOOT | bool |
| `auth.oauth_provider` | `google` | BOOT | enum {google, microsoft} |
| `auth.two_factor_required` | true | BOOT | bool (app-enforced) |
| `auth.access_token_ttl` | 1 h | LIVE | duration; Supabase fixed 1 h (don't raise) |
| `auth.session_absolute_timeout` | 30 d (proposed) | LIVE | duration; Pro+ only; > inactivity |
| `auth.session_inactivity_timeout` | 14 d | LIVE | duration; Pro+ only |
| `auth.invite_link_ttl` | 24 h | BOOT | duration ≤ 24 h (Supabase hard cap, AF-074) |
| `auth.seed_setup_link_ttl` | 24 h | BOOT | duration ≤ 24 h |
| `auth.account_lockout_threshold` | 5 | LIVE | int ≥ 1 |
| `auth.account_lockout_minutes` | 15 (proposed) | LIVE | int minutes ≥ 1 |
| `auth.mfa_softlock_threshold` | 5 | LIVE | int ≥ 1 |
| `auth.mfa_softlock_minutes` | 15 (proposed) | LIVE | int minutes ≥ 1 |
| `auth.captcha_enabled` | true | LIVE | bool |
| `auth.leaked_password_protection` | true | LIVE | bool; Pro+ |

## B. Webhook ingress — `PERM-config.auth` · `UI-config-admin#auth`

| Key | Default | Class | Validation |
|---|---|---|---|
| `webhook.replay_window_seconds` | 300 | LIVE | int seconds 60–900 |
| `webhook.replay_cache_window` | 300 s (proposed) | LIVE | duration ≥ replay_window_seconds |
| `webhook.secret_rotation_window` | 24 h (proposed) | LIVE | duration |
| `webhook.google_expected_audience` | (per-deployment URL) | BOOT | URL; required when Google connector on |
| `webhook.accept_rate_limit` | 60 / min (proposed) | LIVE | int per source per minute ≥ 1 |
| `webhook.failure_alert_threshold` | 3 / hr | LIVE | int per source per hour ≥ 1 |

## C. Support / recovery — `PERM-config.auth` · `UI-config-admin#auth`

| Key | Default | Class | Validation |
|---|---|---|---|
| `support.stale_request_minutes` | 60 (proposed) | LIVE | int minutes ≥ 1 |

## D. RBAC — (records, not config)
RBAC's tunable knob set is a single timing value; roles/perms/clearances are Tier-1 records (Phase 3/4).

| Key | Default | Class | Validation | Gate · Surface |
|---|---|---|---|---|
| `clearance_review_cadence_days` | 90 | LIVE | int days ≥ 1 | `PERM-config.guardrails` · `#guardrails` |

## E. Memory — `PERM-config.memory` · `UI-config-admin#memory`

| Key | Default | Class | Validation |
|---|---|---|---|
| `amber_zone_threshold` | 0.65 | LIVE | float 0–1; ≥ confidence_floor |
| `confidence_floor` | 0.5 | LIVE | float 0–1; ≤ amber_zone_threshold |
| `retrieval_confidence_threshold` | 0.7 | LIVE | float 0–1 |
| `retrieval_sufficiency_threshold` | 0.6 (proposed) | LIVE | float 0–1 |
| `memories_injected_per_task` | 7 | LIVE | int 1–50 (token-cost lever) |
| `merge_similarity_threshold` | 0.92 | LIVE | float 0–1 |
| `soft_decay_age_months` | 6 | LIVE | int months ≥ 1 |
| `soft_decay_multiplier` | 0.95 | LIVE | float 0–1 |
| `summarise_episode_trigger` | 10 | LIVE | int ≥ 2 |
| `chunk_size_tokens` | 300 | LIVE | int 200–400 |
| `coverage_stale_window_days` | 30 | LIVE | int days ≥ 1 |
| `relevance_review_window_days` | 30 | LIVE | int days ≥ 1 |
| `bulk_drop_alert_count` | 10 | LIVE | int ≥ 1 |
| `bulk_drop_alert_window_minutes` | 60 | LIVE | int minutes ≥ 1 |
| `ef_search` | 40 | LIVE | int 10–500 (recall/latency dial) |
| `procedural_boost` | 1.2 | LIVE | float ≥ 1.0 |
| `review_escalation_days` | 7 (proposed) | LIVE | int days ≥ 1 |
| `ingest_defer_resurface_days` | 14 (proposed) | LIVE | int days ≥ 1 |
| `hr_content_enabled` | false | BOOT | bool; legal review gate |
| `embedding_model` | text-embedding-3-small | **REBUILD** | enum; save ⇒ re-embed + HNSW rebuild |
| `ranking_weights` | App. A | LIVE | object; sum = 1.0 |
| `expected_slots` | App. A | LIVE | object; 5–8 per entity type |
| `entity_types` | App. A | BOOT | array unique; "Internal Org" locked-present |

## F. Tool layer / connectors — `PERM-config.tools` · `UI-config-admin#tools`

| Key | Default | Class | Validation |
|---|---|---|---|
| `drive_full_corpus_ingest` | false | BOOT | bool; ⇒ scope escalation + CASA |
| `backoff_initial_ms` | 1000 | LIVE | int ms ≥ 1; ≤ backoff_max_ms |
| `backoff_max_ms` | 60000 | LIVE | int ms; ≥ backoff_initial_ms |
| `backoff_multiplier` | 2 | LIVE | float > 1.0 |
| `rate_max_calls_per_connector_window` | per-connector (App. A) | LIVE | int; per-connector from dossiers |
| `rate_alert_threshold` | 0.80 | LIVE | float 0–1 |
| `token_refresh_interval_minutes` | 15 | LIVE | int minutes ≥ 1 |
| `token_refresh_lead_minutes` | 30 | LIVE | int minutes ≥ 1 |
| `token_expiry_alert_days` | 7 | LIVE | int days ≥ 1 |
| `connector_disconnection_escalation_window` | 24 h | LIVE | duration |
| `event_reconciliation_sweep_minutes` | 30 (proposed) | LIVE | int minutes ≥ 1 |
| `watch_rearm_lead_minutes` | per-connector (proposed) | LIVE | int minutes; < shortest watch TTL |
| `slack_token_rotation_enabled` | false | BOOT | bool; irreversible once on (OD-040) |
| `tool_selection_confidence_threshold` | 0.7 (proposed) | LIVE | float 0–1 |

## G. Prompt architecture — `PERM-config.prompts` · `UI-config-admin#prompts`

| Key | Default | Class | Validation |
|---|---|---|---|
| `dynamic_field_freshness_threshold` | 30 d (proposed) | LIVE | duration |

## H. Agent harness / loops — `PERM-config.loops` · `UI-config-admin#loops`

| Key | Default | Class | Validation |
|---|---|---|---|
| `loop_cadence_fast` | `*/10 * * * *` | BOOT | cron; 5–15 min range |
| `loop_cadence_medium` | `0 */2 * * *` | BOOT | cron; 1–4 h range |
| `loop_cadence_slow` | `0 8 * * *` | BOOT | cron; daily/weekly |
| `task_priority_scheme` | priority-then-FIFO | BOOT | enum {fifo, priority-then-fifo} |
| `compression_threshold_tokens` | 8000 (proposed) | LIVE | int tokens ≥ 1000 |
| `parallel_execution_enabled` | false | BOOT | bool (safety default; opt-in) |
| `smart_scheduling_enabled` | false (proposed) | BOOT | bool |
| `anomaly_check_cadence` | per-step | BOOT | enum {per-step, per-ai-call} |
| `checkpoint_step_threshold` | 4 | LIVE | int steps ≥ 1 |
| `checkpoint_response_timeout_minutes` | 60 | LIVE | int minutes ≥ 1 |
| `max_retries_before_dead_letter` | 3 | LIVE | int ≥ 0 |

## I. Guardrails — `PERM-config.guardrails` · `UI-config-admin#guardrails`

| Key | Default | Class | Validation |
|---|---|---|---|
| `approval_soft_timeout` | 10 min | LIVE | duration ≥ 1 min |
| `approval_escalation_timeout` | 4 h | LIVE | duration ≥ 1 min |
| `injection_semantic_detection_enabled` | false | LIVE | bool (off by default, ADR-007) |
| `injection_semantic_threshold` | 0.85 | LIVE | float 0–1; ≤ quarantine |
| `injection_quarantine_threshold` | 0.95 | LIVE | float 0–1; ≥ semantic |
| `rate_limit_tool_writes_per_task` | 10 | LIVE | int ≥ 1 (never unlimited) |
| `rate_limit_external_comms_per_hour` | 5 | LIVE | int ≥ 1 (never unlimited) |
| `rate_limit_memory_writes_per_minute` | 30 | LIVE | int ≥ 1 (never unlimited) |
| `rate_limit_concurrent_tasks` | 5 | LIVE | int ≥ 1 (never unlimited) |
| `approval_pattern_sample_size` | 30 | LIVE | int ≥ 1 |
| `cost_ladder_soft_threshold` | $50/day, $200/wk | LIVE | currency ≥ 0; < throttle |
| `cost_ladder_throttle_threshold` | $75/day (proposed) | LIVE | currency; between soft & hard |
| `cost_ladder_hard_kill_threshold` | $100/day | LIVE | currency; > throttle |
| `anomaly_thresholds` | App. A | LIVE | object (5 checks) |
| `action_autonomy_matrix` | App. A | LIVE | object; gate `PERM-guardrail.edit_autonomy`; floored rows reject downgrade |

> LOCKED (not knobs): the seven hard limits (ADR-007/OD-047/OD-060), sole-writer identity (ADR-004).

## J. Observability — `PERM-config.observability` · `UI-config-admin#observability`

| Key | Default | Class | Validation |
|---|---|---|---|
| `event_log_retention_window` | 365 d (proposed) | BOOT | duration ≥ legal/audit floor (C10) |
| `realtime_connection_headroom_threshold` | 80% | LIVE | int 1–100 |
| `task_failure_spike_threshold` | 5 in 30 min | LIVE | int count + int minutes |
| `queue_backup_threshold` | 20 for 60 min | LIVE | int count + int minutes |
| `approval_staleness_alert_threshold` | 4 h | LIVE | duration ≥ 1 min |
| `cost_threshold_alert_limit` | $50/day, $200/wk | LIVE | currency ≥ 0 |
| `task_success_rate_threshold_pct` | 95 | LIVE | int 1–100 |
| `memory_confidence_drop_threshold` | 0.6 | LIVE | float 0–1 |
| `alert_escalation_window_hours` | 2 | LIVE | int hours ≥ 1 |
| `deployment_staleness_window` | 15 min (proposed) | LIVE | duration ≥ push interval |
| `polling_interval_health_metrics_s` | 30 | LIVE | int seconds ≥ 5 |
| `polling_interval_event_log_s` | 60 | LIVE | int seconds ≥ 5 |
| `polling_interval_memory_health_s` | 300 | LIVE | int seconds ≥ 5 |
| `polling_interval_self_improvement_s` | 600 | LIVE | int seconds ≥ 5 |
| `polling_interval_cost_tracking_s` | 300 | LIVE | int seconds ≥ 5 |
| `polling_interval_agent_health_s` | 60 | LIVE | int seconds ≥ 5 |
| `price_table` | App. A | LIVE | object (vendor×model→price) |
| **Alert routing (OD-097):** | | | |
| `alert_routing_rules` | route-by-role (default map) | LIVE | object: alert-type → {role, channel} |
| `escalation_contacts` | (per-role) | LIVE | object: role → contact list; must resolve (#3) |
| `quiet_hours` | none | LIVE | object: window(s); never suppresses critical |
| `alert_email_enabled` | true | LIVE | bool |

> **OD-097 — CLOSED.** The *behaviour* "an unroutable alert fails loud, never drops silently" is realised in
> **C7 `FR-7.ALR.009`** (change-control, session 28). `SLACK_WEBHOOK_URL` is in group N (secret).

## K. Agent design / routing — `PERM-config.agents` · `UI-config-admin#agents`

| Key | Default | Class | Validation |
|---|---|---|---|
| `orchestrator_confidence_threshold` | 0.75 | LIVE | float 0–1 |
| `chain_depth_limit` | 6 | LIVE | int ≥ 1 |
| `clarification_escalation` | 24 h (proposed) | LIVE | duration |
| `drift_threshold` | 0.3 (proposed) | LIVE | float 0–1 |
| `dead_agent_threshold` | 0.5 success-rate (proposed) | LIVE | float 0–1 |
| `default_model` | claude-sonnet-4-6 | BOOT | enum (model id) |
| `lightweight_model` | claude-haiku-4-5 | BOOT | enum (model id) |
| `routing_weights` | App. A | LIVE | object; sum = 1.0 |
| `cache_time_window` | App. A | LIVE | object (per agent type, minutes) |

## L. Proactive intelligence — `PERM-config.proactive` · `UI-config-admin#proactive`

| Key | Default | Class | Validation |
|---|---|---|---|
| `cold_start_basic_threshold` | 20% | LIVE | int 0–100; ≤ proactive |
| `cold_start_proactive_threshold` | 50% | LIVE | int 0–100; between basic & full |
| `cold_start_full_threshold` | 80% | LIVE | int 0–100; ≥ proactive |
| `external_act_trust_period` | 14 d | BOOT | int days ≥ 0 |
| `scanner_relationship_enabled` | true | LIVE | bool |
| `scanner_meeting_prep_enabled` | true | LIVE | bool |
| `scanner_document_prep_enabled` | true | LIVE | bool |
| `scanner_derisking_enabled` | true | LIVE | bool (surfacing only; C6 safety unaffected) |
| `scanner_opportunity_enabled` | true | LIVE | bool |
| `scanner_briefing_enabled` | true | LIVE | bool |
| `scanner_pattern_enabled` | true | LIVE | bool |
| `briefing_schedule` | 07:00 daily (proposed) | LIVE | cron/time |
| `meeting_prep_lead_time` | 120 min (proposed) | LIVE | duration |
| `not_contacted_window` | 30 d (proposed) | LIVE | int days ≥ 1 |
| `renewal_lookahead_days` | 60 (proposed) | LIVE | int days ≥ 1 |
| `dismissal_decay` | 0.5 / 30 d (proposed) | LIVE | float 0–1 |
| `risk_floor` | 0.8 (proposed) | LIVE | float 0–1; suppression can't go below |
| `suggestion_ttl_days` | 7 (proposed) | LIVE | int days ≥ 1 |
| `suggestion_volume_limit` | 10 / cycle (proposed) | LIVE | int ≥ 1 |
| `approval_push_frequency_minutes` | 30 | LIVE | int minutes ≥ 1 |
| `stale_queue_push_hours` | 4 | LIVE | int hours ≥ 1 |
| `risk_thresholds` | App. A | LIVE | object (per risk type) |
| `opportunity_thresholds` | App. A | LIVE | object (per opp type) |

## M. Infrastructure & compliance — `PERM-config.infra` · `UI-config-admin#infra`

| Key | Default | Class | Validation |
|---|---|---|---|
| `client_offboarding_retention_days` | 90 | BOOT | int days ≥ legal min |
| `data_export_link_expiry_hours` | 72 | LIVE | int hours ≥ 1 |
| `individual_deletion_audit_years` | 7 | BOOT | int years ≥ legal min |
| `deletion_two_person_auth_required` | true | LIVE | bool; for Restricted/Personal (distinct authoriser) |
| `deploy_max_skew_days` | 14 | LIVE | int days ≥ 1 |
| `deploy_max_version_skew` | 3 | LIVE | int ≥ 1 |
| `canary_soak_minutes` | 60 (proposed) | LIVE | int minutes ≥ 1 |
| `deployment_region` | ap-southeast-2 | BOOT | enum (v1 Sydney locked) |

## N. Platform secrets — `PERM-config.secrets` (presence only) · `UI-config-admin#secrets`
All env/Railway only; surface shows presence + last-rotated, never the value. Deployment cannot boot
without the required ones.

| Key | Required | Validation |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | present at boot |
| `OPENAI_API_KEY` | yes | present at boot (embeddings) |
| `INNGEST_API_KEY` | yes | present at boot (loops/queue) |
| `X_INTERNAL_TOKEN` | yes | present; mgmt-plane push auth (ADR-001 §7) |
| `SLACK_SIGNING_SECRET` | if Slack on | present when connector enabled |
| `SLACK_WEBHOOK_URL` | if Slack alerts on | present when alert_email_enabled=false or Slack routing used (OD-097) |
| `GOHIGHLEVEL_WEBHOOK_SECRET` | if GHL on | Ed25519 (OD-046) |
| `GOOGLE_OAUTH_CLIENT_SECRET` | if Google on | present when connector enabled |
| `GOOGLE_PUBSUB_SERVICE_ACCOUNT_KEY` | if Google push on | service-account JSON |
| `auth.smtp_*` (host/port/user/pass/sender) | prod | present in prod; encrypted |
| `auth.smtp_bounce_webhook` | optional | URL or empty |

---

## Appendix A — Structured (object) configs
Each is one structured config rendering as its own admin sub-table. Defaults + per-field validation:

1. **`ranking_weights`** — recency 0.3 · confidence 0.3 · entity_match 0.2 · vector_similarity 0.2. Each float 0–1; **sum = 1.0** (write-time, else reject).
2. **`expected_slots`** — keyed by entity type → array of 5–8 slot names. Per type 5 ≤ len ≤ 8.
3. **`entity_types`** — array of ~22 default kinds (Client, Contact, Team Member, Vendor/Partner, Campaign, Task, Deliverable, Template, Deal, Contract/Retainer, Invoice, Brand Guide, Audience, Channel, Team/Department, Meeting, SOP/Playbook, Tool/Platform, Goal/OKR, Financial Period, Lesson Learned, Internal Org). Unique strings; soft-disable not delete; "Internal Org" always present + locked.
4. **`routing_weights`** — domain_match 0.35 · complexity_fit 0.25 · memory_scope_fit 0.20 · tool_scope_fit 0.20. Each 0–1; **sum = 1.0**.
5. **`cache_time_window`** (minutes) — research 30 · client 60 · campaign 60 · comms 15 · ops 120 · finance 120 · insight 1440. Each int ≥ 1.
6. **`anomaly_thresholds`** — confidence {0.5, soft} · volume {20/run, soft} · contradiction {on, soft} · scope_expansion {50%, soft} · sentiment {0.3, soft}. Each: threshold (typed per check) + severity {soft_alert, hard_approval}. (Sentiment AND scope are both distinct checks.)
7. **`risk_thresholds`** — per risk type {threshold, owner_role}: sentiment_drop {0.25, account_manager} · payment_overdue {7 d, finance} · campaign_underperform {15%, account_manager} · capacity_stretched {80%, ops} · renewal_approaching {30 d, account_manager}. owner_role ∈ C1 roles.
8. **`opportunity_thresholds`** — per opp type {threshold, confidence_floor}: client_growth {10%, 0.7} · new_service_fit {50%, 0.75} · referral {60%, 0.8} · market_signal {40%, 0.7}.
9. **`action_autonomy_matrix`** — **two sections.** *Configurable:* `low_risk_external_nonclient` {default_mode: Prepare (Suggest|Prepare|Act), act_requires_trust_period: true, act_trust_period_days: 14, act_rate_cap_per_hour: 5 (≤ rate_limit_external_comms_per_hour)}. *LOCKED floored* (mode = hard_approval, **edits rejected at write**, AC-9.MODE.004.2): existing_client_external · system_of_record_comms · financial_operation · confidential_restricted_action. Ambiguous sub-type ⇒ treated as floored.
10. **`price_table`** — vendor×model→{input, output} $/1k tokens (+ embedding $/unit), estimate-grade, operator-editable; e.g. anthropic: opus 0.015/0.045 · sonnet 0.003/0.015 · haiku 0.0008/0.004; openai embedding text-embedding-3-small. Floats ≥ 0.
11. **`rate_max_calls_per_connector_window`** — per connector from dossiers (GHL/Google/Slack each their own limit); int ≥ 1 per connector.

---

## Appendix B — New IDs introduced (downstream wiring)

**New `PERM-` nodes** (→ add to `PERMISSION_NODES.md`, C1 FR-1.PERM.005): `PERM-config.auth`,
`PERM-config.memory`, `PERM-config.tools`, `PERM-config.prompts`, `PERM-config.loops`,
`PERM-config.guardrails`, `PERM-config.observability`, `PERM-config.agents`, `PERM-config.proactive`,
`PERM-config.infra`, `PERM-config.secrets`. All default Super Admin only. (`PERM-guardrail.edit_autonomy`
already exists.)

**New `UI-` surface** (→ specced in Phase 3): `UI-config-admin` with sections `#auth #memory #tools
#prompts #loops #guardrails #observability #agents #proactive #infra #secrets`.

**Owed change-control (Phase 1 follow-up):** **C7 alert-routing FR addendum** (OD-097) — unroutable
alert fails loud.

---

## Open items for the operator (light-touch, non-blocking)
- **Proposed defaults** (tagged `(proposed)` above) — sensible starting values for knobs Phase 1 left
  blank. Worth a glance; adjust any that feel wrong. None block.
- **OD-097 C7 addendum** — to be raised as the registry lands (tracked in SESSION-LOG/README).
