# ISSUE-046 — prompt-optimisation: results / proposals

This slice ships **NO migration** and **NO shared-spec edit** (per the build directive). Everything that
would otherwise touch a shared file is proposed here for the orchestrator / owning slice to fold in.

## Files

- **`opt001-attribution-columns.sql`** — PROPOSED DDL for the version-to-outcome attribution capture
  (FR-4.OPT.001). One row per `(task, slot)` keyed to `task_queue(id)`. C4 owns the *required-fields
  contract + never-lose-identity invariant*; the concrete home is a **C5-owned** migration (ISSUE-053,
  FR-5.ASM.002 pin + FR-5.ASM.009 completion dual-record). The reference model + live adapter are authored
  to this shape.

## Live proof owed (NOT provable offline — not faked)

- **OPT.001 / OPT.002 live silo proof** — the attribution capture against real `prompt_layers` ids and the
  fresh read against real `dynamic_field_values` are proven at the **ISSUE-053 integration / Stage-3
  checkpoint**, run by the operator. `src/supabase-store.ts` is authored to the DDL but NOT run live.
- **AF-111 (build-time EVAL, feasibility-register block O)** — whether version-bucketed outcome deltas
  *exceed noise* (attribution discriminates versions) and whether compression *measurably outperforms* can
  only be measured once a deployment has **real task history**. The machinery ships regardless; this slice
  makes the substrate queryable (`outcomesByVersion`) — it does **not** gate itself on the EVAL result.
  This is the offline-unprovable claim, recorded here rather than faked green.

## Shared-spec proposals

None. No config keys, no schema deltas beyond the C5-owned attribution shape proposed above. No
PERMISSION_NODES / glossary / config-registry change (OPT adds no PERM node, no CFG key — those are
ISSUE-042/044/045's).
