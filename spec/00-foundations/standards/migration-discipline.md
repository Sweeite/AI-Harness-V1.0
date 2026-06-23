# Standard — Migration Discipline (expand-contract)

- **Status:** Binding
- **Source:** ADR-005 §3/§4 (parts 3 + 4 *depend* on this); design-doc `L1106–1136`.
- **Applies to:** every drizzle migration in the shared repo (`pnpm drizzle-kit generate` →
  applied per-deployment by `drizzle-kit migrate` on release, `L1089–1100`).

## Why this exists

The fleet runs **one codebase across N deployments that migrate independently** (ADR-001 §6,
`L1141–1160`). Two consequences make destructive migrations unsafe:

1. **Version skew is normal** (ADR-005 §3): during a rollout a `vN` and a `vN-1` deployment run
   simultaneously, each against its **own** schema. A migration that breaks the *old* code breaks
   any deployment not yet promoted.
2. **Rollback is code-redeploy, not down-migration** (ADR-005 §4): Railway rolls **code** back to a
   prior build; the schema is **not** un-applied. So the previous build must keep working against the
   newer schema.

Both require the same thing: **every schema change is backwards-compatible with the immediately
prior code.**

## The rule (expand → backfill → contract, across releases)

A change that would be destructive is split across **at least two releases**:

1. **Expand** — add the new shape **additively**. New columns are **nullable or defaulted**; new
   tables/indexes are added; nothing existing is removed or renamed. Old code ignores the new shape;
   new code uses it. *(Both versions run.)*
2. **Backfill** — populate/migrate data into the new shape (online job or migration step), still
   leaving the old shape intact.
3. **Contract** — only in a **later** release, once **no deployment runs code that reads the old
   shape**, remove/rename the old column/table.

## Hard constraints (enforced in review + CI)

- **No column/table DROP or RENAME in the same migration that introduces its replacement.** Drops
  happen in a separate, later migration (the contract step). *(`L1106–1136`.)*
- **New columns are nullable or have a default** — never `NOT NULL` without a default on a populated
  table in the expand step.
- **Vector / heavy index builds run `CONCURRENTLY`** so a deploy doesn't lock the table (`L1106–1136`).
- **The seed script is idempotent** and runs on first boot only — it checks for existing data before
  writing (`L1130–1136`).
- **Migration failure halts only that deployment** — previous version stays live, alert fires
  (`L1141–1160`). Migrations must therefore be safe to **re-run** (a halted, then re-triggered deploy
  re-applies cleanly).

## Rollback playbook

- **Bad code, good schema** → redeploy the prior Railway build (per-deployment or fleet). Safe by
  construction: prior code runs against the newer (additive) schema.
- **Bad schema change** → **roll forward** a corrective migration. **Never** ship a destructive
  down-migration to production to "undo" it.

## Feasibility

⚠️ **AF-065 (SPIKE)** — that expand-contract actually keeps a mixed-version fleet safe (a `vN` and
`vN-1` deployment both correct against their own schema, and prior code correct against the newer
schema) is **paper until tested**. The whole skew-is-safe + rollback story rests on it.
