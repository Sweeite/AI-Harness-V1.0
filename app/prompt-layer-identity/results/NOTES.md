# ISSUE-043 — build package notes (`@harness/prompt-layer-identity`)

## What this slice is
The required-content contract for a Layer-1 `core` record (CID) + the canonical seven-principle operating
block (PRIN), validated at save/edit time over the ISSUE-042 `prompt_layers` store. Content-only: it writes
and validates `core` records; it does **not** own the `prompt_layers` DDL, version discipline, rollback,
pinning, or the general `PERM-prompt.edit` gate (all ISSUE-042).

## Migration
**NONE authored.** `prompt_layers` already exists (ISSUE-042 / silo `0001_baseline.sql` + `0004_prompt_version_discipline.sql`).
This slice's `supabase-store.ts` is authored to that **existing** DDL and only ever INSERTs `core` versions
(append-only). The `check` gate (`npm run check`) verifies the baseline `prompt_layers` shape this slice
depends on is present (no `client_slug`, `layer='core' ⇒ agent_id` check, `change_reason NOT NULL`,
`previous_version_id` self-FK) and fails LOUD on drift. It does **not** add to `app/silo/migrations/*` or
`_journal.json`.

## Shared spec proposals
**NONE.** No new config keys, no schema deltas, no new PERM node. `PERM-prompt.edit_principles` is
consumed (authored/matrixed in ISSUE-018); `PERM-prompt.edit` is ISSUE-042's. The ~500-word Layer-1 bound
is a fixed advisory warning (OD-051), not a config key (per §5 CFG: none).

## Offline proof (all 12 §4 ACs, port + in-memory fake)
`npm install && npm test && npm run typecheck` → 12/12 pass, typecheck clean, `check` green. Every AC is a
content-validation / authorization / invariant assertion over the in-memory reference model — none require
live infra to prove correct.

## Live proof owed to the Stage-3 checkpoint capstone (operator, 💻 full session)
The `supabase-store.ts` (`SupabaseCorePromptStore`) pg adapter is authored-to-DDL but **NOT run live**. The
live proofs owed (belt-and-braces over what the fake already proves offline):
- a real `core` INSERT + edit firing the ISSUE-042 `0004` version-discipline trigger (append-only enforced at the DB);
- the `prompt_layers` RLS policy gating a principles edit by `PERM-prompt.edit_principles` (Super-Admin-only) at the DB;
- the distinct safety-relevant edit event landing in the C7 audit/alert sink (the sink here is an in-memory seam).
These are the same class of live proof ISSUE-042 deferred to its capstone; ISSUE-043 adds no new live-only AC.

## Seams left open (by design, per §2 Out)
- Assembly-time FR-4.LYR.004 re-check **executes** in ISSUE-053; this slice exports `assemblyRequiredElementChecks`
  (the three content-string predicates: boundary_instruction / hard_limit_statement / principles_block) for
  ISSUE-053 to wire into `validateAssembledCore(...)` (the halt hook ISSUE-042 left pluggable).
- Answer-mode **pill rendering/evaluation** + said-vs-did (AF-033) = C5/C8 (ISSUE-053/062); this slice owns
  only the Layer-1 signalling **instruction**.
- The **code half** of the hard limits / injection tagging = C6 (ISSUE-055/059); this slice asserts the
  prompt **statement/instruction** is present and never lets the prompt become the sole control (FR-4.PRIN.003).
