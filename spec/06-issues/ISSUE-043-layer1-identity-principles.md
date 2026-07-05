---
id: ISSUE-043
title: Layer-1 identity/principles/limits content + answer-mode signalling + seven-principle floor
epic: E — prompt
status: in-progress
github: "#43"
---

# ISSUE-043 — Layer-1 identity/principles/limits content + answer-mode signalling + seven-principle floor

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Define and validate the **content of every agent's Layer 1** — who the agent is, its communication
style, hard-limit statement, uncertainty/conflict handling, out-of-scope, and answer-mode signalling —
plus the shared seven-principle operating block with its Super-Admin-only edit path and hard-blocking
seven-principle floor, on top of the `prompt_layers` store ISSUE-042 built.

## 2. Scope — in / out
**In:** The **required-content contract for a `core` (Layer 1) record** and the **operating-principles
block** that sits inside it. Concretely: (a) the six-element Layer-1 content set — identity, principles,
communication style + absolute hard limits, uncertainty/conflicting-instruction handling, out-of-scope,
answer-mode signalling — enforced as a record-validation rule at save/edit time (FR-4.CID.001), with the
advisory ~500-word length warning (FR-4.CID.002, non-blocking); (b) the three **non-removable safety
elements** of Layer 1 that this slice authors as content requirements — the external-data boundary
*instruction* (FR-4.CID.003), the hard-limit *statement* referencing the canonical set (FR-4.CID.004),
and the uncertainty-defaults-to-principles text (FR-4.CID.005); (c) the **answer-mode signalling
convention** — every substantive output tagged Cited/Inferred/Unknown, inference never presented as
fact, Unknown redirects productively / never dead-ends (FR-4.CID.006); (d) the **canonical
seven-principle block** stored verbatim in every agent's Layer 1 (FR-4.PRIN.001); (e) the
**principles-edit path** — editable only by Super Admin via `PERM-prompt.edit_principles`, mandatory
`change_reason`, a distinct safety-relevant edit event, a confirmation warning, edit propagates to every
agent's Layer 1 (FR-4.PRIN.002); (f) the **hard-blocking seven-principle floor** — a save that removes or
empties any of the seven is rejected outright; reword/strengthen/add is allowed (FR-4.PRIN.002 / OD-053);
(g) the **principle-is-statement-not-enforcement** invariant — weakening a principle in the prompt leaves
the underlying code control untouched (FR-4.PRIN.003).

**Out:** The `prompt_layers` schema, version-never-overwrite discipline, rollback, version pinning, and
the general `PERM-prompt.edit` gate — all **ISSUE-042** (blocked-by; this slice writes *into* that store,
it does not build it). The **runtime assembly** of the four-layer stack and the **assembly-time
required-element validation gate** (FR-4.LYR.004 — the check that halts assembly if the *resolved* Layer 1
is missing the boundary instruction / hard-limit statement / principles block) *execute* in **ISSUE-053**
(C5 run pipeline, FR-5.ASM.003); this slice owns only the *content requirement* those elements be present
in the stored record, not the assembly-time re-check. **Layer 2/4 content and templates** are **ISSUE-044**.
**Layer-3 memory injection scoping** is **ISSUE-045**. **Answer-mode pill rendering/evaluation** and the
said-vs-did accuracy check (AF-033) are **C5/C8 → ISSUE-053/062** (this slice owns only the Layer-1
*signalling instruction*, not the pill or its rendering). The **code enforcement** of the seven hard
limits and the injection **tagging/sanitization pipeline** are **C6 → ISSUE-055 / ISSUE-059** (this slice
owns the prompt *statement/instruction*, the "both, never one" prompt half only). The **PERM-node matrix**
and `can()` gate that back `PERM-prompt.edit_principles` are authored in **ISSUE-018**; this slice
*consumes* the node.

> **Integration note (bundled FRs).** CID and PRIN are one coherent content unit: the seven-principle
> block (PRIN.001) is element (b) of the six-element Layer-1 set (CID.001), so the CID validation and the
> PRIN floor share the same `core`-record save path — the CID save-completeness check and the PRIN
> floor/edit-authorization check are two clauses of the **same validator** over `prompt_layers` where
> `layer='core'`. Build the CID required-element validator first, then layer the principles-specific
> rules (Super-Admin gate, floor hard-block, safety event, propagation) on top of it — do not build two
> validators. FR-4.CID.003/004/005 and FR-4.PRIN.003 are the "prompt half" of controls whose "code half"
> lives in C6/C1 (ISSUE-055/059/018): this slice must assert the *statement/instruction is present*, and
> must **not** let the prompt text become the sole control — weakening it never disables the code path.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-4.CID.001, FR-4.CID.002, FR-4.CID.003, FR-4.CID.004, FR-4.CID.005, FR-4.CID.006
  (Component 4 — Prompt; Layer-1 Core Identity content); FR-4.PRIN.001, FR-4.PRIN.002, FR-4.PRIN.003
  (Component 4 — Prompt; operating-principles block + floor + statement-not-enforcement).
