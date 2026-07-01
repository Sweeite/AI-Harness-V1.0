# Data-Model Harvest — C7 (Observability) + C8 (Agent Design)

> Mechanical extraction of every DB table/store defined in
> `spec/01-requirements/component-07-observability.md` and
> `spec/01-requirements/component-08-agent-design.md`.
> Fields listed only where the FR text actually names columns/types; where a store is
> referenced but its schema is not spelled out, that is noted as "columns not enumerated in C7/C8".

---

## Component 7 — Observability

### event_log  (C7, owner — end-to-end)
- **fields (verbatim column list, FR-7.LOG.001):**
  - `id`
  - `task_id`
  - `event_type`  (enum, see below)
  - `entity_ids`
  - `summary`  (plain-English, single-sentence "what happened and why"; never empty for any event type — AC-7.LOG.002.2)
  - `payload`  (structured machine detail)
  - `duration_ms`  (execution time; captured for every event with a measurable span — AC-7.LOG.004.2)
  - `cost_tokens`  (estimate-grade token cost per ADR-003; see cost_unknown sentinel below)
  - `created_at`
  - **`client_slug` is DROPPED intra-silo** (OD-067 → single-tenant silo; AC-7.LOG.001.3: "No `event_log` row carries a `client_slug` column within a client deployment"). Slug is not present at all.
- **enums — `event_type` (the 8-value set, verbatim, FR-7.LOG.001 / L3050–3052):**
  - `task_started`
  - `tool_called`
  - `memory_read`
  - `memory_written`
  - `guardrail_hit`
  - `approval_requested`
  - `task_completed`
  - `task_failed`
  - (An event with an `event_type` outside this set is rejected, not silently coerced — AC-7.LOG.001.2.)
- **rls_notes:** single-tenant silo (ADR-001 §3) — no `client_slug`, no multi-tenant RLS key. Tokens/secrets/credentials never appear in `summary`, `payload`, or any field (FR-7.LOG.005 / AC-7.LOG.005.1; C3 token-no-leak L2231).
- **index_notes:** retention = per-deployment configurable window with an **operational floor** (numeric floor deferred to C10/Phase-5). A row is never pruned while still referenced by an open task/approval/cleanup item; every pruning run is itself logged (FR-7.LOG.006 / AC-7.LOG.006.1/.2). Polled by the event-log surface at 60s (or on-demand) — FR-7.RTP.002.
- **constraints:**
  - **Append-only** — rows never UPDATEd or DELETEd in place; retention pruning (LOG.006) is the only removal path. A write that would UPDATE/DELETE an existing row (outside the retention job) is rejected at the data layer (AC-7.LOG.001.1).
  - **Completeness invariant** — every task has exactly one terminal event (`task_completed` XOR `task_failed`); a task with a terminal `task_queue` status but no terminal `event_log` row is flagged as a silent failure (AC-7.LOG.003.1). A log-write failure surfaces via an out-of-band degraded path (local stderr/file + a `log-write-failing` health bit on the mgmt-plane push), never only through the same DB substrate that failed (AC-7.LOG.003.2, AF-119).
  - **Cross-sink reconciliation** — periodic pairing check: every `guardrail_log` row must have its `event_log` `guardrail_hit` counterpart and vice-versa (AC-7.LOG.003.3).
  - **cost_unknown sentinel** — a genuinely costless event records `0`; an event whose cost could not be computed records a distinct **`cost_unknown` sentinel/flag**, never a silent `0` (AC-7.LOG.004.1). Model/tool-call events carry a non-null `cost_tokens`.
  - **Redaction-tombstone on erasure (OD-074)** — compliance erasure scrubs PII fields (`summary`, `entity_ids`) in place while retaining row existence + audit metadata (`created_at`, `event_type`, `task_id`, outcome); the erasure is itself logged (AC-7.LOG.006.3). Triggered by C2 FR-2.MNT.017 (AC-2.MNT.017.4) / C10 FR-10.DEL.004.
