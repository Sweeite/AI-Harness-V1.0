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

### The "What it does (plain English)" column
Every row carries a **plain-English description** — one line, jargon-free, written for a non-technical
agency admin who has never read the spec. This is **canonical, not decoration**: it is the source text
the `UI-config-admin` surface renders as the **on-screen helper line** beneath each key (surface-01 binds
to it). Keep it ≤ ~14 words and say what changes in the real world when the knob moves; if a key's
behaviour changes, update its description in the same edit.

### Surface — one Config Admin area, sectioned (full UI spec → Phase 3)
`UI-config-admin` — a single role-gated screen, one section per group: `#auth`, `#memory`, `#tools`,
`#prompts`, `#loops`, `#guardrails`, `#observability`, `#agents`, `#proactive`, `#infra`, `#secrets`.
SECRET rows render under `#secrets` as **presence + last-rotated only** (never the value). Each section
renders its rows per class (LIVE = live field; BOOT = field flagged "applies next boot"; REBUILD = field
behind a confirm-the-rebuild dialog), with the plain-English description shown as helper text under the key.

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

| Key | What it does (plain English) | Default | Class | Validation |
|---|---|---|---|---|
| `auth.oauth_enabled` | Turns "sign in with Google/Microsoft" on or off | true | BOOT | bool |
| `auth.oauth_provider` | Which company users sign in through — Google or Microsoft | `google` | BOOT | enum {google, microsoft} |
| `auth.two_factor_required` | Forces every user to pass a second login check before seeing data | true | BOOT | bool (app-enforced) |
| `auth.access_token_ttl` | How long a login stays valid before the app needs to refresh it | 1 h | LIVE | duration; Supabase fixed 1 h (don't raise) |
| `auth.session_absolute_timeout` | How long someone can stay signed in before a fresh login is forced | 30 d | LIVE | duration; Pro+ only; > inactivity |
| `auth.session_inactivity_timeout` | How long an idle user stays signed in before being logged out | 14 d | LIVE | duration; Pro+ only |
| `auth.invite_link_ttl` | How long a teammate invite link works before it expires | 24 h | BOOT | duration ≤ 24 h (Supabase hard cap, AF-074) |
| `auth.seed_setup_link_ttl` | How long the first-admin setup link works before it expires | 24 h | BOOT | duration ≤ 24 h |
| `auth.account_lockout_threshold` | How many failed logins before an account is temporarily locked | 5 | LIVE | int ≥ 1 |
| `auth.account_lockout_minutes` | How long a locked-out account stays locked before retrying | 15 | LIVE | int minutes ≥ 1 |
| `auth.mfa_softlock_threshold` | How many wrong 2FA codes before the second-factor step locks | 5 | LIVE | int ≥ 1 |
| `auth.mfa_softlock_minutes` | How long the 2FA step stays locked after too many wrong codes | 15 | LIVE | int minutes ≥ 1 |
| `auth.captcha_enabled` | Shows a "prove you're human" check on the login form | true | LIVE | bool |
| `auth.leaked_password_protection` | Blocks passwords known to have leaked in past breaches | true | LIVE | bool; Pro+ |

## B. Webhook ingress — `PERM-config.auth` · `UI-config-admin#auth`

| Key | What it does (plain English) | Default | Class | Validation |
|---|---|---|---|---|
| `webhook.replay_window_seconds` | How old an incoming webhook can be before it's rejected as a replay | 300 | LIVE | int seconds 60–900 |
| `webhook.replay_cache_window` | How long we remember past events to catch duplicate webhooks | 300 s | LIVE | duration ≥ replay_window_seconds |
| `webhook.secret_rotation_window` | How long old and new signing keys both work while you swap them | 24 h | LIVE | duration |
| `webhook.google_expected_audience` | The exact address Google webhooks must be aimed at to be trusted | (per-deployment URL) | BOOT | URL; required when Google connector on |
| `webhook.accept_rate_limit` | Most webhooks allowed from one source each minute before throttling | 60 / min | LIVE | int per source per minute ≥ 1 |
| `webhook.failure_alert_threshold` | How many webhook failures per hour before you get alerted | 3 / hr | LIVE | int per source per hour ≥ 1 |

## C. Support / recovery — `PERM-config.auth` · `UI-config-admin#auth`

| Key | What it does (plain English) | Default | Class | Validation |
|---|---|---|---|---|
| `support.stale_request_minutes` | How long a pending support request waits before admins are re-alerted | 60 | LIVE | int minutes ≥ 1 |

## D. RBAC — (records, not config)
RBAC's tunable knob set is a single timing value; roles/perms/clearances are Tier-1 records (Phase 3/4).

| Key | What it does (plain English) | Default | Class | Validation | Gate · Surface |
|---|---|---|---|---|---|
| `clearance_review_cadence_days` | How often access clearances must be reviewed and re-confirmed | 90 | LIVE | int days ≥ 1 | `PERM-config.guardrails` · `#guardrails` |

## E. Memory — `PERM-config.memory` · `UI-config-admin#memory`

| Key | What it does (plain English) | Default | Class | Validation |
|---|---|---|---|---|
| `amber_zone_threshold` | Confidence level below which a memory is flagged as shaky before it's fully distrusted | 0.65 | LIVE | float 0–1; ≥ confidence_floor |
| `confidence_floor` | The lowest confidence a memory can decay to — it's never deleted, just parked here | 0.5 | LIVE | float 0–1; ≤ amber_zone_threshold |
| `retrieval_confidence_threshold` | How confident a memory must be before the AI is allowed to use it | 0.7 | LIVE | float 0–1 |
| `retrieval_sufficiency_threshold` | How much memory must be found before an answer counts as well-supported rather than thin | 0.6 | LIVE | float 0–1 |
| `memories_injected_per_task` | How many relevant memories the AI pulls in when working on a task | 7 | LIVE | int 1–50 (token-cost lever) |
| `merge_similarity_threshold` | How alike two memories must be before they're combined into one | 0.92 | LIVE | float 0–1 |
| `soft_decay_age_months` | How old an unconfirmed memory gets before it slowly starts losing confidence | 6 | LIVE | int months ≥ 1 |
| `soft_decay_multiplier` | How fast an aging memory loses confidence each day (closer to 1 = slower fade) | 0.95 | LIVE | float 0–1 |
| `summarise_episode_trigger` | How many small memories about something pile up before they're rolled into one summary | 10 | LIVE | int ≥ 2 |
| `chunk_size_tokens` | How big a piece of text is cut into before being stored as memory | 300 | LIVE | int 200–400 |
| `coverage_stale_window_days` | How long with no new info before a topic is flagged as going stale | 30 | LIVE | int days ≥ 1 |
| `relevance_review_window_days` | How long a memory can go unused before it's flagged for a relevance check | 30 | LIVE | int days ≥ 1 |
| `bulk_drop_alert_count` | How many memories must lose confidence at once to trigger a system alert | 10 | LIVE | int ≥ 1 |
| `bulk_drop_alert_window_minutes` | The time window in which that burst of confidence drops counts as one alert | 60 | LIVE | int minutes ≥ 1 |
| `ef_search` | How thoroughly the system searches its memory — higher finds more but runs slower | 40 | LIVE | int 10–500 (recall/latency dial) |
| `procedural_boost` | How much extra priority "how-to" know-how memories get when ranking results | 1.2 | LIVE | float ≥ 1.0 |
| `review_escalation_days` | How long a pending review item can sit before it's escalated to an admin | 7 | LIVE | int days ≥ 1 |
| `ingest_defer_resurface_days` | How long a deferred item waits before it pops back up for another look | 14 | LIVE | int days ≥ 1 |
| `hr_content_enabled` | Whether HR-related content is allowed into memory at all (off unless legally cleared) | false | BOOT | bool; legal review gate |
| `embedding_model` | Which AI model converts text into searchable memory (changing it rebuilds all memory) | text-embedding-3-small | **REBUILD** | enum; save ⇒ re-embed + HNSW rebuild |
| `ranking_weights` | How much recency, confidence, entity-match and similarity each count when ranking memories | App. A | LIVE | object; sum = 1.0 |
| `expected_slots` | Which key facts the system expects to know about each kind of entity | App. A | LIVE | object; 5–8 per entity type |
| `entity_types` | The list of categories things can be filed under (e.g. Client, Person) — "Internal Org" always present | App. A | BOOT | array unique; "Internal Org" locked-present |

## F. Tool layer / connectors — `PERM-config.tools` · `UI-config-admin#tools`

| Key | What it does (plain English) | Default | Class | Validation |
|---|---|---|---|---|
| `drive_full_corpus_ingest` | Lets the AI read a client's entire Google Drive, not just files it has touched | false | BOOT | bool; ⇒ scope escalation + CASA |
| `backoff_initial_ms` | How long the system waits before the first retry after a connection is throttled | 1000 | LIVE | int ms ≥ 1; ≤ backoff_max_ms |
| `backoff_max_ms` | The longest the system will ever wait between retries after throttling | 60000 | LIVE | int ms; ≥ backoff_initial_ms |
| `backoff_multiplier` | How quickly the wait between retries grows each time | 2 | LIVE | float > 1.0 |
| `rate_max_calls_per_connector_window` | How many times the system may call each connected service in a time window | per-connector (App. A) | LIVE | int; per-connector from dossiers |
| `rate_alert_threshold` | How close to a service's call limit before non-urgent calls get slowed | 0.80 | LIVE | float 0–1 |
| `token_refresh_interval_minutes` | How often the system checks whether connector logins need renewing | 15 | LIVE | int minutes ≥ 1 |
| `token_refresh_lead_minutes` | How early a connector login is renewed before it expires | 30 | LIVE | int minutes ≥ 1 |
| `token_expiry_alert_days` | How many days before a connector login expires that its owner is warned | 7 | LIVE | int days ≥ 1 |
| `connector_disconnection_escalation_window` | How long a dropped connection can stay unfixed before it's escalated to an admin | 24 h | LIVE | duration |
| `event_reconciliation_sweep_minutes` | How often the system double-checks for any incoming updates it missed | 30 | LIVE | int minutes ≥ 1 |
| `watch_rearm_lead_minutes` | How early the system renews a live-update subscription before it lapses | per-connector | LIVE | int minutes; < shortest watch TTL |
| `slack_token_rotation_enabled` | Turn on automatic Slack key rotation (can't be turned off once enabled) | false | BOOT | bool; irreversible once on (OD-040) |
| `tool_selection_confidence_threshold` | How sure the AI must be before using a tool without asking | 0.7 | LIVE | float 0–1 |

## G. Prompt architecture — `PERM-config.prompts` · `UI-config-admin#prompts`

| Key | What it does (plain English) | Default | Class | Validation |
|---|---|---|---|---|
| `dynamic_field_freshness_threshold` | How old a live data field can get before the AI flags it as possibly out of date | 30 d | LIVE | duration |

## H. Agent harness / loops — `PERM-config.loops` · `UI-config-admin#loops`

| Key | What it does (plain English) | Default | Class | Validation |
|---|---|---|---|---|
| `loop_cadence_fast` | How often the system checks for urgent work like new leads or flagged messages | `*/10 * * * *` | BOOT | cron; 5–15 min range |
| `loop_cadence_medium` | How often the system works through queued tasks and pending updates | `0 */2 * * *` | BOOT | cron; 1–4 h range |
| `loop_cadence_slow` | How often the system runs daily cleanup, summaries, and health checks | `0 8 * * *` | BOOT | cron; daily/weekly |
| `task_priority_scheme` | Whether tasks run strictly in order, or by priority first then order | priority-then-FIFO | BOOT | enum {fifo, priority-then-fifo} |
| `compression_threshold_tokens` | How long a task chain can get before older steps are summarised to save space | 8000 | LIVE | int tokens ≥ 1000 |
| `parallel_execution_enabled` | Whether independent task steps may run at the same time (off for safety by default) | false | BOOT | bool (safety default; opt-in) |
| `smart_scheduling_enabled` | Whether non-urgent tasks wait for quiet periods instead of running immediately | false | BOOT | bool |
| `anomaly_check_cadence` | How often the safety check for unusual behaviour runs during a task | per-step | BOOT | enum {per-step, per-ai-call} |
| `checkpoint_step_threshold` | How many steps the AI takes before pausing to check in on a long task | 4 | LIVE | int steps ≥ 1 |
| `checkpoint_response_timeout_minutes` | How long a checked-in task waits for a human reply before timing out | 60 | LIVE | int minutes ≥ 1 |
| `max_retries_before_dead_letter` | How many times a failing task retries before it's set aside for a human | 3 | LIVE | int ≥ 0 |
| `dlq_stale_alert_hours` | How long a set-aside (dead-lettered) task can sit untouched before it's escalated as overdue | 24 | LIVE | int hours ≥ 1 |

## I. Guardrails — `PERM-config.guardrails` · `UI-config-admin#guardrails`

| Key | What it does (plain English) | Default | Class | Validation |
|---|---|---|---|---|
| `approval_soft_timeout` | How long a low-risk action waits for a reply before it runs itself | 10 min | LIVE | duration ≥ 1 min |
| `approval_escalation_timeout` | How long a flagged item can sit before reminders are escalated | 4 h | LIVE | duration ≥ 1 min |
| `injection_semantic_detection_enabled` | Turns on the smarter (meaning-based) scan for sneaky malicious instructions | false | LIVE | bool (off by default, ADR-007) |
| `injection_semantic_threshold` | How suspicious content must look before it gets flagged | 0.85 | LIVE | float 0–1; ≤ quarantine |
| `injection_quarantine_threshold` | How suspicious content must look before it is locked away | 0.95 | LIVE | float 0–1; ≥ semantic |
| `rate_limit_tool_writes_per_task` | Most changes the agent can make to tools in a single task | 10 | LIVE | int ≥ 1 (never unlimited) |
| `rate_limit_external_comms_per_hour` | Most outside messages the agent can send per hour | 5 | LIVE | int ≥ 1 (never unlimited) |
| `rate_limit_memory_writes_per_minute` | Most updates the agent can make to its memory per minute | 30 | LIVE | int ≥ 1 (never unlimited) |
| `rate_limit_concurrent_tasks` | Most tasks the agent can work on at the same time | 5 | LIVE | int ≥ 1 (never unlimited) |
| `approval_pattern_sample_size` | How many past approvals to study before suggesting a shortcut | 30 | LIVE | int ≥ 1 |
| `cost_ladder_soft_threshold` | Spend level that triggers a heads-up alert but keeps working | $50/day, $200/wk | LIVE | currency ≥ 0; < throttle |
| `cost_ladder_throttle_threshold` | Spend level where low-priority work gets slowed or queued | $75/day | LIVE | currency; between soft & hard |
| `cost_ladder_hard_kill_threshold` | Spend level where the system stops taking on new costly work | $100/day | LIVE | currency; > throttle |
| `anomaly_thresholds` | How sensitive the five "something looks off" safety checks are | App. A | LIVE | object (5 checks) |
| `action_autonomy_matrix` | Sets how much each action type can run on its own versus needing sign-off | App. A | LIVE | object; gate `PERM-guardrail.edit_autonomy`; floored rows reject downgrade |

> LOCKED (not knobs): the seven hard limits (ADR-007/OD-047/OD-060), sole-writer identity (ADR-004).

## J. Observability — `PERM-config.observability` · `UI-config-admin#observability`

| Key | What it does (plain English) | Default | Class | Validation |
|---|---|---|---|---|
| `event_log_retention_window` | How long the full activity history is kept before deletion | 365 d | BOOT | duration ≥ legal/audit floor (C10) |
| `realtime_connection_headroom_threshold` | How full live connections get before extras switch to slower updates | 80% | LIVE | int 1–100 |
| `task_failure_spike_threshold` | How many failures in a window before a failure alert fires | 5 in 30 min | LIVE | int count + int minutes |
| `queue_backup_threshold` | How big a stuck backlog gets before a queue alert fires | 20 for 60 min | LIVE | int count + int minutes |
| `approval_staleness_alert_threshold` | How long an approval can wait before the reviewer is nudged | 4 h | LIVE | duration ≥ 1 min |
| `cost_threshold_alert_limit` | Spend level that triggers a cost-warning notification | $50/day, $200/wk | LIVE | currency ≥ 0 |
| `task_success_rate_threshold_pct` | How low the success rate can drop before it raises a warning | 95 | LIVE | int 1–100 |
| `memory_confidence_drop_threshold` | How shaky the agent's memory can get before flagging for review | 0.6 | LIVE | float 0–1 |
| `alert_escalation_window_hours` | How long an unacknowledged alert waits before escalating to the next person | 2 | LIVE | int hours ≥ 1 |
| `deployment_staleness_window` | How old a cross-deployment status view can be before it is marked stale | 15 min | LIVE | duration ≥ push interval |
| `polling_interval_health_metrics_s` | How often system-health numbers refresh | 30 | LIVE | int seconds ≥ 5 |
| `polling_interval_event_log_s` | How often the activity log view refreshes | 60 | LIVE | int seconds ≥ 5 |
| `polling_interval_memory_health_s` | How often memory-health figures refresh | 300 | LIVE | int seconds ≥ 5 |
| `polling_interval_self_improvement_s` | How often the self-improvement metrics refresh | 600 | LIVE | int seconds ≥ 5 |
| `polling_interval_cost_tracking_s` | How often the spend figures refresh | 300 | LIVE | int seconds ≥ 5 |
| `polling_interval_agent_health_s` | How often each agent's health status refreshes | 60 | LIVE | int seconds ≥ 5 |
| `price_table` | The per-model prices used to estimate AI spend | App. A | LIVE | object (vendor×model→price) |
| **Alert routing (OD-097):** | | | | |
| `alert_routing_rules` | Decides who gets which alert and on what channel | route-by-role (default map) | LIVE | object: alert-type → {role, channel} |
| `escalation_contacts` | Who to reach for each role when an alert escalates | (per-role) | LIVE | object: role → contact list; must resolve (#3) |
| `quiet_hours` | Times to hold non-urgent alerts (critical ones still go out) | none | LIVE | object: window(s); never suppresses critical |
| `alert_email_enabled` | Turns email delivery of alerts on or off | true | LIVE | bool |

> **OD-097 — CLOSED.** The *behaviour* "an unroutable alert fails loud, never drops silently" is realised in
> **C7 `FR-7.ALR.009`** (change-control, session 28). `SLACK_WEBHOOK_URL` is in group N (secret).

## K. Agent design / routing — `PERM-config.agents` · `UI-config-admin#agents`

| Key | What it does (plain English) | Default | Class | Validation |
|---|---|---|---|---|
| `orchestrator_confidence_threshold` | How sure the system must be before running a task instead of asking a person | 0.75 | LIVE | float 0–1 |
| `chain_depth_limit` | The most steps the AI may chain together to finish one task | 6 | LIVE | int ≥ 1 |
| `clarification_escalation` | How long a question to staff waits unanswered before it gets bumped up | 24 h | LIVE | duration |
| `drift_threshold` | How far an agent can stray from its job before it's flagged for review | 0.3 | LIVE | float 0–1 |
| `dead_agent_threshold` | How often an agent must fail before it's flagged as broken | 0.5 success-rate | LIVE | float 0–1 |
| `default_model` | The main AI model used for most of the work | claude-sonnet-4-6 | BOOT | enum (model id) |
| `lightweight_model` | The cheaper, faster AI model used for simple tasks | claude-haiku-4-5 | BOOT | enum (model id) |
| `routing_weights` | How much each factor counts when picking which agent handles a task | App. A | LIVE | object; sum = 1.0 |
| `cache_time_window` | How long each agent reuses a saved answer before redoing the work | App. A | LIVE | object (per agent type, minutes) |

## L. Proactive intelligence — `PERM-config.proactive` · `UI-config-admin#proactive`

| Key | What it does (plain English) | Default | Class | Validation |
|---|---|---|---|---|
| `cold_start_basic_threshold` | How much the AI must learn before it unlocks basic help | 20% | LIVE | int 0–100; ≤ proactive |
| `cold_start_proactive_threshold` | How much it must learn before it starts suggesting work unasked | 50% | LIVE | int 0–100; between basic & full |
| `cold_start_full_threshold` | How much it must learn before all proactive features turn on | 80% | LIVE | int 0–100; ≥ proactive |
| `external_act_trust_period` | How long staff must trust the AI before it may send things outside on its own | 14 d | BOOT | int days ≥ 0 |
| `scanner_relationship_enabled` | Whether the AI watches for clients going quiet or at risk | true | LIVE | bool |
| `scanner_meeting_prep_enabled` | Whether the AI prepares briefing notes before meetings | true | LIVE | bool |
| `scanner_document_prep_enabled` | Whether the AI drafts proposals or briefs it thinks you'll need | true | LIVE | bool |
| `scanner_derisking_enabled` | Whether the AI surfaces risk warnings (safety alerts still fire regardless) | true | LIVE | bool (surfacing only; C6 safety unaffected) |
| `scanner_opportunity_enabled` | Whether the AI flags new opportunities it spots | true | LIVE | bool |
| `scanner_briefing_enabled` | Whether the AI produces the regular team briefing | true | LIVE | bool |
| `scanner_pattern_enabled` | Whether the AI surfaces patterns and trends it notices across your data | true | LIVE | bool |
| `briefing_schedule` | When the regular team briefing is delivered | 07:00 daily | LIVE | cron/time |
| `meeting_prep_lead_time` | How far ahead of a meeting the briefing notes are ready | 120 min | LIVE | duration |
| `not_contacted_window` | How long since contact before a client counts as gone quiet | 30 d | LIVE | int days ≥ 1 |
| `renewal_lookahead_days` | How far ahead the AI starts flagging upcoming renewals | 60 | LIVE | int days ≥ 1 |
| `dismissal_decay` | How fast suggestions you keep dismissing fade away | 0.5 / 30 d | LIVE | float 0–1 |
| `risk_floor` | The lowest a risk warning can be muted to, so it's never fully silenced | 0.8 | LIVE | float 0–1; suppression can't go below |
| `suggestion_ttl_days` | How long an unread suggestion sticks around before it expires | 7 | LIVE | int days ≥ 1 |
| `suggestion_volume_limit` | The most suggestions the AI will surface at once | 10 / cycle | LIVE | int ≥ 1 |
| `approval_push_frequency_minutes` | How often you're pinged about items waiting for your approval | 30 | LIVE | int minutes ≥ 1 |
| `stale_queue_push_hours` | How long approvals sit untouched before you get a nudge | 4 | LIVE | int hours ≥ 1 |
| `risk_thresholds` | How strong each kind of risk signal must be before the AI raises it | App. A | LIVE | object (per risk type) |
| `opportunity_thresholds` | How strong each kind of opportunity signal must be before the AI raises it | App. A | LIVE | object (per opp type) |

## M. Infrastructure & compliance — `PERM-config.infra` · `UI-config-admin#infra`

| Key | What it does (plain English) | Default | Class | Validation |
|---|---|---|---|---|
| `client_offboarding_retention_days` | How long a departing client's data is kept before it's permanently deleted | 90 | BOOT | int days ≥ legal min |
| `data_export_link_expiry_hours` | How long a client data-export download link stays valid before it expires | 72 | LIVE | int hours ≥ 1 |
| `individual_deletion_audit_years` | How long proof of a deletion is kept after the data itself is gone | 7 | BOOT | int years ≥ legal min |
| `deletion_two_person_auth_required` | Whether sensitive deletions need a second person to approve them | true | LIVE | bool; for Restricted/Personal (distinct authoriser) |
| `deploy_max_skew_days` | How many days old a deployment's software can be before it's flagged | 14 | LIVE | int days ≥ 1 |
| `deploy_max_version_skew` | How many versions behind a deployment can fall before it's flagged | 3 | LIVE | int ≥ 1 |
| `canary_soak_minutes` | How long a new release is watched on a small slice before full rollout | 60 | LIVE | int minutes ≥ 1 |
| `deployment_region` | Which part of the world this client's data is physically stored in | ap-southeast-2 | BOOT | enum (v1 Sydney locked) |

## N. Platform secrets — `PERM-config.secrets` (presence only) · `UI-config-admin#secrets`
All env/Railway only; surface shows presence + last-rotated, never the value. Deployment cannot boot
without the required ones.

| Key | What it does (plain English) | Required | Validation |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | The key that lets the system use Claude AI models | yes | present at boot |
| `OPENAI_API_KEY` | The key that lets the system turn text into searchable embeddings | yes | present at boot (embeddings) |
| `INNGEST_API_KEY` | The key that runs the system's background jobs and task queue | yes | present at boot (loops/queue) |
| `X_INTERNAL_TOKEN` | The key that lets this deployment report its health to your central dashboard | yes | present; mgmt-plane push auth (ADR-001 §7) |
| `SLACK_SIGNING_SECRET` | The key that confirms incoming Slack messages are genuine | if Slack on | present when connector enabled |
| `SLACK_WEBHOOK_URL` | The address the system uses to post alerts into Slack | if Slack alerts on | present when alert_email_enabled=false or Slack routing used (OD-097) |
| `GOHIGHLEVEL_WEBHOOK_SECRET` | The key that confirms incoming GoHighLevel messages are genuine | if GHL on | Ed25519 (OD-046) |
| `GOOGLE_OAUTH_CLIENT_SECRET` | The key that lets the system connect to a client's Google account | if Google on | present when connector enabled |
| `GOOGLE_PUBSUB_SERVICE_ACCOUNT_KEY` | The key that lets Google push live updates to the system | if Google push on | service-account JSON |
| `auth.smtp_*` (host/port/user/pass/sender) | The login details that let the system send outgoing email | prod | present in prod; encrypted |
| `auth.smtp_bounce_webhook` | The address told when a sent email bounces back | optional | URL or empty |

---

## Appendix A — Structured (object) configs
Each is one structured config rendering as its own admin sub-table. Defaults + per-field validation:

1. **`ranking_weights`** — *how much recency, confidence, entity-match and similarity each count when ranking which memories matter most.* recency 0.3 · confidence 0.3 · entity_match 0.2 · vector_similarity 0.2. Each float 0–1; **sum = 1.0** (write-time, else reject).
2. **`expected_slots`** — *which key facts the system expects to know about each kind of entity.* keyed by entity type → array of 5–8 slot names. Per type 5 ≤ len ≤ 8.
3. **`entity_types`** — *the list of categories things can be filed under (clients, contacts, campaigns, invoices…).* array of ~22 default kinds (Client, Contact, Team Member, Vendor/Partner, Campaign, Task, Deliverable, Template, Deal, Contract/Retainer, Invoice, Brand Guide, Audience, Channel, Team/Department, Meeting, SOP/Playbook, Tool/Platform, Goal/OKR, Financial Period, Lesson Learned, Internal Org). Unique strings; soft-disable not delete; "Internal Org" always present + locked.
4. **`routing_weights`** — *how much each factor counts when deciding which AI agent handles a task.* domain_match 0.35 · complexity_fit 0.25 · memory_scope_fit 0.20 · tool_scope_fit 0.20. Each 0–1; **sum = 1.0**.
5. **`cache_time_window`** — *how long each kind of looked-up answer is reused before being worked out fresh.* (minutes) research 30 · client 60 · campaign 60 · comms 15 · ops 120 · finance 120 · insight 1440. Each int ≥ 1.
6. **`anomaly_thresholds`** — *the limits that decide when something looks "off" enough to flag for review.* confidence {0.5, soft} · volume {20/run, soft} · contradiction {on, soft} · scope_expansion {50%, soft} · sentiment {0.3, soft}. Each: threshold (typed per check) + severity {soft_alert, hard_approval}. (Sentiment AND scope are both distinct checks.)
7. **`risk_thresholds`** — *how strong each kind of risk signal must be before it's raised, and who's told.* per risk type {threshold, owner_role}: sentiment_drop {0.25, account_manager} · payment_overdue {7 d, finance} · campaign_underperform {15%, account_manager} · capacity_stretched {80%, ops} · renewal_approaching {30 d, account_manager}. owner_role ∈ C1 roles.
8. **`opportunity_thresholds`** — *how strong each kind of opportunity signal must be, and how sure the AI must be, before it's flagged.* per opp type {threshold, confidence_floor}: client_growth {10%, 0.7} · new_service_fit {50%, 0.75} · referral {60%, 0.8} · market_signal {40%, 0.7}.
9. **`action_autonomy_matrix`** — *how freely the AI may act on its own for each kind of action (sensitive ones are locked to needing sign-off).* **two sections.** *Configurable:* `low_risk_external_nonclient` {default_mode: Prepare (Suggest|Prepare|Act), act_requires_trust_period: true, act_trust_period_days: 14, act_rate_cap_per_hour: 5 (≤ rate_limit_external_comms_per_hour)}. *LOCKED floored* (mode = hard_approval, **edits rejected at write**, AC-9.MODE.004.2): existing_client_external · system_of_record_comms · financial_operation · confidential_restricted_action. Ambiguous sub-type ⇒ treated as floored.
10. **`price_table`** — *the estimated cost per use of each AI model, used for budgeting.* vendor×model→{input, output} $/1k tokens (+ embedding $/unit), estimate-grade, operator-editable; e.g. anthropic: opus 0.015/0.045 · sonnet 0.003/0.015 · haiku 0.0008/0.004; openai embedding text-embedding-3-small. Floats ≥ 0.
11. **`rate_max_calls_per_connector_window`** — *how many times the system may call each connected service in a time window.* per connector from dossiers (GHL/Google/Slack each their own limit); int ≥ 1 per connector.

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

## Status
- **Defaults confirmed by operator 2026-06-27** ("as long as i can edit these later i am happy"). Every
  knob is LIVE or BOOT — operator-editable post-deploy via `UI-config-admin`; defaults are starting values.
- **OD-097 C7 addendum — CLOSED** (FR-7.ALR.009).
- **Phase-3 change-control (2026-06-30, OD-123, surface-05):** **+`dlq_stale_alert_hours`** (24 h, LIVE, §H
  `#loops`, `PERM-config.loops`) — closes a Rule-0 gap: C5 AC-5.JOB.006.2 mandated a DLQ-unattended escalation
  "beyond a configurable age" but the registry had no such key. Satisfies the existing AC; no FR re-approval.
- **Phase-2 gate met:** every row classified · defaulted · validated · PERM-gated · surfaced; zero `???`;
  verification gate CLEAN. **Ready for Phase-2 sign-off.**
