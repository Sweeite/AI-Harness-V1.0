# ISSUE-084 — proposed shared-spec deltas (for the orchestrator to fold into the shared files)

This package authors **no migration** and edits **no shared file** (parallel fan-out contract). Everything
it needs the shared spec to reflect is proposed here as data, for the integrator to apply on `main`.

Ground truth this proposal is authored against:
- FR-10.RET.002 + `spec/02-config/config-registry.md §M` — the four retention CFG keys.
- FR-10.ISO.001 + `spec/04-data-model/schema.md` "Global rules" — no `client_slug` on any app table.
- FR-10.ISO.003 + ADR-001 §Consequences + ADR-005 §5 — v1 residency default.

---

## 1. Four retention CFG keys — register into the ISSUE-010 config store

These already exist in `config-registry.md §M` (Infrastructure & compliance, `PERM-config.infra` ·
`UI-config-admin#infra`). This slice **registers them into the ISSUE-010 `config_values` store** with the
defaults + floor-validation-on-write below. No new key is invented; this is the runtime binding of §M.

| Key | Default | Class | Gate | Floor (validation) |
|---|---|---|---|---|
| `client_offboarding_retention_days` | `90` | BOOT | `PERM-config.infra` | int days ≥ legal min (AF-136; engineering default floor **30**, review-set) |
| `individual_deletion_audit_years` | `7` | BOOT | `PERM-config.infra` | int years ≥ legal min (AF-136; engineering default floor **7**, review-set) |
| `data_export_link_expiry_hours` | `72` | LIVE | `PERM-config.infra` | int hours ≥ **1** (mechanical floor; a 0-hour link is degenerate) |
| `deletion_two_person_auth_required` | `true` | LIVE | `PERM-config.infra` | bool (no floor); for Restricted/Personal |

Write contract (enforced in `src/store.ts`, mirrored in `src/supabase-store.ts`):
- Only `PERM-config.infra` (Super Admin) may write any of these — else reject (`ERR_DENIED`).
- A numeric value **below its floor** is rejected **with the floor surfaced** (`ERR_BELOW_FLOOR`).
- A numeric key with **no resolvable floor** fails **closed** (`ERR_FLOOR_UNRESOLVED`) — never silently
  accepted (#2/#3).
- Every accepted change appends a `config_audit_log` row (who/old/new/when) in the **same transaction** as
  the `config_values` upsert — a value never lands without its audit (AC-10.RET.002.3 / AC-NFR-CMP.003.2).

> **AF-136 note (do not bake a legal value in):** the numeric floors above are *conservative engineering
> safeguards*, not legal advice. The **actual** per-jurisdiction minimum is installed at runtime by the
> FR-10.LEG.001 legal review (`setFloor(key, floor)`), which may **raise** a floor. The store reads whatever
> the review installed. See §4.

## 2. v2 residency-selection knob (stub)

| Key | Default | Class | Gate | Validation |
|---|---|---|---|---|
| `deployment_region` | `ap-southeast-2` | BOOT | `PERM-config.infra` | enum (v1 **Sydney locked**; selection is v2) |

Already in `config-registry.md §M` — recorded here as the residency default source-of-truth this slice
reads. v1 provisioning records the region on `client_registry.region` (schema §13, owned by ISSUE-012);
this slice records the **default** and asserts it is a recorded fact, never a silent default.

## 3. No-`client_slug` schema-lint assertion (isolation invariant, FR-10.ISO.001)

**Assertion (offline, CI-gated):** the ISSUE-008 baseline migration (`app/silo/migrations/0001_baseline.sql`
— the client-silo schema) declares **no** `client_slug` / `client_id` / `tenant_id` / `tenant` column on
**any** application table. Client identity lives **only** on the management-plane `client_registry`
(schema §13), which is a *separate* migration lineage (ISSUE-012) never created in a client silo.

- **Where:** `src/index.ts` `check` CLI (`npm run check`) — parses every `create table … ( … );` block,
  strips comments, and fails the build if any identity column appears. Verified green: **44 tables linted,
  none carry an identity column.**
- **Proposed shared home:** add this lint to the repo-level build/CI gate (alongside the ISSUE-010 keygroup
  parity check) so a future migration that reintroduces `client_slug` on an app table fails CI. The lint is
  self-contained in this package; the orchestrator can invoke `npm run check` in `app/retention` from CI, or
  lift `checkIsolationLint()` into the shared build gate.
- **OD-096 reconciliation:** the schema "Global rules" note + the baseline header (`` `client_slug` never
  appears in a silo ``) already carry the clerical "column not created" note. No behavioural change — the
  column was never load-bearing for RLS or any filter. The three prior FRs (C5 FR-5.QUE.002, C2, C6
  `guardrail_log`) get their clerical note at Phase-4 schema authoring (carry-forward), not here.

## 4. Residency default (recorded, not silently defaulted)

- **v1 region default:** `ap-southeast-2` (Sydney) — ADR-001 §Consequences / ADR-005 §5 / FR-10.ISO.003.
- Recorded per deployment on `client_registry.region` (schema §13, ISSUE-012). This slice asserts the
  default resolves + is a **recorded** fact carrying a `surfaced_for_legal_review` flag (AC-NFR-CMP.001.2).

---

## Cross-package integration notes (no edits made — for the integrator)

- **ISSUE-010 (config store):** the four keys + `deployment_region` register into `config_values`; the
  floor-validation + audit-on-write wrap the ISSUE-010 `appendAudit`/`putConfigValue` path. This slice's
  `supabase-store.ts` writes both in one transaction — the integrator should route the retention-value write
  through the ISSUE-010 store's audit path rather than a second `config_audit_log` writer, to keep one
  audit sink.
- **ISSUE-008 (baseline DDL):** the isolation lint reads `0001_baseline.sql` read-only; no migration added.
- **ISSUE-012 (`client_registry`):** owns `region`; this slice records the default into it.
- **ISSUE-082 / ISSUE-083 (erasure / offboarding):** consume RET.001's two-path constraint + the retention
  CFG values; the `SANCTIONED_DELETE_PATHS` + `unauthorisedTombstones()` detector is the shared contract
  they enforce against.
