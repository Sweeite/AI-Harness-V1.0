# Surface: [UI-SURFACE-ID] — [Display Name]

> **Usage:** Copy this file to `surface-NN-<name>.md`. Fill every field. Delete placeholder text.
> A surface file is complete when every section has a spec and every state is named — including
> the ones that feel obvious. "Loading" being wrong is how dashboards feel broken.

---

## Context manifest
- **Surface ID:** `UI-SURFACE-ID`
- **Owned by:** Component(s) that produce the data rendered here (e.g. C7, C2)
- **FRs served:** FR-N.AREA.NNN — one line per FR this surface is the rendering target for
- **CFG dependencies:** `CFG-key-name` — any config values that are read or edited on this surface
- **PERM gates:** `PERM-node` for entry; per-action gates noted inline under each action
- **DATA bindings:** `table.field` references — Phase 4 stub; list every table/field this surface reads or writes
- **ADR constraints:** ADR-NNN §N — any load-bearing decisions that directly shape this surface's behaviour

---

## Overview
What this surface is, who uses it (role), when they use it (trigger/context), and what job it
gets done for them. 2–4 sentences max. Do not describe the layout here — that's below.

---

## Access

| Role | Can enter? | Notes |
|---|---|---|
| Super Admin | Yes / No | |
| Admin | Yes / No | |
| Advanced Member | Yes / No | |
| Basic Member | Yes / No | |

**Entry gate:** `PERM-node-name` — callers without this node see [404 / redirect to home / hidden nav item].

---

## Layout
Top-level structure: where this surface lives in the navigation (sidebar item, modal over X,
sub-page under Y), the primary layout pattern (single scroll, split-pane, tabbed, sectioned
sidebar+content, fullscreen canvas, etc.), and any persistent chrome (sticky header, action bar,
breadcrumb, back button).

---

## Sections

> One sub-section per logical panel, tab, or section of the surface. If the surface is tabbed,
> add a section per tab. If a section is gated differently from the surface entry, note the PERM.

### [Section / Panel / Tab Name]

**Purpose:** one sentence on what this section shows or enables.

**Data bindings:**
| Element | Source | Notes |
|---|---|---|
| [Label / field / chart] | `table.field` or `FR-N.AREA.NNN` | How it's computed / formatted |

> **DRY rule for human-readable text.** Any description / helper / label text a surface renders
> (e.g. a config knob's plain-English helper line, a status label's meaning) **binds to its
> canonical source — it is never re-typed into the surface file.** Cite the source (e.g. "renders
> the `What it does` column from `config-registry.md`") so one edit at the source can't drift from a
> stale copy here. A missing description at the source is a defect there, not a surface fallback.

**Actions:**
| Action (label) | What it does | PERM gate |
|---|---|---|
| [Button / link / toggle] | [behaviour — what happens when clicked] | `PERM-node` or "same as entry" |

**Real-time / poll:** [real-time via subscription (C7 RTP contract) | polls every _s | static on
page load | on-demand (user triggers refresh)]

**States:**
- **Loading:** what the user sees while data is being fetched (skeleton, spinner, placeholder text)
- **Empty:** what the user sees when there is no data yet (zero-state copy + call to action if applicable)
- **Error:** what the user sees on a fetch failure (message shown, retry available Y/N, fallback content Y/N)
- **Partial:** what the user sees if some sub-elements loaded but others failed (which elements degrade gracefully)
- **Offline / stale:** what the user sees if connectivity is lost or data is older than expected threshold

*(Repeat for every section / panel / tab)*

---

## Navigation / transitions

| Trigger | Destination |
|---|---|
| [Action or link] | [Surface ID or modal name] |

---

## Mobile
Brief note on how this surface degrades or adapts on narrow viewports. If the surface has a
dedicated mobile treatment, note "see `surface-12-mobile.md`." If it collapses to a simplified
view, describe the key simplifications. If mobile access is not in scope, state that explicitly.

---

## Open decisions

| # | Question | Options | Recommendation |
|---|---|---|---|
| OD-NNN | [UX / layout call needed from operator] | (a) … (b) … | (a) — reason |

*(If none, write "None — surface fully specified.")*

---

## Phase 4 data binding notes
List every `table.field` reference in this surface that is a DATA stub — Phase 4 must define
the schema, RLS policy, and index. Flag any field whose type or nullability affects the empty /
partial states above.
