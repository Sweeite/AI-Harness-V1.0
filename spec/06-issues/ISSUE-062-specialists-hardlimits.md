---
id: ISSUE-062
title: Eight specialist definitions + per-agent hard limits
epic: H — agent design
status: ready
github: "#62"
---

# ISSUE-062 — Eight specialist definitions + per-agent hard limits

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Define the eight canonical specialist agents (Research, Client, Campaign, Comms, Ops, Memory, Finance, Insight) as data-driven registry rows, each with a single-domain description and least-privilege scope, and enforce the three per-agent negative invariants in code — Comms never sends autonomously, Finance never initiates transactions, Memory is the sole memory-writer — rejected **at registry write**, not merely audited.

## 2. Scope — in / out
**In:** The specialist half of the C8 agent roster (`agents` rows and their contracts): each of the eight specialists defined with a single-domain `description` (the routing signal), Research placed read-only + first-in-chain, the Comms Agent's approval-queue-only output path, the Finance Agent's read-heavy finance-scoped-Confidential definition, the Memory Agent as the sole identity for the C2 write flow, and the Insight Agent as slow-loop / read-all / no-write / not-on-demand. The load-bearing deliverable is the **reject-at-write** enforcement on `agents.tools_allowed`: any registry edit that would grant the Comms Agent an autonomous-send tool, grant the Finance Agent a transaction-initiating tool, or grant memory-write capability to any agent other than the Memory Agent must be **denied at save at the code layer** (a negative invariant, not an audited capability change). These invariants are the C8 expression of three of the seven ADR-007 hard limits.

**Out:** The orchestrator, the 7-step routing process, the `agents` table schema/migration, `enabled`-gates-discovery, version discipline, and the **seed** of the canonical roster at provisioning (incl. AC-8.REG.006.3 positive seed-time invariant check) — all owned by **ISSUE-061** (C8 ORC/REG). The per-agent `memory_scope` value expressed as an actual retrieval **filter** (SCO.001–003, the enforcement consumer, OD-081) — owned by **ISSUE-063**. The seven-hard-limits **runtime** code enforcement at the connector/execution layer (C6 FR-6.HRD.*) — owned by **ISSUE-055**; this issue owns only the registry-write-time invariants on the three agent definitions, which sit *on top of* that runtime layer (defense in depth: prompt + missing tool + approval gate + runtime hard limit). The agent-builder UI that renders these rows — **ISSUE-067** (surface-09).

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-8.SPC.001, FR-8.SPC.002, FR-8.SPC.003, FR-8.SPC.004, FR-8.SPC.005, FR-8.SPC.006 (component-08 Agent Design).
- **NFRs:** NFR-SEC.004 (the seven hard limits are code-enforced and non-overridable — this slice implements its FR-8.SPC.003/004/005 + rejected-at-write clauses).
- **Rests on:** ADR-007 §1 (injection posture / hard-limit set), ADR-004 (concurrency model — single memory writer), AF-068 (hard-limit containment red-team, launch-gating spike).

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-8.SPC.001.1
- AC-8.SPC.002.1, AC-8.SPC.002.2
- AC-8.SPC.003.1, AC-8.SPC.003.2, AC-8.SPC.003.3
- AC-8.SPC.004.1, AC-8.SPC.004.2, AC-8.SPC.004.3
- AC-8.SPC.005.1, AC-8.SPC.005.2
- AC-8.SPC.006.1, AC-8.SPC.006.2
- AC-NFR-SEC.004.2 (registry-editor reject-at-save for Comms send / Finance transact / non-Memory-Agent memory write — the NFR posture this slice satisfies)
- **Gating spikes (if any):** **AF-068** (hard-limit containment red-team, RP-1 launch-blocking per OD-157) must be GREEN before this issue ships — it is the standing enforceability gate on FR-8.SPC.003/004 and AC-8.SPC.004.2; proven by **ISSUE-003** (SPIKE: injection containment red-team). AF-121 (description-driven routing accuracy) gates the routing premise behind SPC.001's single-domain descriptions and is a build-time EVAL, not launch-blocking.

