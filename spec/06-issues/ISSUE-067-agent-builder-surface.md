---
id: ISSUE-067
title: Agent builder surface — fleet grid, per-agent Builder, orchestration & plan views
epic: H — agent design
status: ready
github: "#67"
---

# ISSUE-067 — Agent builder surface (surface-09 · UI-AGENT-BUILDER)

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Build the C8 agent-management console (surface-09 `UI-AGENT-BUILDER`) that renders the data-driven `agents` registry as a fleet grid + per-agent Builder (versioned edits with mandatory reason) + orchestration/plan-version views, enforcing the OD-080 authority split and the hard-limit reject-at-write invariants.

## 2. Scope — in / out
**In:** The five sections of surface-09 (OD-138 layout): Fleet grid landing (Section A), the per-agent Builder drawer (Section B), the Version History tab (Section C), the Orchestration & routing read-only readout (Section D), and the Execution Plans list with human-decided rollback (Section E). This is the **render + human-edit-path** slice: it reads the C8-owned `agents` / `agent_health_metrics` / `execution_plans` stores plus the C4 `prompt_layers` read-through and C3 `tools` picker; it stages registry edits through the versioned write path (new immutable version + mandatory `change_reason` modal); it encodes the OD-080 two-tier authority split (capability edits Super-Admin-only; description/tuning/plan-rollback Super Admin + Admin) via the newly-minted `PERM-agents.*` nodes; and it wires the Builder's tool/scope save path to the **reject-at-write** hard-limit invariants (Comms ⊄ send, Finance ⊄ transaction, only-Memory-writes) as a code-level deny. Fleet health/drift/dead-agent **badges** poll at the agent-health cadence and render stale-not-green.

**Out:** The C8 backend logic that this surface renders is owned upstream and is NOT built here — the 7-step orchestrator + agents-registry logic (ISSUE-061), the eight specialist definitions + per-agent hard-limit enforcement in the write API (ISSUE-062), per-agent memory-scope retrieval filtering (ISSUE-063), execution-plan/failure-mode assignment (ISSUE-064), and agent-health/drift/dead-agent metric production (ISSUE-065). The full cross-agent **self-improvement panel** and routing-outcome trends are surface-05 (ISSUE-078) — this surface shows per-agent badges + a link-out only. Config **knobs** (routing weights, confidence threshold, chain-depth, models, cache windows) are read-only readouts here and edited on surface-01 #agents (ISSUE-086, `PERM-config.agents`). **Layer-1 prompt content** editing routes out to C4 (`PERM-prompt.*`). Plan/loop **execution** is C5.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs (component-08-agent-design):** rendered/acted-on by this surface —
  - **Registry (REG):** FR-8.REG.001, FR-8.REG.002 (Layer-1 read-through), FR-8.REG.003 (add agent), FR-8.REG.004 (version discipline), FR-8.REG.005 (enable/disable + sole-agent warn), FR-8.REG.006 (seed roster shown).
  - **Specialists / hard limits (SPC):** FR-8.SPC.001 (roster), FR-8.SPC.002 (Research read-only chip), FR-8.SPC.003 (Comms never-sends — reject-at-write), FR-8.SPC.004 (Finance never-transacts — reject-at-write), FR-8.SPC.005 (Memory sole-writer — reject-at-write), FR-8.SPC.006 (Insight slow-loop chip).
  - **Scope (SCO):** FR-8.SCO.001 (memory-scope field + orchestrator containment note), FR-8.SCO.002 (clearance-on-top display), FR-8.SCO.003 (scope edit is a capability change, reject invalid at write).
  - **Plans (PLAN):** FR-8.PLAN.001 (per-step failure mode shown), FR-8.PLAN.002 (halt-and-escalate default shown), FR-8.PLAN.003 (chain-depth readout), FR-8.PLAN.004 (versioned plans + human-decided rollback).
  - **Health badges (HLTH):** FR-8.HLTH.001 (success/failure + last-run badge), FR-8.HLTH.002 (drift flag, review-scope badge), FR-8.HLTH.003 (dead-agent flag), FR-8.HLTH.004 (stale-not-green producer heartbeat).
  - **Orchestration readout (ORC):** FR-8.ORC.003 (description-is-the-fix act-on), FR-8.ORC.004 (routing-weights readout), FR-8.ORC.006 (confidence-threshold readout), FR-8.ORC.008 (orchestrator-as-registry-agent edited via Builder).
  - **Learning (LRN):** FR-8.LRN.002 (routing-mismatch "description may need updating" pointer → Builder).
  - **Cost (COST):** FR-8.COST.001 (complexity-tier / read-only model display).
