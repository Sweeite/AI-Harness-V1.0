# Coverage Inventory: Components 7–10 (Phase 6 Issue Decomposition)

## Component 7 — Observability (Backbone for "How You Know What It's Doing")

**Status:** Approved 2026-06-26 (35 FRs)  
**Core purpose:** Event log, real-time-vs-polling contract, alerting rules + routing, cost tracking, management-plane cross-deployment push, retention/export.

### FR Summary by Area

| Area | Count | FRs | One-Line Capability |
|------|-------|-----|---------------------|
| **LOG** | 8 | FR-7.LOG.001–008 | Event log schema, retention, redaction-tombstone, config audit backbone |
| **RTP** | 4 | FR-7.RTP.001–004 | Hybrid real-time/polling, per-surface cadences, connection budget, subscription lifecycle |
| **ALR** | 9 | FR-7.ALR.001–009 | Dashboard notification centre, seven alert rules, routing, escalation, delivery durability, watchdog, unroutable-alert-fails-loud |
| **COST** | 4 | FR-7.COST.001–003 | Estimate-grade accounting, per-task aggregation, cost ladder (meter + trigger) |
| **MGM** | 5 | FR-7.MGM.001–005 | Health-reporter push, staleness detector, deployment health grid, cross-deployment alerts, cost overview |
| **VIEW** | 3 | FR-7.VIEW.001–003 | Five role-based dashboard contracts (surfaces are Phase 3) |
| **OPT** | 2 | FR-7.OPT.001–002 | Feedback-flywheel signals, deployment benchmarking substrate |

**Key FRs:**
- **FR-7.LOG.001** — Append-only event_log with 15-value event_type enum
- **FR-7.LOG.006/007/008** — Retention windows, redaction-tombstone on erasure, config_audit_log as third sink
- **FR-7.RTP.001/003** — Real-time only for approval queue + notifications; polling elsewhere; per-silo connection budget with degrade-to-polling
- **FR-7.ALR.002/005/006/008/009** — Seven configurable alert rules; escalation-window → secondary alert; delivery independent of Slack; alert-engine watchdog; unroutable-alert-fails-loud
- **FR-7.COST.003** — C7 meters + signals; C6 decides + C5 executes (the proven approve/execute split)
- **FR-7.MGM.001–005** — Outbound health-reporter push (operational-metadata-only), push-staleness → stale-not-green, deployment health grid, cross-deployment alerts, backup-health, cost overview

### Touchpoints

**DATA-*:**
- `event_log` (unified system timeline; append-only; 15-value event_type enum)
- `guardrail_log` (C6-written; C7 owns view/retention/tamper-evidence/export)
- `config_audit_log` (new third audit sink; C7 governs)
- `access_audit` (C1-written; C7 owns retention floor)
- `notifications` (read/unread state; escalation_state)
- `proactive_suggestions` (C9-written; C7 delivers via notification centre)
- Cross-deployment `client_registry` status (management plane; C7 reads staleness)

**CFG-*:**
- `CFG-alert_routing_rules`, `CFG-escalation_contacts`, `CFG-quiet_hours`, `CFG-alert_email_enabled`, `CFG-SLACK_WEBHOOK_URL`
- `CFG-orchestrator_confidence_threshold`, `CFG-clarification_escalation_window` (read from C8)
- Per-surface polling cadences: `CFG-health_poll_interval`, `CFG-event_log_poll_interval`, `CFG-memory_health_poll_interval`, etc.
- `CFG-cost_price_table`, `CFG-cost_threshold_soft_alert`, `CFG-cost_threshold_hard_kill`
- Realtime connection headroom: `CFG-realtime_connection_headroom_threshold`
- Retention windows: `CFG-event_log_retention_window`, `CFG-guardrail_log_retention_floor`, `CFG-access_audit_retention_floor`

**PERM-*:**
- `PERM-config.observability` (alert routing + escalation config; Super Admin)
- `PERM-compliance.download_records` (export access)
- `PERM-memory.delete` (Admin/Super Admin; gated by C1 roles)

**UI-*:**
- `UI-dashboard-super-admin` (client health grid, cross-deployment alerts, cost overview, CI/CD status)
- `UI-dashboard-operations` (queue depth, approval queue, connector status, loop health, event log, cost tracking, DLQ)
- `UI-dashboard-manager` (memory health, confidence distribution, structural issues, maintenance queue, approval queue, cost tracking)
- `UI-dashboard-standard-user` (approval queue, agent health, self-improvement panel, daily briefing, command menu)
- `UI-dashboard-mobile` (essentials only; push notifications)
- `UI-config-admin#observability` (alert routing configuration)
- `UI-config-audit-log` (surface-01b; governance + export of config changes)

**Connectors:** None directly owned; C7 consumes C3 connector status for observability display.

### Seams (Do Not Double-Spec)

| Intent | Home | Reason |
|--------|------|--------|
| Dashboard panel rendering, visual states, layout, mobile surface | Phase 3 (Surfaces) | C7 owns data contract + signals; Phase 3 renders |
| Memory health signals (confidence, coverage, structural issues, relevance) | C2 (FR-2.MNT.*) | C2 computes; C7 displays |
| Connector status, error rate, quota % | C3 (FR-3.OBS.*) | C3 owns health; C7 displays |
| Loop/task-queue/success-rate/DLQ metrics | C5 (FR-5.LOP/QUE/JOB.*) | C5 produces; C7 displays |
| Guardrail-log write-completeness | C6 (FR-6.LOG.*) | C6 writes; C7 owns view/retention/export |
| Agent health, drift detection, orchestrator confidence | C8 (FR-8.HLTH/LRN.*) | C8 produces metrics; C7 displays |
| Self-improvement suggestions themselves | C9 (Insight Agent output) | C9 produces; C7 displays + tracks acted/history |
| Answer-mode pill content | C4 (FR-4.CID.006) | C4 produces; C7 renders + uses as coverage signal |
| Cost-ladder enforcement (throttle/kill) | C5/C6 (FR-5/6.*) | A guardrail action; C7 owns meter + trigger |
| Alert routing rules (who may action which alert) | C1 (FR-1.ROLE/PERM.*) | C7 routes *to* the C1-defined role |
| Catch-up run on missed loop | C5 (FR-5.LOP.*) | C5 owns; C7 owns alert |

### Gating AFs

**OD-157 Launch Spikes:**
- **AF-068** (injection / hard-limit containment, C6 red-team) — gates FR-7.ALR.002/003, FR-7.MODE.*
- **AF-069** (alert escalation no-silent-drop) — gates FR-7.ALR.005
- **AF-078** (webhook delivery) — gates FR-7.ALR.009 (Slack webhook validation)
- **AF-067** (RLS latency at retrieval) — not directly gated; C7 inherits from C2 retrieval

**Other Feasibility (Block R):**
- **AF-118** (absence-of-signal detection liveness) — gates FR-7.ALR.008 (alert-engine watchdog)
- **AF-119** (last-resort out-of-band log-failure surface) — gates AC-7.LOG.003.2 (degraded log-write path)
- **AF-120** (cross-deployment clock-sync for window math) — gates FR-7.ALR.005.3 (escalation-window staleness computation)

