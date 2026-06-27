# Phase 2 — Config Registry: Master Harvest (working artifact)

**Status:** harvest + gap-hunt complete, **with plain-English descriptions**. Awaiting operator
review before per-row speccing (PERM- gate · UI- surface · full validation).
**Date:** 2026-06-27 (Session 28).

**How to read this file.** Each row is one *knob* (Tier 2 — harness tuning) or *secret* (Tier 3).
Day-to-day record management (users, roles, agents, memory curation) is **not** here — that's Tier 1,
Phase 3 surfaces. Columns: **Key** (what you'd find it under) · **What it does** (plain English — read
this one) · **Default** · **Class** (how it's edited — see below) · **Source** (the FR it traces to).

**The four edit classes** (`standards/config-edit-taxonomy.md`):
- **SECRET** — credentials. Env/Railway only, never shown on screen (only a "present / last-rotated" row).
- **BOOT** — editable on screen, but only takes effect on the next deploy/restart.
- **LIVE** — editable on screen, takes effect immediately.
- **REBUILD** — editable on screen, but saving kicks off a background migration/index rebuild first.

**Flags inline:** `DUP` = one knob, two component homes (collapse to one) · `GAP→now added` = the
gap-hunt found it, it's now in this list · `CONFLICT` = FR vs stale design doc (FR wins) · `LOCKED` =
deliberately *not* a knob (shown for context, will not be specced as editable).

**Count:** ~117 scalar knobs + 9 structured objects (Appendix A) + 11 secrets. Class split ≈
SECRET 11 · BOOT 18 · LIVE 90 · REBUILD 3.

---

## A. Auth & Session — C0

| Key | What it does | Default | Class | Source |
|---|---|---|---|---|
| `auth.oauth_enabled` | Master switch for the OAuth login path (Google/Microsoft sign-in). | true | BOOT | FR-0.AUTH.001/002/003 |
| `auth.oauth_provider` | Which identity provider client users log in with. | `google`\|`microsoft` | BOOT | FR-0.AUTH.001/003 |
| `auth.two_factor_required` | Forces every user to set up 2FA. App-enforced, not a native Supabase toggle. | true | BOOT | FR-0.AUTH.008 |
| `auth.access_token_ttl` | How long a login stays valid before the token refreshes. *CONFLICT: design's "7-day refresh" was refuted (Block J) — tokens rotate, don't expire; FR wins.* | 1h | LIVE | FR-0.SESS.* |
| `auth.session_absolute_timeout` | Hard ceiling on a session's total life, regardless of activity (Pro+ only). | operator-set | LIVE | FR-0.SESS.004 |
| `auth.session_inactivity_timeout` | How long an idle session survives before it's logged out (Pro+ only). | 7–14 d | LIVE | FR-0.SESS.004 |
| `auth.invite_link_ttl` | How long a user-invite email link stays valid. *CONFLICT: design said 72h; Supabase caps at 24h (AF-074) — FR wins.* | ≤24 h | BOOT | FR-0.INV.002 |
| `auth.seed_setup_link_ttl` | Expiry on the first-Super-Admin setup link created at provisioning. | ≤24 h | BOOT | FR-0.SEED.002 |
| `auth.account_lockout_threshold` | Failed password attempts before an account is soft-locked. | ~5 | LIVE | FR-0.AUTH.009 |
| `auth.account_lockout_minutes` | How long that soft-lock lasts. | — | LIVE | FR-0.AUTH.009 |
| `auth.mfa_softlock_threshold` | Wrong 2FA codes before the 2FA step soft-locks. | 5 | LIVE | FR-0.AUTH.007 |
| `auth.mfa_softlock_minutes` | How long the 2FA soft-lock lasts. | 15–30 | LIVE | FR-0.AUTH.007 |
| `auth.captcha_enabled` | Turns on a CAPTCHA on the password login form. | true | LIVE | FR-0.AUTH.009 |
| `auth.leaked_password_protection` | Blocks passwords found in breach databases (Pro+). | true | LIVE | FR-0.AUTH.009 |

## B. Webhook ingress — C0

| Key | What it does | Default | Class | Source |
|---|---|---|---|---|
| `webhook.replay_window_seconds` | How far a webhook's timestamp can drift before it's rejected as a replay. | 300 | LIVE | FR-0.WHK.005 |
| `webhook.replay_cache_window` | How long seen webhook IDs are remembered to block duplicates. | — | LIVE | FR-0.WHK.008 |
| `webhook.secret_rotation_window` | Grace period where both old + new signing secrets are accepted during rotation. | — | LIVE | FR-0.WHK.007 |
| `webhook.google_expected_audience` | The audience claim Google webhooks must carry to be trusted (per deployment URL). | — | BOOT | FR-0.WHK.006 |
| `webhook.accept_rate_limit` | Max inbound webhooks accepted per source per minute. | — | LIVE | FR-0.WHK.008 |
| `webhook.failure_alert_threshold` | Failed webhooks per hour from one source before alerting + auto-throttling. | 3/hr | LIVE | FR-0.WHK.009 |

## C. Support / recovery — C0

| Key | What it does | Default | Class | Source |
|---|---|---|---|---|
| `support.stale_request_minutes` | How long a "trouble signing in" request sits before it's flagged stale. | — | LIVE | FR-0.REC.002 |

## D. RBAC — C1  *(thin by design — RBAC is records-in-data, not config; see note)*

| Key | What it does | Default | Class | Source |
|---|---|---|---|---|
| `clearance_review_cadence_days` | How often above-Standard data clearances must be re-reviewed. | 90 | LIVE | FR-1.CLR.005 |

> **Why D is nearly empty (not a miss):** roles, the permission matrix, and clearances are *records you
> manage on a screen* (Tier 1 → Phase 3/4), not tunable knobs. RBAC's real Phase-2 role is supplying the
> **`PERM-` gate** that every editable row below names (who's allowed to change it). LOCKED, not knobs:
> the six default roles' existence, default-deny, last-Super-Admin protection.

## E. Memory — C2

| Key | What it does | Default | Class | Source |
|---|---|---|---|---|
| `amber_zone_threshold` | Confidence a memory fades to before the system starts flagging it as going stale. | 0.65 | LIVE | FR-2.MNT.004 |
| `confidence_floor` | Lowest confidence a memory can have and still be considered usable. | 0.5 | LIVE | FR-2.MNT.004 |
| `retrieval_confidence_threshold` | How confident a memory must be to be eligible for injection into a task. Higher = only solid facts used. | 0.7 | LIVE | FR-2.RET.002 |
| `retrieval_sufficiency_threshold` | The bar that decides whether the system "knows enough" to answer vs. shows `[Building]`. | — | LIVE | FR-2.MAT.003 |
| `memories_injected_per_task` | Max memories loaded into one task's context (the main token-cost lever). | 7 | LIVE | FR-2.RET.005 · *DUP w/ C4* |
| `merge_similarity_threshold` | How alike two memories must be before they're flagged as duplicates to merge. | 0.92 | LIVE | FR-2.MNT.007 |
| `soft_decay_age_months` | Age at which a low-confidence memory starts losing confidence over time. | 6 | LIVE | FR-2.MNT.004 |
| `soft_decay_multiplier` | How fast that decay happens each month. | 0.95 | LIVE | FR-2.MNT.004 |
| `summarise_episode_trigger` | How many episodic memories pile up before they're auto-summarised. | 10 | LIVE | FR-2.MNT.006 |
| `chunk_size_tokens` | Size of text chunks when ingesting documents. | 300 | LIVE | FR-2.ING.007 |
| `coverage_stale_window_days` | Days without new info before an entity is marked as having stale coverage. | 30 | LIVE | FR-2.MNT.010 |
| `relevance_review_window_days` | How often the memory-ingestion filter's accuracy is audited. | 30 | LIVE | FR-2.MNT.011 |
| `bulk_drop_alert_count` | How many memories dropping confidence at once triggers an alert. | 10 | LIVE | FR-2.MNT.004 |
| `bulk_drop_alert_window_minutes` | The time window for that bulk-drop detection. | 60 | LIVE | FR-2.MNT.004 |
| `embedding_model` | Which embedding model powers semantic search. *CONFLICT: this is REBUILD, not BOOT — changing it re-embeds everything + rebuilds the index.* | text-embedding-3-small | **REBUILD** | FR-2.VEC.002 |
| `ef_search` | Vector-search recall/speed dial: higher = better recall, slower queries. **GAP→now added** (design L1511). | 40 | LIVE | FR-2.VEC.* |
| `procedural_boost` | Extra ranking weight for "how-to" memories so procedures surface. | 1.2 | LIVE | FR-2.RET.005 |
| `review_escalation_days` | Days an un-actioned memory review item waits before it's escalated. | — | LIVE | FR-2.ING.003/WRT.002 |
| `ingest_defer_resurface_days` | How long a "deferred" ingestion item stays hidden before resurfacing. | — | LIVE | FR-2.ING.003 |
| `hr_content_enabled` | Allows ingesting HR content (off by default; needs legal review). | false | BOOT | FR-2.ING.005 |
| `ranking_weights` | **(structured — App. A)** The 4 weights balancing how memories are ranked. | see A | LIVE | FR-2.RET.005 |
| `expected_slots` | **(structured — App. A)** The "what we should know" checklist per entity type, drives coverage %. | see A | LIVE | FR-2.MAT.001 |
| `entity_types` | **(structured — App. A)** The list of entity kinds the system organises memory around. | see A | BOOT | FR-2.ENT.002 |

## F. Tool layer / connectors — C3

| Key | What it does | Default | Class | Source |
|---|---|---|---|---|
| `drive_full_corpus_ingest` | Ingest the whole Google Drive (escalates to a broader scope + CASA review). | false | BOOT | FR-3.OBS.005 |
| `backoff_initial_ms` | First retry delay after a rate-limit (429) response. | 1000 | LIVE | FR-3.RL.005 |
| `backoff_max_ms` | Ceiling on how long retry backoff can grow. | 60000 | LIVE | FR-3.RL.005 |
| `backoff_multiplier` | How fast the retry delay grows each attempt. | 2 (+jitter) | LIVE | FR-3.RL.005 |
| `rate_max_calls_per_connector_window` | Max API calls per connector per window. *Per-connector values differ (GHL/Google/Slack) — App. A note.* | 80/min | LIVE | FR-3.RL.002 |
| `rate_alert_threshold` | What fraction of a connector's rate budget triggers a warning. | 0.80 | LIVE | FR-3.RL.004 |
| `token_refresh_interval_minutes` | How often the background job checks for tokens needing refresh. | 15 | LIVE | FR-3.TOK.002 |
| `token_refresh_lead_minutes` | Refresh a token this many minutes before it would expire. | 30 | LIVE | FR-3.TOK.002 |
| `token_expiry_alert_days` | Warn the connector owner this many days before a token finally lapses. | 7 | LIVE | FR-3.DSC.006 |
| `connector_disconnection_escalation_window` | How long a degraded connector goes unresolved before escalating. | 24 h | LIVE | FR-3.DSC.004 |
| `event_reconciliation_sweep_minutes` | How often to check for missed Slack events and backfill them. | — | LIVE | FR-3.TRIG.006 |
| `watch_rearm_lead_minutes` | Re-arm Google Calendar/Drive watches this long before they expire. | — | LIVE | FR-3.TRIG.005 |
| `slack_token_rotation_enabled` | Turns on Slack's 12h token rotation (irreversible once on). | false | BOOT | FR-3.TOK.005 |
| `tool_selection_confidence_threshold` | How sure the AI must be before calling a tool vs. asking first. | — | LIVE | FR-3.OPT.001 |

## G. Prompt architecture — C4

| Key | What it does | Default | Class | Source |
|---|---|---|---|---|
| `dynamic_field_freshness_threshold` | How old a dynamic business-context field can get before it's flagged stale. | — | LIVE | FR-4.BIZ.003 |

## H. Agent harness / loops — C5

| Key | What it does | Default | Class | Source |
|---|---|---|---|---|
| `loop_cadence_fast` | How often the fast loop runs (urgent triggers, new leads). | `*/10 * * * *` | BOOT | FR-5.LOP.001 |
| `loop_cadence_medium` | How often the medium loop runs (queued tasks, pending writes). | `0 */2 * * *` | BOOT | FR-5.LOP.001 |
| `loop_cadence_slow` | How often the slow loop runs (consolidation, summaries, self-improvement). | `0 8 * * *` | BOOT | FR-5.LOP.001 |
| `task_priority_scheme` | How the task queue decides what runs first. | — | BOOT | FR-5.QUE.004 |
| `compression_threshold_tokens` | Context size at which long task-chains start compressing between steps. | — | LIVE | FR-5.ENV.003 |
| `parallel_execution_enabled` | Lets independent steps in a task run at the same time. *CONFLICT: design implies on; C5 FR = off-by-default (safety). FR wins.* | false | BOOT | FR-5.OPT.001 |
| `smart_scheduling_enabled` | Defers non-urgent work to quiet periods. | — | BOOT | FR-5.OPT.002 |
| `anomaly_check_cadence` | Whether anomaly checks fire per-step or per-AI-call. | per-step | BOOT | FR-5.ASM.007 · *seam C6* |
| `checkpoint_step_threshold` | How many steps a task can run before pausing for a human checkpoint. **GAP→now added** (design L950). | 4 | LIVE | FR-5.* (OD-056) |
| `checkpoint_response_timeout_minutes` | How long that checkpoint waits for a human before escalating. **GAP→now added** (L951). | 60 | LIVE | FR-5.* (OD-056) |
| `max_retries_before_dead_letter` | Retries before a failing task is parked in the dead-letter queue. | 3 | LIVE | FR-5.JOB.* · *DUP w/ C6* |

## I. Guardrails — C6

| Key | What it does | Default | Class | Source |
|---|---|---|---|---|
| `approval_soft_timeout` | How long a soft-approval action waits before auto-executing if nobody objects. | 10 min | LIVE | FR-6.APR.003 |
| `approval_escalation_timeout` | How long a flagged item waits before it's escalated/reminded. | 4 h | LIVE | FR-6.ESC.004 |
| `injection_semantic_detection_enabled` | Turns on the embedding-based prompt-injection scanner (off by default). | false | LIVE | FR-6.INJ.002 |
| `injection_semantic_threshold` | Similarity score that flags content as a possible injection. | 0.85 | LIVE | FR-6.INJ.003 |
| `injection_quarantine_threshold` | Higher score that quarantines content outright. | 0.95 | LIVE | FR-6.INJ.006 |
| `rate_limit_tool_writes_per_task` | Cap on write-actions a single task can make. | 10 | LIVE | FR-6.RTL.001 |
| `rate_limit_external_comms_per_hour` | Cap on outbound messages per hour. | 5 | LIVE | FR-6.RTL.001 |
| `rate_limit_memory_writes_per_minute` | Cap on memory writes per minute. | 30 | LIVE | FR-6.RTL.001 |
| `rate_limit_concurrent_tasks` | Cap on tasks running at once. | 5 | LIVE | FR-6.RTL.001 |
| `approval_pattern_sample_size` | How many past approvals to sample when learning approval patterns. **GAP→now added** (L979). | 30 | LIVE | FR-6.APR.* |
| `anomaly_thresholds` | **(structured — App. A)** The 5 pre-step anomaly checks + their trip points. | see A | LIVE | FR-6.ANM.002/004 |
| `cost_ladder_soft_threshold` | Spend level that triggers a soft cost alert. | $50/day, $200/wk | LIVE | FR-6.RTL.004 · *DUP w/ C7* |
| `cost_ladder_throttle_threshold` | Spend level that starts throttling non-critical work. | $75 | LIVE | FR-6.RTL.004 |
| `cost_ladder_hard_kill_threshold` | Spend level that hard-stops consequential work. | $100 | LIVE | FR-6.RTL.004 |

> LOCKED, not knobs: the **seven hard limits** (ADR-007/OD-047/OD-060) and the **sole-writer identity**
> (ADR-004). They're code-enforced and intentionally not configurable — making them tunable would breach
> the three non-negotiables.

## J. Observability — C7

| Key | What it does | Default | Class | Source |
|---|---|---|---|---|
| `price_table` | **(structured — App. A)** Token→cost rates per vendor/model for spend estimates. | see A | LIVE | FR-7.COST.001 |
| `event_log_retention_window` | How long event-log rows are kept before pruning. | — | BOOT | FR-7.LOG.006 |
| `realtime_connection_headroom_threshold` | % of the realtime budget used before falling back to polling. | 80% | LIVE | FR-7.RTP.003 |
| `task_failure_spike_threshold` | Failures in a window that trigger a spike alert. | 5 in 30 min | LIVE | FR-7.ALR.002 |
| `queue_backup_threshold` | Pending-task pile-up that triggers a backup alert. | 20 for 60 min | LIVE | FR-7.ALR.002 |
| `approval_staleness_alert_threshold` | How long an approval can wait before it alerts. | 4 h | LIVE | FR-7.ALR.002 |
| `cost_threshold_alert_limit` | Spend level that fires the cost-breach alert. | $50/day, $200/wk | LIVE | FR-7.ALR.002 |
| `task_success_rate_threshold_pct` | Success-rate floor below which an alert fires. **GAP→now added** (L996). | 95 | LIVE | FR-7.ALR.002 |
| `memory_confidence_drop_threshold` | Confidence-drop level that triggers a memory-health alert. **GAP→now added** (L998). | 0.6 | LIVE | FR-7.ALR.002 |
| `alert_escalation_window_hours` | How long an unacknowledged alert waits before escalating. **GAP→now added** (L1003). | 2 | LIVE | FR-7.ALR.* |
| `deployment_staleness_window` | How long without a management-plane push before a deployment is marked stale. | — | LIVE | FR-7.MGM.002 |
| `polling_interval_health_metrics_s` | Refresh rate for the health-metrics dashboard. **GAP→now added** (L1007). | 30 | LIVE | FR-7.RTP.* |
| `polling_interval_event_log_s` | Refresh rate for the event-log view. **GAP→now added** (L1008). | 60 | LIVE | FR-7.RTP.* |
| `polling_interval_memory_health_s` | Refresh rate for the memory-health view. **GAP→now added** (L1009). | 300 | LIVE | FR-7.RTP.* |
| `polling_interval_self_improvement_s` | Refresh rate for the self-improvement panel. **GAP→now added** (L1010). | 600 | LIVE | FR-7.RTP.* |
| `polling_interval_cost_tracking_s` | Refresh rate for cost tracking. **GAP→now added** (L1011). | 300 | LIVE | FR-7.RTP.* |
| `polling_interval_agent_health_s` | Refresh rate for agent-health metrics. **GAP→now added** (L1012). | 60 | LIVE | FR-7.RTP.* |

## K. Agent design / routing — C8

| Key | What it does | Default | Class | Source |
|---|---|---|---|---|
| `orchestrator_confidence_threshold` | How sure routing must be before acting vs. asking for clarification. | 0.75 | LIVE | FR-8.ORC.006 |
| `chain_depth_limit` | Max depth of agent-calls-agent chains before it's cut off. | 6 | LIVE | FR-8.ORC.005 |
| `clarification_escalation` | How long an unanswered routing clarification waits before escalating. | — | LIVE | FR-8.ORC.006 |
| `drift_threshold` | How far an agent can drift from its scope before it's flagged. | — | LIVE | FR-8.HLTH.002 |
| `dead_agent_threshold` | Failure/low-quality level at which an agent is flagged as dead. | — | LIVE | FR-8.HLTH.003 |
| `default_model` | The main LLM agents use. **GAP→now added** (design L1035). | claude-sonnet-4-6 | BOOT | FR-8.* |
| `lightweight_model` | The cheap LLM used for high-volume gate tasks. **GAP→now added** (L1036). | claude-haiku-4-5 | BOOT | FR-8.* |
| `routing_weights` | **(structured — App. A)** The 4 factors that decide which agent gets a task. | see A | LIVE | FR-8.ORC.004 |
| `cache_time_window` | **(structured — App. A)** How long each agent type caches its results. | see A | LIVE | FR-8.LRN.003 |

## L. Proactive intelligence — C9

| Key | What it does | Default | Class | Source |
|---|---|---|---|---|
| `cold_start_basic_threshold` | Coverage % at which basic human-initiated tasks run normally. | 20% | LIVE | FR-9.CST.001 |
| `cold_start_proactive_threshold` | Coverage % below which the system stays quiet (no proactive suggestions). | 50% | LIVE | FR-9.CST.002 |
| `cold_start_full_threshold` | Coverage % at which all features unlock and cold-start mode ends. | 80% | LIVE | FR-9.CST.001 · *DUP w/ C2* |
| `external_act_trust_period` | Trust grace period before low-risk external comms can be set to autonomous. | — | BOOT | FR-9.MODE.004 |
| `scanner_relationship_enabled` | Turns the relationship-management generator on/off. | true | LIVE | FR-9.PRO.001 |
| `scanner_meeting_prep_enabled` | Turns the meeting-prep generator on/off. | true | LIVE | FR-9.PRO.002 |
| `scanner_document_prep_enabled` | Turns the document-prep generator on/off. | true | LIVE | FR-9.PRO.003 |
| `scanner_derisking_enabled` | Turns the risk-scan generator's *surfacing* on/off (does not silence C6 safety). | true | LIVE | FR-9.PRO.004 |
| `scanner_opportunity_enabled` | Turns the opportunity-spotting generator on/off. | true | LIVE | FR-9.PRO.005 |
| `scanner_briefing_enabled` | Turns the daily-briefing generator on/off. | true | LIVE | FR-9.PRO.006 |
| `scanner_pattern_enabled` | Turns the pattern-recognition generator on/off. | true | LIVE | FR-9.PRO.007 |
| `briefing_schedule` | When the daily morning briefing is generated. | time+cadence | LIVE | FR-9.PRO.006 |
| `meeting_prep_lead_time` | How far ahead of a meeting prep is generated. | — | LIVE | FR-9.PRO.002 |
| `not_contacted_window` | Client silence period before a check-in is suggested. | — | LIVE | FR-9.PRO.001 |
| `renewal_lookahead_days` | How far ahead contract renewals are flagged. | — | LIVE | FR-9.PRO.001 |
| `dismissal_decay` | How fast a dismissed suggestion type stops being suggested. | — | LIVE | FR-9.SUG.005 |
| `risk_floor` | The weight floor below which risk signals can *never* be suppressed by dismissals. | — | LIVE | FR-9.SUG.005 |
| `suggestion_ttl_days` | How long an unanswered suggestion lives before it expires. | — | LIVE | FR-9.SUG.001 |
| `suggestion_volume_limit` | Max suggestions surfaced per cycle (anti-spam). | — | LIVE | FR-9.SUG.002 |
| `approval_push_frequency_minutes` | How often pending-approval push notifications are sent. **GAP→now added** (L1028). | 30 | LIVE | FR-9.SUG.004 |
| `stale_queue_push_hours` | How long a stale approval queue waits before a push nudge. **GAP→now added** (L1029). | 4 | LIVE | FR-9.SUG.004 |
| `risk_thresholds` | **(structured — App. A)** Per-risk-type trip points + who they route to. | see A | LIVE | FR-9.PRO.004 |
| `opportunity_thresholds` | **(structured — App. A)** Per-opportunity-type trip points + confidence floors. | see A | LIVE | FR-9.PRO.005 |
| `action_autonomy_matrix` | **(structured — App. A)** Which action types may be Suggest/Prepare/Act. *Has LOCKED floored rows.* | see A | LIVE | FR-9.MODE.004 |

## M. Infrastructure & compliance — C10

| Key | What it does | Default | Class | Source |
|---|---|---|---|---|
| `client_offboarding_retention_days` | How long client data is kept after offboarding sign-off before hard deletion. | 90 | BOOT | FR-10.RET.002 |
| `data_export_link_expiry_hours` | How long an offboarding data-export download link stays valid. | 72 | LIVE | FR-10.RET.002 |
| `individual_deletion_audit_years` | How long deletion audit records are kept after the data is gone. | 7 | BOOT | FR-10.DEL.005 |
| `deletion_two_person_auth_required` | Requires a second distinct admin to confirm erasures of sensitive data. | true | LIVE | FR-10.DEL.006 |
| `deploy_max_skew_days` | How stale a deployment can get (days) before a version-skew alert. | 14 | LIVE | FR-10.DEP.004 |
| `deploy_max_version_skew` | How many versions behind before a version-skew alert. | 3 | LIVE | FR-10.DEP.004 |
| `canary_soak_minutes` | Minimum soak time on canary before a release can promote to the fleet. | — | LIVE | FR-10.DEP.002 |
| `deployment_region` | Data-residency region for a deployment (Sydney locked in v1). | ap-southeast-2 | BOOT | FR-10.ISO.003 |

## N. Platform secrets — cross-component (Tier 3)  *(all GAP→now added by the secrets audit)*

| Key | What it is | Class | Source |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | LLM inference key (Haiku/Sonnet). Deployment can't run without it. | SECRET | C4/C5, ADR-003 |
| `OPENAI_API_KEY` | Embedding-model key (text-embedding-3-small). | SECRET | C2 FR-2.VEC.001 |
| `SLACK_SIGNING_SECRET` | Verifies inbound Slack webhooks (per workspace/app). | SECRET | C3 FR-3.TRIG.004 |
| `GOHIGHLEVEL_WEBHOOK_SECRET` | Verifies inbound GHL webhooks (Ed25519, per location). | SECRET | C3, OD-044/046 |
| `GOOGLE_OAUTH_CLIENT_SECRET` | The client's Google OAuth app secret (Gmail/Drive/Calendar). | SECRET | C3, ADR-005 §6 |
| `GOOGLE_PUBSUB_SERVICE_ACCOUNT_KEY` | Service-account key for Google Pub/Sub push webhooks. | SECRET | C3 FR-3.TRIG.004 |
| `X_INTERNAL_TOKEN` | Authenticates the deployment→management-plane push (ADR-001 §7). | SECRET | C10 FR-10.MGT.* |
| `INNGEST_API_KEY` | Job-execution platform key (the loops + task queue run on it). | SECRET | C5 FR-5.JOB.* |

> SMTP credentials (`auth.smtp_*`, `auth.smtp_bounce_webhook`) are also SECRET — listed conceptually
> here, homed under group A's source FRs (FR-0.INV.003/007).

---

## Appendix A — Structured (object) configs

These 9 keys aren't single values — each is an object that renders as its own small admin table.
Recommendation (Agent B): keep each as **one structured config**, not exploded into scalar keys.

1. **`ranking_weights`** (C2) — `recency 0.3 · confidence 0.3 · entity_match 0.2 · vector_similarity 0.2`. Must sum to 1.0.
2. **`expected_slots`** (C2) — per entity type, a list of 5–8 "things we should know" slots (~150 fields across the default types). Drives coverage %.
3. **`entity_types`** (C2) — the default list of ~22 entity kinds (Client, Contact, Campaign, …); operator add/rename/soft-disable. "Internal Org" always present, locked.
4. **`routing_weights`** (C8) — `domain_match 0.35 · complexity_fit 0.25 · memory_scope_fit 0.20 · tool_scope_fit 0.20`. Sum to 1.0.
5. **`cache_time_window`** (C8) — per agent type minutes: research 30 · client 60 · campaign 60 · comms 15 · ops 120 · finance 120 · insight 1440.
6. **`anomaly_thresholds`** (C6) — 5 checks, each with a trip point + severity: confidence 0.5 · volume 20/run · contradiction (on/off) · scope_expansion 50% · sentiment 0.3. (Sentiment AND scope are both distinct checks.)
7. **`risk_thresholds`** (C9) — per risk type a threshold + owner role: sentiment_drop · payment_overdue (7d) · campaign_underperform · capacity_stretched · renewal_approaching (30d).
8. **`opportunity_thresholds`** (C9) — per opportunity type a magnitude + confidence floor: client_growth · new_service_fit · referral · market_signal.
9. **`action_autonomy_matrix`** (C9) — **two sections.** *Configurable:* low-risk external/non-client comms (Suggest/Prepare/Act + trust period + rate cap). *LOCKED floored:* existing-client comms, system-of-record comms, financial ops, Confidential/Restricted — all fixed at hard-approval, edits rejected at write-time (AC-9.MODE.004.2). This is the one composite that is *partly* a knob and *partly* a locked floor.

`price_table` (C7) is the 10th object: vendor × model → input/output token price; estimate-grade, operator-editable.

---

## Open flags for the operator (resolve before / during step-2 speccing)

**1. CONFLICTS — all resolve "locked spec beats stale design doc," I'll apply unless you object:**
- `parallel_execution_enabled` → **false** (C5 safety default).
- `embedding_model` → **REBUILD** class (not BOOT).
- `auth.invite_link_ttl` / `auth.access_token_ttl` → **FR values** (24h cap; rotating tokens) — design is stale.

**2. NEW SPEC HOLE — alert routing has no owner. Needs a decision (an OD).**
C7 fires alerts and routes "by role," but **nothing in the spec says *where* an alert physically goes** —
no Slack webhook URL, no admin channel, no escalation-contact list, no quiet-hours. This isn't a harvest
miss; it was never specified. *Recommendation:* open an **OD** — likely C7 owns a small routing config
(`SLACK_WEBHOOK_URL` = SECRET, `alert_routing_rules` + `escalation_contacts` + `quiet_hours` = LIVE/BOOT),
resolved through C1 roles. I did **not** invent these as committed rows — they're parked here pending your call.

**3. CLASS calls needing your edit-policy confirmation:**
- `entity_types` — BOOT (soft-disable lifecycle) vs LIVE. *Rec: BOOT.*
- `default_model` / `lightweight_model` — BOOT vs REBUILD. *Rec: BOOT (no re-embed; embeddings are separate).*

**4. DELIBERATE LOCKS (confirmed correct — shown so they don't read as gaps):** the seven hard limits,
the sole-writer identity, default-deny, roles/permissions/agents/users (Tier-1 records → Phase 3). None
are knobs, by design.

**Naming:** step 2 normalises to dotted group prefixes (`memory.*`, `guardrail.*`, `loop.*`, `cost.*`,
`proactive.*`, `deploy.*`) matching C0's existing `auth.*` / `webhook.*`, so the Config Admin screen
sections cleanly.