- **NFRs (05-non-functional):** NFR-A11Y.001 (surface accessibility baseline — per coverage ledger, all surface issues).
- **Rests on:** ADR-001 §3 (intra-client, no `client_slug`), ADR-004 (Memory sole-writer identity), ADR-005 (seed roster is scripted provisioning), ADR-006 (registry edits are a `service_role`-managed, human-gated path), ADR-007 (specialist hard limits are defense-in-depth); OD-080 (capability-vs-description authority split), OD-075 (no `agents.system_prompt`), OD-081 (scope-wiring, consumed as a display/containment note), OD-137 (`PERM-agents.*` mint), OD-138/139/140 (layout, edit-gating UX, hard-limit presentation), OOS-030 (no automatic plan rollback); AF-068 (hard-limit containment red-team — reject-at-write is the Builder's defense-in-depth layer), AF-123/AF-124 (drift / dead-agent thresholds — badges reflect these signals).

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-8.REG.001.1, AC-8.REG.001.2 (empty-description rejected at write), AC-8.REG.001.3 (no `client_slug`)
- AC-8.REG.002.1 (Layer-1 read-through from `prompt_layers`)
- AC-8.REG.003.1 (add agent = insert enabled row, auto-discovered)
- AC-8.REG.004.1 (edit without `change_reason` rejected), AC-8.REG.004.2 (prior version retrievable)
- AC-8.REG.005.1 (disabled agent retained + shown), AC-8.REG.005.2 (sole-agent loss → clarification), AC-8.REG.005.3 (warn at disable-time)
- AC-8.REG.006.3 (Comms/Finance seed hard-limit positive check shown)
- AC-8.SPC.003.3 (Comms send-tool grant rejected at write)
- AC-8.SPC.004.3 (Finance transaction-tool grant rejected at write)
- AC-8.SPC.005.2 (only Memory holds memory-write; grant to any other agent rejected)
- AC-8.SCO.001.3 (orchestrator containment note — fail-closed if scope unwired; display/link only here)
- AC-8.SCO.002.2 (Restricted never auto-injected — display of clearance-on-top)
- AC-8.SCO.003.1 (invalid `memory_scope` edit rejected at write)
- AC-8.PLAN.002.1 (halt-and-escalate default shown per step)
- AC-8.PLAN.004.2 (rollback human-initiated + audited, never automatic)
- AC-8.HLTH.001.1, AC-8.HLTH.002.1 (drift flag, never auto-corrected), AC-8.HLTH.003.2 (dead-agent, never auto-disabled), AC-8.HLTH.004.2 (stalled producer shows stale, never last-known-good green)
- AC-8.ORC.003.1 (routing fix is the description, edited here), AC-8.ORC.004.2 (weight readout reflects surface-01 edits)
- AC-8.LRN.002.1 (routing-mismatch pointer surfaces "description may need updating")
- **Gating spikes (if any):** none directly gate this leaf. The hard-limit reject-at-write invariants (AC-8.SPC.003.3/.004.3/.005.2) are the Builder's defense-in-depth layer for **AF-068** (proven GREEN via ISSUE-003 spike, gating ISSUE-062's code enforcement); the drift/dead-agent badges reflect **AF-123/AF-124** signals produced by ISSUE-065. Per feasibility-register, AF-068 must be GREEN before the containment posture ships.