---

## Component 8 — Agent Design (Routing + Agent-Definition Layer)

**Status:** Approved 2026-06-26 (37 FRs)  
**Core purpose:** One orchestrator (routes+plans only); eight specialist agents; agent registry (data-driven discovery); per-agent memory scope; per-step failure-mode assignment; agent-health/drift/dead-agent metrics; orchestrator learning + result caching; cost-routing by confidence.

### FR Summary by Area

| Area | Count | FRs | One-Line Capability |
|------|-------|-----|---------------------|
| **ORC** | 8 | FR-8.ORC.001–008 | Orchestrator 7-step routing, registry-driven (not hardcoded), confidence check, plan versioning, self-representation in registry |
| **REG** | 6 | FR-8.REG.001–006 | Agents table schema, Layer-1 from prompt_layers (closes OD-048), auto-discovery, version discipline, enabled gates discovery, seed roster |
| **SPC** | 6 | FR-8.SPC.001–006 | Eight single-domain specialists, Research read-only + called first, Comms approval-queue-only, Finance no-transaction hard limit, Memory sole-writer identity, Insight read-all-no-write on slow loop |
| **SCO** | 3 | FR-8.SCO.001–003 | Per-agent memory scope as retrieval filter (OD-081 wired), clearance on top, scope defined in registry not code |
| **PLAN** | 4 | FR-8.PLAN.001–004 | Failure mode per step upfront, plan structure, confidence-driven clarification, outcome tracking |
| **HLTH** | 4 | FR-8.HLTH.001–004 | Success-rate metric per agent, drift detection (mismatch scoring), dead-agent detection, producer liveness heartbeat |
| **LRN** | 3 | FR-8.LRN.001–003 | Orchestrator learning loop, result cache (scope-aware + time-bounded per OD-076), cache invalidation |
| **COST** | 3 | FR-8.COST.001–003 | Per-route cost model, confidence threshold, cost-routing complexity dial |

