# Surface: UI-COMMANDS (surface-10) — Custom Command Management

**Status:** 🟢 **Drafted + gate-clean 2026-07-01** — OD-141–144 raised + resolved surface-local (recommendations). The
eleventh Phase-3 surface. Surface ID **`UI-COMMANDS`** is **named by the FRs, not minted here** — FR-9.CMD.006 already
assigns it ("Custom commands are created, edited, and deleted via `UI-COMMANDS`"). FR source: **C9 (Proactive
Intelligence)** — the custom-command CRUD (FR-9.CMD.006–008) framed inside the broader `/` command dispatch contract
(FR-9.CMD.001–005). **No PERM node is minted here** — the two nodes this surface needs (`PERM-commands.manage`,
`PERM-system.tune`) are **already catalogued** under the C9 "Proactive / Commands" section of `PERMISSION_NODES.md`
(L89–90 — a cleaner case than surfaces 03/04/06/07/08/09, which each had a Rule-0 catalog gap). **OD-142 + OD-143 pushed
back into the C9 requirement layer via change-control** (as **AC-9.CMD.006.4** author-authority on the invocation gate,
and **AC-9.CMD.008.4** a definition can never lower the C6 tier) so the #2 constraints live in the FRs, not only here —
mirroring surface-04 OD-120→AC-6.APR.003.3. Next OD: OD-145.

> **Verification gate (independent zero-context subagent, checks a–f): CLEAN — 0 HIGH · 1 MED · 2 LOW (all reconciled).**
> (a) Coverage PASS — every FR-9.CMD.001–008 + AC cited resolves and paraphrases faithfully; invocation/agent-definition/
> config all correctly seamed out (surface-08/09/01), no over-claim. (b) CFG PASS — the CMD FRs declare no config keys;
> "none" is accurate. (c) DATA PASS — no `client_slug` on any binding; the `commands` store is correctly NET-NEW Phase-4,
> user-defined-only (system commands code-registered). (d) PERM PASS — both nodes catalogued with the claimed roles/scope;
> no node minted; no role-string gates; six canonical roles used. (e) #1/#2/#3 sweep PASS — no false-healthy state (error
> never reads empty/healthy; collision is loud; disabled-agent = "unavailable"; unmapped node = default-deny; no C6
> outrun; no audience-widening past authority). (f) Seams PASS. **Reconciled:** **MED-1** — OD-141–144 transcribed into
> `open-decisions.md` (this session; the Rule-0 register-sync step). **LOW-1** — catalog line-cite tightened `L86–90`→**L89–90**.
> **LOW-2** — OD-142/143 pushed into C9 as AC-9.CMD.006.4 / AC-9.CMD.008.4 via change-control (the #2 constraints now live
> in the requirement layer, not only this surface).