- **NFRs:** none owned here. *(NFR-OBS.012 answer-mode pill everywhere is the C5/C8/C7 **rendering**
  duty — ISSUE-053/073; this slice owns only the FR-4.CID.006 Layer-1 signalling *instruction*, seamed
  away from the pill mechanism.)*
- **Rests on:** ADR-007 (containment-first injection posture — every Layer 1 carries the external-data
  boundary instruction, FR-4.CID.003); ADR-002 (Cited/Inferred/Unknown answer modes — the FR-4.CID.006
  convention); OD-049 (principles Super-Admin-editable, `PERM-prompt.edit_principles`); OD-053 (the floor
  is hard-blocking). No build-time viability gate holds any FR in this slice (AF-111 gates only the C4
  *optimisation* claim — ISSUE-046 — not the content contract here).

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-4.CID.001.1 (all six Layer-1 elements present; incomplete Layer-1 flagged in editor)
- AC-4.CID.002.1 (over-length save shows non-blocking warning and succeeds)
- AC-4.CID.003.1 (external-data boundary instruction present; save without it rejected)
- AC-4.CID.004.1 (hard-limit statement present, referencing canonical set; independent of C6 code enforcement)
- AC-4.CID.005.1 (ambiguity/conflict behaviour stated, references operating principles)
- AC-4.CID.006.1 (three-mode Cited/Inferred/Unknown signalling + never-dead-end instruction present)
- AC-4.PRIN.001.1 (all seven principles present verbatim from the canonical block)
- AC-4.PRIN.002.1 (Admin — not Super Admin — denied on principles edit, logged; general content still editable)
- AC-4.PRIN.002.2 (Super-Admin edit: mandatory `change_reason` + immutable version-chain record + distinct safety-relevant event)
- AC-4.PRIN.002.3 (post-edit assembly reflects edited block across all agents; in-flight tasks unaffected)
- AC-4.PRIN.002.4 (removing/emptying any of the seven is hard-blocked; reword/strengthen permitted)
- AC-4.PRIN.003.1 (weakening a principle in the prompt leaves the underlying code control unaffected)
- **Gating spikes (if any):** none — no launch-gating spike (ISSUE-001..006) and no build-time AF gates
  this slice. (ISSUE-042, the blocked-by, is a feature issue, not a spike.)

## 5. Touches (complete blast radius, by ID)
- **DATA:** `prompt_layers` rows where `layer='core'` (schema.md §5) — this slice **writes/validates**
  `core` records (`content`, `agent_id`, `change_reason`, the version-chain columns), it does **not**
  alter the DDL (ISSUE-042 / migration owns the table). No new column.
