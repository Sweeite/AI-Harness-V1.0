---
id: ISSUE-004
title: "SPIKE — restore actually works (DB + pgvector + auth) end-to-end"
epic: S — spikes
status: ready
github: "#4"
---

# ISSUE-004 — SPIKE: restore actually works (DB + pgvector + auth)

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR/NFR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and run this spike to its Definition of done **without guessing**.

## 1. Goal (one line)
Prove — by a real, logged restore rehearsal into a throwaway project — that a recent backup (in-project target **and** the off-platform `pg_dump`) comes back complete and queryable, including **pgvector memory** and **`auth` user rows**, within acceptable downtime — turning AF-069 GREEN so the backup guarantee (non-negotiable #1) is proven, not assumed, before go-live.

## 2. Scope — in / out
**In:** A spike, not a shipping feature. Take a recent snapshot from BOTH backup paths ADR-008 defines — a free daily in-project backup **and** the independent off-platform `pg_dump` (§1/§2) — and restore each into a **throwaway** Supabase project. Assert the restored DB is complete and queryable, specifically that **pgvector memory rows** (embeddings included) and **`auth.users` rows** survive intact. Measure and record the real end-to-end restore **downtime (RTO)** — this spike is where the "minutes-to-hours, to be confirmed" RTO number in backup-dr.md becomes a measured number. Log the result + timestamp (this is the first execution of the standing rehearsal AC-NFR-DR.003.2 later automates). Flip AF-069 to GREEN in the feasibility register with the evidence, per RP-1 / the launch-go/no-go gate in `test-strategy.md §4`.
**Out:** Building the *standing* automated rehearsal job + its cadence (monthly + per-migration) and the backup-health lapse/stale alert wiring — that is **ISSUE-085** (Backup & DR), which is blocked-by this spike. Scheduling the hourly off-platform dump job and the provisioning that creates the client-owned destination — **ISSUE-007** (provisioning) / ISSUE-085. Whether the hourly dump *fits the hour at scale* (AF-072, LOAD) and the Management-API backup-health payload (AF-070) — separate AFs owned by ISSUE-085, NOT this spike. Region/residency confirmation (AF-071, DOCS). Off-platform purge-on-erasure (NFR-DR.009 / AF-137).

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** none (spike; no user-facing FR — it verifies an NFR posture).
- **NFRs:** NFR-DR.003 (backup-dr.md — tested restore, the only restore that counts). Also confirms the RTO number asserted in NFR-DR.005.
- **Rests on:** ADR-008 (§4 tested restore; §1/§2 the two backup paths it restores from) · AF-069 (the SPIKE this issue *is*).

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-NFR-DR.003.1 — restored throwaway project: pgvector memory **and** `auth` rows complete + queryable within acceptable downtime (the core spike assertion).
- AC-NFR-DR.003.2 — (first, manual execution of) the rehearsal logs result + timestamp; a missing/failed/stale rehearsal is a loud alert. *(The standing automated cadence + alert lands in ISSUE-085; this spike runs it once, by hand, and logs it.)*
- AC-NFR-DR.005.1 — the measured restore is backup-restore-with-bounded-downtime, and the RTO recorded is a **measured AF-069 number**, not an assumed one.
- **Gating spikes (this issue IS the gate):** AF-069 must be flipped to **GREEN** in `feasibility-register.md` (Block I) with logged evidence. Per RP-1, AF-069 is one of the six launch-blocking spikes (`test-strategy.md §4`); until GREEN, ISSUE-085 may not ship.

## 5. Touches (complete blast radius, by ID)
- **DATA:** none created/migrated by this spike. It *reads-back* the whole restored DB — asserting `memories` (pgvector embedding column) and the Supabase-managed `auth.users` rows survive; it writes no app schema.
- **PERM:** none. Uses the operator's delegated backup-ops credential (ADR-008 §Consequences / NFR-SEC.017), not an app permission node.
- **CFG:** reads `recovery_tier` to know which paths to restore from (config owned/provisioned by ISSUE-007/085); this spike sets nothing.
- **UI:** none (operator-run rehearsal; the dashboard lapse/stale surface is ISSUE-085 via FR-7.MGM.005).
- **Connectors:** none. Supabase Management API is used only to obtain the in-project backup for restore; the off-platform copy is the client-owned `pg_dump` destination.

## 6. Context manifest (the EXACT files to open — nothing more)
- spec/05-non-functional/backup-dr.md — NFR-DR.003 (spike target), NFR-DR.001/002 (the two backup paths restored from), NFR-DR.005 (the RTO posture this measures).
- spec/00-foundations/adr/ADR-008-backup-dr.md — §4 (tested restore), §1/§2 (default tier + off-platform copy the restore reads).
- spec/00-foundations/feasibility-register.md — Block I, AF-069 (the assumption to flip GREEN; AF-070/071/072 noted there as out-of-scope for this spike).
- spec/05-non-functional/test-strategy.md — §4 (the six-spike launch go/no-go gate; how a spike PASS is evidenced) and the SPIKE method definition.

## 7. Dependencies
- **Blocked-by:** none (foundational spike; runs first / alongside per Tier 0).
- **Blocks:** ISSUE-085 (Backup & DR — hourly dump + standing restore rehearsal + backup-health push). AF-069 must be GREEN before ISSUE-085 ships (backlog "Gate" column; spike sequencing 004 → 085).

## 8. Build order within the slice
1. Stand up a **throwaway** Supabase project as the restore target (disposable; deleted after).
2. Obtain a recent **in-project** backup of a representative source project (via Supabase Management API / dashboard), and a recent **off-platform** `pg_dump` artifact (the ADR-008 §2 client-owned copy) — restore rehearsal must exercise BOTH paths.
3. Restore path A: the in-project backup → throwaway project; restore path B: the off-platform `pg_dump` → throwaway project.
4. Assert completeness + queryability: run queries confirming `memories` rows return **with their pgvector embeddings** (vector similarity query works) and `auth.users` rows are present + resolvable — per AC-NFR-DR.003.1.
5. Time the end-to-end restore for each path; record the RTO number (AC-NFR-DR.005.1 — measured, not assumed).
6. Log the rehearsal result + timestamp (first manual run of AC-NFR-DR.003.2); tear down the throwaway project.
7. Flip AF-069 → GREEN in `feasibility-register.md` (Block I) with the logged evidence + measured RTO, per `test-strategy.md §4`; if any assertion fails, AF-069 stays 🔴 and the design/mechanism must change before launch (RP-1).

## 9. Verification (how DoD is proven)
- Test layer per `test-strategy.md`: **SPIKE** (the AF-069 method) — a real restore rehearsal, not a unit/integration test; evidence is the logged rehearsal result + measured RTO in the feasibility register.
- AC→Verified path: AC-NFR-DR.003.1 verified by the queryability assertions on the restored throwaway project (pgvector + `auth` rows); AC-NFR-DR.005.1 verified by the recorded RTO number; AC-NFR-DR.003.2 verified by the logged result+timestamp of this first manual run.
- Gate posture: this is a **launch-blocking (SPIKE-GATE)** AF (`test-strategy.md §4`, item 2). DoD = AF-069 shows a PASS with logged evidence; ISSUE-085 stays blocked until then.