> The **custom-command management console** of one client deployment — where an **Admin** (or Super Admin) *defines the
> shortcuts*, not runs them. A custom command is this product's take on a Claude-Code-style skill: a saved slug + prompt
> template (with a `$ARGUMENTS` placeholder) bound to one agent from the registry and gated on a permission node — so a
> recurring ask ("draft the weekly client digest", "summarise this account's last month") becomes `/digest` for everyone
> who holds the node. This surface is **management only**: commands are *invoked* on **surface-08** (the chat), rendered
> inline with an answer-mode pill; here they are created, edited, enabled/disabled, and deleted (FR-9.CMD.006), and here an
> admin sees the **read-only reference of code-registered system commands** so a new slug can't silently collide
> (FR-9.CMD.006 collision check). The three non-negotiables it most directly serves: **#2** — a custom command can never
> become a privilege back-door (its invocation node is default-deny FR-9.CMD.002/AC-9.CMD.002.3, and every invocation runs
> the **same C6 guardrail pipeline** as any agent run FR-9.CMD.008, so a saved shortcut can't outrun the guardrails its
> author couldn't); **#3** — a command whose assigned agent is later disabled reads **"unavailable", never a silent no-op**
> (AC-9.CMD.006.3), and a slug collision is a **loud rejection, never a silent rename** (AC-9.CMD.006.2); **#1** — the
> command definition is durable data (the `commands` store), and deleting the *last* agent of a command soft-inactivates
> the command rather than dropping it. It does **not** execute anything (invocation is surface-08 / C5/C8), edit
> code-registered system commands (they are code, shown read-only), define agents (surface-09), or edit config knobs
> (surface-01).

---

## Context manifest

- **Surface ID:** **`UI-COMMANDS`** — **named by FR-9.CMD.006, not minted here** (unlike surface-04…09 which each minted
  their own `UI-` id). The operator's planning-doc "custom commands / skills" concept maps here.
- **Owned by:** **C9 (Proactive Intelligence)** — the `/` command registry + dispatch (FR-9.CMD.001), per-command
  node-gating (FR-9.CMD.002), destructive-confirm (FR-9.CMD.003), the pill-response + audit-log contract (FR-9.CMD.004),
  the mobile menu (FR-9.CMD.005), and the **user-defined custom commands** (FR-9.CMD.006–008 — the CRUD this surface owns).
  **C8** owns the `agents` registry a command binds to (FR-8.REG.001). **C1** owns the authority model
  (`PERM-commands.manage` to manage; the per-command invocation node, FR-1.PERM). **C4** owns the answer-mode pill every
  command output carries (FR-4.CID.006 — rendered on surface-08, seam). **C6** owns the guardrail pipeline every
  invocation runs (seam). **C7** owns the `event_log` every invocation writes to (seam).
- **FRs served:**
  - **The `/` dispatch contract (context — this surface configures what it dispatches):** FR-9.CMD.001 (**the `/` command
    registry + dispatch** — system commands are code-registered by home component; an unknown command shows guidance,
    never a silent no-op AC-9.CMD.001.2), FR-9.CMD.002 (**per-command permission-node gating** — every command, custom or
    system, gates on a C1 node evaluated against the caller's node set, **not** a role ladder; a command with **no mapped
    node is denied by default** AC-9.CMD.002.3; the design's "Agency Owner" gating row is realized as node assignment,
    never a role AC-9.CMD.002.2), FR-9.CMD.003 (**destructive commands require explicit confirmation** — the node gate is
    evaluated **before** the confirm AC-9.CMD.003.3, and the confirm is **never the sole barrier** — the action's C6 tier
    still governs AC-9.CMD.003.2), FR-9.CMD.004 (**every command produces a pill response + an `event_log` entry**; a
    **destructive or node-gated command whose log write fails FAILS CLOSED** AC-9.CMD.004.3, mirroring C6 AC-6.LOG.003.3),
    FR-9.CMD.005 (**mobile tap-optimised menu** — rendering is surface-12; C9 owns the command set + which are "common").
  - **Custom command CRUD (the heart of this surface — C9 CMD.006–008):** FR-9.CMD.006 (**user-defined command
    definitions** — slug validated against all system slugs, display name, description, prompt template with a
    `$ARGUMENTS` placeholder, an **assigned agent** from the registry, a **PERM-node gate**; created/edited/deleted via
    `UI-COMMANDS` by callers holding `PERM-commands.manage`; a **slug collision is rejected with a clear message, never
    silently renamed** AC-9.CMD.006.2; **no agent assigned → save rejected**; an **assigned agent later disabled/deleted →
    the command is marked inactive, not deleted**, and callers see "command unavailable", never a silent no-op
    AC-9.CMD.006.3), FR-9.CMD.007 (**custom commands registered in dispatch alongside system commands** — visible in the
    `/` menu to callers who hold the command's node, **visually labelled "Custom"**; a custom command **can never overwrite
    or shadow a system slug** — the CMD.006 save-time collision check is the enforcement point; an inactive command is
    hidden, not shown broken AC-9.CMD.007.2), FR-9.CMD.008 (**custom command invocation** — `$ARGUMENTS` substituted (empty
    string if none), dispatched to the assigned agent, returned **inline with an answer-mode pill**, **same node gate** as
    CMD.002, **subject to the same C6 guardrail pipeline** as any agent run, **no `task_queue` entry** — the invocation is
    synchronous and the `event_log` row is the only persistent record AC-9.CMD.008.3). *(Invocation is rendered on
    surface-08 — this surface owns the definitions that make it possible.)*
- **CFG dependencies:** **none.** The CMD area declares no config keys (FR-9.CMD.001–008 all list "Config dependencies: —").
  The system-command threshold config reachable via `/tune` is gated `PERM-system.tune` but its *values* live on
  surface-01 (`PERM-config.*`), not here. This surface reads/writes the `commands` store and the `agents` registry only.
- **PERM gates:** **no node minted here** — the required nodes are **already catalogued** (C9 "Proactive / Commands"
  section, `PERMISSION_NODES.md` L89–90):
  - **`PERM-commands.manage`** (Super Admin, Admin; intra-client) — **entry + all CRUD** on this surface (create / edit /
    delete / enable-disable custom commands, FR-9.CMD.006).
  - **`PERM-system.tune`** (Super Admin, Admin; intra-client) — **not an entry gate here**; it gates the `/tune` *system
    command* and full system-command set (FR-9.CMD.002 default assignment). Referenced on the read-only System-Command
    Reference (Section C) so an admin sees which system commands sit behind it; the tuning *values* are surface-01.
  - **The per-command invocation node** a custom command is gated on (FR-9.CMD.006/002) is **chosen at definition time
    from the existing C1 node catalog** — **no new node is minted per command** (OD-142). A command with no mapped node is
    **denied by default** (AC-9.CMD.002.3), never open. All nodes default-deny (FR-1.PERM.002 / OD-030).
- **DATA bindings** (Phase-4 stubs; **intra-client — no `client_slug` on any binding** per OD-096 / FR-10.ISO.001; ADR-006):
  - **`commands` store** (read/write; **NET-NEW Phase-4, FR-9.CMD.006** — **user-defined commands only**; system commands
    remain **code-registered**, never rows here): per row `id`, `slug` (unique; validated against all system slugs at
    write, AC-9.CMD.006.2), `display_name`, `description`, `prompt_template` (carries the `$ARGUMENTS` placeholder),
    `assigned_agent_id` (→ C8 `agents`), `perm_node` (the invocation gate, a C1 node id), `active` (bool; auto-set false
    when the assigned agent is disabled/deleted, AC-9.CMD.006.3), `created_by`, `created_at`, `updated_at`. **No
    `client_slug`.**
  - **C8 `agents`** (read; FR-8.REG.001) — the agent picker reads `id` / `name` / `description` / `enabled`; a command's
    `assigned_agent_id` must reference an **enabled** agent, and the store watches for that agent being later disabled
    (AC-9.CMD.006.3). **No `client_slug`** (AC-8.REG.001.3).
  - **C1 node catalog** (read) — the invocation-node picker reads the available C1 nodes (`PERMISSION_NODES.md` at build);
    a chosen node must exist (default-deny if unmapped, AC-9.CMD.002.3).
  - **System-command registry** (read; code-registered, FR-9.CMD.001) — the read-only reference reads the code-declared
    system command slugs + their home component + default node; **not a table this surface writes.**
  - **C7 `event_log`** (read, for a per-command "recent invocations" glance; write happens at *invocation* on surface-08 /
    C7, FR-9.CMD.004) — **no `client_slug`** (C7 OD-067).
- **ADR constraints:**
  - **ADR-006** — command gating is **permissions-in-data**: a command gates on a C1 node evaluated against the caller's
    node set, never a hardcoded role (FR-9.CMD.002 / OD-086); managing commands is a `service_role`-managed, human-gated
    path (`PERM-commands.manage`).
  - **ADR-001 §3** — intra-client only; **no `client_slug` column** on the `commands` store or any binding.
  - **ADR-007 / C6** — every custom-command invocation runs the **same C6 guardrail pipeline** as any agent run
    (FR-9.CMD.008); a saved command is **not** a way to pre-approve or outrun a guardrail. Destructive-confirm
    (FR-9.CMD.003) is a UI gate *in addition to* the action's C6 tier, never a replacement.
  - **The three non-negotiables** — **#2** (a command's invocation node is default-deny and cannot exceed the guardrails
    its invocation still runs; capability to *manage* is `PERM-commands.manage`, Admin+), **#3** (slug collision =
    loud rejection AC-9.CMD.006.2; disabled-agent command = "unavailable", never silent AC-9.CMD.006.3; a destructive/
    node-gated command that can't be logged **fails closed** AC-9.CMD.004.3), **#1** (definitions are durable data;
    last-agent-gone soft-inactivates rather than drops).