- **source:** FR-7.LOG.001 (schema + enum), FR-7.LOG.002 (summary/payload semantics), FR-7.LOG.003 (completeness), FR-7.LOG.004 (duration/cost + cost_unknown), FR-7.LOG.005 (token-no-leak), FR-7.LOG.006 (retention + redaction-tombstone). Cites L3045–3064, L3050–3052.

### guardrail_log  (write-owner C6 · view/retention/tamper-evidence/export owner C7)
- **fields:** schema is **owned/enumerated by C6** (design L2887–2902; C6 FR-6.LOG.*). C7 does NOT re-spec its columns. C7 text names PII fields subject to erasure: `description` (the narrative/PII field), plus retained audit metadata (timestamp, event_type, task_id, outcome). Full column set: see C6 FR-6.LOG.* / L2887–2902 — not enumerated in C7.
- **enums:** hard-kill from the cost ladder is logged as a `rate_limit`-class event (FR-7.COST.003 / OD-068). (Full event-class enum lives in C6.)
- **rls_notes:** single-tenant (design's `client_slug` on L2896 is a moot label under ADR-001 §3 — reconciliation #1). No credential material.
- **index_notes:** C7-owned retention honors the **security/audit floor** (≥ the compliance minimum, never below it) — a pruning run never removes a row inside the floor window (AC-7.LOG.007.2). Exportable as client-facing trust evidence over a date range (AC-7.LOG.007.1).
- **constraints:**
  - **Append-only + tamper-evident** — any post-hoc modification is detectable via an integrity check (AC-7.LOG.007.3). The integrity check distinguishes an authorized redaction from tampering (AC-7.LOG.007.4).
  - **Export completeness** — an export over a range returns every row in range, no silent truncation (AC-7.LOG.007.1).
  - **Redaction-tombstone on erasure (OD-074)** — same in-place PII scrub as event_log, applied to `description`; security event + audit metadata retained; redaction is itself a tamper-evident, logged operation (AC-7.LOG.007.4).
- **source:** FR-7.LOG.007 (C7 side of OD-065). Cites L2902, OD-065, OD-072.

### config_audit_log  (write-owner = config save path · view/retention/tamper-evidence/export owner C7)
- **fields (named in FR-7.LOG.008 AC text — this is the "third audit sink"):**
  - `actor_id`  (the user attribution; redaction-tombstone target on user erasure — AC-7.LOG.008.4)
  - `key`  (the config key changed; key-prefix-scoped to caller's `PERM-config.*` nodes for reads — OD-155)
  - `old_value`
  - `new_value`
  - `changed_at`
  - (Every LIVE/BOOT/REBUILD change is audited who/when/old→new — `config-edit-taxonomy.md` rule 4. Full column set = surface-01 `config_audit_log` schema stub, referenced not fully enumerated in C7.)
- **enums:** change classes = LIVE / BOOT / REBUILD (from `config-edit-taxonomy.md` rule 4). SECRET edit class is read-only / never UI-editable, so SECRET rows never produce an audit row.
- **rls_notes:** read authority is **key-prefix-scoped to the caller's `PERM-config.*` nodes** (no separate view perm node — OD-155). Export gated by `PERM-compliance.download_records`. No credential material ever appears (`old_value`/`new_value` never secret values by construction — AC-7.LOG.008.5). Rendered on `UI-config-audit-log` (surface-01b, OD-099).
- **index_notes:** retention honors the audit/compliance floor — same floor as event_log/guardrail_log, ≥ the `individual_deletion_audit_years` legal minimum; a pruning run never removes a floor-window row and is itself logged (AC-7.LOG.008.2).
- **constraints:**
  - **Append-only + tamper-evident** — post-hoc modification detectable (integrity check, outside authorized retention pruning) — as immutable as guardrail_log (AC-7.LOG.008.3).
  - **All-or-nothing export** — export over a range + `PERM-config.*` key-prefix scope returns every matching row or fails loudly; a partial read aborts to error, never a silent partial file (AC-7.LOG.008.1).
  - **Redaction-tombstone on user erasure** — scrub `actor_id` attribution; retain change record (`key`/`old_value`/`new_value`/`changed_at`); erasure is itself tamper-evident + logged (AC-7.LOG.008.4). Carry-forward: config_audit_log owed to the C2/C10 erasure walk (Phase-4/C10).
- **source:** FR-7.LOG.008 (added via change-control 2026-07-01, session 43, closing OD-153). Cites OD-153, `standards/config-edit-taxonomy.md` rule 4, surface-01 schema stub; parallels FR-7.LOG.007 + FR-1.AUD.003.

### notification / notification-centre store (dashboard alerts)  (C7)
- **fields (named, not a full DDL):**
  - a **read/unread row** per dashboard notification (persisted first, independently of Slack) — FR-7.ALR.006 / OD-070.
  - each alert also carries an **escalation window** + a **routing chain** (FR-7.ALR.005 / OD-069).
  - (No explicit column-by-column schema given; C7 defines the durability + lifecycle contract, not the table DDL.)
- **enums:** the **seven alert rules / alert types** (FR-7.ALR.002): `task failure spike` · `queue backup` · `memory confidence drop` · `approval queue stale` · `hard limit hit` · `cost threshold breach` · `loop missed`.
- **rls_notes:** routing-by-type resolves through C1 roles/permissions (FR-7.ALR.003); a stale-approval alert routes to the specific reviewer, not broadcast. An unresolvable routing target escalates, never silently dropped (AC-7.ALR.003.2 / FR-7.ALR.005).
- **index_notes:** dashboard notification persists as read/unread **until actioned**, reachable from every view (FR-7.ALR.001 / AC-7.ALR.001.2). Realtime-delivered (one of the two trust-critical Realtime surfaces — FR-7.RTP.001).
- **constraints:**
  - **Dashboard-first, persisted-before-fan-out** — dashboard notification persisted first + independently; Slack is best-effort fan-out off the persisted row; a Slack failure never loses the dashboard row and is itself surfaced (FR-7.ALR.006 / AC-7.ALR.006.1/.2).
  - **Escalate-don't-abandon** — unacknowledged alert fires a secondary alert at end of escalation window; a critical/hard-limit alert never auto-resolves by timeout — stays visible/escalated until a human actions it (FR-7.ALR.005 / AC-7.ALR.005.1/.2).
  - **Server-authoritative time** — all escalation-window / staleness / "N hours" / daily-weekly math uses a single server-authoritative timestamp (AC-7.ALR.005.3, AF-120).
  - **Every alert logged** — each raised alert has a corresponding `event_log` row, independent of delivery success (FR-7.ALR.004).
  - **Watchdog** — the alert-evaluation engine emits a heartbeat; an independent watchdog raises a critical alert if it stalls (FR-7.ALR.008, AF-118).
  - **hard limit hit is non-suppressible** — immediate dashboard + Slack, always, not suppressible by config (AC-7.ALR.002.2); quiet_hours can never silence a critical/hard-limit alert (AC-7.ALR.009.2).
- **source:** FR-7.ALR.001–009 (esp. ALR.005 escalation, ALR.006 durability). Cites L3288–3315, OD-069, OD-070, OD-097.

### alert_routing config store  (C7 — Phase-2 registry / config, not an audit sink)
- **fields (verbatim config keys, FR-7.ALR.009):**
  - `alert_routing_rules`  (alert-type → {role, channel})
  - `escalation_contacts`  (role → contact list)
  - `quiet_hours`
  - `alert_email_enabled`
  - `SLACK_WEBHOOK_URL`  (secret)
- **rls_notes:** Phase-2 registry at `UI-config-admin#observability`, gated by `PERM-config.observability`. C1 roles remain recipient authority.
- **index_notes:** —
- **constraints:**
  - **Unroutable-alert-fails-loud** — an alert resolving to no deliverable destination persists on the dashboard notification centre AND raises a distinct "alert delivery misconfigured" critical condition routed to Super Admin + carried on the mgmt-plane push (AC-7.ALR.009.1).
  - **Write-time validation / fail-closed** — a config write that would leave a critical-alert type with no resolvable destination is rejected at config time (AC-7.ALR.009.3).
  - **quiet_hours** suppresses only non-critical alerts; critical/hard-limit always delivered (AC-7.ALR.009.2).
  - runtime-invalid `SLACK_WEBHOOK_URL`/channel surfaced as delivery-failure, dashboard unaffected (AC-7.ALR.009.4).
- **source:** FR-7.ALR.009 (change-control session 28, closing OD-097).

### cost meter / cost-tracking store  (C7)
- **fields / structure (named, not a full DDL):**
  - per-event `cost_tokens` (lives on **event_log**, see FR-7.LOG.004) — the raw input.
  - a **running per-deployment spend total** (the "cost meter", FR-7.COST.003).
  - an **operator-editable price table** — token counts × price per vendor (incl. OpenAI embeddings), rounded up (FR-7.COST.001 / AC-7.COST.001.1). Price table is per-deployment editable; changing a price re-bases subsequent estimates.
  - cost **aggregated per task type** from day one (FR-7.COST.002 / AC-7.COST.002.1) — queryable/groupable by task type.
- **enums:** cost-ladder tiers (thresholds, per-deployment tunable, FR-7.COST.003): **soft alert** ($50/day + $200/week) → **throttle non-critical** ($75) → **hard kill** ($100).
- **rls_notes:** estimate-grade only — never the vendor invoice (ADR-001 boundary forbids reading client billing); figures labelled/treated as estimates (AC-7.COST.001.2).
- **index_notes:** cost-tracking surface polls every 5m (FR-7.RTP.002). Aggregation populated from the first task, not retrofitted (AC-7.COST.002.2).
- **constraints:**
  - **Estimate-grade / rounded up / never-invoice** (FR-7.COST.001).
  - **cost_unknown sentinel** — see event_log; a blind cost meter must be detectable, not averaged in as free (AC-7.LOG.004.1).
  - **Meter/enforce split (OD-068)** — C7 meters + detects breach + fires alert + emits breach signal; **C6 enforces** (throttle/kill), **C5 executes**. C7 does not itself throttle/kill (AC-7.COST.003.2/.3). Owed C6 cost-ladder enforcement FR is a tracked carry-forward.
  - crossing soft threshold fires the cost-threshold-breach alert (FR-7.COST.004 / AC-7.COST.004.1).
- **source:** FR-7.COST.001–004. Cites ADR-003, L3308–3309, L3321, OD-068.

### management-plane health-reporter push / snapshot store  (C7 — mgmt plane)
- **fields (allow-listed operational-metadata-only snapshot payload, FR-7.MGM.001/003):**
  - `health_score` (health score)
  - `queue_depth` (queue depth)
  - `alert_counts` (open/alert counts)
  - `core_version`
  - `last_active` / freshness timestamp (FR-7.MGM.002 — snapshot freshness timestamp)
  - `approval_queue_depth` (rendered on the deployment card, FR-7.MGM.003)
  - backup-health signal (FR-7.MGM.005 — sourced remotely via Supabase Management API `GET /v1/projects/{ref}/database/backups`)
  - a `log-write-failing` health bit (carried on the push, from AC-7.LOG.003.2)
  - "and similar operational signals" — allow-listed set, not exhaustively enumerated.
  - Deployment cards keyed on the management-plane **`client_registry`** (FR-7.MGM.003) — the only place client identity lives (see reconciliation #1; `client_registry` is an ADR-001 mgmt-plane table, referenced not specced in C7).
- **enums:** deployment card state includes `stale` / `unreachable` (vs healthy/green) — FR-7.MGM.002.
- **rls_notes:** **PUSH, operational-metadata-only** — no client business data (memories, entity content, message text, sensitive data) may cross the boundary; any business-data field is rejected before send (AC-7.MGM.001.1). The mgmt plane never pulls client data (AC-7.MGM.001.2) — "a map, not a warehouse." Card click-through navigates INTO the client deployment, not a mgmt-plane copy (AC-7.MGM.003.2).
- **index_notes:** configurable **staleness window**; a snapshot older than the window flips the card to stale/unreachable (FR-7.MGM.002).
- **constraints:**
  - **Stale-not-green** — absence of signal is itself a signal; a stale deployment raises a cross-deployment alert, never rendered healthy (AC-7.MGM.002.1/.2).
  - **Independent-heartbeat staleness evaluator** — staleness runs on an independent heartbeat (not a one-shot poll); a stalled evaluator is itself surfaced (AC-7.MGM.002.3, AF-118).
  - **Server-authoritative timestamp** for the staleness window — not a reporter-asserted clock (AC-7.MGM.002.4, AF-120).
  - reporter logs each push attempt/failure to the **local** event_log so an unreachable deployment surfaces on its own dashboard (AC-7.MGM.001.3).
- **source:** FR-7.MGM.001–005. Cites ADR-001 §7, ADR-008, L3188–3202, OD-071, reconciliation #2.

### C7 — explicit "no client_slug" / "consolidated in Phase 4" / seam statements
- `event_log` `client_slug` **dropped intra-silo** (OD-067, reconciliation #1) — AC-7.LOG.001.3.
- `guardrail_log` `client_slug` (design L2896) and the Realtime `client_slug=eq.…` filters (L3085, L3159) are a **moot label / no-op** intra-silo (reconciliation #1); Realtime filter reduces to `status=eq.awaiting_approval` (OD-067). AC-7.RTP.003.3: Realtime filter within a silo does not depend on `client_slug`.
- Client identity lives **only** at the management-plane `client_registry` (reconciliation #1, FR-7.MGM.003).
- `event_log` / `access_audit` (C1, OD-024) / `guardrail_log` (C6) are **three distinct append-only sinks** (OD-065, reconciliation #4); `config_audit_log` is the **third audit sink** (FR-7.LOG.008 — note: C7 counts event_log+guardrail_log+config_audit_log as its three; access_audit retention seamed from C1 OD-024).
- No explicit "consolidated in Phase 4" phrasing in C7 for a table; the migration to drop `agents.system_prompt` is "Phase 4/6" but that is a C8 statement (see below). C7 numeric retention floors are deferred to **C10/Phase-5** (FR-7.LOG.006/007/008).

---

## Component 8 — Agent Design

### agents  (C8, owner — the agent registry table)
- **fields (verbatim column list, FR-8.REG.001 / L3499–3517):**
  - `id`
  - `name`  ('{client_slug}_<role>_agent' — the slug is part of the **human-readable name string only**, NOT a column)
  - `description`  (the routing signal; empty description rejected at write — AC-8.REG.001.2)
  - `memory_scope`  (json — the per-agent scope matrix; see SCO area)
  - `tools_allowed`  (uuid[] — references C3 tool ids)
  - `max_tokens`
  - `enabled`  (boolean — gates routing discovery; FR-8.REG.005)
  - `version`
  - `created_at`
  - `updated_at`
  - `created_by`
  - `previous_version_id`  (immutable-history link)
  - `change_reason`  (mandatory, non-empty on every edit — AC-8.REG.004.1)
- **CONFIRMED ABSENT columns:**
  - **NO `system_prompt` column** — removed / derived (OD-075, closing OD-048). Layer-1 resolves solely from `prompt_layers` keyed by `agent_id` (`layer='core'`) — FR-8.REG.002. AC-8.REG.001.1: schema carries "**no** `system_prompt` storage column." Legacy/migrated rows migrate system_prompt into `prompt_layers` then drop the column (one-time migration, **Phase 4/6** — FR-8.REG.002 branches).
  - **NO `model` column** — not present in the enumerated column list. (Model is stated in prose only: orchestrator model = `claude-sonnet-4-6`, L158/notes on FR-8.ORC.001 — it is NOT a registry column.)
  - **NO `client_slug` column** — dropped intra-silo (ADR-001 §3, mirrors C7 OD-067); slug survives only inside the `name` string (AC-8.REG.001.3).
- **rls_notes:** capability-grant edits (`memory_scope` / `tools_allowed` / `enabled`) = **Super Admin only**; `description` / routing-weight tuning = Super Admin + Admin (OD-080). Mandatory `change_reason` + audit on every change. Orchestrator + specialists run `service_role` on the agent path (C1 FR-1.RLS.007).
- **index_notes:** seeded at provisioning (orchestrator + 8 specialists) then authoritative/operator-editable (FR-8.REG.006, idempotent re-run). Registry read by the orchestrator at routing step 3 (`WHERE enabled = true`).
- **constraints:**
  - **Empty `description` rejected at write** (AC-8.REG.001.2).
  - **Immutable version history** — an edit creates a new version, increments `version`, sets `previous_version_id`, requires non-empty `change_reason`, writes an audit row; prior versions never overwritten in place (FR-8.REG.004).
  - **`enabled` gates discovery** — a disabled agent is retained but never a routing candidate; disabling the sole agent for a domain surfaces a warning at disable-time (AC-8.REG.005.3) and future such tasks route to clarification, never silent drop (AC-8.REG.005.2).
  - **Negative-invariant tool guards (reject-at-write, not just audit):** a registry edit adding an autonomous-send tool to the **Comms** Agent's `tools_allowed` is rejected at write (AC-8.SPC.003.3); adding a transaction-initiating tool to the **Finance** Agent is rejected at write (AC-8.SPC.004.3). Positive seed-time check: Comms excludes send tools, Finance excludes transaction tools (AC-8.REG.006.3).
  - **Sole memory-writer** — only the Memory Agent has memory-write capability in `tools_allowed` (ADR-004 single writer, AC-8.SPC.005.2).
  - **`memory_scope` is registry data, not code** — invalid scope spec rejected at write (FR-8.SCO.003).
- **source:** FR-8.REG.001–006, FR-8.SPC.003/004/005, FR-8.SCO.003, FR-8.ORC.008. Cites L3499–3517, OD-075, OD-080, ADR-001 §3, ADR-004.

### prompt_layers  (C4, owner — consumed/read by C8)
- **fields:** keyed by `agent_id`, `layer` (e.g. `'core'` for Layer 1). Columns owned/enumerated by **C4** (FR-4.LYR.001 / FR-4.STO.*) — NOT re-specced in C8. C8 only asserts it is the **single authoritative Layer-1 store** (no duplicate copy on the agents row).
- **constraints:** single source of truth for Layer 1 (OD-048/OD-075); assembly halts if no `core` layer exists (C4 FR-4.LYR.004).
- **source:** FR-8.REG.002. Cites OD-048, L3504, L2458–2469.

### agent metric store (agent-health / drift / dead-agent / routing-mismatch)  (C8 — producer)
- **fields / metrics produced (named, not a formal DDL — "metric store"):**
  - per-agent **health metrics**: `success_rate`, `failure_rate`, `last_run` — aggregated from task outcomes (FR-8.HLTH.001).
  - **drift score** per agent (recent behaviour vs intended scope), configurable `drift_threshold` (FR-8.HLTH.002, CFG-drift_threshold).
  - **dead-agent flag** (consistent-failure / low-quality), configurable `dead_agent_threshold` (FR-8.HLTH.003, CFG-dead_agent_threshold).
  - **routing-mismatch metric** — per-agent/task-type reroute patterns + per-candidate routing scores (FR-8.LRN.002 + FR-8.ORC.004 scores).
  - quality signal inputs (OD-078): task success/failure + answer-mode-pill distribution + human approval/rejection outcomes.
- **rls_notes:** C8 **produces** metrics only; C7 surfaces (polls ~60s, L3217), C9 turns into suggestions, a human decides. C8 never auto-acts (AC-8.HLTH.004.1).
- **index_notes:** read source = `event_log` (outcomes) + metric store. Agent-health panel polled by C7 ~60s (FR-7.RTP.002).
- **constraints:**
  - **Flag, never auto-correct / never auto-disable** (OD-078) — high failure rate, drift, dead-agent are all surfaced, not auto-acted (AC-8.HLTH.001.2 / .002.1 / .003.2). Prompt drift never auto-corrected (L3563).
  - **Producer liveness / heartbeat** — if any metric producer (health aggregator, dead-agent detector, routing-mismatch detector, drift check) stalls, its absence is surfaced to C7 as a stale/heartbeat signal, never shown as last-known-good green (AC-8.HLTH.004.2 / AC-8.HLTH.002.2; mirrors C5 AC-5.JOB.006.2).
- **source:** FR-8.HLTH.001–004, FR-8.LRN.002. Cites L3589, L3642–3644, L2846–2847, OD-078. Gated by AF-123/AF-124.

### agent result cache  (C8 — orchestrator learning / result caching)
- **fields (cache key + entry, FR-8.LRN.003):**
  - cache key = (`agent`, in-scope `entity_ids`, their `last-write` / `memory_version`).
  - cached agent **output** (per-agent configurable window).
  - per-agent-type window config (CFG-cache_time_window, L952–960): research 30 / client 60 / campaign 60 / comms 15 / ops 120 / finance 120 / insight 1440 (minutes).
- **rls_notes:** —
- **index_notes:** cache hit/miss + invalidations logged as a cost signal (FR-8.LRN.003 observability).
- **constraints:**
  - **Scope-aware + time-bounded invalidation (OD-076, #1)** — reused within window only if no in-scope entity changed; a write to any in-scope entity invalidates the entry. Never serves stale knowledge.
  - **Write-triggered invalidation** — invalidation is triggered by the Memory Agent's commit (the sole writer = single nameable "entity X changed" producer), not only a best-effort poll (AC-8.LRN.003.2).
  - **Miss-on-uncertainty (blind-spot-fails-safe)** — if it's uncertain whether a write is in-scope (low entity-extraction confidence, or a write to an entity class read but not the specific keyed id), miss-and-recompute rather than risk a stale hit (AC-8.LRN.003.3).
- **source:** FR-8.LRN.003. Cites L3603, L3630, L952–960, OD-076. Gated by AF-125.

### execution-plan store  (C8 — routing-plan versioning; execution owned by C5)
- **fields (named, not a formal DDL):**
  - versioned execution plan per common task type — plan `version` id, `previous_version_id`-style supersession link (a new version supersedes but never deletes the prior — audit).
  - per-step: assigned **failure mode** ∈ {retry, skip-and-continue, halt-and-escalate} (FR-8.PLAN.001), dependencies, parallel-eligible flag.
  - outcome attribution: success/failure/skip per step recorded against the plan version (FR-8.ORC.007 / PLAN.004).
  - the plan body itself is written into the **context envelope's `execution_plan` field** (C5 FR-5.ENV.*) — C8 populates, C5 owns the envelope.
- **rls_notes:** rollback = OD-080 (Super Admin/Admin per the split).
- **index_notes:** —
- **constraints:**
  - **Failure mode assigned upfront** — every step carries a mode at plan-build time, never chosen at failure time; unassigned step defaults to halt-and-escalate (FR-8.PLAN.001/002).
  - **chain_depth_limit** enforced at build time (default 6, CFG-chain_depth_limit, L948) — reject/trim, never silently truncate mid-execution (FR-8.PLAN.003).
  - **Human-decided rollback only** — no automatic rollback (OOS-030, OD-010); rollback human-initiated + audited (AC-8.PLAN.004.2).
  - **Idempotent re-route** — a crash between dequeue (step 1) and plan-persist (ORC.007) returns the task to a re-routable queue state; never dequeued-but-unplanned (AC-8.ORC.001.3).
  - **Outcome-write-failure secondary sink** — an outcome write failure surfaces through a secondary sink/heartbeat distinct from the failed channel (AC-8.ORC.007.2).
- **source:** FR-8.ORC.005/007, FR-8.PLAN.001–004. Cites L3407–3416, L3483–3493, L3646, OOS-030.

### routing / learning model (routing weights)  (C8)
- **fields / config:** routing score per candidate from four weighted factors (domain match, complexity fit, memory-scope fit, tool-scope fit) — CFG-routing_weights (L3404, "all weights configurable"). Orchestrator confidence threshold — CFG-orchestrator_confidence_threshold (default 0.75, L947). Learning refines routing scoring/selection from tracked outcomes (FR-8.LRN.001), adjustments observable + reversible.
- **constraints:** learning adjustments logged/attributable (AC-8.LRN.001.1); a degrading update detectable via HLTH.001 + LRN.002. Confidence threshold is the primary cost/quality dial (FR-8.COST.002).
- **source:** FR-8.ORC.004, FR-8.LRN.001, FR-8.COST.002/003. Cites L3403–3405, L3572, L3640, ADR-003, OD-068.

### per-agent memory_scope matrix  (C8 — a `memory_scope` json column on `agents`, applied as a retrieval filter)
- **This is not a separate table** — it is the `memory_scope` (json) column on `agents`, but harvested here because FR-8.SCO.* define its semantics + the seed matrix.
- **seed scope matrix (verbatim, FR-8.SCO.001 / L3467–3476):**
  - Research — read-all
  - Client — semantic + episodic for client/contact
  - Campaign — semantic + episodic + procedural for campaign
  - Comms — semantic for brand/contact prefs
  - Ops — procedural SOPs + semantic team + Internal Org
  - Memory — full r/w
  - Finance — semantic contract/invoice only (Confidential clearance, finance-entity scoped — FR-8.SPC.004)
  - Insight — read-all, no-write
  - Orchestrator — semantic + entity model + tool registry (FR-8.ORC.008, L3476)
- **rls_notes / constraints:**
  - Applied as an **additional least-privilege retrieval filter** — the C5 run pipeline (FR-5.ASM.006) passes the running agent's scope into the C2 read flow (FR-2.RET.004), **in addition to** task clearance + task entities. An out-of-scope request returns empty without revealing existence (AC-8.SCO.001.2).
  - **Fail-closed** — if the agent-scope predicate is not applied (wiring missing/failed), retrieval returns nothing, never widens to the clearance-only set (AC-8.SCO.001.3). Especially load-bearing for the `service_role` orchestrator whose containment rests entirely on this filter (M5 note on ORC.008).
  - **Clearance on top of scope** — effective access = memory_scope ∩ task clearance; Restricted memory never auto-injected even for read-all agents (FR-8.SCO.002 / C2 FR-2.RET.006 / C1 FR-1.RST.003).
  - scope changes = Super Admin (OD-080), audited as capability changes; invalid scope spec rejected at write (FR-8.SCO.003).
  - OD-081 (the cross-component wiring) **RESOLVED + applied** via change-control (+AC-5.ASM.006.2 fail-closed, +AC-2.RET.004.2 narrow-within-clearance).
- **source:** FR-8.SCO.001/002/003, FR-8.ORC.008. Cites L3464–3479, OD-080, OD-081.

### C8 — explicit "no client_slug" / "consolidated / migrated in Phase 4" statements
- `agents` has **NO `client_slug` column** — dropped intra-silo (ADR-001 §3, mirrors C7 OD-067); slug survives only inside the `name` string (AC-8.REG.001.3). The design doc's `agents.client_slug` column was explicitly caught + dropped by the verification gate.
- `agents.system_prompt` **removed / derived** — one-time migration into `prompt_layers`, column dropped, "one-time migration, **Phase 4/6**" (FR-8.REG.002 branches; OD-075). No `model` column either (model is prose-only, `claude-sonnet-4-6`).
- Owed **C6 cost-ladder enforcement FR** is a tracked carry-forward (OD-068) — C8 only feeds the per-route cost model (FR-8.COST.003 notes).
- `config_audit_log` owed to the C2/C10 erasure walk = a **Phase-4/C10 carry-forward** (this is C7's AC-7.LOG.008.4, relevant to C8's agents/registry auditing but logged in C7).

---

## Table count summary

**C7 (7 stores):**
1. `event_log`
2. `guardrail_log` (C7 owns view/retention/tamper/export; C6 owns write schema)
3. `config_audit_log`
4. notification / notification-centre store
5. `alert_routing` config store
6. cost meter / cost-tracking store (incl. price table)
7. management-plane health-reporter push / snapshot store

**C8 (6 stores + the memory_scope matrix on `agents`):**
1. `agents` (registry — no system_prompt, no model, no client_slug)
2. `prompt_layers` (C4-owned, consumed)
3. agent metric store (health / drift / dead-agent / routing-mismatch)
4. agent result cache
5. execution-plan store (routing-plan versions)
6. routing / learning model (weights + confidence threshold)
7. per-agent `memory_scope` matrix (the json column on `agents`)

**Total distinct data stores harvested: 13** (counting `prompt_layers` as consumed-not-owned; the `memory_scope` matrix is a column on `agents`, not a separate table).
