---
id: ISSUE-072
title: Command dispatch + node-gating + custom commands
epic: I — proactive
status: blocked
github: "#72"
---

# ISSUE-072 — Command dispatch + node-gating + custom commands

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Build the `/` chat-command system — dispatch to home components, per-command C1 permission-node gating, destructive-confirm, pill+`event_log` audit, mobile menu — plus admin-authored custom commands (define / register / invoke) via `UI-COMMANDS`, all running the same C6 pipeline as any agent run.

## 2. Scope — in / out
**In:**
- The whole C9 **CMD** area (FR-9.CMD.001–008): the `/` dispatch registry that routes each command to its home component (C2 memory / C5-C6 task / C8 agent / C5-C7-config system); per-command permission-node gating evaluated against the caller's C1 node set (default-deny, "Agency Owner" resolved as node assignment, never a role); destructive-confirm ordered *after* the node gate and never the sole barrier; the pill-response + `event_log` write on every command with fail-closed for destructive/node-gated commands; the mobile tap-optimised menu contract (C9 owns the set + "common"; surface-12 renders).
- **Custom commands** end-to-end: the `commands` store CRUD via `UI-COMMANDS` (slug collision-check vs system slugs, agent-required, invocation-node choice with author-authority least-privilege), registration into the unified `/` menu (labelled "Custom", inactive hidden), and synchronous invocation (`$ARGUMENTS` substitution, dispatch to assigned agent, inline pill result) — creating/reusing a `task_queue` row exactly like any other agent action (OD-165) and carrying the wrapped action's real C6 tier (a definition can add friction, never lower the tier).
- The `UI-COMMANDS` management surface (surface-10): the custom-command list, the Command Builder drawer, and the read-only System-Command Reference — the three sections and their five states.

**Out:**
- **Invocation rendering in chat** (the inline `/slug` response + answer-mode pill on surface-08) — surface-08 renders; this issue owns the dispatch/definition contract that makes it possible. The chat thread stores (`conversations` / `messages`, OD-135) are Phase-4 net-new owned elsewhere.
- **The C6 guardrail pipeline itself** (approval tiers, hard limits, anomaly) — ISSUE-055/056/057; this slice *routes through* it, does not implement it.
- **The agent registry / `agents` table** a command binds to (C8 REG) — ISSUE-061; this slice only reads it.
- **The C1 node model + `can()` gate** the node check calls — ISSUE-018 (blocked-by).
- **The run pipeline / `task_queue` row machinery + approval routing** the invocation creates — ISSUE-053 (blocked-by) + ISSUE-048/056.
- **The `event_log` sink + fail-loud log-failure path** — ISSUE-011; this slice *writes to it* and enforces fail-closed for audit-critical commands.
- The **mobile rendering** of the quick-tap menu — surface-12 / ISSUE-079.
- The other C9 areas (MODE/PRO/SUG/CST) — ISSUE-068/069/070/071.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-9.CMD.001, FR-9.CMD.002, FR-9.CMD.003, FR-9.CMD.004, FR-9.CMD.005, FR-9.CMD.006, FR-9.CMD.007, FR-9.CMD.008 (all C9 Proactive Intelligence).
- **NFRs:** NFR-SEC.014 (least-privilege on custom commands); NFR-A11Y.001 (surface baseline floor — applies to `UI-COMMANDS`).
- **Rests on:** ADR-006 (permissions-in-data — command gates on a C1 node, never a hardcoded role), ADR-001 §3 (intra-client — no `client_slug` on the `commands` store or any binding), ADR-007 / C6 (every invocation runs the same C6 guardrail pipeline); OD-086 (`/` gating → node, "Agency Owner" dissolved), OD-142 (invocation-node least-privilege → AC-9.CMD.006.4), OD-143 (a definition can never lower the C6 tier → AC-9.CMD.008.4), OD-165 (invocation creates/reuses a `task_queue` row, routes to surface-04 approval like any agent action). No launch-gating spike or AF gates the CMD area.

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-9.CMD.001.1, AC-9.CMD.001.2
- AC-9.CMD.002.1, AC-9.CMD.002.2, AC-9.CMD.002.3
- AC-9.CMD.003.1, AC-9.CMD.003.2, AC-9.CMD.003.3
- AC-9.CMD.004.1, AC-9.CMD.004.2, AC-9.CMD.004.3
- AC-9.CMD.005.1
- AC-9.CMD.006.1, AC-9.CMD.006.2, AC-9.CMD.006.3, AC-9.CMD.006.4
- AC-9.CMD.007.1, AC-9.CMD.007.2
- AC-9.CMD.008.1, AC-9.CMD.008.2, AC-9.CMD.008.3, AC-9.CMD.008.4
- AC-NFR-SEC.014.1, AC-NFR-SEC.014.2
- AC-NFR-A11Y.001.1, AC-NFR-A11Y.001.2 (for `UI-COMMANDS`)
- **Gating spikes (if any):** none — the CMD area rests on no OD-157 launch spike or build-time AF.

## 5. Touches (complete blast radius, by ID)
- **DATA:** `commands` (net-new Phase-4; user-defined only — `slug`, `display_name`, `description`, `prompt_template` (`$ARGUMENTS`), `assigned_agent_id` → `agents`, `perm_node`, `active`, `created_by`; no `client_slug`); `agents` (read — enabled-agent picker + disabled-agent watch that auto-flips `commands.active` false); `event_log` (write — per-invocation audit, C7); `task_queue` (write/reuse on custom-command invocation, OD-165, C5). System commands are code-registered (read-only reference), never rows.
- **PERM:** `PERM-commands.manage` (create/edit/delete/enable-disable custom commands; Super Admin + Admin); `PERM-system.tune` (gates `/tune` + full system-command set; shown read-only on the System-Command Reference); the per-command invocation node (chosen from the existing C1 node catalog at definition time — no node minted here; default-deny if unmapped).
- **CFG:** none — the CMD FRs declare no config keys (all list "Config dependencies: —").
- **UI:** `UI-COMMANDS` (surface-10 — the custom-command list, Command Builder, System-Command Reference); the `/` command menu + mobile quick-tap menu (surface-08 / surface-12 render; contract owned here).
- **Connectors:** none.

