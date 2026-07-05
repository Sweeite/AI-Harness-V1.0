---
id: ISSUE-044
title: Layer-2 business context + Layer-4 task instruction + templates
epic: E — prompt
status: in-progress
github: "#44"
---

# ISSUE-044 — Layer-2 business context + Layer-4 task instruction + templates

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Define Layer 2 (shared business context — static vs dynamic fields, config-declared dynamic-field value source + staleness surfacing) and Layer 4 (task instruction with explicit output format + versioned, reusable task templates) as content on the prompt store stood up by ISSUE-042.

## 2. Scope — in / out
**In:**
- **Layer 2 (C4 BIZ)** — the shared per-deployment business-context content (name, description, tone, tool stack, approval rules, comms preferences, hours, escalation paths); the explicit static-vs-dynamic field classification; the dynamic-field set declared in deployment config with its live values read from the operator-editable `dynamic_field_values` store at assembly; and the required staleness surfacing when a dynamic field's `last_updated` exceeds a configurable freshness threshold.
- **Layer 4 (C4 TSK)** — the per-call task-instruction content contract (instruction, parameters, constraints, **explicitly specified** output format — never implicit); reusable stored **task templates** (`layer='task_template'`) populated with runtime parameters to produce a Layer 4; and the fact that task templates are versioned assets governed exactly like any other prompt layer (version-on-change + mandatory `change_reason` + non-destructive rollback).
- The Layer-2 CFG keys this slice introduces: `business_context.dynamic_fields` (declaration list), `dynamic_field_freshness_threshold`.

**Out:**
- The `prompt_layers` table, `prompt_layer_kind` enum, the `dynamic_field_values` **table itself**, and the layer-agnostic version-discipline/rollback/pinning machinery — all owned by **ISSUE-042** (this slice writes `business`/`task_template` content into that store and consumes the version machinery; it does not re-implement it). This slice owns the *declaration + staleness semantics* of `dynamic_field_values`, not the table DDL.
- **Layer 1 content** (identity, principles, boundary instruction, hard-limit statement, answer-mode) — **ISSUE-043** (C4 CID, PRIN).
- **Layer 3 memory injection** (per-agent scope, clearance filter, volume bound) — **ISSUE-045** (C4 INJ).
- **Version-to-outcome attribution + dynamic-Layer-2 injection optimisation + compression discipline** (FR-4.OPT.*, AF-111) — **ISSUE-046** (C4 OPT). This slice defines the static/dynamic split + value source; 046 owns the OPT "injected fresh each session" optimisation claim and its feasibility gate.
- **Runtime prompt-stack assembly** (retrieve layers → inject dynamic/memory values → concatenate → send) — **ISSUE-053** (C5 ASM). C4 defines the fields + value source + staleness rule; C5 performs the assembly-time read and injection.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-4.BIZ.001, FR-4.BIZ.002, FR-4.BIZ.003, FR-4.TSK.001, FR-4.TSK.002, FR-4.TSK.003 (all Component 4 — Prompt Architecture)
- **NFRs:** none (no NFR domain maps to BIZ/TSK in the coverage ledger)
- **Rests on:** ADR-003 (cost — dynamic Layer-2 as a token/freshness lever); the version-discipline substrate from ISSUE-042 (FR-4.STO.001/003/004, which FR-4.TSK.003 inherits verbatim)

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- **BIZ:** AC-4.BIZ.001.1, AC-4.BIZ.002.1, AC-4.BIZ.003.1, AC-4.BIZ.003.2, AC-4.BIZ.003.3
- **TSK:** AC-4.TSK.001.1, AC-4.TSK.002.1, AC-4.TSK.003.1
- **Gating spikes (if any):** none. No AF gates any BIZ/TSK FR (AF-111 gates only C4 OPT, owned by ISSUE-046).

## 5. Touches (complete blast radius, by ID)
- **DATA:** DATA-prompt_layers (rows where `layer='business'` and `layer='task_template'`), DATA-dynamic_field_values (`field_name`, `field_value`, `last_updated` — table created by ISSUE-042; this slice reads/writes its values + declares its keys)
- **PERM:** PERM-prompt.edit (Super Admin + Admin — general prompt content, i.e. Layer 2 + task templates), PERM-prompt.view_history, PERM-prompt.rollback (task-template version history + rollback, per FR-4.TSK.003)
- **CFG:** `business_context.dynamic_fields`, `dynamic_field_freshness_threshold`
- **UI:** prompt-layer editor (Layer-2 + task-template content + version + mandatory `change_reason`), dynamic-Layer-2 value editor with `last_updated` hint + staleness indicator, version-history + rollback view (for task templates)
- **Connectors:** none