## 5. Touches (complete blast radius, by ID)
- **DATA:** `agents` (read/write — id, name, description, memory_scope, tools_allowed, max_tokens, enabled, version, previous_version_id, change_reason, created_at/updated_at/created_by; **no** system_prompt / model / client_slug); `agent_health_metrics` (read — success_rate, failure_rate, last_run, drift_score, dead_agent_flag, routing_mismatch_count, producer_heartbeat); `execution_plans` (read + version-rollback — task_type_name, version, plan_body, previous_version_id); `prompt_layers` (read-through — Layer-1 `WHERE agent_id=? AND layer='core'`, C4-owned); `tools` (read — tools picker, C3-owned); `event_log` (read — registry-version audit, routing decisions/outcomes, capability-change flags).
- **PERM:** `PERM-agents.view` (entry — SA + Admin), `PERM-agents.edit_description` (description / max_tokens / plan-rollback — SA + Admin), `PERM-agents.edit_capability` (memory_scope / tools_allowed / enabled / add / disable — **SA only**) — all three minted via OD-137 under FR-1.PERM.007 Asset Management, intra-client, transcribed in `PERMISSION_NODES.md`. Routes out: `PERM-prompt.edit` / `PERM-prompt.edit_principles` (Layer-1 → C4), `PERM-config.agents` (config knobs → surface-01), `PERM-dashboard.ops` (self-improvement signals → surface-05), `PERM-tool.manage` (tool registry → C3).
- **CFG:** read-only readout only (edited on surface-01 #agents, `PERM-config.agents`): `orchestrator_confidence_threshold` (0.75), `chain_depth_limit` (6), `clarification_escalation` (24h), `drift_threshold` (0.3), `dead_agent_threshold` (0.5), `default_model` (claude-sonnet-4-6), `lightweight_model` (claude-haiku-4-5), `routing_weights` (sum=1.0), `cache_time_window`. On #observability (`PERM-config.observability`, never editable here): `polling_interval_agent_health_s` (60) — the fleet health-badge poll cadence.
- **UI:** `UI-AGENT-BUILDER` (surface-09; minted in the surface file).
- **Connectors:** none (agents interact with C3 connectors through C3's tool interface; this surface only reads the `tools` registry for the picker).

## 6. Context manifest (the EXACT files to open — nothing more)
- `spec/03-surfaces/surface-09-agent-builder.md` — the surface contract: five sections, data bindings, actions + PERM gates, all five states, OD-137–140 resolutions, Phase-4 binding notes.
- `spec/01-requirements/component-08-agent-design.md` — the FR text + ACs for areas REG / SPC / SCO / PLAN / HLTH / ORC / LRN / COST.
- `spec/04-data-model/schema.md §9 Agent Design (C8)` — `agents`, `agent_health_metrics`, `agent_result_cache`, `execution_plans` tables; §12 for the config-key cluster (routing weights / confidence threshold live in config, not tables); §5 (`prompt_layers`, C4) and §4 (`tools`, C3) for the read-through/picker joins.
- `spec/00-foundations/adr/ADR-001-*.md` (§3 intra-client), `ADR-004-*.md` (sole-writer identity), `ADR-005-*.md` (scripted seed), `ADR-006-*.md` (service_role human-gated registry path), `ADR-007-*.md` (hard-limit defense-in-depth).
- `spec/00-foundations/open-decisions.md` — OD-080, OD-137, OD-138, OD-139, OD-140, OOS-030.
- `spec/00-foundations/feasibility-register.md` — AF-068 (containment red-team), AF-123 / AF-124 (drift / dead-agent thresholds).

## 7. Dependencies
- **Blocked-by:** ISSUE-062 (eight specialist definitions + per-agent hard-limit code enforcement — the reject-at-write invariants this surface's save path is the front gate for), ISSUE-064 (execution plans + per-step failure-mode assignment — the store Section E renders), ISSUE-065 (agent health / drift / dead-agent metric production + producer heartbeat — the badges Sections A/B render). None of these blockers is a spike; the launch-gating AF-068 is proven by ISSUE-003 (upstream of ISSUE-062).
- **Blocks:** none (leaf).

## 8. Build order within the slice
1. **Read path first** — bind the fleet grid (Section A) to `agents` (one card per row) + `agent_health_metrics` for the badges; implement all five states, with the false-empty and stale-not-green rules explicit (Loading never shows "no agents"; a genuinely empty registry is an alarm; a badge-read failure shows "—"/"health unavailable", never a green tick — AC-8.HLTH.004.2 producer-heartbeat check).
2. **Builder drawer (Section B)** — render the per-agent definition editor over the grid: description / memory_scope / tools_allowed / max_tokens / enabled, plus the read-only config-derived model display (no `agents.model` column exists — FR-8.REG.001; model is complexity-routed per FR-8.COST.001), and the C4 `prompt_layers` Layer-1 read-through (no `core` layer → "no Layer 1 — assembly will halt", never a blank).
3. **OD-080 authority gating** — encode the two tiers inline (OD-139 option a): capability fields (memory_scope / tools_allowed / enabled) are read-only/locked for an Admin with a visible "Super-Admin-only" affordance; description/tuning editable for both. Entry gated by `PERM-agents.view`; per-action gates as in the surface Actions tables; all nodes default-deny.
4. **Versioned write path** — every Save opens the mandatory `change_reason` modal; on confirm create a **new** version (`version`++, `previous_version_id` set), write the audit row, flag capability changes (OD-080); a save without a reason is rejected (AC-8.REG.004.1). Nothing half-written — the prior version stands on failure.
5. **Reject-at-write hard-limit enforcement** — wire the tool/scope save path (in the registry write API, not just the front end, ADR-007) to deny AC-8.SPC.003.3 (Comms + send tool), AC-8.SPC.004.3 (Finance + transaction tool), AC-8.SPC.005.2 (any non-Memory agent + memory-write tool), and AC-8.SCO.003.1 (invalid scope). Present forbidden tools greyed with an inline reason (OD-140 option a), never hidden.
6. **Version History tab (Section C)** — the immutable trail from the `agents` version chain (`previous_version_id`), each with `change_reason` / author / timestamp / capability-change flag; view / diff / restore-as-new-version (restore is forward-only, never an in-place rewind).
7. **Orchestration & routing readout (Section D)** — read-only render of the orchestrator row + the config-cluster values (routing weights / confidence threshold / chain-depth / models / cache windows) with "edit on surface-01 #agents" links; the routing-mismatch pointer (LRN.002) links to the implicated agent's Builder (the description fix, AC-8.ORC.003.1). Never show defaults as if live (missing value → "—").
8. **Execution Plans (Section E)** — the versioned-plan list from `execution_plans`, per-step failure modes (halt-and-escalate default shown), outcome attribution, and **human-decided rollback** (AC-8.PLAN.004.2 — audited, never automatic, OOS-030; rollback disabled on uncertain/stale state).
9. **Poll + chrome** — health badges poll `polling_interval_agent_health_s` (60s, not Realtime); registry/plans/readout static on load + on-demand refresh; the two always-loud notification banners (AC-7.ALR.008.2, AC-7.ALR.009.1) pinned above every section.
10. **Test to the AC** — cover each AC-* in the Definition of done, with the reject-at-write and stale-not-green paths as first-class cases.

## 9. Verification (how DoD is proven)
- Per `spec/05-non-functional/test-strategy.md`: component/integration tests for the versioned write path + reject-at-write hard-limit denials (the highest-stakes behaviour — a #2 containment breach if it slips); UI/state tests for all five states across every section, asserting the no-false-empty and stale-not-green invariants (#1/#3); an authority-matrix test that an Admin session cannot mutate capability fields (OD-080 #2).
- The reject-at-write invariants (AC-8.SPC.003.3/.004.3/.005.2) are this surface's defense-in-depth layer for **AF-068** — the AC→`Verified` path requires the red-team spike (ISSUE-003) GREEN and the ISSUE-062 code enforcement present; this surface's test proves the Builder save path is the first of the three layers (Builder-reject / missing-tool-C3 / code-enforcement-C6), not the only one.
- Accessibility baseline (NFR-A11Y.001) for the fleet grid, drawer, modal, and section nav.