## 5. Touches (complete blast radius, by ID)
- **DATA:** `agents` (specifically `agents.description`, `agents.tools_allowed`, `agents.memory_scope`, `agents.enabled` — read + the reject-at-write guard on `tools_allowed`). Read-only against `tools` (schema §4, C3) to resolve the three forbidden tool classes by ID (see build-order step 4 — the classification predicate).
- **PERM:** `PERM-agents.edit_capability` (OD-080 capability tier, RESOLVED — Super Admin only for `tools_allowed`/`memory_scope`/`enabled` edits; the node family is defined in `open-decisions.md` OD-080, not yet transcribed to a standalone nodes file). The reject-at-write guard fires **regardless of caller role** — it is a negative invariant on the data, so it is independent of the OD-080 authority value (that PERM binding gates *who may open the editor*, not *whether the invariant holds*).
- **CFG:** none.
- **UI:** none in this slice (registry editor is UI-registry-editor, rendered by ISSUE-067 / surface-09).
- **Connectors:** none directly (Comms send + Finance transaction tools live behind C3 FR-3.ACT.*; this slice enforces their *exclusion* from the relevant agents' `tools_allowed`).

## 6. Context manifest (the EXACT files to open — nothing more)
- spec/01-requirements/component-08-agent-design.md §Area SPC (FR-8.SPC.001–006 + their ACs; header note M6 for the reject-at-write invariants).
- spec/04-data-model/schema.md §9 Agent Design (C8) — the `agents` table (`description`, `memory_scope`, `tools_allowed`, `enabled`; note "hard-limit invariants reject-at-write" on `tools_allowed`). **AND §4 Tools & Connectors (C3)** — the `tools` table (`category`, `risk_level`, `requires_approval`, `connector`, `scopes`): the target of the `tools_allowed → tools.id` reference the guard classifies (see build-order step 4).
- spec/01-requirements/component-03-tool-layer.md — the **classification predicate** for the reject-at-write guard: **FR-3.ACT.007** (the single internal memory-write tool — "memory-write capability" = holding *that* tool's id; ADR-004 sole-writer); **FR-3.ACT.004** (Comms external send → draft-only; the "autonomous-send tool" is a C3 send tool that would bypass this draft path — hard limit #1); **FR-3.ACT.002** (the seven hard limits; its note states the **financial-transaction** and **impersonation** limits have *no C3 mechanism* — so **no transaction-initiating tool exists in the registry today**; the Finance guard therefore blocks *adding* one). These three FRs are what turn the three forbidden tool *classes* into concrete tool ids the guard can match — without this file the predicate is unresolvable.
- spec/05-non-functional/security.md §NFR-SEC.004 — the seven-hard-limits posture + AC-NFR-SEC.004.2 reject-at-save clause (which names AC-8.SPC.005.2 among the rejected-at-write ACs) + AF-068 launch gate.
- spec/00-foundations/adr/ADR-007-injection-posture.md — §1 hard-limit set (capability control, not detection).
- spec/00-foundations/adr/ADR-004-concurrency-model.md — single memory writer (Memory Agent sole-writer identity, FR-8.SPC.005).
- spec/00-foundations/open-decisions.md — **OD-080** (RESOLVED — the `PERM-agents.*` node family and the capability-vs-description authority split gating the registry editor) and **OD-140** (RESOLVED — the hard-limit invariant presentation: forbidden tool shown greyed with an inline reason **and rejected at write** with the reason logged, binding AC-8.SPC.003.3 / .004.3 / .005.2).

## 7. Dependencies
- **Blocked-by:** ISSUE-061 (orchestrator + agents registry + seed roster — the `agents` table and REG.006 seed must exist before specialist rows and their invariants can be defined), ISSUE-043 (Layer-1 identity/principles/limits — the Layer-1 prompt content each specialist resolves from `prompt_layers`, OD-075); **ISSUE-003** (SPIKE) gates ship-readiness via AF-068.
- **Blocks:** ISSUE-063 (per-agent memory scoping — needs the specialist rows + `memory_scope` values), ISSUE-067 (agent builder surface — renders REG/SPC/PLAN/HLTH).

## 8. Build order within the slice
1. Confirm the `agents` table + seed roster from ISSUE-061 are in place (rows exist for orchestrator + 8 specialists; `agents.tools_allowed`, `description`, `memory_scope`, `enabled` columns present per schema §9).
2. Define each specialist's single-domain `description` (FR-8.SPC.001) — the routing signal; Research, Client, Campaign, Comms, Ops, Memory, Finance, Insight. **The concrete `description` prose and `memory_scope` values are authored by the ISSUE-061 seed roster (REG.006, design-doc L3423–3439), not by this issue's manifest** — this slice consumes those rows and asserts their invariants; it does not originate the content. (This is why ISSUE-061 is blocked-by, field 7. If the seed rows are absent, stop — a builder must not invent description/scope text here.)
3. Set each specialist's `tools_allowed` to its least-privilege set: Research read-only / no write-or-action tools (FR-8.SPC.002); Comms excludes any C3 autonomous-send tool (FR-8.SPC.003); Finance excludes any transaction-initiating tool + finance-scoped Confidential clearance (FR-8.SPC.004); only the Memory Agent holds memory-write capability (FR-8.SPC.005, ADR-004); Insight read-all / no-write (FR-8.SPC.006).
4. Implement the **reject-at-write invariant** on `agents.tools_allowed` (the load-bearing step): a code-level deny at the registry save path that rejects (a) an autonomous-send tool added to the Comms Agent, (b) a transaction-initiating tool added to the Finance Agent, (c) memory-write capability added to any non-Memory agent — AC-8.SPC.003.3 / .004.3 / .005.2 + AC-NFR-SEC.004.2. This is a save-time guard, not an audit event.
   **Resolve the tool-classification predicate first (do not guess which tool ids count).** The `tools` table (schema §4) carries only `category` (`read`/`write`), `risk_level`, `requires_approval`, `connector`, `scopes` — none of which by itself splits *send* vs *transact* vs *memory-write* (all three are `category='write'`). The three forbidden classes resolve **by tool identity via C3, not by a column**:
   - **memory-write capability** = the single internal memory-write tool registered under **FR-3.ACT.007** (ADR-004 sole-writer). Predicate: any agent other than the Memory Agent whose `tools_allowed` contains *that* tool's id → reject.
   - **autonomous-send tool** (Comms) = a C3 send tool that would deliver externally without the FR-3.ACT.004 draft/approval path (hard limit #1, ADR-007). Predicate: the Comms Agent's `tools_allowed` gaining such a tool id → reject. (Today the only external-email tool is draft-only per FR-3.ACT.004; the guard blocks a future direct-send tool.)
   - **transaction-initiating tool** (Finance) = a tool realizing hard limit #2 (financial transaction). Per the FR-3.ACT.002 note, **the financial-transaction and impersonation limits have no C3 tool/mechanism today — no such tool exists in the registry** — so the guard blocks *adding* any transaction-initiating tool id to the Finance Agent.
   Implementation note: since the discriminator is not a stored column, the guard needs an explicit, version-controlled classification of tool ids into these three classes (a code constant or a `tools.config`/tag convention owned with C3). That classifier is a build artifact of this step; flag it against **AF-068** (its correctness is part of the red-team battery). This mirrors OD-140's "show + explain + block" (the picker already knows which tool is forbidden, so the same classification drives both the greyed-picker reason and the save-time deny).
5. Wire the Comms output path so a comms task's product lands in the approval queue (C6 FR-6.APR.* home; this slice asserts the specialist produces a draft, never an outbound send) and the Finance payment-implying task produces a human flag, never a transaction.
6. Constrain Research to first-in-chain when gathering is needed and Insight to slow-loop-only / not-selectable-on-demand (routing-side assertions verified against the orchestrator from ISSUE-061).
7. Tests to the ACs in field 4 — including negative-invariant tests that a forbidden `tools_allowed` edit is denied at save (not merely logged), and inclusion in the AF-068 red-team battery.

## 9. Verification (how DoD is proven)
- Per spec/05-non-functional/test-strategy.md: unit + agent-definition-write tests for each SPC AC; the three reject-at-write invariants proven by negative tests at the registry save path (edit denied, not audited); routing-side assertions (Research-first, Insight-not-on-demand) as integration tests against the ISSUE-061 orchestrator.
- **AC-NFR-SEC.004** posture must hold: no UI/API path grants a hard-limited capability to Comms/Finance or memory-write to a non-Memory agent. The `Verified` path for FR-8.SPC.003/004 requires the **AF-068** red-team battery (ISSUE-003) to be GREEN — it is the launch-blocking enforceability proof (RP-1); no test may achieve a hard-limited effect without an explicit, authorized, non-bypassable human step.
