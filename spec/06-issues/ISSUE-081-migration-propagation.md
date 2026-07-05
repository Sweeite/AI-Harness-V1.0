---
id: ISSUE-081
title: Schema-migration propagation + per-deployment failure isolation
epic: K — infra & compliance
status: ready
github: "#81"
---

# ISSUE-081 — Schema-migration propagation + per-deployment failure isolation

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Wire migration *propagation* across the fleet on top of the ISSUE-008 harness: each deployment runs the one shared, identical migration set against its **own** Supabase independently on release, and a migration failure **halts only that silo** (prior version live) and **fires a loud alert** — never silent, never cascading — with expand-contract as the mixed-version safety premise.

## 2. Scope — in / out
**In:**
- **Per-deployment migrate-on-release propagation** (FR-10.MIG.001): the identical migration files (authored once by the ISSUE-008 harness) run as N independent `drizzle-kit migrate` invocations, each against that deployment's own Supabase, with no per-client schema fork — per-client variation is env config + `/plugins` only. Includes the `vN` / `vN-1` mixed-fleet correctness branch (each deployment correct against its own schema through a rollout).
- **Per-deployment migration-failure isolation** (FR-10.MIG.002): a failure halts that one silo with the prior version left live, is **safe to re-run** (a halted-then-retried deploy re-applies cleanly), fires a migration-failure alert, surfaces the stuck silo in the version-skew view, and is structurally isolated (separate Supabase per silo) so it cannot cascade to another client.
- The **expand-contract discipline** as the binding authoring constraint enforced in review + CI (NFR-INF.002): no destructive `DROP`/rename in the same migration a running prior build depends on; add → backfill → later-release remove; new columns nullable-or-defaulted; the worked-example ladder in `migrations.md`.
- The **isolation posture** proving a migration failure is contained to the failing deployment with no fleet-wide abort (NFR-INF.005).

**Out:**
- **The migration toolchain itself** — `drizzle-kit generate` (author once) + `drizzle-kit migrate` wiring, migration 0001 baseline, the `CONCURRENTLY` non-transactional step, idempotent first-boot seed: **ISSUE-008** owns these; this slice orchestrates *when/where* they run across the fleet and *what happens on failure*.
- **The release train + canary/soak promotion gate + rollback-by-redeploy + the version-skew alert rule itself** (FR-10.DEP.001–005, NFR-INF.003/004): **ISSUE-080** owns these. This slice *consumes* ISSUE-080's per-project auto-deploy as the trigger surface and *feeds* the skew/migration-failure alert into ISSUE-080's version-skew view; the rollback path (FR-10.DEP.003) rests on this slice's expand-contract premise (AF-065) but is built there.
- **The cross-deployment alert delivery + fleet version grid** (C7 FR-7.MGM.004 / FR-7.MGM.003): **ISSUE-012 / ISSUE-077 / ISSUE-078** (management plane + C7) own the ingest, grid, and alert routing; this slice raises the migration-failure signal *into* that path.
- The management deployment's **own** separate migration lineage (`client_registry`/`deployment_health`/`offboarding_records`): homed with the management plane (ISSUE-012); referenced here only as "not part of a client silo's set."

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-10.MIG.001, FR-10.MIG.002 (both Component 10 — Infra & Compliance).
- **NFRs:** NFR-INF.002 (expand-contract mixed-fleet safety), NFR-INF.005 (per-deployment migration-failure isolation).
- **Rests on:** ADR-001 §2 (one codebase, per-client env/plugin variation only) / §6 (N deployments migrate independently) / §7 (management plane has its own lineage), ADR-005 §1 (migrate-on-release) / §2 (isolation) / §3 (skew is normal, expand-contract) / §4 (rollback = roll-forward, no down-migration); `standards/migration-discipline.md` (the binding expand-contract rules); AF-065 (expand-contract keeps a mixed-version fleet safe — build-time SPIKE), AF-020 (Railway on-release `drizzle-kit migrate` — 🟢 VERIFIED).

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-10.MIG.001.1, AC-10.MIG.001.2 (FR-10.MIG.001 — per-deployment migrate against own Supabase; identical files, no fork)
- AC-10.MIG.002.1, AC-10.MIG.002.2 (FR-10.MIG.002 — failure halts that silo only + alert fires + never silent + no cascade)
- AC-NFR-INF.002.1, AC-NFR-INF.002.2 (expand-contract authored; `vN` and `vN-1` both correct against the migrated schema)
- AC-NFR-INF.005.1 (a forced migration failure in one silo halts+logs+alerts that silo only)
- **Gating spikes (if any):** **AF-065 (expand-contract mixed-version safety) must be GREEN before this issue ships** — it is a build-time SPIKE (RP-1 posture, `spec/05-non-functional/infrastructure.md` NFR-INF.002 launch-gate: blocking), owned/proven by the ISSUE-008 migration track (backlog Gate for ISSUE-008), **not** one of the OD-157 launch-gating spike ISSUEs (ISSUE-001–006). It confirms AC-NFR-INF.002.2 (`vN`/`vN-1` both correct against the migrated schema, prior code correct against the newer schema — the rollback premise ISSUE-080 also depends on). **AF-020** (Railway per-project auto-deploy + on-release `drizzle-kit migrate`) is already 🟢 VERIFIED (feasibility register F11).