## 6. Context manifest (the EXACT files to open — nothing more)
- `spec/01-requirements/component-09-proactive.md` — the CMD FR text + all AC-9.CMD.* acceptance criteria (§CMD, FR-9.CMD.001–008).
- `spec/03-surfaces/surface-10-commands.md` — the `UI-COMMANDS` states, sections, and data bindings.
- `spec/04-data-model/schema.md` §10 Proactive (C9) — the `commands` table (and `agents` in §9 Agent Design for the FK/read).
- `spec/05-non-functional/security.md` §NFR-SEC.014 — the least-privilege-on-custom-commands posture + its AC.
- `spec/05-non-functional/observability.md` §NFR-A11Y.001 — the surface accessibility baseline floor + its AC.
- `spec/00-foundations/adr/ADR-006-*.md` (permissions-in-data), `ADR-001-*.md` §3 (intra-client isolation), `ADR-007-*.md` (guardrail pipeline).

## 7. Dependencies
- **Blocked-by:** ISSUE-018 (C1 role model + permission matrix + `can()` gate — the node check FR-9.CMD.002 / AC-9.CMD.006.4 calls); ISSUE-053 (run pipeline — the `task_queue` row + C6-tier + approval routing a custom-command invocation creates/reuses, OD-165). Neither is a spike; no AF gate.
- **Blocks:** none (leaf).

## 8. Build order within the slice
1. **Migration** — add the `commands` table (schema.md §10; net-new, user-defined only; no `client_slug`) with the unique-slug constraint; add the `active` auto-flip trigger/reconcile pass that watches `agents.enabled` transitions (AC-9.CMD.006.3).
2. **Dispatch registry (FR-9.CMD.001)** — the `/` command registry that code-registers system commands by home component and routes a parsed `/slug [args]` to the correct home action; unknown command → guidance, never a silent no-op; home unavailable → explicit error.
3. **Node gating (FR-9.CMD.002)** — evaluate the command's mapped C1 node against the caller's node set via the ISSUE-018 `can()` gate; default node assignments per the FR; unmapped node → denied by default; "Agency Owner" realized as node assignment.
4. **Destructive-confirm (FR-9.CMD.003)** — order the node gate *before* the confirm prompt (AC-9.CMD.003.3); the confirm is additive to the action's C6 tier, never the sole barrier.
5. **Pill + audit (FR-9.CMD.004)** — every executed/denied command writes an `event_log` row and returns an answer-mode pill; **fail closed** for destructive or node-gated commands whose log write fails (AC-9.CMD.004.3, mirrors C6 AC-6.LOG.003.3).
6. **Custom-command CRUD (FR-9.CMD.006)** — the `UI-COMMANDS` Command Builder save path: slug collision-check vs system + existing custom slugs (loud rejection, never rename); agent-required; invocation-node picker enforcing author-authority least-privilege at write (AC-9.CMD.006.4 / NFR-SEC.014) — reject a node above the manager's own authority.
7. **Registration (FR-9.CMD.007)** — register active custom commands into the unified `/` menu alongside system commands, labelled "Custom"; inactive commands hidden, never shown broken; never shadow a system slug (the save-time check is the enforcement point).
8. **Invocation (FR-9.CMD.008)** — resolve the prompt template (`$ARGUMENTS` → args or empty string), dispatch to the assigned agent, create/reuse a `task_queue` row exactly like any agent action (OD-165) carrying the wrapped action's real C6 tier (no definition-time downgrade, AC-9.CMD.008.4 / NFR-SEC.014); route above auto-approve/reversible-soft to the surface-04 approval queue; return inline with a pill; agent error surfaced inline, never silent.
9. **`UI-COMMANDS` surface (surface-10)** — the list landing, the Command Builder drawer, and the read-only System-Command Reference; all five states per section (never render a false-empty command list — a #1 mask); the two always-loud alert banners; accessibility baseline (NFR-A11Y.001).
10. **Mobile menu contract (FR-9.CMD.005)** — expose the "common" node-permitted command set for surface-12 to render as quick-tap buttons; node-gated commands the caller lacks are hidden/disabled.
11. **Tests to the AC** — see Verification.

## 9. Verification (how DoD is proven)
- **Per `spec/05-non-functional/test-strategy.md`:** unit + integration tests on dispatch routing, node-gating (default-deny + unmapped-node), destructive-confirm ordering, and fail-closed audit; a build-time security test for NFR-SEC.014 (save-time rejection of an over-authority invocation node; invocation runs the wrapped action's own C6 tier — a definition cannot downgrade it — AC-NFR-SEC.014.1/2 = AC-9.CMD.006.4 / AC-9.CMD.008.4).
- **Surface tests:** the five states of each `UI-COMMANDS` section (loading / empty / error / partial / offline), the never-false-empty list guarantee, and the `UI-COMMANDS` accessibility audit for AC-NFR-A11Y.001.1/2.
- **AC → `Verified` path:** each AC-9.CMD.* is exercised by the test layer above; the two NFR postures (SEC.014 blocking launch gate, A11Y.001 build-time audit) must hold before sign-off. No spike/AF must be GREEN — the CMD area rests on none.