## 6. Context manifest (the EXACT files to open — nothing more)
- spec/01-requirements/component-04-prompt.md — the FR + AC text for BIZ (FR-4.BIZ.001–003) and TSK (FR-4.TSK.001–003), plus the OD-052 resolution and the C4 seams table
- spec/04-data-model/schema.md §5 (Prompt Content) — `prompt_layers` (the `business`/`task_template` rows) + `dynamic_field_values`; and the Types block for the `prompt_layer_kind` enum
- spec/00-foundations/adr/ADR-003-* — cost posture ("controls before gates"): dynamic Layer-2 + freshness threshold as a token-cost lever
- spec/00-foundations/standards/change-control.md — the version-on-change / mandatory-reason / retain-prior / non-destructive-rollback discipline that FR-4.TSK.003 inherits for task templates

## 7. Dependencies
- **Blocked-by:** ISSUE-042 (prompt layer model + store + version-never-overwrite — this slice writes `business`/`task_template` content into that store and reuses its version/rollback machinery and the `dynamic_field_values` table). Not a spike; no AF gate.
- **Blocks:** none (leaf)

## 8. Build order within the slice
1. **CFG keys** — register `business_context.dynamic_fields` (the declaration list of dynamic Layer-2 field names) and `dynamic_field_freshness_threshold` in the config store (per ISSUE-010's registry; classify edit-class appropriately).
2. **Layer-2 content contract (FR-4.BIZ.001)** — define the `business` layer record shape (one shared record per deployment) carrying the business-identity fields; assert the same Layer-2 content is used across all agents in a deployment (shared-block invariant — AC-4.BIZ.001.1).
3. **Static/dynamic split (FR-4.BIZ.002)** — classify each Layer-2 field static (baked from deployment config at boot) or dynamic (resolved at assembly); a field is exactly one (AC-4.BIZ.002.1).
4. **Dynamic-field value source + staleness (FR-4.BIZ.003)** — read dynamic-field live values from the operator-editable `dynamic_field_values` store keyed by declared field name at assembly (AC-4.BIZ.003.1); an unset dynamic field is omitted/empty rather than carrying a stale baked-in value, gap observable to operator (AC-4.BIZ.003.2); a value whose `last_updated` exceeds `dynamic_field_freshness_threshold` has its staleness surfaced to the operator (required, not optional) — never silently presented as current (AC-4.BIZ.003.3). *(The assembly-time read itself is executed by ISSUE-053; this slice owns the field declaration, the value store's semantics, and the staleness rule.)*
5. **Layer-4 task content contract (FR-4.TSK.001)** — define the Layer-4 shape (instruction, parameters, constraints, output format); validate that an explicit expected output format is present and flag a Layer 4 with no specified output format as incomplete (AC-4.TSK.001.1).
6. **Task templates (FR-4.TSK.002)** — stored reusable templates persisted as `prompt_layers` rows with `layer='task_template'`, holding parameter slots; instantiate with runtime parameters to produce a complete Layer 4 with all slots filled (AC-4.TSK.002.1).
7. **Task-template versioning (FR-4.TSK.003)** — wire task-template edits through the ISSUE-042 version machinery (version-on-change + mandatory `change_reason` + retained history + non-destructive rollback) exactly as any prompt layer (AC-4.TSK.003.1); reuse `PERM-prompt.edit` / `view_history` / `rollback`.
8. **UI wiring** — Layer-2 + task-template editor entries in the prompt-layer editor; the dynamic-Layer-2 value editor with a `last_updated` hint + staleness indicator surfacing the freshness-threshold breach.
9. **Tests to the AC IDs** in field 4.

## 9. Verification (how DoD is proven)
- **Content-contract layer** — unit/integration tests per `spec/05-non-functional/test-strategy.md`: a `business` layer record carries the identity fields and is the same across all agents in the deployment (AC-4.BIZ.001.1); every Layer-2 field is classified static or dynamic and dynamic fields resolve at assembly not boot (AC-4.BIZ.002.1); a Layer-4 record with no explicit output format is flagged incomplete and a task template instantiates all slots (AC-4.TSK.001.1, AC-4.TSK.002.1).
- **Dynamic-field value source + staleness** — a declared dynamic field's value is read from `dynamic_field_values` at assembly (AC-4.BIZ.003.1); an unset field is omitted/empty with the gap observable (AC-4.BIZ.003.2); a value past `dynamic_field_freshness_threshold` surfaces staleness to the operator and is never silently presented as current (AC-4.BIZ.003.3 — the #3 no-silent-failure check).
- **Version discipline (inherited)** — a task-template edit follows the same version-on-change + mandatory-`change_reason` + non-destructive-rollback rules as any prompt layer (AC-4.TSK.003.1); the underlying machinery is proven in ISSUE-042, this slice proves it holds for `task_template` rows.
- No `AC-NFR-*` posture is owned by this slice.