## 5. Touches (complete blast radius, by ID)
- **DATA:** each client silo's **own** Supabase schema (the target of the per-deployment migrate; no shared table); `DATA-deployment_health.core_version` + `DATA-deployment_health.last_migrated_at` (the push-fed markers a stuck silo surfaces through — written via the C7 health push, read by the skew evaluation). No `client_slug` in any application table (ADR-001 §3, invariant honoured).
- **PERM:** none newly created; the deploy pipeline (per-deployment) runs the migrate; the operator is the migration-failure alert recipient.
- **CFG:** `CFG-deploy_max_version_skew`, `CFG-deploy_max_skew_days` (read by the skew evaluation a stuck-on-failed-migration silo trips; the alert *rule* is homed in ISSUE-080/C7 — consumed here as the surfacing path).
- **UI:** none directly (the fleet version grid + migration-status view are C7 + Phase 3, rendered by ISSUE-078; this slice raises the signal).
- **Connectors:** none.

## 6. Context manifest (the EXACT files to open — nothing more)
- spec/01-requirements/component-10-infra-compliance.md — the FR text + ACs (MIG.001/002; the DEP.003/DEP.004 seam paragraphs for the ISSUE-080 boundary — rollback premise + skew alert).
- spec/04-data-model/migrations.md — the fleet migration shape (one codebase / N independent runs), the migration-0001 baseline it builds on, the expand-contract worked-example ladder, the "hard constraints (CI-enforced)" list, and the rollback playbook.
- spec/04-data-model/schema.md §13 (Management plane) — `deployment_health.core_version` / `.last_migrated_at` (the markers a stuck silo surfaces through); the note that `client_registry`/`deployment_health`/`offboarding_records` are a separate lineage, never in a client silo.
- spec/05-non-functional/infrastructure.md — NFR-INF.002 (expand-contract) + NFR-INF.005 (failure isolation), and NFR-INF.003/004 for the adjacent rollback/skew posture this slice feeds.
- spec/00-foundations/standards/migration-discipline.md — the binding expand → backfill → contract rules enforced in review + CI.
- spec/00-foundations/adr/ADR-005-deploy-provisioning.md — §1 (migrate-on-release), §2 (isolation), §3 (skew normal / expand-contract), §4 (rollback rolls forward); ADR-001 §2/§6/§7 (one codebase, independent per-client migrates, management-plane lineage).

## 7. Dependencies
- **Blocked-by:** ISSUE-008 (migration harness — `drizzle-kit generate`/`migrate` toolchain + 0001 baseline + the expand-contract discipline this slice propagates; **also proves AF-065** — the mixed-fleet SPIKE this issue's DoD gates on), ISSUE-080 (release model — the per-project auto-deploy trigger + version-skew view this slice's failure signal feeds into).
- **Blocks:** none (leaf).

## 8. Build order within the slice
1. Confirm the ISSUE-008 harness is in place (toolchain wired, 0001 baseline applies against a fresh silo, expand-contract discipline + CI constraints live) and the ISSUE-080 per-project auto-deploy trigger exists — this slice adds fleet-wide *propagation + failure behaviour*, not the toolchain or the deploy trigger.
2. **Propagation:** wire the release deploy so each deployment runs `drizzle-kit migrate` against **its own** Supabase, independently — N runs of the *identical* migration files, no per-client schema fork (per-client variation stays env config + `/plugins`); assert the `vN` / `vN-1` mixed-fleet branch stays correct (FR-10.MIG.001 → AF-020, AF-065).
3. **Expand-contract enforcement gate:** add the review + CI check that rejects any migration with a destructive `DROP`/rename in the same step a running prior build depends on, and that new columns are nullable-or-defaulted — the add→backfill→later-remove ladder from `migrations.md` (NFR-INF.002 → AF-065).
4. **Failure isolation + halt:** make a migration failure halt only that deployment with the prior version left live, ensure the migration is **safe to re-run** (halted-then-retried re-applies cleanly), and confirm no cross-silo effect (structural — separate Supabase per ADR-001) (FR-10.MIG.002, NFR-INF.005).
5. **Fail-loud signal:** on failure, raise the migration-failure signal into the health push so the stuck silo surfaces both as a direct migration-failure alert and as a laggard in the skew view (`core_version`/`last_migrated_at` markers) — never silent (FR-10.MIG.002 → C7 FR-7.MGM.004; the alert delivery + grid are ISSUE-012/077/078).
6. Test to each AC in field 4: a clean multi-deployment rollout (independent migrates, identical files), an expand-contract-violating migration rejected by the CI gate, a `vN`/`vN-1` mixed-fleet run (AF-065 spike), and a forced single-silo failure that halts+alerts that silo only with every other silo unaffected.

## 9. Verification (how DoD is proven)
- **DOCS / topology (per spec/05-non-functional/test-strategy.md):** the "one codebase → N independent per-deployment migrates against own Supabase, no fork" topology + the migration-discipline CI constraints prove AC-10.MIG.001.1/.2 and AC-NFR-INF.002.1; the per-deployment migration boundary (separate projects, ADR-001) proves the structural no-cascade claim of AC-NFR-INF.005.1.
- **Build-time gate tests:** a migration authored with a destructive change a prior build relies on → CI rejects it (AC-NFR-INF.002.1); a forced migration failure in one silo → that silo halts (prior version live) + logs + a migration-failure alert fires + no other silo is affected, and the stuck silo surfaces in the skew view (AC-10.MIG.002.1/.2, AC-NFR-INF.005.1); a halted-then-retried deploy re-applies cleanly (re-runnability, AC-10.MIG.002.1).
- **Spike gate:** **AF-065 GREEN** (proven on the ISSUE-008 migration track) is a precondition to shipping — a `vN` and `vN-1` deployment run concurrently against the migrated schema and both operate with no data loss or errored path, and the prior build runs correctly against the newer schema — proving AC-NFR-INF.002.2. The AC→`Verified` path for the MIG/INF.002 ACs runs once AF-065 is GREEN.