---

## Overview

surface-10 is the **custom-command management console** of one client deployment — the surface an **Admin** (or Super
Admin) uses to turn a recurring ask into a saved `/` command. It renders and edits the **`commands` store** C9 defines
(FR-9.CMD.006): each custom command is a slug + display name + description + prompt template (with a `$ARGUMENTS`
placeholder) + an **assigned agent** (from C8's registry) + an **invocation permission node**. The surface has three
jobs: **manage custom commands** (create / edit / enable-disable / delete — Section A + B), and **show the read-only
reference of code-registered system commands** (Section C) so a new slug can't silently collide and an admin can see the
reserved namespace. Commands are **invoked elsewhere** — on **surface-08** (the chat), returned inline with an
answer-mode pill (FR-9.CMD.004/008); this surface only *defines* them. The cardinal sins here are a **custom command that
becomes a privilege back-door** (gated on a broadly-held node while wrapping a powerful agent — a #2 breach, guarded by
default-deny + the shared C6 pipeline), a **silent slug collision or silent-broken command** (a #3 false-success), and a
**definition lost on the last agent's deletion** (a #1 violation, guarded by soft-inactivation).

---

## Access

> Uses the six canonical C1 roles (FR-1.ROLE.001). This is an **admin / power-user** surface — only **Super Admin** and
> **Admin** enter (the `PERM-commands.manage` default, FR-9.CMD.006). The others do not manage commands (they *invoke*
> permitted commands on surface-08, gated per-command by FR-9.CMD.002 — a different, finer authority).

| Role | Can enter? | Notes |
|---|---|---|
| Super Admin | Yes | Full CRUD on custom commands; sees the full system-command reference. Holds `PERM-commands.manage` |
| Admin | Yes | Full CRUD on custom commands (`PERM-commands.manage` default = Super Admin + Admin). Cannot edit code-registered system commands (none can — read-only) |
| Finance | No | No `PERM-commands.manage` — invokes permitted commands on surface-08, does not define them |
| HR | No | No `PERM-commands.manage` |
| Account Manager | No | No `PERM-commands.manage` — the AM is a heavy command *user*, but defining commands is an admin function |
| Standard User | No | No `PERM-commands.manage` |

**Entry gate:** the surface renders iff the caller holds `PERM-commands.manage`; a caller without it never sees the nav
item and a direct URL returns 404 (FR-1.PERM.006 — denied surfaces are absent, not visible-but-empty). Entry grants CRUD
on **custom** commands only; **system commands are code-registered and read-only for everyone** (Section C). Choosing a
command's *invocation* node does not grant that node — it assigns which node a caller must hold to run the command
(FR-9.CMD.002); the manager cannot gate a command on a node they are not themselves authorized to assign (OD-142). All
nodes default-deny (OD-030).

---

## Layout

A **list-and-editor management console** on the client deployment, reached from the admin/system area of the navigation
(**OD-141**): a **custom-command list landing** (one row per `commands` entry) with a **create/edit drawer** (the Command
Builder) that opens over the list, plus a **collapsible read-only System-Command Reference** section reachable from a
section nav. Persistent chrome: a sticky header with the section nav (**Custom Commands · System Reference**), a "commands
are invoked in chat → surface-08" pointer, and — when a save is in flight — inline validation (slug-collision, agent-
required). The two always-loud notification banners (alert-engine-stalled AC-7.ALR.008.2, alert-delivery-misconfigured
AC-7.ALR.009.1) ride here as on every dashboard (FR-7.ALR.001), pinned above any section.

- **Custom Commands section (landing):** the **command list** (Section A); clicking a row (or "New command") opens the
  **Command Builder** drawer (Section B).
- **System Reference section:** the read-only **System-Command Reference** (Section C).

**No section here holds a Realtime subscription** — surface-10 is a configuration/management surface, not one of the two
Realtime surfaces (FR-7.RTP.001 = approval queue + notification centre). The command list and reference are **static on
load + on-demand refresh** (they change only on an explicit human edit or a code deploy). An optional per-command "recent
invocations" glance (Section B) **polls** the `event_log` on demand, not live.

---

## Sections

> Three sections grouped into the two playbook buckets: **manage custom commands** (A the list + B the builder) and
> **reference the reserved namespace** (C the read-only system-command reference). Each live section states its poll
> contract and all five states.

---

### Section A — Custom Commands (the list; landing)

**Purpose:** The roster of user-defined commands — one row per `commands` entry (FR-9.CMD.006/007). Each row is a glance
at *what shortcut exists, which agent it runs, who can run it, is it active*; clicking opens the Command Builder
(Section B). This is where an admin sees, at a glance, an **inactive** command (its agent was disabled — AC-9.CMD.006.3)
distinct from a healthy one.

**Data bindings:**
| Element | Source | Notes |
|---|---|---|
| Command row (one per entry) | `commands` (FR-9.CMD.006) | `slug` (shown with a leading `/`), `display_name`, assigned agent name, invocation node, `active` state |
| Slug | `commands.slug` | Unique; validated against all system slugs at save (AC-9.CMD.006.2) — a reserved slug can never appear here |
| Assigned agent | `commands.assigned_agent_id` → C8 `agents.name` | The agent the command dispatches to (FR-9.CMD.008); if that agent is disabled/deleted the command shows **inactive** |
| Invocation node | `commands.perm_node` → C1 node | Which C1 node a caller must hold to run it (FR-9.CMD.002); shown so an admin can see the command's audience |
| Active / inactive state | `commands.active` (AC-9.CMD.006.3) | **Inactive** = assigned agent disabled/deleted → callers see "command unavailable", the command is **hidden from the `/` menu** (AC-9.CMD.007.2), **not deleted** (#1) |
| "Custom" label | FR-9.CMD.007 | Every row is a custom command (system commands live in Section C) — reinforces the never-shadow-a-system-slug rule |

**Actions:**
| Action (label) | What it does | PERM gate |
|---|---|---|
| New command | Opens a blank Command Builder (Section B) | `PERM-commands.manage` (entry) |
| Open command (row click) | Opens the Builder for that command | `PERM-commands.manage` |
| Enable / disable | Toggles `commands.active`; **disabling hides it from the `/` menu but retains the definition** (FR-9.CMD.007 / AC-9.CMD.007.2), never deletes it | `PERM-commands.manage` |
| Delete command | **Destructive — requires explicit confirmation** (the surface's own confirm, consistent with FR-9.CMD.003's destructive-confirm posture for management too); permanently removes the definition after confirm | `PERM-commands.manage` |

**Real-time / poll:** **Static on load + on-demand refresh** — the list changes only on a human edit or when an agent
disable flips a command inactive (surfaced on next load/refresh, not live). Not Realtime.

**States:**
- **Loading:** Skeleton rows — never a false "no commands" before data resolves.
- **Empty:** Genuinely no custom commands yet → a real zero-state: "No custom commands yet — create one to turn a recurring
  ask into a `/` shortcut" + a "New command" call-to-action (this is a legitimate cold-start, distinct from a fetch
  failure — the system ships with **zero** custom commands; system commands are code, in Section C).
- **Error:** `commands` read fails → "Couldn't load custom commands" + retry; **never render an empty list as if there
  were no commands** (a false-empty could mask lost definitions — #1). Creating is disabled until the list is confirmed
  (else a new slug can't be collision-checked against existing custom commands).
- **Partial:** The list loads but the C8 `agents` join is slow/failed → rows render with the agent name marked
  "checking…" / "agent status unavailable"; a command's `active` state is **not** flipped to healthy on an unknown agent
  read — an unresolved agent shows "status unknown", never a false-active green.
- **Offline / stale:** "last loaded HH:MM" + manual refresh; create/edit/delete disabled offline ("changes can't be
  saved").

---

### Section B — Command Builder (the definition editor)

**Purpose:** Create or edit one custom command (FR-9.CMD.006) — slug, display name, description, prompt template (with the
`$ARGUMENTS` placeholder), the assigned agent, and the invocation permission node. This is where the collision check, the
agent-required rule, and the invocation-node choice are enforced at save.

**Data bindings:**
| Element | Source | Notes |
|---|---|---|
| Slug | `commands.slug` (FR-9.CMD.006) | Live-validated against **all system slugs + existing custom slugs**; a collision is **rejected with a clear message, never silently renamed** (AC-9.CMD.006.2). Shown with a `/` prefix |
| Display name | `commands.display_name` | The human label in the `/` menu |
| Description | `commands.description` | What the command does (shown in the `/` menu and the mobile quick-tap tooltip) |
| Prompt template | `commands.prompt_template` (FR-9.CMD.008) | Carries a **`$ARGUMENTS`** placeholder; on invocation `$ARGUMENTS` is substituted with supplied args, or an **empty string** if none (AC-9.CMD.008.1 — the author handles graceful empties). A helper explains the placeholder |
| Assigned agent | `commands.assigned_agent_id` → C8 `agents` (enabled) (FR-9.CMD.008) | Picker of **enabled** registry agents; **no agent assigned → save rejected** (FR-9.CMD.006). A later-disabled agent flips the command inactive (AC-9.CMD.006.3) |
| Invocation node | `commands.perm_node` → C1 node catalog (FR-9.CMD.002) | The node a caller must hold to run the command; chosen from existing C1 nodes (OD-142); a command with **no mapped node is denied by default** (AC-9.CMD.002.3) — the picker defaults to a safe node and requires an explicit choice, never "open" |
| Live invocation preview | derived | Shows the resolved `/slug [args]` form + which roles (by default node assignment) would see it — read-only, no execution here |

**Actions:**
| Action (label) | What it does | PERM gate |
|---|---|---|
| Edit any field | Stages a change to the staged definition | `PERM-commands.manage` |
| Choose assigned agent | Opens the enabled-agent picker (C8 registry); required before save | `PERM-commands.manage` |
| Choose invocation node | Opens the C1 node picker; the manager may only assign a node they are authorized to assign (OD-142) — a command can't be gated on a node below its own risk to widen its audience | `PERM-commands.manage` |
| Save | Validates: **slug non-colliding** (AC-9.CMD.006.2), **agent assigned** (FR-9.CMD.006), **node chosen** (default-deny if not, AC-9.CMD.002.3); on pass writes the `commands` row and registers it in dispatch (FR-9.CMD.007) | `PERM-commands.manage` |
| Test / dry-run *(optional)* | Resolves the template against sample args and shows what *would* dispatch — **does not execute** and **does not bypass** the invocation node or C6 (a real run happens only on surface-08, through CMD.002 + CMD.008's C6 pipeline) | `PERM-commands.manage` |

**Real-time / poll:** **Static on load + on-demand** — the definition changes only on an explicit human edit. The agent
picker reads the C8 registry on open; an optional "recent invocations" glance polls `event_log` on demand. No Realtime.

**States:**
- **Loading:** Skeleton form; fields disabled until the row (edit) or the agent list (create) resolves.
- **Empty (new command):** A blank Builder with required fields marked; **Save is blocked until slug is non-colliding, an
  agent is assigned, and an invocation node is chosen** — the surface never saves a command that would be denied-by-default
  or agentless.
- **Error:** Read fails → "Couldn't load this command" + retry. A **save** failure shows the edit as **not applied**
  (nothing half-written); a **slug collision** shows the explicit reserved/duplicate slug ("`/summarise` is a system
  command — choose another", AC-9.CMD.006.2), never a silent rename or overwrite (FR-9.CMD.007 never-shadow rule). An
  **agent-list read failure** blocks save with "can't confirm the assigned agent" rather than saving against an unverified
  agent.
- **Partial:** The definition loads but the C1 node catalog read fails → the node picker shows "couldn't load permission
  nodes"; **save is blocked** (a command must have a valid, existing node — saving against an unknown node would be a #2
  hole, and default-deny would make it un-runnable anyway).
- **Offline / stale:** Editing disabled with "You're offline — changes can't be saved"; a staged-but-unsaved edit is held
  locally and clearly marked unsaved (never silently lost — #1), never auto-committed on reconnect.

---

### Section C — System-Command Reference (read-only)

**Purpose:** The read-only reference of **code-registered system commands** (FR-9.CMD.001) — the reserved slug namespace,
grouped by home component, each with its default permission node. It exists so an admin (1) can't collide a new custom
slug with a reserved one blindly (proactive complement to the save-time check, AC-9.CMD.006.2), and (2) can see which
system commands sit behind `PERM-system.tune` and the other default node assignments (FR-9.CMD.002). **Nothing here is
editable** — system commands are code, not data (FR-9.CMD.006 scopes the `commands` store to user-defined only).

**Data bindings:**
| Element | Source | Notes |
|---|---|---|
| System command list | System-command registry (code-registered, FR-9.CMD.001) | Grouped by home component: **memory** (`/remember` `/forget` `/recall` `/verify` `/memory-health` → C2), **task** (`/run` `/queue` `/approve` `/reject` `/status` → C5/C6), **agent** (`/ask` `/research` `/summarise` → C8), **trigger/system** (`/trigger` `/schedule` `/health` `/alerts` `/help` `/tune` → C5/C7/config) |
| Default node | FR-9.CMD.002 default assignment | e.g. memory/basic-task/agent commands + `/health` `/alerts` `/help` → Standard User and up; `/approve` `/reject` `/schedule` `/trigger` → approval/scheduling nodes; **`/tune` + full system commands → `PERM-system.tune`** (Admin and up); all → Super Admin |
| Destructive flag | FR-9.CMD.003 | Marks the commands that require confirmation (e.g. `/forget`, `/reject`, a destructive `/tune`) — the confirm is **in addition to** the action's C6 gate (AC-9.CMD.003.2) |
| Reserved-slug badge | derived from the registry | Every slug here is reserved — a custom command may never reuse it (FR-9.CMD.007) |

**Actions:**
| Action (label) | What it does | PERM gate |
|---|---|---|
| View system command detail | Shows the command's home component, default node, destructive flag (read-only) | `PERM-commands.manage` (entry) |
| Edit `/tune` threshold values → | Links to **surface-01** (the config the `/tune` command edits lives there, `PERM-config.*`) — **not editable here** | `PERM-config.*` (surface-01) |

**Real-time / poll:** **Static on load** — the system-command set changes only on a code deploy, never at runtime.

**States:**
- **Loading:** Skeleton reference rows.
- **Empty:** N/A — there is always a code-registered system-command set (FR-9.CMD.001). A truly empty reference is an
  **alarm** ("system commands unavailable — dispatch may be misconfigured"), never a quiet empty (an empty reserved
  namespace would let a custom slug collide undetected — a #3 risk).
- **Error:** Registry read fails → "Couldn't load the system-command reference" + a warning that **new custom slugs can't
  be fully collision-checked against system commands until it loads** (the save-time check still enforces at write,
  AC-9.CMD.006.2 — this is belt-and-braces); retry offered.
- **Partial:** Some component groups load, others fail → render what loaded, mark the gap "some system commands couldn't
  load — collision-check may be incomplete", never imply the reserved list is complete.
- **Offline / stale:** "last loaded HH:MM"; the reference is informational — the authoritative collision check is at save
  (server-side), so a stale reference degrades to a warning, not a wrong-save.

---

## Navigation / transitions

| Trigger | Destination |
|---|---|
| Admin/system nav → Command management | surface-10 (custom-command list landing) |
| Command row click / "New command" | Section B Command Builder drawer |
| Builder → choose assigned agent | The C8 agent registry picker (surface-09 is where agents are *defined*) |
| Builder → choose invocation node | The C1 node picker (`PERMISSION_NODES.md` catalog) |
| System Reference → edit `/tune` values | surface-01 (`PERM-config.*`) |
| "Commands are invoked in chat" pointer | surface-08 (the chat — where `/` commands run, FR-9.CMD.008) |
| Mobile quick-tap command menu | surface-12 (mobile rendering of FR-9.CMD.005; C9 owns which commands are "common") |

---

## Mobile

This is a **desktop-first management surface** — authoring a prompt template, picking an agent, and choosing a permission
gate is a considered task, not a phone task. On a narrow viewport it degrades to a **read-mostly** view: the custom-command
list collapses to a single-column list with active/inactive state (an admin can *see* the commands and *disable* a
misbehaving one from a phone — a disable still retains the definition, #1), but the full Command Builder (template editing,
agent + node pickers) is **best-effort / discouraged on mobile** and may be gated behind an "edit on desktop" notice
rather than offering a cramped editor (a mis-gated command is a #2 risk — better deferred than fat-fingered). Note the
distinction from **surface-12's mobile *command menu*** (FR-9.CMD.005): that is the tap-optimised menu for **invoking**
common commands in chat; *this* surface **manages** command definitions. The two protective notification banners remain
mandatory. Detailed mobile treatment: `surface-12-mobile.md`.

---

## Open decisions

| # | Question | Options | Recommendation |
|---|---|---|---|
| OD-141 | **Layout** — how to structure a management surface that both edits custom commands and shows the read-only system-command namespace. | (a) **Custom-command list landing + Command Builder drawer + a collapsible read-only System-Command Reference section** via section nav. (b) Two symmetric tabs (Custom / System). (c) Single long scroll. | **(a)** — the custom-command list is the natural home (you pick or create a command, then edit it in a drawer that keeps list context), and the system-command reference is *reference*, not a peer editing surface, so it earns a distinct collapsible section rather than a co-equal tab. Consistent with surface-09's list/grid-landing + detail-drawer (OD-138) and surface-06 (OD-126). (b) implies system commands are editable here (they aren't); (c) buries the reference. |
| OD-142 ⚠️ **#2 authority** | **Invocation-node choice** — when an admin defines a custom command, which permission node can it be gated on, and does defining a command need a *new* node? | (a) **No new node minted; the invocation node is chosen from the existing C1 catalog**, defaulting to a safe node, requiring an explicit choice (never "open"); **the manager may only assign a node they are authorized to assign**, so a custom command can't be gated on a broadly-held node below the command's own risk to widen its audience — and every invocation still runs the same C6 pipeline (FR-9.CMD.008), so it can't outrun guardrails. (b) Mint a dedicated `PERM-command.<slug>` node per command (catalog churn; every new command mutates C1). (c) Let any node be assigned freely, no author-authority constraint (a #2 escalation hole — an author gates a powerful agent on a node everyone holds). | **(a)** — `PERM-commands.manage` (already catalogued) governs *managing* commands; the *invocation* gate is FR-9.CMD.002's existing node model (default-deny AC-9.CMD.002.3), so **no node is minted here** (the clean case — unlike surfaces 03/04/06/07/08/09). The author-authority constraint closes the escalation path; the shared C6 pipeline is the backstop. (b) explodes the catalog; (c) is a #2 breach. |
| OD-143 ⚠️ **#2 containment** | **Destructiveness of custom commands** — can an author mark a custom command as non-destructive to skip confirmation, and how is confirmation governed? | (a) **Destructiveness/confirmation is governed by the underlying action's C6 tier, not a definition-time flag the author can clear** — a custom command runs the same C6 guardrail pipeline as any agent run (FR-9.CMD.008), so the action's tier (approval/confirm) governs execution regardless of the definition (mirrors AC-9.CMD.003.2 — the confirm is never the sole barrier); the author *may* additionally mark a command as requiring a UI confirm, but can never mark it as *not* needing one when the action is gated. (b) An explicit author-set "destructive" boolean that fully governs (lets an author clear it → #2 hole). (c) Custom commands can never be destructive (too restrictive — a `/cleanup` that runs a real action is legitimate, just gated). | **(a)** — the C6 tier is the real barrier (FR-9.CMD.008 routes every invocation through it); a definition-time flag must never be able to *lower* that. The author can add friction (a UI confirm) but not remove the guardrail. (b) hands the author a bypass; (c) forbids legitimate action commands. |
| OD-144 | **System-command reference presentation** — how the code-registered system commands appear on a management surface where they're not editable. | (a) **A read-only reference list grouped by home component**, showing each system command's default node + destructive flag + reserved-slug badge — visible so an admin sees the reserved namespace and can't collide blindly (proactive complement to the save-time collision check). (b) Hide system commands entirely (collision surfaces only as a save-time rejection — a surprise). (c) Allow limited editing of system-command node assignments here (they're code-registered; editing them here would fork code and data — a #3/#1 risk). | **(a)** — surfacing the reserved namespace *read-only* is the #3-honest choice (a visible reserved list teaches the namespace and prevents surprise rejections; the authoritative check stays server-side at save, AC-9.CMD.006.2). (b) turns every collision into a surprise; (c) forks code and data. |

*(All four resolved surface-local, recommendations delegated — consistent with surfaces 05–09. The two ⚠️#2 authority/
containment decisions, **OD-142 + OD-143, were additionally pushed back into the C9 requirement layer via change-control**
— AC-9.CMD.006.4 (author-authority on the invocation gate) and AC-9.CMD.008.4 (a definition can never lower the C6 tier)
— so the constraints live in the FRs, not only this surface, mirroring surface-04 OD-120→AC-6.APR.003.3.)*

---

## Phase 4 data binding notes

- **`commands` store (NET-NEW Phase-4, FR-9.CMD.006)** — **user-defined commands only**; system commands remain
  code-registered (never rows here). Per row: `id`, `slug` (unique, indexed; collision-checked against system slugs +
  existing custom slugs at write, AC-9.CMD.006.2), `display_name`, `description`, `prompt_template` (holds `$ARGUMENTS`),
  `assigned_agent_id` (FK → C8 `agents`, must be enabled at save), `perm_node` (a C1 node id, the invocation gate),
  `active` (bool; **auto-set false** when the assigned agent is disabled/deleted — AC-9.CMD.006.3, so this needs a trigger
  or a reconcile pass watching `agents.enabled`), `created_by`, `created_at`, `updated_at`. **No `client_slug`** (OD-096 /
  FR-10.ISO.001). RLS: managing is a `service_role`-managed path gated by `PERM-commands.manage`; per-command *invocation*
  authority is FR-9.CMD.002 at dispatch (surface-08), not row-level per-user RLS on this store. **Owed to C9/C5 to home
  formally** (the store is named by FR-9.CMD.006 but not yet schema'd).
- **C8 `agents`** (read here) — the agent picker + the disabled-agent watch (AC-9.CMD.006.3). Phase 4: the `active`
  auto-flip needs to observe `agents.enabled` transitions (trigger or scheduled reconcile). **No `client_slug`.**
- **C1 node catalog** (read here) — the invocation-node picker reads available nodes (`PERMISSION_NODES.md`); the OD-142
  author-authority constraint (a manager may only assign a node they're authorized to assign; no audience-widening past
  their own authority over the wrapped capability) is a build-time check on the save path, now carried in the requirement
  layer as **AC-9.CMD.006.4** (change-control this session). The OD-143 tier-lock (a definition can never lower the
  action's C6 tier) is carried as **AC-9.CMD.008.4**.
- **System-command registry** (read here) — code-declared (slug, home component, default node, destructive flag); not a
  table. Phase 4/6: the reference reads this from the code registry, and the **save-time collision check** (AC-9.CMD.006.2)
  is the authoritative server-side enforcement, independent of whether Section C's reference loaded.
- **C7 `event_log`** (read here for a per-command "recent invocations" glance) — the *write* happens at invocation
  (surface-08 / C7, FR-9.CMD.004), incl. the **fail-closed on log-write-failure for destructive/node-gated commands**
  (AC-9.CMD.004.3). **No `client_slug`** (C7 OD-067).
- **No new PERM node** — `PERM-commands.manage` + `PERM-system.tune` are **already catalogued** (C9 section,
  `PERMISSION_NODES.md`). This surface adds **no** catalog rows (the clean case). *(Catalog housekeeping still owed
  elsewhere and unchanged: the 3 flagged surface-03/04 nodes — OD-115 ×2, OD-117 ×1 — remain to be transcribed when those
  surfaces are next touched; surface-10 does not touch them.)*
</content>
</invoke>