**Key FRs:**
- **FR-8.ORC.001–007** — Orchestrator 7-step: classify → registry-read → score candidates → build plan (with failure modes) → confidence-check (→ clarification if low) → version-log → outcome-track
- **FR-8.REG.001–006** — Agent registry (`agents` table); Layer-1 from `prompt_layers` (OD-075); auto-discovery on insert; version discipline + mandatory change_reason; enabled gates routing; seed 8+1 on provisioning
- **FR-8.SPC.001–006** — Research (read-only, placed first); Comms (approval-queue-only, no autonomous send); Finance (Confidential scope, no transactions); Memory (sole-writer path to C2); Insight (slow-loop, read-all-no-write)
- **FR-8.SCO.001–003** — Per-agent memory scope as least-privilege retrieval filter (OD-081 wired via AC-5.ASM.006.2 + AC-2.RET.004.2); clearance intersects scope; scope defined in registry, not code
- **FR-8.PLAN.001–002** — Failure mode per step upfront (retry/skip/halt); low-confidence routes to human clarification (OD-077 escalate-don't-abandon)
- **FR-8.HLTH.001–003** — Agent success rate, drift (routing mismatch + answer-mode pill + human approval/rejection), dead-agent (low/no recent runs)
- **FR-8.LRN.001–003** — Learning loop from outcomes; result cache with scope-aware key + time window + write-triggered invalidation (OD-076)
- **FR-8.COST.001–003** — Per-route cost model (estimate-grade); confidence dial highest-leverage cost/quality tunable

### Touchpoints

**DATA-*:**
- `agents` (id, name, description, memory_scope, tools_allowed, max_tokens, enabled, version, change_reason, previous_version_id)
- `prompt_layers` (keyed to agent_id, layer='core'; Single Layer-1 source, closes OD-048)
- `execution_plan` (version, step structure, failure modes per step; lives in context envelope, C5 owns envelope)
- `orchestrator_outcomes` (per-plan-version: success/failure per step)
- `agent_cache_results` (scope-aware key: in-scope entity ids + their last-write/memory version; time-windowed)
- `agent_metrics` (per-agent success rate, drift score, dead-agent flag)

**CFG-*:**
- `CFG-orchestrator_confidence_threshold` (default 0.75; reused by C9 cold-start gating)
- `CFG-chain_depth_limit` (max steps in a chain)
- `CFG-routing_weights` (domain / complexity / memory / tool fit weights)
- `CFG-parallel_execution_enabled`
- `CFG-clarification_escalation_window` (C9 also gates on it)
- `CFG-agent_result_cache_time_window` (OD-076 time-bound on cache key)

**PERM-*:**
- `PERM-agents.manage` (registry edits; OD-080 → Super Admin for scope/tools/enabled; Admin+Super Admin for description/tuning)
- `PERM-config.agents` (implicit via OD-080)

**UI-*:**
- `UI-registry-editor` (Phase 3; add/edit/disable agents; view version history; change_reason + audit)
- `UI-clarification-request` (inline; low-confidence routing prompt for human decision; OD-077 escalates if unanswered)
- Agent-health cards (Phase 3/C7 display; C8 produces metrics)
- Routing-outcome metrics (Phase 3/C7 display; feeds self-improvement panel)

**Connectors:** None directly owned; agents interact with C3 connectors through C3's tool interface.

### Seams (Do Not Double-Spec)

| Intent | Home | Reason |
|--------|------|--------|
| Context envelope (shape, travel, compression) | C5 (FR-5.ENV.*) | C8 populates execution_plan; C5 owns envelope machinery |
| Failure-mode execution (retry-with-backoff, skip, halt) | C5 (FR-5.LOP/JOB.*) | C8 assigns mode; C5 executes |
| Self-healing mechanisms | C2/C3/C5 | C8 owns assignment; others own execution |
| Self-improvement panel, improvement history, dashboards | C7 + Phase 3 | C8 produces metrics; C7 displays; Phase 3 renders |
| Cost metering, cost-ladder enforcement | C7/C6 | C8 owns routing logic + confidence dial; C7 meters; C6 enforces |
| Layer-1 prompt content | C4 (FR-4.LYR.*) | C8 reconciles agents.system_prompt (OD-075); C4 owns content + prompt_layers store |
| Anomaly baseline, approval tiers | C6 | C8 scoping sits under approval tiers |
| Tool execution + tools registry | C3 (FR-3.REG.002 / FR-3.ACT.*) | Orchestrator scores on tool-fit; C3 owns actual execution |
| Sensitivity clearance applies on top | C1 + C2 (FR-1.CLR.* / FR-2.RET.*) | C8 scoping ∩ task clearance = effective access (clearance-before-ranking) |

### Gating AFs

**OD-157 Launch Spikes:**
- **AF-068** (hard-limit containment) — gates FR-8.SPC.003/004 (Comms/Finance hard limits)
- **AF-069** (no-silent-drop alert escalation) — gates FR-8.ORC.006 (low-confidence clarification escalates, OD-077)

**Verification-Gate Findings (wired via change-control OD-081):**
- **AF-123** (drift detection thresholds) — gates FR-8.HLTH.002/003
- **AF-124** (dead-agent detection accuracy) — gates FR-8.HLTH.003

**Other Feasibility:**
- **AF-121** (description-driven routing accuracy) — gates FR-8.ORC.001–004 (classification + registry-read + scoring)
- **AF-122** (confidence calibration) — gates FR-8.ORC.006 (threshold separates good/bad routing)
- **AF-125** (outcome-tracking measurably improves routing) — gates FR-8.LRN.001
- **AF-126** (cache invalidation prevents stale knowledge) — gates FR-8.LRN.003 (OD-076 scope-aware key)

---

## Component 9 — Proactive Intelligence (Generation + Cold-Start Gating + Chat Commands)

**Status:** Approved 2026-06-27 (31 FRs)  
**Core purpose:** Three proactivity modes (Suggest/Prepare/Act); seven proactive generators; suggestion lifecycle (persist, rank, explain, deliver, learn-from-dismissals); cold-start gating (four coverage phases); `/` command system + custom commands.

### FR Summary by Area

| Area | Count | FRs | One-Line Capability |
|------|-------|-----|---------------------|
| **MODE** | 4 | FR-9.MODE.001–004 | Three modes mapped from C6 tiers; no-bypass same guardrails; configurable autonomy matrix (non-negotiable floor) |
| **PRO** | 7 | FR-9.PRO.001–007 | Relationship mgmt, meeting prep, document prep, derisking (risk scan), opportunity spotting, daily briefing, pattern recognition |
| **SUG** | 5 | FR-9.SUG.001–005 | Persistence + lifecycle, ranking by urgency+relevance, reasoning+pill, multi-surface delivery, dismissal-learning with floor |
| **CST** | 7 | FR-9.CST.001–007 | Phase behaviour matrix, proactive suppression below 50%, reduced loops below 20%, external-write block below 50%, per-entity cold-start framing, cold-start status + verification-priority |
| **CMD** | 8 | FR-9.CMD.001–008 | Command dispatch, per-command permission-node gating, destructive-confirm, pill+logging, mobile menu, custom-command definitions, dispatch registry, invocation (via task_queue) |

**Key FRs:**
- **FR-9.MODE.001–004** — Suggest/Prepare/Act modes; mapped from C6 tier (not separate classifier); same C6 pipeline for proactive actions; configurable autonomy matrix with **non-negotiable floor** (low-risk external capped at Prepare; floored set fixed at hard-approval; OD-161 reverted Act path)
- **FR-9.PRO.001–007** — Seven independent scanners (all on by default, disable-able): relationship mgmt + meeting prep + document prep + derisking + opportunity + briefing + pattern recognition; each has threshold config; derisking never suppressed below floor
- **FR-9.SUG.001–005** — Proactive suggestions persist in dedicated store with explicit lifecycle; ranked by urgency×relevance; cap volume per config; carry reasoning+pill; routed by risk type to right person; learn from dismissals (but never suppress hard-risk below floor, re-surface if underlying metric escalates)
- **FR-9.CST.001–007** — Cold-start phase matrix (consumes C2 FR-2.MAT.002 per-entity Maturity); <20% cold (proactive suppressed, loops reduced, external-write blocked, agents read-only); 20–50% basic (normal tasks, full loops, proactive still suppressed); 50–80% proactive (unlock); >80% full (permanent activation); thresholds configurable; per-entity framing; verification-pass ranked highest-priority; status contract for progress indicator
- **FR-9.CMD.001–008** — `/` command dispatch; per-command node-gating (C1 permission nodes, not hardcoded roles; resolves "Agency Owner" as node assignments); destructive-confirm; pill+audit logging; mobile quick-tap menu; custom commands (admin-created, slug-validated, template-based, agent-assigned, node-gated, invocation via task_queue with same C6 pipeline)

### Touchpoints

**DATA-*:**
- `proactive_suggestions` (generated, surfaced, acted/dismissed/expired/superseded lifecycle)
- `signal_weights` (dismissal-learning per signal type + context)
- `conversations` + `messages` (chat thread persistence, async-result return path; Phase 4 stubs)
- `commands` (user-defined custom commands; slug, name, prompt template, assigned agent, PERM node)

**CFG-*:**
- `CFG-cold_start_basic_threshold` (default 20%)
- `CFG-cold_start_proactive_threshold` (default 50%)
- `CFG-cold_start_full_threshold` (default 80%)
- `CFG-scanner_*_enabled` (one per scanner: relationship, meeting_prep, document_prep, derisking, opportunity, briefing, pattern; all default true)
- `CFG-risk_thresholds` (per derisking signal)
- `CFG-opportunity_thresholds`
- `CFG-suggestion_volume_limit`
- `CFG-suggestion_ttl_days`
- `CFG-briefing_schedule` (time to fire daily briefing)
- `CFG-action_autonomy_matrix` (OD-088; low-risk external configurable Suggest↔Prepare; floored set locked hard-approval)
- `CFG-dismissal_decay`, `CFG-risk_floor` (learning parameters)
- `CFG-clarification_escalation_window` (reused from C8 for `/tune` / config edits)

**PERM-*:**
- `PERM-commands.manage` (create/edit/delete custom commands; Super Admin + Admin; C1 FR-1.PERM.005 stub owed)
- `PERM-guardrail.edit_autonomy` (edit autonomy matrix; Super Admin only)
- Per-command node (gated by caller's authorization; default assignments: basic commands → Standard User+; approval/schedule → approval/schedule nodes; system commands → Admin+; all → Super Admin)

**UI-*:**
- `UI-suggestion-feed` (surface-09; cards ranked by urgency; reasoning+pill; act/dismiss/review actions)
- `UI-briefing-panel` (due-today / at-risk / needs-attention / overnight-activity)
- `UI-cold-start-banner` (phase label, progress indicator, verification-pass priority + count)
- `UI-command-menu` (chat `/` menu; system + permitted custom commands; mobile quick-tap buttons)
- `UI-COMMANDS` (Phase 3 admin interface to define custom commands)
- `UI-autonomy-matrix` (Phase 3; configure low-risk external Suggest↔Prepare)

**Connectors:** Relationship health + derisking pull live data from C3 connectors (read-only).

### Seams (Do Not Double-Spec)

| Intent | Home | Reason |
|--------|------|--------|
| Enforcement of any proactive action | C6 (FR-6.APR/HRD/ANM/INJ.*) | C9 assigns mode; C6 enforces gate; identical pipeline as reactive |
| Slow loop + scheduled briefing trigger | C5 (FR-5.LOP.001 / FR-5.TRG.*) | C9 owns content generation; C5 owns scheduling |
| Insight Agent definition + read-all-no-write scope | C8 (FR-8.SPC.006) | C8 defines agent; C9 consumes output |
| Coverage / Maturity / [Building] computation | C2 (FR-2.MAT.002 / FR-2.RET.007, ADR-002) | C2 emits phase + per-entity Maturity; C9 consumes for cold-start gating |
| Notification delivery of surfaced suggestions | C7 (FR-7.ALR.*) | C9 produces item + routing; C7 delivers to dashboard/chat/push |
| Rendering of all surfaces | Phase 3 | C9 owns content + state contract; Phase 3 renders |
| Memory writes (never direct from C9) | C2 sole-writer + Memory Agent | Proactive scanning read-only; any write goes through C2 FR-2.WRT.* path |
| RBAC / clearance, tool execution, prompt content | C1 / C3 / C4 | C9 produces suggestions; others enforce/execute/author |

### Gating AFs

**OD-157 Launch Spikes:**
- **AF-068** (hard-limit containment) — gates FR-9.MODE.002/003 (floored set enforcement via C6)
- **AF-078** (webhook + delivery) — gates FR-9.SUG.004 (suggestion delivery via C7 notification)
- **AF-069** (escalation no-silent-drop) — gates FR-9.SUG.001.4 (stuck-generated suggestion escalates)

**Verification-Gate Findings:**
- **AF-127** (proactive signal-detection accuracy: sentiment, relationship, risk, patterns) — gates FR-9.PRO.001/004/005/007
- **AF-128** (dismissal-learning never suppresses true escalating signal; OD-084 floor holds) — gates FR-9.SUG.005
- **AF-129** (ranking + briefing surface genuinely important items) — gates FR-9.SUG.002 / FR-9.PRO.006
- **AF-130** (ETA from ingestion rate is meaningful) — gates FR-9.CST.007
- **AF-131** (accuracy of non-client / content-sensitivity classification; stakes lowered by OD-161) — gates FR-9.MODE.004.3 (ambiguity → floored)

**Other Feasibility:**
- **AF-034** (Maturity/Sufficiency separates Building/Unknown) — carry-in from C2; gates FR-9.CST.004

---

## Component 10 — Infrastructure & Compliance (Deployment, Deprovisioning, Lawful Deletion)

**Status:** Approved 2026-06-27 (34 FRs)  
**Core purpose:** Intentional retention + lawful deletion; individual right-to-erasure workflow (6 steps); client offboarding workflow (6 steps); provisioning orchestration; release model (canary/train); management plane (ingest + registry); isolation (silo model) + residency.

### FR Summary by Area

| Area | Count | FRs | One-Line Capability |
|------|-------|-----|---------------------|
| **RET** | 2 | FR-10.RET.001–002 | Intentional retention (decay never deletes, only deliberate paths), configurable retention values with legal-minimum floors |
| **DEL** | 7 | FR-10.DEL.001–007 | Individual erasure workflow (request queue, identify deterministic+probabilistic, conditional id-removal+hard-delete, content scrubbing, audit log, connector-flag+two-person auth, frozen-deployment check) |
| **OFF** | 6 | FR-10.OFF.001–006 | Offboarding workflow (trigger, export-verified-complete, client sign-off, retention-freeze+deployment-frozen, hard-deletion+deprovision, meta-record) |
| **PRV** | 4 | FR-10.PRV.001–004 | Provisioning script (Railway+secrets+token+registry+seed), per-client OAuth apps, canary synthetic client, client-side runbook |
| **MGT** | 4 | FR-10.MGT.001–004 | `client_registry` schema + status lifecycle, ingest endpoint, push-only data flow, `internal_token` lifecycle |
| **DEP** | 5 | FR-10.DEP.001–005 | Railway per-project auto-deploy, canary + release-train gate, rollback = code-redeploy, version reporting + max-skew alert, plugins out of train |
| **MIG** | 2 | FR-10.MIG.001–002 | Per-deployment migrate-on-release, per-deployment migration-failure isolation + alert |
| **ISO** | 3 | FR-10.ISO.001–003 | `client_slug` deleted from app tables (only in management registry), physical isolation = airtight offboarding, data residency (v1 Sydney lock) |
| **LEG** | 1 | FR-10.LEG.001 | Mandatory legal review before handling regulated personal data |

**Key FRs:**
- **FR-10.RET.001–002** — Intentional retention principle (decay/supersede/archive never hard-delete; only DEL/OFF paths); retention values configurable with legal-minimum floors
- **FR-10.DEL.001–007** — 6-step individual erasure: (1) intake queue; (2) identify deterministic (entity_id matches) + probabilistic (name-in-content, human-confirm only); (3) conditional id-removal + hard-delete if empty (via C2 FR-2.MNT.017, transitive); (4) content scrubbing on retained multi-entity memories; (5) permanent audit log (7-year floor); (6) connector-flag + two-person auth (distinct Admin/Super Admin); (7) frozen-deployment check
- **FR-10.OFF.001–006** — 6-step offboarding: (1) Super-Admin trigger (deliberate, from request or contract-end); (2) full export verified-complete (row-count/checksum reconciliation) → client sign-off; (3) retention-freeze (90 days default, configurable) + deployment status `frozen` + `deployment_settings.frozen_at` written locally (C5 reads for dispatch gate, OD-091); (4) hard-deletion + deprovision (Supabase + Railway + credentials + OAuth revoke + off-platform backup purged), never partial-silent; (5) meta-record in management plane (proof of completion, no client data); (6) reactivation possible within window
- **FR-10.PRV.001–004** — Provisioning script (operator-side, idempotent): Railway link → config+secrets → internal_token mint (dual-stored Railway+mgmt DB) → client_registry insert → first deploy → seed; per-client OAuth apps in client accounts; canary seeded-synthetic-client fixture; client-side runbook (create Supabase + API accounts + grant delegated access)
- **FR-10.MGT.001–004** — `client_registry` (only home of client identity; no client_slug in app tables); status lifecycle (initialising → active → offboarding → frozen → reactivation); ingest endpoint (each deployment authenticates by internal_token, accepts operational-metadata-only push); push-only data flow (management plane is map, not warehouse); internal_token lifecycle (mint at provision, dual-store, rotate, revoke at offboard)
- **FR-10.DEP.001–005** — Railway per-project auto-deploy (not custom CI); canary (release branch) → smoke-battery gate → fast-forward promote → main (fleet auto-deploys); rollback = code-redeploy (no destructive down-migration; expand-contract schema); version reporting + max-skew alert (3 versions / 14 days default); plugins per-deployment, out of train
- **FR-10.MIG.001–002** — Per-deployment migrate-on-release (identical files, N independent runs against own Supabase); migration failure isolated to one deployment (alert + version-skew flag; never silent or cascades)
- **FR-10.ISO.001–003** — `client_slug` deleted from all app tables (only in management `client_registry`); physical isolation (separate Supabase + Railway per client) = airtight offboarding evidence; residency v1 Sydney lock (ap-southeast-2), v2 selectable

### Touchpoints

**DATA-*:**
- `client_registry` (management plane; id, client_slug, client_name, railway_url, internal_token encrypted, core_version, region, status, created_at, offboarding_at)
- `deletion_requests` (queue of individual erasure requests; requester, legal_basis, target, authorized_by, executor_id, second_authoriser_id, outcome)
- `connector_deletion_flags` (per-system tracked-until-acknowledged flags for external system deletion)
- `offboarding_records` (meta-record: client identity, offboarding_at, export_delivered_at, export_acknowledged_at, retention_window_end, deletion_executed_at, systems_deprovisioned[], tokens_revoked[])
- Per-deployment `deployment_settings.frozen_at` (written to client's own Supabase by mgmt plane via custodied service_role key; C5 reads locally for dispatch gate, OD-162)
- Deployment `core_version`, `last_migrated_at` (reported via C7 health push)

**CFG-*:**
- `CFG-client_offboarding_retention_days` (default 90)
- `CFG-individual_deletion_audit_years` (default 7; legal retention floor)
- `CFG-data_export_link_expiry_hours` (default 72)
- `CFG-deletion_two_person_auth_required` (default true for Restricted/Personal)
- `CFG-canary_soak_minutes` (promotion gate soak window)
- `CFG-deploy_max_version_skew` (default 3 versions)
- `CFG-deploy_max_skew_days` (default 14 days)
- `DEPLOYMENT_CONFIG` (non-secret JSON: client identity, region, etc.)
- Region default: `ap-southeast-2` (v1 lock)

**PERM-*:**
- `PERM-config.infra` (Super Admin; retention values, deployment freeze/unfreeze)
- `PERM-memory.delete` (Admin / Super Admin; individual erasure requests, two-person auth)
- Operator-only: provisioning, release promotion, plugin updates, offboarding initiation

**UI-*:**
- `UI-deletion-requests-queue` (Phase 3; Admin queue, lifecycle tracking, two-person auth)
- `UI-offboarding-wizard` (Phase 3; Super Admin guided workflow, step-by-step confirmation, export download, retention-progress, completion meta-record)
- `UI-config-retention` (Super Admin; retention-value config with legal-minimum validation)
- `UI-fleet-version-grid` (C7 + Phase 3; version spread, skew alerts, migration status)
- `UI-config-audit-log` (surface-01b; export of config changes, tamper-evidence)

**Connectors:** C10 invokes C3 connector OAuth revocation endpoints during offboarding (FR-10.OFF.005).

### Seams (Do Not Double-Spec)

| Intent | Home | Reason |
|--------|------|--------|
| Memory erasure mechanics (transitive hard-delete, embeddings, merged rows) | C2 (FR-2.MNT.017, amended OD-074) | C10 owns request workflow + authorization + audit + connector flag; calls C2's mechanism |
| Log redaction-tombstone (`event_log` / `guardrail_log`) | C7 (AC-7.LOG.006.3 / AC-7.LOG.007.4) | C10 erasure workflow triggers it (via C2 FR-2.MNT.017 amendment) |
| Credential / OAuth-token lifecycle, revocation endpoints | C3 (FR-3.TOK.*) | C10's offboarding invokes revocation; C3 owns runtime |
| First-boot seed (Internal Org, first Super Admin, roles) | C0 / C1 (FR-0.SEED.* / FR-1.ROLE.001) | C10's provisioning triggers it; C0/C1 own logic |
| Management-plane health-reporter push | C7 (FR-7.MGM.001) | C7 owns reporter + payload whitelist; C10 owns ingest endpoint + registry writes |
| Backup / DR scheduling, restore-rehearsal | Phase 5 + ADR-008 | C10 references only; deployment erasure flags off-platform backup for purge |
| All rendering (offboarding wizard, deletion queue, fleet grid) | Phase 3 | C10 owns workflow + state contract; Phase 3 renders |

### Gating AFs

**OD-157 Launch Spikes:**
- **AF-069** (no-silent-drop alert escalation) — gates FR-10.DEL.001 (un-actioned erasure request escalates)

**Verification-Gate Findings:**
- **AF-132** (offboarding deprovision completeness: all sub-steps complete or escalate, never partial-silent) — gates FR-10.OFF.005
- **AF-133** (export integrity + readability at scale; verification never fails open) — gates FR-10.OFF.002/003
- **AF-134** (individual-erasure name-matching recall for probabilistic sweep) — gates FR-10.DEL.002
- **AF-135** (deployment freeze propagates to every dispatch path; C5 enforcement consumer wired) — gates FR-10.OFF.004
- **AF-136** (jurisdiction-specific lawful retention minimums are legal-review-gated, not spec'd) — gates FR-10.RET.002 / FR-10.LEG.001

**Other Feasibility:**
- **AF-004** (end-to-end provisioning against client-owned Supabase) — gates FR-10.PRV.001
- **AF-013** (Google OAuth production-verification lead-time) — gates FR-10.PRV.002
- **AF-020** (Railway native per-project auto-deploy + on-release migrate) — gates FR-10.DEP.001
- **AF-064** (Railway branch-based canary/train model) — gates FR-10.DEP.002
- **AF-065** (expand-contract mixed-version safety, rollback premise) — gates FR-10.DEP.003 / FR-10.MIG.001
- **AF-066** (canary synthetic corpus representativeness) — gates FR-10.PRV.003
- **AF-071** (backup residency for AU/region requirement) — gates FR-10.ISO.003 (Phase 5 / ADR-008)
- **AF-137** (transitive-erasure completeness verification across C10→C2 boundary) — gates FR-10.DEL.003.4 (verify-before-done)

---

## Cross-Component Seams

### C7 ↔ Other Components

| Seam | From | To | Flow |
|------|------|-----|------|
| Event log sources | C2/C3/C5/C6/C8/C9 | C7 (event_log) | Every component writes events; C7 persists + retains + exports |
| Alert delivery | C5 (stale approval) + C6 (hard-limit) | C7 (ALR.007) | C5/C6 emit event; C7 delivers to dashboard/Slack/mobile |
| Health metrics | C2/C3/C5/C8 | C7 (observability display) | Producers compute; C7 displays in dashboards |
| Cost accounting | C5 (run pipeline emits duration/tokens) | C7 (COST.*) | C5 emits per-event cost; C7 aggregates + meters + triggers ladder |
| Cost-ladder enforcement | C7 (meter + signal) | C6 + C5 (enforcement) | C7 detects breach, signals; C6 decides (throttle/kill), C5 executes |
| Insight Agent output | C8/C9 (Insight + PRO.* suggestions) | C7 (display + delivery) | C8/C9 produce insights; C7 surfaces via notification centre |
| Suggestion delivery | C9 (proactive_suggestions) | C7 (notification centre) | C9 ranks + routes; C7 delivers to dashboard/chat/push |
| Cross-deployment alerts | C10 (health push) + C5 (version-skew) | C7 (MGM.004) | C10/C5 report; C7 fires cross-deployment alerts on staleness/skew |

### C8 ↔ Other Components

| Seam | From | To | Flow |
|------|------|-----|------|
| Memory scope enforcement | C8 (registry) | C5 + C2 (retrieval filter) | C8 defines scope in registry; C5 (AC-5.ASM.006.2) passes scope to C2 (AC-2.RET.004.2 filters); OD-081 wired |
| Agent-health metrics | C8 (HLTH.* computation) | C7 + C9 (display + suggestions) | C8 produces success rate / drift / dead-agent; C7 displays; C9 uses for self-improvement ranking |
| Result caching | C8 (LRN.003 scope-aware cache) | C5 (execution path reads cache) | C8 invalidates on write; C5 checks before invoking agent |
| Failure-mode assignment | C8 (PLAN.001) | C5 (execution) | C8 assigns retry/skip/halt per step; C5 executes the mode |
| Cost-routing dial | C8 (COST.003 confidence threshold) | C7 + C6 (metering + enforcement) | C8 produces cost-by-route model; C7 meters; C6 enforces |
| Insight Agent output | C8 (SPC.006 Insight + metrics) | C9 (PRO.004 derisking + PRO.005 opportunity + suggestions) | C8 defines Insight; C9 consumes output for proactive generation |

### C9 ↔ Other Components

| Seam | From | To | Flow |
|------|------|-----|------|
| Cold-start phase gating | C2 (MAT.002 per-entity Maturity) | C9 (CST.001–007) | C2 emits phase; C9 consumes for suppression / external-write block / loop reduction |
| Proactive suppression | C9 (CST.002) | C5 + C6 + C3 (enforcement) | C9 sets phase; C5 reduces loops, C6 blocks writes, C3 blocks external sends below threshold |
| Suggestion delivery | C9 (proactive_suggestions) | C7 (ALR.* notification centre) | C9 ranks + routes; C7 delivers to dashboard/chat/push |
| Command dispatch | C9 (CMD.001–008) | C8 + C5 + C6 + C2 + C7 (home components) | C9 dispatches to home; each component executes; result returned with pill |
| Clarification requests | C8 (ORC.006 low-confidence) | C9 (CST.002 cold-start gating) | C8 may route low-confidence to clarification; C9 cold-start suppresses proactive clarification reqs below threshold |
| Answer-mode pill | C4 (CID.006 definition) + C2 (RET.007 [Building] flag) | C9 (SUG.003 reasoning+pill) | C4 defines pill types; C2 produces [Building]; C9 attaches to every suggestion |

### C10 ↔ Other Components

| Seam | From | To | Flow |
|------|------|-----|------|
| Erasure mechanics | C10 (DEL workflow) | C2 (MNT.017 transitive delete) | C10 owns request workflow + auth + audit; calls C2 to execute hard-delete + redaction |
| Log redaction | C10 (DEL workflow) | C7 (LOG.006/007 redaction-tombstone) | C10 erasure triggers C2 (MNT.017 amendment); C2 triggers C7 log redaction |
| Credential revocation | C10 (OFF.005 deprovision) | C3 (TOK.* revocation endpoints) | C10 invokes per-connector revocation during offboarding |
| First-boot seed | C10 (PRV.001 provisioning) | C0 + C1 (SEED / ROLE initial setup) | C10 script triggers; C0/C1 own seed logic (Internal Org, first Super Admin, roles) |
| Deployment freeze enforcement | C10 (OFF.004 retention freeze) | C5 (trigger/queue/loop dispatch gate) | C10 writes `deployment_settings.frozen_at` (client's own Supabase, via service_role); C5 reads locally, fails closed if frozen (OD-091 + OD-162) |
| Health-reporter push | C7 (MGM.001 reporter) | C10 (MGT.002 ingest endpoint) | C7 reporter pushes operational-metadata; C10 endpoint ingests, authenticates by internal_token, updates client_registry + health store |
| Cross-deployment alerts | C10 (status lifecycle + migration failures) | C7 (MGM.004 cross-deployment alerts) | C10 owns status + migration isolation; C7 fires alerts on skew / stale / migration-failure |
| Management-plane RBAC | C1 (roles + permissions) | C10 (provisioning + offboarding authority) | C1 defines six roles; C10 gates provisioning/offboarding to operator/Super Admin |

---

## OD-157 Launch-Gating Spikes Coverage

### Spike Status

| AF | Title | C7 | C8 | C9 | C10 | Status |
|----|-------|----|----|----|----|--------|
| **AF-068** | Hard-limit containment (red-team C6 injection + Comms/Finance) | ALR.002/003 | SPC.003/004 | MODE.002/003 | OFF.005 | Build-time SPIKE |
| **AF-069** | Alert escalation (no silent drop on unacknowledged) | ALR.005 | ORC.006 (clarif ↔ SUG.001.4) | SUG.001.4 | DEL.001 | Build-time SPIKE |
| **AF-067** | RLS latency at retrieval | — | SCO.001 (inherited from C2) | — | — | Build-time (carry-in C2) |
| **AF-078** | Webhook delivery (Slack validity) | ALR.009 (webhook config + validation) | — | — | — | Build-time SPIKE |
| **AF-077** | Brute-force / rate-limiting (not direct C7-C10) | — | — | — | — | C0/C1/C3 owned |

### FR Gatings by Spike

**AF-068 (Hard-Limit Containment):**
- C7: FR-7.ALR.002 (hard-limit hit always surfaces), FR-7.ALR.003 (routed to admin)
- C8: FR-8.SPC.003 (Comms no autonomous send, hard limit), FR-8.SPC.004 (Finance no transactions, hard limit)
- C9: FR-9.MODE.002 (high-risk → Suggest, never Act), FR-9.MODE.003 (proactive actions same C6 pipeline)
- C10: FR-10.OFF.005 (deprovision never partial-silent; each sub-step hard limit on failure)

**AF-069 (Alert Escalation):**
- C7: FR-7.ALR.005 (unacknowledged alert → secondary alert after window, never auto-cleared)
- C8: FR-8.ORC.006 (low-confidence → clarification request escalates if un-answered, OD-077)
- C9: FR-9.SUG.001.4 (stuck-`generated` suggestion escalates after delivery timeout, reusing escalate-don't-abandon)
- C10: FR-10.DEL.001 (un-actioned erasure request escalates on timeout, legal obligation)

**AF-078 (Webhook Delivery):**
- C7: FR-7.ALR.009 (unroutable alert fails loud; SLACK_WEBHOOK_URL validation; delivery-failure surfaced)

**AF-067 (RLS Latency):** Inherited from C2; C8 SCO.001 consumes C2's retrieval scope enforcement.

---

## Vertical-Slice Grouping Proposal

### Grouped by Cross-Component Data Lifecycle

**Slice 1: Event Logging + Observability (C7 LOG/RTP focus)**
- FR-7.LOG.001–008 (event_log schema, retention, redaction-tombstone, config_audit_log)
- FR-7.RTP.001–004 (real-time/polling contract, subscription lifecycle)
- Rationale: Foundational data backbone for all observability; no external dependencies beyond schema
- Touch: C7 event_log, C2 access_audit (retention floor), C10 legal review (retention periods)

**Slice 2: Alerting + Escalation (C7 ALR focus + C8 ORC.006 + C9 SUG.001.4)**
- FR-7.ALR.001–009 (notification centre, seven alert rules, routing, escalation-window, delivery durability, alert-engine watchdog, unroutable-fails-loud)
- FR-8.ORC.006 (low-confidence clarification, OD-077 escalate-don't-abandon)
- FR-9.SUG.001.4 (stuck-suggestion escalation)
- Rationale: Unified escalation + no-silent-drop across all three components; shared C7 delivery backbone
- Touch: C7 ALR.* delivery, C8 ORC clarification request queue, C9 proactive-suggestions lifecycle

**Slice 3: Orchestration + Agent Registry (C8 ORC/REG focus + C9 CMD custom commands)**
- FR-8.ORC.001–008 (7-step orchestrator, confidence check, plan versioning, self-representation)
- FR-8.REG.001–006 (agents table, Layer-1 resolution, auto-discovery, version discipline, seeding)
- FR-9.CMD.006–008 (custom commands: definition, dispatch registration, invocation)
- Rationale: Agent system as data-driven + discoverable; custom commands extend agent dispatch
- Touch: C8 agents table + prompt_layers, C9 commands table, C5 execution_plan consumption

**Slice 4: Agent Scoping + Memory Access (C8 SCO + C2 retrieval wiring via OD-081)**
- FR-8.SCO.001–003 (per-agent memory scope, clearance intersection, scope in registry)
- AC-5.ASM.006.2 (C5 passes scope to C2), AC-2.RET.004.2 (C2 applies agent-scope predicate)
- Rationale: Least-privilege access control; tight cross-component wiring (OD-081 change-control)
- Touch: C8 agents.memory_scope, C5 run pipeline, C2 retrieval filtering

**Slice 5: Proactivity Modes + Cold-Start Gating (C9 MODE/CST focus)**
- FR-9.MODE.001–004 (Suggest/Prepare/Act mapping, no-bypass same guardrails, autonomy matrix with floor, OD-161 Act removal)
- FR-9.CST.001–007 (phase matrix, proactive suppression, external-write block, loop reduction, per-entity framing)
- Rationale: Gating policy + risk-tier mapping; tight integration with C2 (Maturity phase) + C6 (approval tiers)
- Touch: C2 FR-2.MAT.002 per-entity phase, C6 FR-6.APR.001 approval tiers, C5 loop scheduling, C3 external-send blocking

**Slice 6: Proactive Generators + Suggestion Lifecycle (C9 PRO/SUG focus)**
- FR-9.PRO.001–007 (seven scanners: relationship, meeting, document, derisking, opportunity, briefing, pattern)
- FR-9.SUG.001–005 (persistence, ranking, reasoning+pill, delivery routing, dismissal-learning-with-floor)
- Rationale: Proactive generation pipeline; independent of cold-start gates (can be tuned separately)
- Touch: C9 proactive-suggestions store + signal-weights, C7 ALR notification delivery, C2 Maturity (for per-entity cold-start only)

**Slice 7: Chat Commands (C9 CMD focus)**
- FR-9.CMD.001–005 (command dispatch, node-gating, destructive-confirm, pill+logging, mobile menu)
- Rationale: System command backbone; custom-command FRs (006–008) can follow after this baseline
- Touch: C9 command registry, C1 permission nodes (CMD.002), C7 event_log (CMD.004)

**Slice 8: Provisioning + Management Plane (C10 PRV/MGT focus)**
- FR-10.PRV.001–004 (provisioning script, per-client OAuth, canary fixture, client-side runbook)
- FR-10.MGT.001–004 (`client_registry` schema + status lifecycle, ingest endpoint, push-only data flow, internal_token lifecycle)
- Rationale: Foundational deployment + cross-deployment infrastructure; enables all per-deployment operations
- Touch: C10 client_registry (management plane), C7 health-reporter push, C0/C1 first-boot seed

**Slice 9: Release Model + Schema Migration (C10 DEP/MIG focus)**
- FR-10.DEP.001–005 (Railway per-project auto-deploy, canary/train gate, rollback, version reporting, plugins out-of-train)
- FR-10.MIG.001–002 (per-deployment migrate-on-release, failure isolation + alert)
- Rationale: Blast-radius + safety controls; expand-contract discipline as binding constraint
- Touch: C10 deployment version reporting, C7 FR-7.MGM.004 (cross-deployment alerts + version grid)

**Slice 10: Individual Erasure (C10 DEL focus + C2 FR-2.MNT.017 transitive delete)**
- FR-10.DEL.001–007 (6-step erasure: queue, identify, id-removal+hard-delete, scrubbing, audit-log, connector-flag+two-person-auth, frozen-deployment check)
- Rationale: High-stakes compliance workflow; tight cross-component wiring (C2 erasure, C7 log redaction, C3 revocation, C1 roles)
- Touch: C10 deletion_requests queue + audit, C2 FR-2.MNT.017 (transitive), C7 AC-7.LOG.006.3 (log redaction), C3 FR-3.TOK.* (revocation), C1 PERM-memory.delete

**Slice 11: Client Offboarding (C10 OFF focus)**
- FR-10.OFF.001–006 (6-step offboarding: trigger, export+verify, client-sign-off, freeze+frozen-status, deprovision, meta-record)
- Rationale: Highest-stakes workflow; airtight deletion-evidence via physical isolation (Silo model)
- Touch: C10 offboarding_records (management), C5 deployment freeze gate (OD-091), C3 revocation, ADR-008 off-platform backup flag

**Slice 12: Data Isolation + Residency (C10 ISO focus)**
- FR-10.ISO.001–003 (`client_slug` removed from app tables, physical isolation, v1 region lock)
- Rationale: Architectural invariants; enable offboarding deletion-evidence
- Touch: C10 deployment model, Phase-4 schema authoring, C7 staleness framing (ISO.001 status reconciliation)

**Slice 13: Legal Compliance (C10 LEG focus)**
- FR-10.LEG.001 (mandatory legal review before regulated data)
- Rationale: Gate to regulated features; jurisdictional safeguard
- Touch: C10 retention floors (FR-10.RET.002), HR content enablement

---

## Summary: Compact Digest

### C7 Observability (35 FRs)
| Area | FRs | Label |
|------|-----|-------|
| LOG | 8 | Event log + three audit sinks, retention, redaction |
| RTP | 4 | Real-time/polling hybrid, per-silo budget |
| ALR | 9 | Alerting backbone, escalation, durability, watchdog |
| COST | 4 | Estimate-grade meter, per-task aggregation, ladder trigger |
| MGM | 5 | Health-reporter push, staleness, deployment grid |
| VIEW | 3 | Five role-based dashboard contracts |
| OPT | 2 | Feedback-flywheel + benchmarking substrate |

### C8 Agent Design (37 FRs)
| Area | FRs | Label |
|------|-----|-------|
| ORC | 8 | Orchestrator 7-step, registry-driven, confidence gate |
| REG | 6 | Agents table, Layer-1 resolution, version discipline |
| SPC | 6 | Eight single-domain specialists, hard limits |
| SCO | 3 | Per-agent memory scope retrieval filter (OD-081 wired) |
| PLAN | 4 | Failure mode per step, outcome tracking |
| HLTH | 4 | Success rate, drift, dead-agent, producer liveness |
| LRN | 3 | Learning loop, scope-aware cache (OD-076) |
| COST | 3 | Per-route cost model, confidence dial |

### C9 Proactive Intelligence (31 FRs)
| Area | FRs | Label |
|------|-----|-------|
| MODE | 4 | Suggest/Prepare/Act from C6 tiers, autonomy matrix (no Act, OD-161) |
| PRO | 7 | Seven independent scanners (on by default, configurable) |
| SUG | 5 | Persistence, ranking, reasoning+pill, learning-with-floor |
| CST | 7 | Cold-start phase matrix, suppression, external-write block, per-entity |
| CMD | 8 | Command dispatch, node-gating, destructive-confirm, custom commands |

### C10 Infrastructure & Compliance (34 FRs)
| Area | FRs | Label |
|------|-----|-------|
| RET | 2 | Intentional retention, configurable floors |
| DEL | 7 | Individual erasure 6-step (deterministic+probabilistic, audit, two-person auth) |
| OFF | 6 | Offboarding 6-step (export+verify, freeze, deprovision, meta-record) |
| PRV | 4 | Provisioning script, per-client OAuth, canary, client-side runbook |
| MGT | 4 | Client_registry schema, ingest endpoint, push-only, internal_token |
| DEP | 5 | Railway auto-deploy, canary/train gate, rollback, version reporting |
| MIG | 2 | Per-deployment migrate, failure isolation + alert |
| ISO | 3 | Client_slug deleted (app tables), physical isolation, residency v1 |
| LEG | 1 | Mandatory legal review before regulated data |

### Cross-Component Seams (1-Line Each)

| Seam | Flow |
|------|------|
| Event log sources → C7 | C2/C3/C5/C6/C8/C9 write events; C7 persists + retains + exports |
| Alert delivery (C5 stale + C6 hard-limit) → C7 | C5/C6 emit; C7 delivers to dashboard/Slack/mobile |
| Health metrics (C2/C3/C5/C8) → C7 | Producers compute; C7 displays in dashboards |
| Cost accounting (C5 run pipeline) → C7 | C5 emits per-event cost; C7 aggregates + meters + triggers ladder |
| Cost-ladder enforcement (C7 meter) → C6 + C5 | C7 detects breach + signals; C6 decides (throttle/kill); C5 executes |
| Insight Agent output (C8 + C9 PRO) → C7 | C8/C9 produce; C7 surfaces via notification centre |
| Suggestion delivery (C9) → C7 | C9 ranks + routes; C7 delivers dashboard/chat/push |
| Memory scope (C8 registry) → C5 + C2 | C8 defines; C5 (AC-5.ASM.006.2) passes to C2 (AC-2.RET.004.2 filters); OD-081 wired |
| Agent-health metrics (C8) → C7 + C9 | C8 produces; C7 displays; C9 uses for ranking |
| Result cache (C8) → C5 | C8 invalidates on write; C5 checks before invoking |
| Failure-mode assignment (C8) → C5 | C8 assigns retry/skip/halt per step; C5 executes |
| Cost-routing dial (C8) → C7 + C6 | C8 produces model; C7 meters; C6 enforces |
| Cold-start phase (C2 Maturity) → C9 + C5 + C6 + C3 | C2 emits per-entity phase; C9/C5/C6/C3 consume for suppression/gate |
| Command dispatch (C9) → C8/C5/C6/C2/C7 | C9 dispatches to home; each executes; C9 returns with pill |
| Clarification queue (C8 ORC.006) → C9 CST (cold-start gating) | C8 low-confidence may route to clarification; C9 suppresses in cold start |
| Erasure mechanics (C10 DEL) → C2 FR-2.MNT.017 | C10 owns request workflow + auth + audit; calls C2 transitive delete |
| Log redaction (C10 DEL) → C7 LOG.006/007 | C10 erasure triggers C2 (MNT.017 amendment); C2 triggers C7 redaction |
| Credential revocation (C10 OFF) → C3 TOK.* | C10 invokes per-connector endpoints during offboarding |
| First-boot seed (C10 PRV) → C0 + C1 | C10 script triggers; C0/C1 own seed logic |
| Deployment freeze (C10 OFF.004) → C5 dispatch gate | C10 writes `frozen_at` (client's own Supabase); C5 reads locally, fails closed (OD-091/162) |
| Health-reporter push (C7) → C10 MGT.002 ingest | C7 reporter pushes metadata; C10 ingest authenticates, updates client_registry |

### OD-157 Spike Gating Summary

**Spikes with Phase-1 FR Coverage:**
- **AF-068** (Hard-limit containment) — **C7 ALR.002/003, C8 SPC.003/004, C9 MODE.002/003, C10 OFF.005**
- **AF-069** (Alert escalation) — **C7 ALR.005, C8 ORC.006, C9 SUG.001.4, C10 DEL.001**
- **AF-078** (Webhook delivery) — **C7 ALR.009**
- **AF-067** (RLS latency) — C8 SCO.001 (inherited from C2)

**Spikes NOT phase-1-gated (covered in earlier phases or deferred):**
- **AF-077** (Brute-force / rate-limiting) — C0/C1/C3 owned

### Suggested Issue Decomposition (Vertical Slices)

1. **Event Logging + Audit Backbone** (C7 LOG.001–008; Phase-4 schema + Phase-2 config)
2. **Real-Time / Polling Contract** (C7 RTP.001–004; Phase-2 config per surface)
3. **Alerting System** (C7 ALR.001–009; Phase-2 alert routing config)
4. **Cost Tracking** (C7 COST.001–003; C6 ladder FR owed; Phase-2 price table)
5. **Management Plane Infrastructure** (C10 PRV.001–004 + MGT.001–004; ops runbooks)
6. **Release Model + Schema Migration** (C10 DEP.001–005 + MIG.001–002; expand-contract build-time)
7. **Orchestrator + Agent Registry** (C8 ORC.001–008 + REG.001–006; Phase-2 config)
8. **Agent Scoping + Memory Access** (C8 SCO.001–003 + OD-081 C5/C2 wiring via change-control)
9. **Proactivity Modes + Cold-Start Gating** (C9 MODE.001–004 + CST.001–007; Phase-2 config + C2 Maturity handoff)
10. **Proactive Generators + Suggestions** (C9 PRO.001–007 + SUG.001–005; Phase-2 scanner config)
11. **Chat Command System** (C9 CMD.001–008; Phase-2/3 command registry + UI)
12. **Individual Erasure Workflow** (C10 DEL.001–007 + C2 FR-2.MNT.017 transitive; C7 log redaction; C3 revocation; ops queue UI)
13. **Client Offboarding Workflow** (C10 OFF.001–006; ops wizard UI; C5 freeze gate wiring via OD-091/162)
14. **Data Isolation + Residency** (C10 ISO.001–003; Phase-4 schema enforcement)
15. **Legal Compliance Gate** (C10 LEG.001; onboarding checklist + retention floor validation)