- **PERM:** `PERM-prompt.edit_principles` (Super Admin only — gates FR-4.PRIN.002; node authored/matrixed
  in ISSUE-018, **consumed** here). *(General `PERM-prompt.edit` is ISSUE-042's; not this slice.)*
- **CFG:** none. *(The `dynamic_field_freshness_threshold`, `memories_injected_per_task`, and Layer-2
  keys belong to ISSUE-044/045; the advisory Layer-1 length bound per OD-051 is a fixed ~500-word warning,
  not a config key.)*
- **UI:** the **principles-editor** (Super-Admin-only, with the confirmation/safety warning and the
  floor-block feedback) and the **Layer-1 content editor** completeness/word-count-advisory affordances
  (the six-element incomplete flag, the ~500-word advisory). *(The version-history + rollback view is
  ISSUE-042's surface.)*
- **Connectors:** none.

## 6. Context manifest (the EXACT files to open — nothing more)
- spec/01-requirements/component-04-prompt.md — FR-4.CID.001–006 + FR-4.PRIN.001–003 text and their ACs
  (the CID and PRIN areas), plus the doc-reconciliation notes (boundary-instruction split, hard-limit
  "both never one", principles shared-verbatim + floor)
- spec/04-data-model/schema.md §5 (Prompt Content — C4) — the `prompt_layers` table this slice writes
  `core` records into (`layer`, `content`, `agent_id`, `change_reason`, version-chain columns)
- spec/00-foundations/adr/ADR-007-injection-posture.md — the containment-first posture: why every Layer 1
  must carry the external-data boundary instruction (Decision part 2, FR-4.CID.003)

## 7. Dependencies
- **Blocked-by:** ISSUE-042 (prompt layer model + `prompt_layers` store + version-never-overwrite +
  version pinning — this slice writes `core` records into that store and relies on its version-chain
  columns and the general `PERM-prompt.edit` gate being in place).
- **Blocks:** ISSUE-053 (C5 run-pipeline — assembles the stack and executes the FR-4.LYR.004 assembly-time
  validation over the Layer-1 content this slice guarantees; also attaches the answer-mode pill per the
  FR-4.CID.006 instruction); ISSUE-062 (eight specialist definitions — each specialist's per-agent Layer 1
  and per-agent hard limits are authored against this slice's Layer-1 content contract).

## 8. Build order within the slice
1. **Six-element Layer-1 validator** — a save/edit-time completeness check over `prompt_layers` where
   `layer='core'` asserting elements (a)–(f) of FR-4.CID.001 are present; an incomplete `core` record is
   flagged in the editor (not silently saved).
2. **Non-removable safety elements** — extend the validator so a `core` save is **rejected** without the
   external-data boundary instruction (FR-4.CID.003) and must carry the hard-limit statement referencing
   the canonical set (FR-4.CID.004) and the uncertainty/conflict text (FR-4.CID.005). These are the prompt
   half of C6/C1 controls — presence is required; presence never becomes the sole control.
3. **Answer-mode signalling instruction** — require the Layer-1 Cited/Inferred/Unknown convention +
   never-dead-end rule (FR-4.CID.006). Content-only; the pill mechanism is ISSUE-053/062 (seam).
4. **Advisory length bound** — the ~500-word non-blocking warning on over-length Layer-1 save (FR-4.CID.002,
   OD-051 — warn, never block).
5. **Canonical principles block** — store the seven principles verbatim in every agent's `core` record;
   the validator asserts all seven present verbatim (FR-4.PRIN.001), as element (b) of step 1.
6. **Principles edit path** — gate the edit on `PERM-prompt.edit_principles` (Super Admin only; Admin
   denied + logged), require mandatory `change_reason`, emit a distinct safety-relevant edit event to the
   audit/alert sink (C7 seam), and surface the confirmation/safety warning; propagate the edited block to
   every agent's Layer 1 (FR-4.PRIN.002; AC-4.PRIN.002.1/.2/.3). Version discipline + pinning come from
   ISSUE-042 — reuse, don't rebuild.
7. **Seven-principle floor (hard-block)** — reject any save that removes or empties one of the seven;
   allow reword/strengthen/add (FR-4.PRIN.002 / OD-053; AC-4.PRIN.002.4).
8. **Statement-not-enforcement invariant** — prove weakening/omitting a principle in the prompt does not
   disable its code control (FR-4.PRIN.003; AC-4.PRIN.003.1).
9. **Tests to the ACs** — the DoD list above.

## 9. Verification (how DoD is proven)
- **Validation/unit layer** (per spec/05-non-functional/test-strategy.md): a `core`-record validator test
  matrix — six-element completeness (AC-4.CID.001.1), boundary-instruction-required reject
  (AC-4.CID.003.1), hard-limit-statement present (AC-4.CID.004.1), uncertainty text present
  (AC-4.CID.005.1), answer-mode instruction present (AC-4.CID.006.1), over-length warn-not-block
  (AC-4.CID.002.1), seven principles verbatim (AC-4.PRIN.001.1), and the floor hard-block on
  remove/empty vs allow reword (AC-4.PRIN.002.4).
- **Authorization/integration layer:** the principles-edit path — Admin denied + logged, Super Admin
  succeeds with mandatory `change_reason` + version-chain record + a distinct safety-relevant event
  emitted (AC-4.PRIN.002.1/.2); a post-edit assembly test showing every agent's Layer 1 reflects the
  edit while an in-flight task keeps its pinned version (AC-4.PRIN.002.3 — exercises ISSUE-042's pinning).
- **Invariant test:** weakening a principle's prompt text leaves the mapped code control (RBAC / approval
  gate) enforcing (AC-4.PRIN.003.1) — the principle is proven *not* the enforcement path.
- No `AC-NFR-*` posture and no AF gate blocks this slice; the `AC → Verified` path is the validator +
  authorization + invariant suites above.
