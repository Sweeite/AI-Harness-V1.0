---
id: ISSUE-<nnn>
title: <imperative, specific — the slice in a few words>
epic: <capability group, e.g. "Identity & Access", "Memory write path">
status: ready        # ready | blocked | in-progress | done
github:              # #<n> once exported; blank until then
---

# ISSUE-<nnn> — <title>

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
<the vertical slice in a single sentence>

## 2. Scope — in / out
**In:** <what this issue delivers — the slice boundary, in this issue's own words>
**Out:** <what it explicitly does NOT do, and which ISSUE-<nnn> owns that instead>

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** <FR-x.AREA.nnn, … — with component in parens on first use>
- **NFRs:** <NFR-DOMAIN.nnn, … or "none">
- **Rests on:** <ADR-nnn, AF-nnn, …>

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- <AC-x.AREA.nnn.n, … — list every acceptance criterion this slice must satisfy, by ID only>
- **Gating spikes (if any):** <AF-nnn must be GREEN before this issue ships, per OD-157/RP-1>

## 5. Touches (complete blast radius, by ID)
- **DATA:** <DATA-table / DATA-table.field, …>
- **PERM:** <PERM-category.action, …>
- **CFG:** <CFG-key, …>
- **UI:** <UI-surface, …>
- **Connectors:** <GHL / Google / Slack / none>

## 6. Context manifest (the EXACT files to open — nothing more)
- <spec/01-requirements/component-XX-*.md — the FR text + ACs>
- <spec/04-data-model/schema.md §<group> — the tables>
- <spec/03-surfaces/surface-XX-*.md — the UI states, if this slice has a surface>
- <spec/05-non-functional/<domain>.md — the NFR posture, if named above>
- <spec/00-foundations/adr/ADR-nnn-*.md — if it rests on an ADR>

## 7. Dependencies
- **Blocked-by:** <ISSUE-<nnn> / AF-nnn spike, … or "none (foundational)">
- **Blocks:** <ISSUE-<nnn>, … or "none (leaf)">

## 8. Build order within the slice
1. <e.g. migration (schema group) →>
2. <RLS policy →>
3. <FR logic →>
4. <surface wiring →>
5. <guardrail / observability hook →>
6. <test to the AC>

## 9. Verification (how DoD is proven)
- <which test layer per `spec/05-non-functional/test-strategy.md`>
- <which `AC-NFR-*` posture must hold; the AC→`Verified` path for this slice>
