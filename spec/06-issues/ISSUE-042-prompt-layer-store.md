---
id: ISSUE-042
title: Prompt layer model + store + version-never-overwrite
epic: E — prompt
status: done
github: "#42"
---

# ISSUE-042 — Prompt layer model + store + version-never-overwrite

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Stand up the four-layer prompt data model — the `prompt_layers` store with its append-only-by-version discipline (never overwrite, mandatory `change_reason`, retained history, rollback) plus the assembly contract (four fixed layer types, per-agent Layer 1, mid-run immutability, required-element halt) — so the content slices (043–046) and the run pipeline (053) can build on one authoritative, versioned prompt store.

## 2. Scope — in / out
**In:**
- The `prompt_layers` table + `prompt_layer_kind` enum + `dynamic_field_values` table (schema §5) — the persistence substrate all four layer types share.
- The version-discipline machinery that is layer-content-agnostic: insert-new-version-on-edit (never overwrite), mandatory non-empty `change_reason`, `previous_version_id` linkage, history-viewable + non-destructive rollback, and version pinning at assembly.
- Single-source-of-truth invariant: `prompt_layers` (`layer='core'`) is the only Layer-1 store; nothing reads/writes `agents.system_prompt` (that column's removal/derivation is C8/ISSUE-061's job — this slice just never depends on it).
- The four-layer **structure/ordering contract** (fixed order core → business → memory → task; each layer identified by `prompt_layer_kind`), Layer-1-per-agent keying, mid-run immutability, and the assembly-time required-element **validation requirement** (FR-4.LYR.004 — C4 owns the requirement; its *execution* is wired in the run pipeline, ISSUE-053).
- The dashboard-edit-without-redeploy path and the `PERM-prompt.edit` / `view_history` / `rollback` gating hooks at the store level.

**Out:**
- **Layer-1 content rules** (required content set, boundary instruction, hard-limit statement, answer-mode signalling) and the **operating-principles block + floor** — ISSUE-043 (C4 CID, PRIN).
- **Layer-2 business content** (static/dynamic split, dynamic-field declaration/value semantics) and **Layer-4 task content + templates** — ISSUE-044 (C4 BIZ, TSK). This slice creates the `dynamic_field_values` table but 044 owns its declaration/staleness semantics.
- **Layer-3 memory injection scoping** (per-agent scope, clearance filter, volume bound) — ISSUE-045 (C4 INJ).
- **Version-to-outcome attribution + compression discipline** (the OPT optimisations gated by AF-111) — ISSUE-046 (C4 OPT).
- **Runtime prompt-stack assembly** (retrieve → inject dynamic/memory → concatenate → send) and the *execution* of the FR-4.LYR.004 halt — ISSUE-053 (C5 ASM). C4 defines the contract; C5 runs it.
- The `PERM-prompt.edit_principles` node + principles-floor enforcement — homed with PRIN in ISSUE-043; the PERM node itself lands in C1's node model (ISSUE-018).

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-4.LYR.001, FR-4.LYR.002, FR-4.LYR.003, FR-4.LYR.004, FR-4.STO.001, FR-4.STO.002, FR-4.STO.003, FR-4.STO.004, FR-4.STO.005, FR-4.STO.006 (all Component 4 — Prompt Architecture)
- **NFRs:** none (no NFR domain maps to LYR/STO in the coverage ledger)
- **Rests on:** ADR-006 / `standards/rbac.md` (prompt-edit PERM nodes, default-deny; `client_slug` label-not-RLS-key — and per OD-096 the column is deleted, not carried), ADR-001 (physical cross-client isolation — no `client_slug` on this app table), `standards/change-control.md` (version-never-overwrite as the change-control expression over a runtime-editable asset); ODs resolved in-FR: OD-048 (single source of truth), OD-050 (pin at assembly), OD-051 (length bound advisory — content, deferred to 043), OD-096 / FR-10.ISO.001 (`client_slug` column deleted)

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-4.LYR.001.1, AC-4.LYR.001.2
- AC-4.LYR.002.1, AC-4.LYR.002.2
- AC-4.LYR.003.1
- AC-4.LYR.004.1  *(C4 owns the requirement; the halt executes in the run pipeline, ISSUE-053 — this slice delivers the validation rule + the store-level "core missing/incomplete" detection it depends on)*
- AC-4.STO.001.1  *(note: per the Phase-4 reconciliation on this AC — OD-096 / FR-10.ISO.001 — `client_slug` is **deleted from the column set**, not merely label-only; build the table without it)*
- AC-4.STO.002.1
- AC-4.STO.003.1, AC-4.STO.003.2
- AC-4.STO.004.1
- AC-4.STO.005.1, AC-4.STO.005.2
- AC-4.STO.006.1
- **Gating spikes (if any):** none. AF-111 gates only the OPT optimisation claims (ISSUE-046) — no LYR/STO AC rests on it, and no launch-gating spike (ISSUE-001–006) blocks this slice.

