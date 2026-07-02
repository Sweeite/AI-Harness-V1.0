# Surface: UI-AGENT-BUILDER (surface-09) — Agent Fleet · Agent Builder / specialist config · Orchestration

**Status:** 🟢 **Signed off 2026-07-01** (operator: "I trust your recommendations, what's needed" — recommendations
delegated). **10 of 14 Phase-3 surfaces complete.** OD-137–140 🟢. Gate CLEAN-WITH-FIXES (1 HIGH already-resolved + 2 LOW,
all reconciled — see gate note below). OD-137–140 resolved in-file
(recommendations). The tenth Phase-3 surface. One surface ID minted here: **`UI-AGENT-BUILDER`** — C8 (Agent Design)
names "registry editor", "version history", and the routing/plan-version views by description (FR-8.REG.001/003/004,
FR-8.PLAN.004) but assigns no formal `UI-` id. **OD-137 mints the `PERM-agents.*` node family** via change-control under
the **existing Asset Management category** (FR-1.PERM.007 — the design-doc's "Create / edit agents" row, L509–615),
refined by the **locked OD-080** two-tier authority split (capability edits = Super Admin only; description/tuning =
Super Admin + Admin). Next OD: OD-141.

> **Verification gate (independent zero-context subagent, checks a–f): CLEAN-WITH-FIXES — 1 HIGH · 0 MED · 2 LOW (all
> reconciled).** (a) Coverage PASS — owns all eight C8 areas, does **not** double-own surface-05's self-improvement panel
> (badges + link-out only; surface-05 reciprocally points back). (b) CFG PASS — all 10 keys match the registry default/
> class/anchor/PERM verbatim. (c) DATA PASS — no `client_slug` on any binding; both net-new Phase-4 stores flagged;
> `agents` columns match FR-8.REG.001 (no `system_prompt`, OD-075). (d) PERM PASS — OD-080 split encoded exactly across
> the three nodes; mint under the existing Asset Management category (no invented category, no ADR supersede). (e) #1/#2/#3
> sweep PASS — false-healthy refused everywhere (stalled health producer shows "—"/"stale" not green; empty registry is an
> alarm); hard-limit containment enforced **at write** for all three invariants (Comms⊄send, Finance⊄transaction,
> only-Memory-writes); drift/dead-agent flag-never-auto-correct; plan rollback human-only. (f) Seams PASS. **Fixes:**
> **F1 HIGH (dangling-ID)** — the gate read the catalog *before* the transcription edit landed (it ran concurrently);
> verified the three `PERM-agents.*` nodes **are** present in `PERMISSION_NODES.md` (Asset Management section, count 45→48)
> — resolved, not a real gap. **F3 LOW** — the Model field bound to a non-existent `agents.model` column (FR-8.REG.001
> defines none); corrected to a **read-only config-derived display** (model is selected by complexity per FR-8.COST.001;
> a per-agent override would be a net-new Phase-4 field, not asserted). **F2 LOW** — count-baseline note, no contradiction
> (45→48 applied to the right baseline; the 3 owed surface-03/04 nodes remain separately owed).

> The **agent-management console** of one client deployment — where a Super Admin (and, for the lighter tier, an Admin)
> sees and shapes **who does the work**: the **Agent Fleet** (the orchestrator + eight specialists + any custom agents,
> each a row in the data-driven `agents` registry), the **Agent Builder** (the per-agent definition editor — description,
> memory scope, allowed tools, max-tokens, enabled state — every change versioned with a mandatory reason), and **Orchestration**
> (the routing config readout + the versioned execution plans). It is the act-on surface for the signals surface-05's
> self-improvement panel raises (a drifting agent, a dead agent, a consistently-rerouted task type) — surface-05 shows the
> flag, surface-09 is where a human edits the description, adjusts the scope, or rolls back a plan. The three
> non-negotiables it most directly serves: **#1** (every agent change is an immutable new version with a reason — history
> is never overwritten; a plan rollback is human-decided, never automatic), **#2** (a capability grant — widening memory
> scope, adding a tool, enabling an agent — is Super-Admin-only, and the hard-limit invariants are enforced *at write*:
> the Comms Agent can never be granted an autonomous-send tool, Finance never a transaction tool, no second agent a
> memory-write tool — a code-level deny, not a mere audit), and **#3** (a drift / dead-agent flag is surfaced, never
> auto-corrected; disabling the sole agent for a domain warns at disable-time; a stalled health-metric producer shows
> "stale", never a false last-known-good green). It does **not** execute anything (that is C5), render the cross-agent
> self-improvement panel or routing-outcome trends (surface-05), edit the agent config *knobs* (surface-01 #agents), or
> edit Layer-1 prompt content (C4 / surface — `PERM-prompt.*`).

---

## Context manifest

- **Surface ID:** **`UI-AGENT-BUILDER`** (minted here) — C8 names the registry editor / version history / routing &
  plan-version views by description but assigns no `UI-` id. The operator's planning-doc "Agent Fleet / Agent Builder /
  Orchestration" labels map here.
- **Owned by:** **C8 (Agent Design)** — the orchestrator + 7-step routing (FR-8.ORC.*), the `agents` registry
  (data-driven, versioned; FR-8.REG.*), the eight specialist definitions + their hard limits (FR-8.SPC.*), per-agent
  memory scoping (FR-8.SCO.*), the execution-plan / failure-mode model (FR-8.PLAN.*), agent-health / drift / dead-agent
  **metric production** (FR-8.HLTH.*), orchestrator learning + result caching (FR-8.LRN.*), and cost-routing
  (FR-8.COST.*). **C4** owns the Layer-1 prompt content this surface *references but does not edit* (FR-4.LYR.001 /
  FR-4.STO.*). **C1** owns the authority model (FR-1.PERM.007 Asset Management category; OD-080). Health/drift/dead-agent
  **rendering** (the full self-improvement panel) is **C7 + surface-05**; this surface shows only per-agent **badges**
  and links there.
- **FRs served:**
  - **The orchestrator & routing (C8 ORC):** FR-8.ORC.001 (the orchestrator **routes and plans only, never does the
    work** — represented here as the registry agent it is, ORC.008; it invokes no domain tool, AC-8.ORC.001.1),
    FR-8.ORC.003 (**routing is data-driven — read every enabled agent's `description`, never a hardcoded task→agent
    map**; the fix for mis-routing is the *description*, AC-8.ORC.003.1, edited here), FR-8.ORC.004 (candidates scored on
    four **configurable weights** — read-only readout here, edited on surface-01 #agents AC-8.ORC.004.2), FR-8.ORC.006
    (**confidence < threshold → human clarification, never silent**; the threshold is config, surface-01), FR-8.ORC.007
    (**every plan versioned + logged + its outcome tracked**; outcome-write failure routes to a secondary sink
    AC-8.ORC.007.2), FR-8.ORC.008 (**the orchestrator is itself a scoped registry agent** with its own Layer 1 + a
    restricted memory scope — edited via the Builder; its containment rests on the SCO.001 scope filter, note M5).
  - **The agent registry (C8 REG):** FR-8.REG.001 (**the `agents` table** — id, name, description, `memory_scope`,
    `tools_allowed`, `max_tokens`, `enabled`, version columns, `change_reason`; **no `system_prompt`** (OD-075), **no
    `client_slug`** intra-silo AC-8.REG.001.3; an empty `description` is **rejected at write** AC-8.REG.001.2),
    FR-8.REG.002 (**Layer 1 resolves from `prompt_layers` by `agent_id`**, not a column on the row — the Builder shows it
    read-through, edited via C4 AC-8.REG.002.1), FR-8.REG.003 (**add a specialist = insert an enabled row**, auto-
    discovered, no code change AC-8.REG.003.1), FR-8.REG.004 (**version discipline — immutable history, mandatory
    `change_reason`, `previous_version_id`, audited**; an edit without a reason is **rejected** AC-8.REG.004.1; the prior
    version stays retrievable AC-8.REG.004.2), FR-8.REG.005 (**`enabled` gates discovery** — a disabled agent is retained
    but never routed AC-8.REG.005.1; disabling a domain's **sole** enabled agent **warns at disable-time** AC-8.REG.005.3
    and its tasks hit clarification not a silent drop AC-8.REG.005.2), FR-8.REG.006 (**the seed roster** — orchestrator +
    8 specialists provisioned, then operator-editable; the seed positively verifies Comms holds no send tool + Finance no
    transaction tool AC-8.REG.006.3).
  - **The specialist roster & hard limits (C8 SPC):** FR-8.SPC.001 (**eight single-domain specialists**, each with a
    routing-precise description AC-8.SPC.001.1), FR-8.SPC.002 (**Research is read-only, called first** — no write/action
    tools AC-8.SPC.002.2), FR-8.SPC.003 (**Comms never sends autonomously** — output to the approval queue; a registry
    edit that would add an autonomous-send tool is **rejected at write**, a code-level deny not a mere audit
    AC-8.SPC.003.3), FR-8.SPC.004 (**Finance never initiates transactions** + finance-scoped Confidential clearance; a
    transaction-tool grant is **rejected at write** AC-8.SPC.004.3), FR-8.SPC.005 (**the Memory Agent is the sole agent
    identity for the C2 write flow** — only it holds memory-write capability AC-8.SPC.005.2, ADR-004), FR-8.SPC.006
    (**Insight runs on the slow loop, read-only**, not on-demand AC-8.SPC.006.2).
  - **Memory scoping per agent (C8 SCO):** FR-8.SCO.001 (**`memory_scope` is a least-privilege retrieval filter**, not a
    label — fails closed when the wiring is absent AC-8.SCO.001.3, OD-081), FR-8.SCO.002 (**sensitivity clearance applies
    on top of scope** — scope never grants above the task clearance; Restricted never auto-injected even for read-all
    agents AC-8.SCO.002.2), FR-8.SCO.003 (**scope is registry data, not code** — an edit governs the next run, an invalid
    scope is rejected at write AC-8.SCO.003.1).
  - **Execution plan & failure modes (C8 PLAN):** FR-8.PLAN.001 (**a failure mode {retry / skip-and-continue /
    halt-and-escalate} assigned to every step upfront**), FR-8.PLAN.002 (**default = halt-and-escalate** — fail safe,
    AC-8.PLAN.002.1; an unattended halt re-escalates AC-8.PLAN.002.2), FR-8.PLAN.003 (**chain-depth limit enforced at
    build time** — read-only readout, edited surface-01), FR-8.PLAN.004 (**versioned execution plans per task type +
    human-decided rollback** — never automatic AC-8.PLAN.004.2; a new version supersedes but never deletes the prior).
  - **Agent health / drift / dead-agent metric production (C8 HLTH — badges here, full panel surface-05):**
    FR-8.HLTH.001 (**per-agent success/failure rate + last-run** AC-8.HLTH.001.1; a high failure rate is **surfaced, not
    auto-corrected** AC-8.HLTH.001.2), FR-8.HLTH.002 (**specialisation-drift flag — never auto-corrected** AC-8.HLTH.002.1;
    the detector's own failure surfaces AC-8.HLTH.002.2), FR-8.HLTH.003 (**dead-agent flag — never auto-disabled**
    AC-8.HLTH.003.2), FR-8.HLTH.004 (**metrics produced here, surfaced/acted-on elsewhere**; a **stalled metric producer
    shows stale, never last-known-good green** AC-8.HLTH.004.2).
  - **Orchestrator learning & caching (C8 LRN):** FR-8.LRN.002 (**the routing-mismatch metric** — a consistently-rerouted
    task type surfaces a "description may need updating" suggestion AC-8.LRN.002.1; the fix is the **description**, edited
    here), FR-8.LRN.003 (**result caching with scope-aware, time-bounded invalidation** — window config is surface-01; a
    write to any in-scope entity invalidates AC-8.LRN.003.2).
  - **Cost routing (C8 COST):** FR-8.COST.001 (**route by complexity tier** — single / two-agent / full chain;
    cheapest-that-fits AC-8.COST.001.1), FR-8.COST.002 (**the confidence threshold is the cost/quality dial** — config,
    surface-01), FR-8.COST.003 (**emit the per-route cost model for C7 metering / C6 ladder** — C8 neither meters nor
    enforces AC-8.COST.003.1).
- **CFG dependencies** (read here as a **read-only readout**; **edited on surface-01 #agents** gated `PERM-config.agents`,
  except the health-poll key on #observability — never editable from this surface; description text binds DRY to
  `config-registry.md`'s `What it does` column, never re-typed):
  - **Agent design / routing** (`#agents`, `PERM-config.agents`): `orchestrator_confidence_threshold` (**0.75**, LIVE),
    `chain_depth_limit` (**6**, LIVE), `clarification_escalation` (**24 h**, LIVE), `drift_threshold` (**0.3**, LIVE),
    `dead_agent_threshold` (**0.5** success-rate, LIVE), `default_model` (**claude-sonnet-4-6**, BOOT), `lightweight_model`
    (**claude-haiku-4-5**, BOOT), `routing_weights` (object, **sum = 1.0** — domain 0.35 / complexity 0.25 / memory 0.20
    / tool 0.20, LIVE), `cache_time_window` (object, per agent type minutes — research 30 … insight 1440, LIVE).
  - **Observability** (`#observability`, `PERM-config.observability`): `polling_interval_agent_health_s` (**60** — the
    fleet health-badge refresh cadence).
- **PERM gates:** ⚠️ **OD-137 — a Rule-0 gap (change-control mint).** FR-1.PERM.007 homes the twelve permission
  categories, one of which is **Asset Management**, whose design-doc seed row **"Create / edit agents" (Super Admin +
  Admin, L509–615)** is the authority over this surface — but **no concrete `PERM-agents.*` node id was ever catalogued**
  (the catalog has no Asset Management section at all). A gate with no catalog entry is a build-time #3 defect. The
  locked **OD-080** further splits that coarse row into two authority tiers. **Minted the `PERM-agents.*` family via
  change-control**, scope **intra-client**, under the **already-homed** FR-1.PERM.007 Asset Management category (no new
  category, no ADR supersede — mirrors OD-117/OD-125/OD-129/OD-133):
  - **`PERM-agents.view`** — enter the fleet/builder; view the registry, definitions, version history, routing readout,
    health badges. **Default: Super Admin, Admin** (viewing ≤ editing; matches the Asset Management row's holders).
  - **`PERM-agents.edit_description`** — edit `description`, `max_tokens`, and the per-agent registry tuning; **roll back
    a plan version** (PLAN.004 "task graphs", Asset Management). **Default: Super Admin, Admin** (OD-080 — the
    description/tuning tier).
  - **`PERM-agents.edit_capability`** — edit `memory_scope` / `tools_allowed` / `enabled`; **add** a new agent; **disable**
    an agent. **Default: Super Admin only** (OD-080 — capability grants are *tighter* than the design-doc's coarse
    SA+Admin row; an authority decision, #2).
  - **Per-action gating inside is finer than entry:** description/tuning = `PERM-agents.edit_description`; any capability
    change = `PERM-agents.edit_capability`; **Layer-1 prompt edits route out to C4** (`PERM-prompt.edit` /
    `PERM-prompt.edit_principles`), **config knobs route out to surface-01** (`PERM-config.agents`). All nodes default-deny
    (FR-1.PERM.002 / OD-030); build obligation = appear in `PERMISSION_NODES.md` with all four fields (FR-1.PERM.005).
    Recorded in `open-decisions.md` OD-137 + **transcribed into `PERMISSION_NODES.md` immediately**. **C1 catalog grows;
    no FR re-approval, no ADR supersede.**
- **DATA bindings** (Phase-4 stubs; **intra-client — no `client_slug` on any** per OD-096 / FR-10.ISO.001 /
  AC-8.REG.001.3; the registry is `service_role`-managed, human edits gated by the OD-137 nodes; ADR-006):
  - **C8-owned `agents`** (read/write) — per row: `id`, `name` ('{client_slug}_<role>_agent' — the slug survives **only**
    inside this human-readable name string, **never as a column** AC-8.REG.001.3), `description`, `memory_scope` (json),
    `tools_allowed` (uuid[] → C3 `tools`), `max_tokens`, `enabled`, `version`, `created_at`/`updated_at`, `created_by`,
    `previous_version_id`, `change_reason`. **No `system_prompt`** (OD-075/AC-8.REG.001.1).
  - **C4-owned `prompt_layers`** (read-through; Layer-1 `WHERE agent_id=? AND layer='core'`, OD-048/FR-8.REG.002) — the
    Builder **displays** an agent's Layer 1 but **editing routes to C4** (`PERM-prompt.*`); if no `core` layer exists,
    assembly halts (C4 FR-4.LYR.004) and the Builder shows "no Layer 1 — assembly will halt", never a blank that looks fine.
  - **C3-owned `tools`** (read; FR-3.REG.002) — the tools picker reads tool ids + descriptions; the hard-limit invariants
    (SPC.003/004/005) constrain which tools a given agent may hold.
  - **Execution-plan store** (read; PLAN.004 versioned plans per task type, outcome attribution, `previous_version_id`)
    — **net-new Phase-4 store** owed to C8/C5 (C5 owns the live envelope `execution_plan`; the *versioned plan record* is
    the management artifact). Flagged below.
  - **Agent-health metric store** (read; HLTH.001–003 — success/failure rate, last-run, drift score, dead-agent flag,
    **producer heartbeat** AC-8.HLTH.004.2) — **net-new Phase-4 metric store**; read here for the per-agent badges, full
    panel on surface-05.
  - **C7-owned `event_log` / audit** (read) — registry-version audit (REG.004), routing decisions/outcomes (ORC.007),
    capability-change flags (OD-080).
- **ADR constraints:**
  - **ADR-001 §3** — intra-client only; one silo, **no `client_slug` column** anywhere (AC-8.REG.001.3); no
    cross-deployment view (that is surface-06).
  - **ADR-004** — the **Memory Agent is the sole writer identity**; the Builder **must not** allow granting memory-write
    capability to any second agent (AC-8.SPC.005.2) — enforced at write, not just audited.
  - **ADR-007** — the specialist **hard limits are defense-in-depth**: Comms never-sends (SPC.003), Finance never-transacts
    (SPC.004). The Builder is the third layer's first gate — a tool grant that would breach a hard limit is **rejected at
    write** (AC-8.SPC.003.3/.004.3), alongside the missing tool (C3) and the code enforcement (C6, AF-068).
  - **ADR-006** — registry edits are a **service_role-managed, human-gated** path (the OD-137 nodes); per-agent
    `memory_scope` is itself a least-privilege RLS-grade filter at retrieval (SCO.001 / OD-081), not a UI-only annotation.
  - **ADR-005** — the seed roster is **scripted provisioning** (REG.006), then operator-editable here.
  - **The three non-negotiables** — **#1** (immutable version history, mandatory `change_reason`, human-decided plan
    rollback — never overwrite, never auto-roll-back, OOS-030), **#2** (capability grants Super-Admin-only OD-080; the
    Comms/Finance/sole-writer hard-limit invariants rejected *at write*; the orchestrator's containment rests on its
    `memory_scope`, ORC.008/M5), **#3** (drift/dead-agent flag-never-auto-correct OD-078; sole-agent-disable warns;
    stalled metric producer shows stale not green HLTH.004.2; an empty `description` rejected, REG.001.2).

---

## Overview

surface-09 is the **agent-management console** of one client deployment — the surface a **Super Admin** (full authority)
and an **Admin** (the lighter description/tuning tier, OD-080) use to see and shape **who does the work**. It renders the
data-driven `agents` registry C8 defines: the **Agent Fleet** (the orchestrator + the eight seed specialists + any custom
agents, each a registry row, FR-8.REG.001/006), the **Agent Builder** (the per-agent definition editor — description,
memory scope, allowed tools, max-tokens, enabled state — every change a new immutable version with a mandatory reason,
FR-8.REG.004), and **Orchestration** (the read-only routing-config readout FR-8.ORC.004/006 + the versioned execution
plans FR-8.PLAN.004). It is the **act-on** counterpart to surface-05's self-improvement panel: surface-05 raises the flag
(drifting agent, dead agent, consistently-rerouted task type), surface-09 is where a human edits the description, narrows
the scope, or rolls back a plan — because in C8 the fix for mis-routing is **data, never code** (AC-8.ORC.003.1). The
cardinal sins here are a **capability grant that an Admin shouldn't make** (a #2 authority breach), a **hard-limit
invariant slipping through** — Comms handed a send tool, Finance a transaction tool, a second agent a memory-write tool
(a #2 containment breach, the most dangerous failure this surface can have), and a **drift/dead-agent flag silently
auto-acting** or a **stale health badge reading green** (a #3 false-healthy view).

---

## Access

> Uses the six canonical C1 roles (FR-1.ROLE.001). This is a **technical / power-user** surface — only **Super Admin** and
> **Admin** enter (the design-doc Asset Management "Create / edit agents" row, L509–615). The **two authority tiers** are
> the locked OD-080 split: **capability edits** (memory scope / tools / enabled / add / disable) = **Super Admin only**;
> **description / tuning / plan rollback** = **Super Admin + Admin**. Finance / HR / Account Manager / Standard User do
> not enter (an agent's *behaviour* affects them, but *defining* agents is not their function).

| Role | Can enter? | Notes |
|---|---|---|
| Super Admin | Yes | Full authority — capability edits (scope/tools/enabled/add/disable), description/tuning, plan rollback. Holds all three `PERM-agents.*` nodes |
| Admin | Yes | The **description/tuning tier only** (`PERM-agents.view` + `.edit_description`) — may edit descriptions, `max_tokens`, roll back plans; **capability fields are read-only** (memory scope / tools / enabled / add / disable are Super-Admin-only, OD-080) |
| Finance | No | An agent's behaviour touches finance, but defining agents is not a Finance function (no Asset Management node) |
| HR | No | No Asset Management node |
| Account Manager | No | No Asset Management node |
| Standard User | No | No Asset Management node |

**Entry gate:** the surface renders iff the caller holds `PERM-agents.view`; a caller without it never sees the nav item
and a direct URL returns 404 (FR-1.PERM.006 — denied surfaces are absent, not visible-but-empty). **Entry does not grant
editing** — capability changes require `PERM-agents.edit_capability` (Super Admin), description/tuning requires
`PERM-agents.edit_description`; **Layer-1 prompt editing routes out to C4** (`PERM-prompt.*`) and **config knobs to
surface-01** (`PERM-config.agents`). All nodes default-deny (OD-030).

---

## Layout

A **sectioned management console** on the client deployment, reached from the admin/system area of the navigation
(**OD-138**): a **fleet-grid landing** (one card per registry agent) with a **per-agent Builder drawer** that opens over
the grid, plus an **Orchestration** section reachable from a section nav. Persistent chrome: a sticky header with the
section nav (**Fleet · Orchestration**), a "view self-improvement signals → surface-05" link, and — when a save is in
flight — a mandatory **change-reason** modal (no silent edits, REG.004). The two always-loud notification banners
(alert-engine-stalled AC-7.ALR.008.2, alert-delivery-misconfigured AC-7.ALR.009.1) ride here as on every dashboard
(FR-7.ALR.001), pinned above any section.

- **Fleet section (landing):** the **Agent Fleet** grid (Section A); clicking a card opens the **Agent Builder** drawer
  (Section B), which carries the **Version History** tab (Section C).
- **Orchestration section:** the **Orchestration & Routing** readout (Section D) + the **Execution Plans** list
  (Section E).

**No section here holds a Realtime subscription** — surface-09 is a configuration/management surface, not one of the two
Realtime surfaces (FR-7.RTP.001 = approval queue + notification centre). The fleet **health badges** poll at
`polling_interval_agent_health_s` (60 s, FR-7.RTP.002); the registry / plans / readout are **static on load + on-demand
refresh** (they change only on an explicit human edit).

---

## Sections

> Five sections grouped into the three playbook buckets: **Agent Fleet** (A), **Agent Builder / specialist config**
> (B + C), **Orchestration** (D + E). Each live section states its poll contract and all five states.

---

### Section A — Agent Fleet (the roster grid; landing)

**Purpose:** The data-driven roster — one card per `agents` row (the orchestrator + the eight seed specialists + any
custom agents, FR-8.REG.001/006/003). Each card is a glance at *who exists, are they enabled, are they healthy*; clicking
opens the Builder (Section B). This is the act-on landing for surface-05's self-improvement flags.

**Data bindings:**
| Element | Source | Notes |
|---|---|---|
| Agent card (one per row) | C8 `agents` (FR-8.REG.001) | `name`, `description` (the routing signal), domain, `enabled` state, `version`, plus `model` — **read-only, config-derived** (not an `agents.model` column; FR-8.REG.001 defines none — model is selected by complexity per FR-8.COST.001, sourced from `default_model` / `lightweight_model` config, surface-01) |
| Enabled / disabled state | `agents.enabled` (FR-8.REG.005) | A disabled agent is **retained + shown greyed**, never routed (AC-8.REG.005.1); never silently dropped |
| Health badge | Agent-health metric store (FR-8.HLTH.001) | Success/failure rate + last-run; a **glance** — the full agent-health / self-improvement panel is **surface-05** (seam). Polls 60 s |
| Drift flag | FR-8.HLTH.002 (`drift_threshold`) | Surfaced, **never auto-corrected** (AC-8.HLTH.002.1) — a "review scope" badge links to the Builder |
| Dead-agent flag | FR-8.HLTH.003 (`dead_agent_threshold`) | Surfaced, **never auto-disabled** (AC-8.HLTH.003.2) — agent stays enabled until a human decides |
| Hard-limit chips | FR-8.SPC.002–005 | Read-only invariant chips on the seed specialists (Research "read-only", Comms "never sends", Finance "never transacts", Memory "sole writer") — explain why some tool grants are blocked in the Builder |

**Actions:**
| Action (label) | What it does | PERM gate |
|---|---|---|
| Open agent (card click) | Opens the Builder drawer (Section B) for that agent | `PERM-agents.view` (entry) |
| Add agent | Opens a blank Builder; insert an **enabled** row → auto-discovered next routing pass, no code change (FR-8.REG.003); an empty `description` is **rejected at write** (AC-8.REG.001.2) | `PERM-agents.edit_capability` (Super Admin) |
| Enable / disable | Toggles `agents.enabled`; **disabling a domain's sole enabled agent warns at disable-time** (AC-8.REG.005.3) and its future tasks hit clarification, not a silent drop (AC-8.REG.005.2) | `PERM-agents.edit_capability` (Super Admin) |
| Go to self-improvement signals | Links to **surface-05** (the full health / drift / routing-mismatch panel) | `PERM-dashboard.ops` (surface-05's gate) |

**Real-time / poll:** Cards are **static on load**; the **health/drift/dead-agent badges poll** at
`polling_interval_agent_health_s` (60 s, FR-7.RTP.002). Not Realtime.

**States:**
- **Loading:** Skeleton cards — **never an empty "no agents" before data** (a registry should always have the seed roster;
  a false-empty would imply the roster was lost — #1).
- **Empty:** Genuinely empty registry → "No agents — provisioning may not have completed" + a re-run pointer (the seed
  roster is provisioned, REG.006; a truly empty grid is an alarm, not a quiet zero-state).
- **Error:** Registry read fails → "Couldn't load the agent fleet" + retry; **never render an empty grid as if there were
  no agents**. A **health-badge** read failure shows **"—" / "health unavailable", never a green tick** (a stalled
  producer must not read as last-known-good, AC-8.HLTH.004.2).
- **Partial:** The registry loads but the health store is stale/down → cards render with badges marked **"stale (as-of
  HH:MM)"**, never green; drift/dead-agent flags that *did* load stay visible.
- **Offline / stale:** Badges show "as-of HH:MM" and are marked stale; the registry itself (which only changes on a human
  edit) is shown with a "last loaded HH:MM" + manual refresh.

---

### Section B — Agent Builder (the per-agent definition editor)

**Purpose:** Edit one agent's registry definition (FR-8.REG.001/004) — the description (the routing signal), memory scope,
allowed tools, max-tokens, enabled state (model is read-only, config-derived) — every change a **new immutable version with a mandatory `change_reason`**
(FR-8.REG.004). This is where the hard-limit invariants are enforced *at write*, and where the two OD-080 authority tiers
are visible: capability fields are Super-Admin-only; description/tuning is Super Admin + Admin.

**Data bindings:**
| Element | Source | Notes |
|---|---|---|
| Description | `agents.description` (FR-8.ORC.003 / REG.001) | The routing signal; **empty is rejected at write** (AC-8.REG.001.2). Editing it is the documented fix for a routing-mismatch flag (LRN.002) |
| Memory scope | `agents.memory_scope` json (FR-8.SCO.001/003) | A **least-privilege retrieval filter** (not a label) — the scope matrix per agent (L3467–3476). An invalid scope is **rejected at write** (AC-8.SCO.003.1) |
| Allowed tools | `agents.tools_allowed` uuid[] → C3 `tools` (FR-3.REG.002) | The tools picker; **hard-limit invariants constrain it** (see Actions) |
| Model (read-only) | `default_model` / `lightweight_model` (config, surface-01) + complexity routing (FR-8.COST.001) | **Read-only display** of which model the agent runs — model is selected by complexity (cost-routing), not a per-agent registry column (FR-8.REG.001 defines **no `agents.model` column**). A per-agent model override would be a **net-new Phase-4 field owed to C8** — not asserted here; the config defaults are edited on surface-01 |
| Max tokens | `agents.max_tokens` (REG.001) | Tuning field (description tier) |
| Enabled | `agents.enabled` (REG.005) | Capability field (Super-Admin) |
| Layer 1 (prompt) | **C4 `prompt_layers`** `WHERE agent_id=? AND layer='core'` (FR-8.REG.002) | **Displayed read-through; editing routes to C4** (`PERM-prompt.edit` / `.edit_principles`). No `core` layer → "no Layer 1 — assembly will halt" (C4 FR-4.LYR.004), never a blank that looks fine |
| Hard-limit invariants | FR-8.SPC.002–005, ADR-004/007 | Surfaced as locked constraints on the seed specialists (see Actions / OD-140) |

**Actions:**
| Action (label) | What it does | PERM gate |
|---|---|---|
| Edit description / max-tokens | Stages a change to the routing-signal text / token budget | `PERM-agents.edit_description` (Super Admin, Admin) |
| Edit memory scope | Stages a `memory_scope` change (a **capability** change — widens/narrows what the agent can read); invalid scope **rejected at write** (AC-8.SCO.003.1) | `PERM-agents.edit_capability` (**Super Admin only**) |
| Edit allowed tools | Stages a `tools_allowed` change; a grant that breaches a hard limit is **rejected at write** — **Comms + an autonomous-send tool** (AC-8.SPC.003.3), **Finance + a transaction tool** (AC-8.SPC.004.3), **any non-Memory agent + a memory-write tool** (AC-8.SPC.005.2, ADR-004 sole writer) — a code-level deny, not a mere audit (OD-140) | `PERM-agents.edit_capability` (**Super Admin only**) |
| Toggle enabled | Capability toggle (see Section A enable/disable, incl. the sole-agent warning) | `PERM-agents.edit_capability` (**Super Admin only**) |
| Edit Layer 1 prompt | **Routes out to C4** (the prompt editor); not edited inline here | `PERM-prompt.edit` / `.edit_principles` (C4) |
| Save (any edit) | Opens the **mandatory `change_reason` modal**; on confirm creates a **new version** (`version`++, `previous_version_id` set), writes the audit row, flags capability changes for review (OD-080); a save **without a reason is rejected** (AC-8.REG.004.1) | the field's tier (above) |

**Real-time / poll:** **Static on load + on-demand** — the definition changes only on an explicit human edit. No poll, no
Realtime.

**States:**
- **Loading:** Skeleton form; fields disabled until the row + the C4 Layer-1 read-through resolve.
- **Empty (Add-agent):** A blank Builder with the required fields marked; **Save is blocked until `description` is
  non-empty** (AC-8.REG.001.2) and a `change_reason` is given.
- **Error:** Read fails → "Couldn't load this agent" + retry. A **save** failure shows the edit as **not applied** (the
  prior version stands; nothing is half-written — REG.004 immutable history); a **hard-limit-rejected** grant shows the
  explicit reason ("Comms Agent can never hold an autonomous-send tool — hard limit", AC-8.SPC.003.3), never a silent
  drop.
- **Partial:** The registry row loads but the C4 Layer-1 read-through fails → the form renders with the prompt panel
  marked "Layer 1 unavailable — edit on the prompt surface", never a blank implying no prompt.
- **Offline / stale:** Editing disabled with "You're offline — changes can't be saved"; a staged-but-unsaved edit is held
  locally and clearly marked unsaved (never silently lost — #1), never auto-committed on reconnect without the
  `change_reason` step.

---

### Section C — Version History (per agent; a tab inside the Builder)

**Purpose:** The immutable version trail of one agent (FR-8.REG.004) — every prior version retrievable, each with its
`change_reason`, author, timestamp, and a **capability-change flag** (OD-080). Upholds #1: history is never overwritten.

**Data bindings:**
| Element | Source | Notes |
|---|---|---|
| Version list | `agents` version chain (`version`, `previous_version_id`, FR-8.REG.004) | Newest first; each prior version **retrievable** (AC-8.REG.004.2), never deleted |
| Change reason | `agents.change_reason` (REG.004) | Mandatory on every version (AC-8.REG.004.1) — no version exists without one |
| Author + timestamp | `agents.created_by` / `updated_at` | Who made the change, when |
| Capability-change flag | OD-080 / REG.004 | A version that changed `memory_scope` / `tools_allowed` / `enabled` is flagged as an authority change |
| Diff (version → version) | derived from the chain | What changed between two versions |

**Actions:**
| Action (label) | What it does | PERM gate |
|---|---|---|
| View a prior version | Shows the full definition at that version (read-only) | `PERM-agents.view` |
| Diff two versions | Shows the field-level delta | `PERM-agents.view` |
| Restore a prior version | Stages the prior definition as a **new** version (forward-only history; the restore is itself a new version with a reason — never an in-place rewind); a capability restore needs the capability tier | the restored fields' tier (capability → Super Admin; description → Admin) |

**Real-time / poll:** **Static on load + on-demand** — history grows only on an edit.

**States:**
- **Loading:** Skeleton version rows.
- **Empty:** A brand-new agent → only its seed/initial version (never truly empty — REG.004 means at least one version
  with a reason exists).
- **Error:** Read fails → "Couldn't load version history" + retry; **never render an empty history as if the agent had no
  prior versions** (a false-empty would imply history was lost — #1).
- **Partial:** Some versions resolve, others fail → render what loaded, mark the gap "some versions couldn't load", never
  imply the chain is complete.
- **Offline / stale:** "last loaded HH:MM" + manual refresh; restore disabled offline.

---

### Section D — Orchestration & Routing (the orchestrator + routing-config readout)

**Purpose:** The orchestrator's definition and the routing behaviour it runs (FR-8.ORC.*) — **read-mostly**: the
orchestrator is a registry agent (edited via the Builder, ORC.008); the routing *weights*, *confidence threshold*,
*chain-depth limit*, *models*, and *cache windows* are **config** (read-only readout here, **edited on surface-01
#agents**, `PERM-config.agents`). The cross-agent routing-outcome **trends** are surface-05 (seam); this section explains
*how routing works* + links out.

**Data bindings:**
| Element | Source | Notes |
|---|---|---|
| Orchestrator definition | C8 `agents` (the orchestrator row, ORC.008) | Its restricted memory scope (semantic + entity model + tool registry) + Layer 1; edited via the Builder. Its containment **rests on its `memory_scope`** (M5 / OD-081) — flagged as load-bearing |
| Routing weights | `routing_weights` (read-only; surface-01) | domain 0.35 / complexity 0.25 / memory 0.20 / tool 0.20 (sum = 1.0); "edit on surface-01 #agents" |
| Confidence threshold | `orchestrator_confidence_threshold` (read-only; surface-01) | 0.75 — the cost/quality dial (COST.002); below it → human clarification (ORC.006), never silent |
| Chain-depth limit | `chain_depth_limit` (read-only; surface-01) | 6 — enforced at build time (PLAN.003) |
| Models | `default_model` / `lightweight_model` (read-only; surface-01) | sonnet-4-6 / haiku-4-5 |
| Cost tiers | FR-8.COST.001 | single / two-agent / full-chain — explained, cheapest-that-fits |
| Routing-mismatch suggestions | FR-8.LRN.002 (produced by C8, surfaced by surface-05) | A "description may need updating" pointer **links to the Builder** (act-on) — the metric/panel is surface-05 |

**Actions:**
| Action (label) | What it does | PERM gate |
|---|---|---|
| Open orchestrator in Builder | Edits the orchestrator's description / scope / Layer 1 (its scope is load-bearing — M5) | the field's tier (capability → Super Admin) |
| Edit routing config → | Links to **surface-01 #agents** for weights / threshold / depth / models / cache | `PERM-config.agents` (surface-01) |
| Act on a routing-mismatch suggestion | Jumps to the implicated agent's Builder to edit its description (the data fix, AC-8.ORC.003.1) | `PERM-agents.edit_description` |

**Real-time / poll:** **Static on load + on-demand**. Config values are a read-only readout (live-edited on surface-01);
mismatch suggestions are produced on the slow loop (surface-05 owns their freshness).

**States:**
- **Loading:** Skeleton readout.
- **Empty:** N/A — the orchestrator + routing config always exist (seeded REG.006 / config defaults). If the orchestrator
  row is **missing**, that is an **alarm** ("orchestrator not found — routing cannot run"), never a quiet empty.
- **Error:** Config/registry read fails → "Couldn't load routing configuration" + retry; **never show defaults as if they
  were the live values** (a wrong threshold reading green would mislead a cost decision — show "—").
- **Partial:** The orchestrator row loads but a config value fails → render what loaded, mark the missing value "—", never
  substitute a default silently.
- **Offline / stale:** "as-of HH:MM"; the "edit on surface-01" link still routes but the readout is marked stale.

---

### Section E — Execution Plans (versioned plans per task type + human-decided rollback)

**Purpose:** The versioned execution plans for common task types (FR-8.PLAN.004) — outcome attribution per plan version,
and **human-decided rollback** to a prior version (never automatic — OOS-030, consistent with OD-010). Each step of a
plan carries its assigned failure mode (PLAN.001), defaulting to halt-and-escalate (PLAN.002).

**Data bindings:**
| Element | Source | Notes |
|---|---|---|
| Plan list (by task type) | Execution-plan store (PLAN.004) | One entry per common task type, with its current version |
| Plan version chain | PLAN.004 (`previous_version_id`) | A new version supersedes but **never deletes** the prior (audit) |
| Step + failure mode | FR-8.PLAN.001/002 | Each step's assigned mode {retry / skip-and-continue / halt-and-escalate}; unassigned defaults to halt-and-escalate (AC-8.PLAN.002.1) |
| Outcome attribution | FR-8.ORC.007 / PLAN.004 | Success/failure/skip per step attributed to the plan version (feeds the routing-learning signal) |

**Actions:**
| Action (label) | What it does | PERM gate |
|---|---|---|
| View a plan version | Shows the full plan + per-step failure modes + outcomes (read-only) | `PERM-agents.view` |
| Roll back to a prior version | **Human-initiated, audited** rollback (AC-8.PLAN.004.2) — never automatic (OOS-030); creates a forward record, never an in-place rewind | `PERM-agents.edit_description` (Asset Management "task graphs", SA + Admin) |

**Real-time / poll:** **Static on load + on-demand** — plans change only on a human edit/rollback or a new version event.

**States:**
- **Loading:** Skeleton plan rows.
- **Empty:** Genuinely no versioned plans yet → "No versioned plans yet — they appear as recurring task types are seen"
  (a true cold-start, distinct from a fetch failure).
- **Error:** Read fails → "Couldn't load execution plans" + retry; rollback **disabled** while the chain is unconfirmed
  (a rollback against a wrongly-loaded chain is a #2 risk — never offer it on uncertain state).
- **Partial:** Some plans/versions load, others fail → render what loaded, mark gaps, never imply completeness.
- **Offline / stale:** "as-of HH:MM"; rollback disabled offline (a destructive-ish action on stale state).

---

## Navigation / transitions

| Trigger | Destination |
|---|---|
| Admin/system nav → Agent management | surface-09 (fleet landing) |
| Fleet card click | Section B Agent Builder drawer (with the Version History tab, Section C) |
| Builder → Edit Layer 1 prompt | The C4 prompt editor (`PERM-prompt.*`) |
| Builder / Orchestration → Edit config knobs | surface-01 #agents (`PERM-config.agents`) |
| Fleet / Orchestration → self-improvement signals + routing trends | surface-05 (`PERM-dashboard.ops`) |
| Routing-mismatch suggestion → act | The implicated agent's Builder (edit description) |
| Tools picker → tool registry | surface (C3 tool registry, `PERM-tool.manage`) |

---

## Mobile

This is a **desktop-first management surface** — defining agent memory scopes, tool grants, and execution plans is a
considered, wide-canvas task, not a phone task. On a narrow viewport it degrades to a **read-mostly** view: the fleet grid
collapses to a single-column list with health badges (a Super Admin can *see* fleet health and *disable* a misbehaving
agent from a phone — the disable still carries the sole-agent warning and the `change_reason` step), but the full Builder
(scope/tools editing) and plan rollback are **best-effort / discouraged on mobile** and may be gated behind an "edit on
desktop" notice rather than offering a cramped capability editor (a mis-set scope or tool grant is a #2 risk — better
deferred than fat-fingered). The two protective notification banners remain mandatory. Detailed mobile treatment:
`surface-12-mobile.md`.

---

## Open decisions

| # | Question | Options | Recommendation |
|---|---|---|---|
| OD-137 ⚠️ **Rule-0 PERM gap** | The agent fleet/builder needs an entry + edit authority model, and OD-080 already split that authority — but **no concrete `PERM-agents.*` node was ever catalogued**. The design-doc's Asset Management category names "Create / edit agents (Super Admin + Admin)" (L509–615) but the catalog has no Asset Management section. A gate with no catalog entry is a build-time #3 defect. | (a) **Mint the `PERM-agents.*` family via change-control** under the **existing** FR-1.PERM.007 Asset Management category, scope **intra-client**, refined by the locked OD-080: `PERM-agents.view` (entry — SA + Admin), `PERM-agents.edit_description` (description/tuning/plan-rollback — SA + Admin), `PERM-agents.edit_capability` (memory scope / tools / enabled / add / disable — **SA only**). (b) Reuse `PERM-config.agents` (wrong — that gates the config *knobs* on surface-01, not registry CRUD; and it's SA-only, losing the Admin description tier). (c) One coarse `PERM-agents.manage` node (loses the OD-080 capability-vs-description split — an Admin would get capability edits, a #2 breach). | **(a)** — closes a real Rule-0 gap, homes the family under the **already-homed** Asset Management category (no new category, no ADR supersede — mirrors OD-117/OD-125/OD-129/OD-133), and the three-node split **encodes OD-080 exactly** (capability = SA only, *tighter* than the design-doc's coarse SA+Admin; description/tuning = SA+Admin). **Transcribe into `PERMISSION_NODES.md` immediately** (catalog 45→48, + a new Asset Management section). **C1 catalog grows; no FR re-approval.** |
| OD-138 | **Layout** — fleet-grid landing + Builder drawer + Orchestration section, vs a fully-tabbed surface, vs a single scroll. | (a) **Fleet-grid landing + per-agent Builder drawer (with a Version History tab) + an Orchestration section** reached via section nav. (b) Fully tabbed (Fleet / Builder / Orchestration / Plans). (c) Single long scroll. | **(a)** — the fleet grid is the natural home (you pick an agent, then edit it), and a drawer keeps the grid context while editing; the Orchestration + Plans content is distinct enough for its own section. Tabbing (b) separates an agent from its history/edit; a single scroll (c) buries the orchestration config. Consistent with surface-06's grid-landing + detail-drawer pattern (OD-126). |
| OD-139 | **Edit gating + change-reason UX** — how the two OD-080 authority tiers and the mandatory `change_reason` are presented. | (a) **Inline split** — render all fields in one Builder; **capability fields (scope/tools/enabled) are read-only/locked for an Admin** with a "Super-Admin-only" affordance, description/tuning fields editable; **every Save opens a mandatory `change_reason` modal** (no silent edits, REG.004); capability saves are flagged as authority changes. (b) Two separate edit modes (description-edit vs capability-edit) behind a mode switch. (c) Reason optional, captured if given. | **(a)** — one Builder with clearly-locked capability fields makes the OD-080 boundary visible (an Admin *sees* the capability fields but cannot edit them — transparency over hiding, #3), and the mandatory reason modal enforces REG.004's "no version without a reason" (AC-8.REG.004.1) uniformly. (b) hides half the definition behind a mode; (c) violates REG.004. |
| OD-140 | **Hard-limit invariant presentation** — how the reject-at-write invariants (Comms never-sends, Finance never-transacts, sole-writer memory) appear in the tools/scope picker. | (a) **Show + explain + block** — the forbidden tool appears in the picker **greyed with an inline reason** ("Comms Agent can never hold an autonomous-send tool — hard limit, ADR-007"); any attempt to grant it is **rejected at write** with the reason logged (AC-8.SPC.003.3/.004.3/.005.2). (b) Hide the forbidden tools entirely (looks like an oversight; a future operator can't tell *why* it's absent). (c) Allow the grant, warn, rely on C3/C6 downstream (drops the Builder's defense-in-depth layer — a #2 hole). | **(a)** — surfacing the constraint *with its reason* is the #3-honest choice (a hidden constraint reads as a bug; a visible "this is a hard limit" teaches the operator the invariant), and the **reject-at-write** is the Builder's defense-in-depth layer alongside the missing tool (C3) and the code enforcement (C6) — exactly what AC-8.SPC.003.3/.004.3/.005.2 mandate (a code-level deny, not a mere audit). (b) hides intent; (c) removes a safety layer. |

---

## Phase 4 data binding notes

- **C8 `agents`** (read/write here) — the registry; per row id / `name` (slug only inside the name string, **no
  `client_slug` column** AC-8.REG.001.3) / `description` / `memory_scope` (json) / `tools_allowed` (uuid[] → C3 `tools`) /
  `max_tokens` / `enabled` / `version` / `created_at` / `updated_at` / `created_by` / `previous_version_id` /
  `change_reason`; **no `system_prompt`** (OD-075). Phase 4: the version chain (`previous_version_id`) must be queryable
  for the history/diff; `enabled` indexed for the routing candidacy read. **No `client_slug`.** RLS: registry edits are a
  `service_role`-managed path gated by the OD-137 nodes (human-path authorization), not row-level per-user RLS.
- **C4 `prompt_layers`** (read-through here) — Layer 1 `WHERE agent_id=? AND layer='core'` (FR-8.REG.002); editing is C4's
  (`PERM-prompt.*`). Phase 4: the read-through join must surface "no core layer" distinctly (assembly-halt condition,
  FR-4.LYR.004), never a null that renders blank.
- **C3 `tools`** (read here) — `tools_allowed` references tool ids (FR-3.REG.002); the picker reads tool id + description.
- **Execution-plan store (NET-NEW Phase-4, PLAN.004)** — versioned plans per task type: id, task-type key, plan body
  (steps + per-step failure mode), `version`, `previous_version_id`, outcome attribution. C5 owns the live envelope
  `execution_plan`; this **versioned management record is owed to C8/C5 to home formally**. **No `client_slug`.**
- **Agent-health metric store (NET-NEW Phase-4, HLTH.001–003)** — per-agent success/failure rate, last-run, drift score,
  dead-agent flag, and a **producer heartbeat / last-emitted timestamp** so a stalled producer renders "stale", not green
  (AC-8.HLTH.004.2). Read here for badges; the full panel is surface-05. **No `client_slug`.**
- **C7 `event_log` / audit** (read here) — registry-version audit (REG.004, incl. capability-change flags OD-080),
  routing decisions/outcomes (ORC.007). **No `client_slug`** (C7 OD-067).
- **New intra-client PERM nodes (OD-137)** — `PERM-agents.view` / `.edit_description` (default SA + Admin),
  `.edit_capability` (default SA only), scope **intra-client**, under the FR-1.PERM.007 Asset Management category; owed to
  `PERMISSION_NODES.md` with all four fields (FR-1.PERM.005) — **transcribed this session**.
- **Hard-limit enforcement (reject-at-write)** — the Builder's tool/scope save path must enforce AC-8.SPC.003.3 (Comms ⊄
  send), AC-8.SPC.004.3 (Finance ⊄ transaction), AC-8.SPC.005.2 (only Memory holds memory-write) as a **code-level deny**,
  not a UI hint — Phase 4/6 wires this into the registry write API, not just the front end.
