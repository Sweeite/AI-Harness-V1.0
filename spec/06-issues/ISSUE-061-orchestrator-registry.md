---
id: ISSUE-061
title: Orchestrator + 7-step routing + agents registry
epic: H — agent design
status: blocked
github: "#61"
---

# ISSUE-061 — Orchestrator + 7-step routing + agents registry

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Stand up the data-driven agent layer's spine — the `agents` registry (schema, version discipline, `enabled`-gated discovery, canonical-roster seed) plus the single orchestrator that runs the seven-step routing process (classify → registry-read → score → build plan → confidence-check → version+log → outcome-track) — so specialists (062), scoping (063), plans (064), health (065), learning (066), and the run pipeline (053) build on one authoritative, discoverable registry and one place all routing decisions are made.

## 2. Scope — in / out
**In:**
- The `agents` registry table (schema §9) with all C8 columns and its invariants: non-empty `description` (routing signal), `memory_scope` json present, `tools_allowed` uuid[], `enabled` flag, version chain (`version`, `previous_version_id`, mandatory `change_reason`), **no `system_prompt` / no `model` / no `client_slug`** columns.
- Layer-1 resolution from `prompt_layers` (`agent_id`, `layer='core'`) — the C8 reconciliation that closes OD-048/OD-075; the one-time migration that drops any residual `agents.system_prompt` source of truth.
- Registry lifecycle: add-by-inserting-a-row auto-discovery, version-never-overwrite discipline with audit, `enabled` gates routing candidacy (disabled rows retained, sole-agent-disable warning), and the idempotent seed of the orchestrator + 8 canonical specialists at provisioning — **including the positive seed-time check that Comms holds no autonomous-send tool and Finance no transaction tool** (AC-8.REG.006.3, the seed-side of SPC.003/004's negative invariants).
- The orchestrator agent itself as a scoped registry row (its own Layer 1 + restricted `memory_scope`), and the full seven-step routing engine: task classification, registry-read (description-driven, never hardcoded), weighted candidate scoring, execution-plan construction (single vs chain, deps, parallel-eligible marks, a failure mode on every step), the confidence-check that raises human clarification below threshold and never silently auto-proceeds/parks, plan versioning + logging, and routing-outcome recording. Crash-window idempotency (never dequeued-but-unplanned) and the secondary-sink guarantee on outcome-write failure.
- The `PERM-config.agents` gate on registry edits, with OD-080's authority split (capability edits — `memory_scope`/`tools_allowed`/`enabled` — Super Admin only; `description`/routing tuning — Super Admin + Admin) enforced at the store, and the routing CFG keys read at runtime.

**Out:**
- **The eight specialist *definitions* + their per-agent hard limits** (Research read-only, Comms never-sends, Finance never-transacts, Memory sole-writer) — FR-8.SPC.* → **ISSUE-062**. This slice seeds the roster rows and the positive Comms/Finance seed check (REG.006.3); 062 owns the SPC behaviour FRs and the reject-at-write hard-limit invariants (AC-8.SPC.003.3/.004.3).
- **Per-agent `memory_scope` *enforcement* as a real retrieval filter** (SCO.001–003, the OD-081 C5/C2 wiring) — **ISSUE-063**. This slice stores `memory_scope` and seeds the matrix; 063 (with 025's retrieval) makes it an executable filter. ORC.008's containment claim depends on 063 landing.
- **Per-step failure-mode *assignment* semantics + outcome tracking + the `execution_plans` store's plan-structure ownership** (PLAN.001–004) — **ISSUE-064**. ORC.005 marks that every step carries a failure mode and ORC.007 writes plan versions/outcomes; 064 owns the failure-mode taxonomy, the `step_failure_mode` enum semantics, and the outcome model. The `execution_plans` table is created by whichever of {061,064} lands first via the shared migration; treat it as co-owned (see field 5).
- **Agent-health / drift / dead-agent metric production + producer heartbeat** (HLTH.*) — **ISSUE-065**; and **orchestrator learning + scope-aware result cache + cost-routing** (LRN.*, COST.*) — **ISSUE-066**. ORC.004/007 *emit* the per-candidate scores + plan outcomes those slices consume; they do not compute the metrics or the cache.
- **Failure-mode *execution* (retry/skip/halt), the context envelope, the run pipeline** — C5 → **ISSUE-050/052/053**. C8 assigns/hands off; C5 executes. ORC.005.3 writes the plan into the envelope's `execution_plan` field (C5 owns the envelope machinery).
- **Layer-1 prompt *content* + the `prompt_layers` store + version discipline** — C4 → **ISSUE-042/043**. This slice reads Layer 1 by `agent_id`; it does not author content.
- **The registry-editor / clarification / agent-health UI** (surface-09) — **ISSUE-067**. This slice defines the signals + the RBAC-routed need; Phase 3 renders.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs (all Component 8 — Agent Design):** FR-8.ORC.001, FR-8.ORC.002, FR-8.ORC.003, FR-8.ORC.004, FR-8.ORC.005, FR-8.ORC.006, FR-8.ORC.007, FR-8.ORC.008, FR-8.REG.001, FR-8.REG.002, FR-8.REG.003, FR-8.REG.004, FR-8.REG.005, FR-8.REG.006
- **NFRs:** none (no NFR domain maps to ORC/REG in the coverage ledger)
- **Rests on:** ADR-004 (concurrency — "the Memory Agent is the *only* writer" invariant the orchestrator must not violate; the orchestrator/specialists never write memory directly), ADR-005 (scripted provisioning — the seed roster, mirroring C1 OD-030), ADR-003 (cost estimate-grade — the confidence threshold is the highest-leverage cost/quality dial), ADR-007 (injection containment — retrieved memory/tool output is data, never instructions), ADR-001 §3 (physical per-client isolation — no `client_slug` column on the `agents` app table); ODs resolved in-FR: OD-048/OD-075 (`agents.system_prompt` removed; Layer-1 sole store = `prompt_layers`), OD-077 (low-confidence clarification is tracked + escalating, reuses C5 escalate-don't-abandon), OD-079 (seed the 8 specialists + orchestrator), OD-080 (registry-edit authority split), OD-081 (per-agent scope wiring — resolved but *enforced* in ISSUE-063)

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-8.ORC.001.1, AC-8.ORC.001.2, AC-8.ORC.001.3
- AC-8.ORC.002.1, AC-8.ORC.002.2
- AC-8.ORC.003.1, AC-8.ORC.003.2
- AC-8.ORC.004.1, AC-8.ORC.004.2
- AC-8.ORC.005.1, AC-8.ORC.005.2, AC-8.ORC.005.3
- AC-8.ORC.006.1, AC-8.ORC.006.2
- AC-8.ORC.007.1, AC-8.ORC.007.2
- AC-8.ORC.008.1, AC-8.ORC.008.2  *(AC-8.ORC.008.2 asserts the orchestrator cannot read outside its scope via the SCO.001 filter — the filter's execution lands in ISSUE-063; this slice delivers the scoped registry row + Layer-1, and 063 closes the enforcement.)*
- AC-8.REG.001.1, AC-8.REG.001.2, AC-8.REG.001.3
- AC-8.REG.002.1, AC-8.REG.002.2
- AC-8.REG.003.1
- AC-8.REG.004.1, AC-8.REG.004.2
- AC-8.REG.005.1, AC-8.REG.005.2, AC-8.REG.005.3
- AC-8.REG.006.1, AC-8.REG.006.2, AC-8.REG.006.3
- **Gating spikes (if any):** none of the launch-gating spikes (ISSUE-001–006) block this slice. Build-time feasibility that gates the routing-accuracy *claims* (not this slice's ship, but must be flagged in verification): **AF-121** (description-driven routing accuracy — ORC.001–004), **AF-122** (confidence calibration — ORC.006, the threshold meaningfully separates good/bad routing), **AF-126** (outcome-tracking measurably improves routing — ORC.007). See `spec/00-foundations/feasibility-register.md` block S.

## 5. Touches (complete blast radius, by ID)
- **DATA:** DATA-agents (schema §9 — the registry table, created here), DATA-prompt_layers (read — Layer-1 resolution by `agent_id`/`layer='core'`; the store itself is ISSUE-042), DATA-execution_plans (schema §9 — **co-owned with ISSUE-064**: created by whichever slice lands first via the shared migration; this slice writes plan versions at ORC.007, 064 owns `plan_body` step/failure-mode structure), DATA-task_queue (read at step 1, status write for awaiting-clarification; the table + status enum are C5/ISSUE-048), DATA-event_log (write — every classification / candidate set / score / plan / confidence / outcome; the table is C7/ISSUE-011), DATA-config_values (read — routing CFG keys)
- **PERM:** PERM-config.agents (registry-edit gate; OD-080 authority split — capability edits `memory_scope`/`tools_allowed`/`enabled` = Super Admin only, `description`/routing tuning = Super Admin + Admin). The orchestrator runs `service_role` (RLS-bypass, C1 FR-1.RLS.007) — its containment rests entirely on the SCO scope filter (ISSUE-063).
- **CFG:** CFG-orchestrator_confidence_threshold (0.75, LIVE), CFG-chain_depth_limit (6, LIVE), CFG-routing_weights (object; sum = 1.0; domain_match/complexity_fit/memory_scope_fit/tool_scope_fit), CFG-parallel_execution_enabled (false, BOOT), CFG-clarification_escalation_window (OD-077 escalation timer)  *(all in `spec/02-config/config-registry.md` §K — Agent design / routing)*
- **UI:** none owned here — registry editor + clarification-request + version-history views are surface-09 / ISSUE-067 (Phase 3). This slice emits the signals + the RBAC-routed need only.
- **Connectors:** none (agents reach C3 connectors only through C3's tool interface; the orchestrator itself invokes no action tool)

## 6. Context manifest (the EXACT files to open — nothing more)
- spec/01-requirements/component-08-agent-design.md — the FR text + ACs for the ORC + REG areas (and the Context manifest / seams / OD table at its head)
- spec/04-data-model/schema.md §9 Agent Design (C8) — the `agents` + `execution_plans` tables, plus §"Global rules" (versioned-tables append-only-by-version; `client_slug` confined to the management plane) and §"Immutability enforcement"; and §5 Prompt Content (C4) for the `prompt_layers` shape Layer-1 resolves against
- spec/02-config/config-registry.md §K (Agent design / routing) — the five routing CFG keys, defaults, edit-class, and `PERM-config.agents` gate
- spec/00-foundations/adr/ADR-004-concurrency-model.md — the "Memory Agent is the only writer" invariant the orchestrator/specialists must not violate
- spec/00-foundations/adr/ADR-005-* — scripted provisioning (the seed-roster mechanism)
- spec/00-foundations/adr/ADR-007-* — injection containment (retrieved memory / tool output is data, never instructions)
- spec/00-foundations/adr/ADR-001-* — physical per-client isolation (why no `client_slug` on the `agents` table)

## 7. Dependencies
- **Blocked-by:** ISSUE-042 (prompt-layer store — the orchestrator's own Layer 1 and REG.002's Layer-1 resolution require `prompt_layers` to exist); ISSUE-048 (`task_queue` + status machine — ORC.001 reads a task at the queue front and ORC.006 sets the awaiting-clarification status). Neither is a spike; no AF gate blocks this slice's ship.
- **Blocks:** ISSUE-053 (run pipeline — assembles/executes the plans this slice produces), ISSUE-062 (specialist definitions — seeded into the registry here), ISSUE-064 (execution plans + failure-mode assignment — build on ORC.005/007's plan-versioning), ISSUE-065 (agent health/drift — consumes the per-candidate scores + plan outcomes emitted here), ISSUE-066 (orchestrator learning + result cache + cost-routing — consumes ORC.004/007 signals)

## 8. Build order within the slice
1. **Migration (schema §9)** — create `agents` exactly per schema §9: `id`, `name` ('{slug}_<role>_agent'; slug only in the string), `description` (NOT NULL, non-empty), `memory_scope` (jsonb NOT NULL), `tools_allowed` (uuid[] → `tools.id`, default `{}`), `max_tokens`, `enabled` (default true), `version` (default 1), `previous_version_id` (self-FK), `change_reason` (NOT NULL), `created_at`/`updated_at`, `created_by` (FK → profiles). **No `system_prompt`, no `model`, no `client_slug` column** (OD-075 / ADR-001 §3 / complexity-routed). Also create `execution_plans` (schema §9) if ISSUE-064 has not — coordinate to avoid a duplicate migration. Ship through the ISSUE-008 expand-contract harness. Honour the global "versioned tables are append-only-by-version" rule.
2. **Registry write-gate + version discipline (REG.004)** — every edit inserts a new version incrementing `version`, links `previous_version_id`, requires a non-empty `change_reason` (reject empty), and writes an audit row; prior versions stay retrievable, never overwritten. Flag capability-changing edits (scope/tools/enabled) as authority changes.
3. **PERM gating (OD-080)** — gate registry edits on `PERM-config.agents` with the authority split: `memory_scope`/`tools_allowed`/`enabled` edits require Super Admin; `description`/routing-weight tuning allows Super Admin + Admin. Default-deny + log on denial.
4. **Layer-1 resolution + system_prompt migration (REG.002 / OD-048/075)** — Layer 1 resolves from `prompt_layers WHERE agent_id = ? AND layer='core'`; the `agents` row references the agent by `id` only. Run the one-time migration folding any residual `system_prompt` into `prompt_layers` and asserting no second source of truth remains. If an agent has no `core` layer, assembly halts (C4 FR-4.LYR.004 — executed in ISSUE-053).
5. **`enabled`-gated discovery (REG.003/005)** — `enabled=true` inserts are auto-discovered as routing candidates with no code change; `enabled=false` rows are retained but never candidates; disabling the *sole* enabled agent for a domain surfaces a warning at disable-time (REG.005.3).
6. **Seed the roster (REG.006 / OD-079)** — scripted provisioning (ADR-005) idempotently inserts the orchestrator + 8 specialists (Research/Client/Campaign/Comms/Ops/Memory/Finance/Insight) with descriptions, `memory_scope` (the SCO matrix), `tools_allowed`, and `enabled` defaults; a partial seed re-runs without duplicates. **Positive seed-time check (REG.006.3):** the Comms row's `tools_allowed` excludes any autonomous-send tool and the Finance row's excludes any transaction tool.
7. **Orchestrator as a scoped registry row (ORC.008)** — seed the orchestrator with its own `prompt_layers` Layer 1 and a restricted `memory_scope` (semantic + entity model + tool registry). Note its `service_role` path means containment rests on the SCO.001 filter (enforced in ISSUE-063).
8. **Seven-step routing engine (ORC.001–007):**
   a. **Step 1 dequeue + crash-window guard (ORC.001)** — read the task at the `task_queue` front (after RBAC/clearance has passed); the orchestrator invokes no domain/action tool. On crash/timeout between dequeue and plan-persist, the task returns to a re-routable state (idempotent re-route; relies on the C5 task-lifecycle guarantee) — never dequeued-but-unplanned (ORC.001.3).
   b. **Step 2 classify (ORC.002)** — record domain/complexity/context/output on the routing record; ambiguity lowers confidence, propagated (never silently defaulted).
   c. **Step 3 registry-read (ORC.003)** — read all `enabled=true` rows; route on `description`, never a hardcoded task→agent map; a proposed hardcoded rule is rejected in review.
   d. **Step 4 score (ORC.004)** — compute a routing score per candidate from the four `routing_weights` factors; log per-candidate scores (the signal ISSUE-065/066 consume).
   e. **Step 5 build plan (ORC.005)** — simple → single agent; complex → ordered chain with deps + parallel-eligible marks; **every step carries a failure mode** (assignment semantics + `step_failure_mode` owned by ISSUE-064); within `chain_depth_limit`; write the plan into the C5 envelope's `execution_plan` field (does not execute).
   f. **Step 6 confidence-check (ORC.006 / OD-077)** — confidence ≥ `orchestrator_confidence_threshold` → proceed; below → raise a clarification request, set the task to awaiting-clarification, do **not** execute; the request escalates on `clarification_escalation_window` timeout (reuse C5 escalate-don't-abandon), never silently parks or auto-proceeds.
   g. **Step 7 version + log + outcome (ORC.007)** — persist the plan with a version id; on completion record the outcome per step; a re-planned task links to the original; outcome-write failure surfaces via a secondary sink/heartbeat distinct from the failed channel (never silently dropped).
9. **Observability wiring** — every classification, candidate set, score, plan, confidence decision, and outcome is written to `event_log`.
10. **Tests to the AC IDs** in field 4.

## 9. Verification (how DoD is proven)
- **Migration/schema layer** — DB-level tests per `spec/05-non-functional/test-strategy.md`: `agents` matches schema §9 (columns, `description` NOT NULL, `memory_scope` NOT NULL, `change_reason` NOT NULL, `previous_version_id` self-FK), and carries **no** `system_prompt`, `model`, or `client_slug` column (AC-8.REG.001.1/.3).
- **Registry lifecycle** — an empty-`description` insert is rejected (REG.001.2); an edit without `change_reason` is rejected and any edit creates a new version leaving the prior retrievable (REG.004.1/.2); a valid enabled insert becomes a routing candidate with no code change (REG.003.1); a disabled agent is excluded but its row/history persists (REG.005.1); disabling a domain's sole agent warns at disable-time and later routes such tasks to clarification not a silent drop (REG.005.2/.3).
- **Layer-1 single source of truth** — Layer 1 resolves only from `prompt_layers` by `agent_id`; post-migration no `agents.system_prompt` value survives (REG.002.1/.2).
- **Seed** — a freshly provisioned deployment has the orchestrator + 8 specialists with their SCO scopes; re-running provisioning converges without duplicates; the seeded Comms/Finance `tools_allowed` exclude send/transaction tools (REG.006.1/.2/.3).
- **Routing engine** — the orchestrator produces a plan and calls no domain tool (ORC.001.1); an unroutable task halts-and-escalates + logs (ORC.001.2); a crash between dequeue and plan-persist leaves the task re-routable (ORC.001.3); classification is recorded and ambiguity propagates (ORC.002.*); routing is description-driven and a hardcoded-rule change is rejected, disabled agents are never candidates (ORC.003.*); per-candidate scores are recorded and a changed weight takes effect next task (ORC.004.*); simple→single / complex→chain-with-failure-modes, plan written into the C5 envelope (ORC.005.*); below-threshold confidence raises clarification without executing and escalates on timeout (ORC.006.*); outcomes are recorded against the plan version and an outcome-write failure surfaces via a secondary sink (ORC.007.*); the orchestrator exists as a scoped registry row with a `prompt_layers` Layer 1 (ORC.008.1). AC-8.ORC.008.2 (scope containment) is proven end-to-end only once ISSUE-063 lands the SCO.001 filter.
- **Feasibility flag (paper-vs-proven):** the routing *accuracy* claims (ORC.001–004), confidence *calibration* (ORC.006), and outcome-tracking *improvement* (ORC.007) rest on **AF-121 / AF-122 / AF-126** — these are EVAL-class assumptions, not proven by these ACs; surface them in the verification report per `spec/00-foundations/feasibility-register.md`. No `AC-NFR-*` posture is owned by this slice.