## 5. Touches (complete blast radius, by ID)
- **DATA:** DATA-prompt_layers (schema §5: `prompt_layers` table + `prompt_layer_kind` enum), `dynamic_field_values` (table created here; declaration/staleness semantics owned by ISSUE-044)
- **PERM:** PERM-prompt.edit (Super Admin + Admin), PERM-prompt.view_history, PERM-prompt.rollback  *(nodes homed in C1's node model, ISSUE-018; this slice consumes them as store-level gates. PERM-prompt.edit_principles is out — ISSUE-043.)*
- **CFG:** none owned here  *(`memories_injected_per_task`, `business_context.dynamic_fields`, `dynamic_field_freshness_threshold` belong to the content slices 044/045)*
- **UI:** prompt-layer editor (content + version + mandatory `change_reason` + word-count advisory), version-history + rollback view  *(the principles-editor and dynamic-Layer-2 value editor are out — 043/044)*
- **Connectors:** none

## 6. Context manifest (the EXACT files to open — nothing more)
- spec/01-requirements/component-04-prompt.md — the FR text + ACs for LYR + STO (and the Context manifest / Doc-reconciliation notes at its head)
- spec/04-data-model/schema.md §5 Prompt Content (C4) — the `prompt_layers` + `dynamic_field_values` tables + the `prompt_layer_kind` enum (Types block); plus §"Global rules" (versioned-tables append-only-by-version rule) and §"Immutability enforcement" for the version-discipline posture
- spec/00-foundations/adr/ADR-001-* — physical per-client isolation (why no `client_slug` on this table)
- spec/00-foundations/adr/ADR-006-* + spec/00-foundations/standards/rbac.md — prompt-edit PERM nodes, default-deny
- spec/00-foundations/standards/change-control.md — the version-never-overwrite / mandatory-reason / retain-prior discipline this slice implements

## 7. Dependencies
- **Blocked-by:** ISSUE-008 (migration harness — expand-contract + 0001 baseline; this slice ships the `prompt_layers` migration through that harness). Not a spike; no AF gate.
- **Blocks:** ISSUE-043, ISSUE-044, ISSUE-045, ISSUE-046 (all C4 content slices build on this store), ISSUE-061 (orchestrator + agents registry — the orchestrator's own Layer 1 lives in this store)

## 8. Build order within the slice

> **⚠️ Reconcile with built reality first (Rule 0 — this issue was authored pre-build).** ISSUE-008's
> `0001_baseline` **already created** the `prompt_layer_kind` enum (`0001_baseline.sql` L48) and the
> `prompt_layers` + `dynamic_field_values` tables (all 44 tables). So steps 1-2 below are
> **verify-present, not re-create** — an absence is an ISSUE-008 gap, not a re-create here (mirror
> ISSUE-011 §8 step 1). This slice's *new* migration work (if any beyond app-code) is the
> **version-discipline trigger + the `prompt_layers` RLS policy** (additive, composes on the ISSUE-009
> `default_deny` baseline) as **the next free migration tag** after the shared head (`0002_rls_scaffold`;
> coordinate the exact number with the other Stage-2 fan-out slices — see BUILD-SCHEDULE "Fan-out /
> workflow guidance"). The bulk of this slice (insert-new-version-on-edit, rollback, PERM gating,
> editor UI) is app-code, not schema.
1. **Enum — VERIFY PRESENT (created by 008):** confirm `prompt_layer_kind` (`core|business|memory|task_template`) exists (`0001_baseline.sql` L48). Do not re-create.
2. **Migration (schema §5) — VERIFY PRESENT (created by 008):** confirm `prompt_layers` exists exactly per schema §5 (`id`, `layer`, `name`, `content`, `agent_id` FK→agents required when `layer='core'` via the check constraint, `enabled`, `version`, `previous_version_id` self-FK, `change_reason` NOT NULL non-empty, `created_at`, `created_by` FK→profiles; **no `client_slug`** — OD-096 / FR-10.ISO.001) and that `dynamic_field_values` (`field_name` PK, `field_value`, `last_updated`) exists. Do not re-create. Any *new* additive schema (e.g. a version-discipline trigger) ships through the ISSUE-008 expand-contract harness.
3. **Version-discipline enforcement** — implement insert-new-version-on-edit (never UPDATE content in place): each edit inserts a new row incrementing `version`, links `previous_version_id`, and requires a non-empty `change_reason` (reject empty) — FR-4.STO.003. Honour the global "versioned tables are append-only-by-version" rule; do not overwrite prior rows.
4. **Single-source-of-truth guard** — reads/writes of Layer 1 go only to `prompt_layers` (`layer='core'`); nothing touches `agents.system_prompt` — FR-4.STO.002 / OD-048.
5. **Structure/ordering + per-agent-L1 + immutability contract** — enforce the four fixed layer types + order and the `layer='core' ⇒ agent_id not null` keying (FR-4.LYR.001/002); expose the version-pin point so an in-flight task stays on its pinned version and only post-edit assemblies pick up N+1 (FR-4.LYR.003 / FR-4.STO.006 / OD-050).
6. **Required-element validation rule (FR-4.LYR.004)** — implement the "resolved core must carry boundary instruction + hard-limit statement + principles block, else halt-and-surface" rule as a callable validation the run pipeline (ISSUE-053) invokes at assembly; store-side, expose the "core missing" configuration-error detection (AC-4.LYR.002.2). *(The specific required-element checks are content owned by 043; this slice provides the halt hook + the structural checks.)*
7. **History + rollback** — version-history read + non-destructive rollback (rollback = new version equal to version K + `change_reason`, never a destructive revert) — FR-4.STO.004.
8. **PERM gating + dashboard-edit path** — gate edit on `PERM-prompt.edit` (default-deny + log on denial), history/rollback on `PERM-prompt.view_history` / `PERM-prompt.rollback`; edits take effect on next assembly with no redeploy — FR-4.STO.005.
9. **Editor UI wiring** — prompt-layer editor (content + version + mandatory `change_reason` + word-count advisory) and the version-history + rollback view.
10. **Tests to the AC IDs** in field 4.

## 9. Verification (how DoD is proven)
- **Migration/schema layer** — DB-level tests per `spec/05-non-functional/test-strategy.md`: `prompt_layers` matches schema §5 (columns, `prompt_layer_kind` enum, `layer='core' ⇒ agent_id` check, `change_reason` NOT NULL, `previous_version_id` self-FK), no `client_slug` column present (AC-4.STO.001.1 with the OD-096 reconciliation).
- **Version discipline** — an edit inserts a new version and leaves the prior row unmutated; an empty `change_reason` is rejected; rollback creates a new version and deletes nothing (AC-4.STO.003.1/.2, AC-4.STO.004.1).
- **Single source of truth + pinning** — Layer 1 reads resolve only from `prompt_layers` `layer='core'`; a mid-task edit does not change the running task's pinned version (AC-4.STO.002.1, AC-4.STO.006.1, AC-4.LYR.003.1).
- **Structure + assembly-halt** — assembled structure is exactly the four ordered layer types; a core record resolving without a required safety element halts loudly (AC-4.LYR.001.1/.2, AC-4.LYR.004.1); the FR-4.LYR.004 execution path is proven end-to-end in ISSUE-053.
- **RBAC posture** — a user without `PERM-prompt.edit` is denied + logged; an edit by a permitted user takes effect on next assembly with no redeploy (AC-4.STO.005.1/.2). No `AC-NFR-*` posture is owned by this slice.

## 10. Build result — ✅ DONE (session 66, 2026-07-05)
Built `app/prompt-store/` (`@harness/prompt-store`) + migration `0004_prompt_version_discipline.sql` (append-only-by-version
trigger + `prompt_edit` RLS policy composing on 0002 default_deny). Offline **14/14** (one test per §4 AC) + typecheck +
`check`. Independent verification: SAFE, no BLOCKER — two MINORs applied (the trigger now also freezes `name`, not just
content, so a rename can't split a version chain; revoke-comment corrected). **LIVE capstone** 7/7: AC-4.STO.001.1 (no
client_slug), .003.1 (in-place edit rejected), .003.2 (empty change_reason rejected), .004.1 (DELETE forbidden), AC-4.LYR.002.1
(core requires agent_id), AC-4.STO.005.2 deny+allow (RLS via `PERM-prompt.edit`). Checkpoint added `grant select, insert on
prompt_layers to authenticated` to `0004` (0001c's blanket revoke had left the read policy unreachable) + a `::uuid` cast in the
capstone. Evidence `app/silo/results/stage2-checkpoint-evidence.2026-07-05.md`. GitHub #42 closed. Content slices (043–046) +
the run-pipeline assembly (053) build on this store; the FR-4.LYR.004 halt executes in ISSUE-053.
