# ADR-008 — Backup & Disaster Recovery

- **Status:** Accepted
- **Date decided:** 2026-06-23
- **Resolves:** OD-009
- **Affects:** non-negotiable #1 (never lose or corrupt knowledge), ADR-001 (ownership boundary),
  ADR-003 (per-silo cost), ADR-005 (provisioning script + runbook), component 10 (offboarding),
  Super Admin management plane, NFR-SEC (secrets / data custody), data model

## Context

Nothing in the design doc or the prior seven ADRs addresses **data loss or corruption** of a
client's Supabase. For a "business brain" whose entire job is remembering, losing the memory layer
is the worst possible failure — it is exactly **non-negotiable #1**. OD-009 was elevated to top-bar
for this reason.

ADR-001 makes it thornier: **the client owns and pays for the Supabase project** (on their own card).
So the operator may be responsible for the integrity of a system whose backups they don't own and
can't unilaterally verify. The question OD-009 poses: backup cadence + retention, point-in-time
recovery, a *tested* restore, **who owns and who verifies** backups under client-owned Supabase, and
whether backup-health is part of the management-plane push.

**Primary-source vendor research (2026-06-23, see feasibility block I + the OD-009 dossier notes)
reframed the decision.** The load-bearing findings:

1. **The biggest loss path is the client's credit card, not a crash.** Because the project is on the
   client's account: a billing lapse / downgrade → **project pauses after ~7 days** → **restorable for
   90 days** → then **the project *and its backups in S3* are permanently, irreversibly deleted.** All
   in-project backups (daily *and* PITR) die with the project. The only data copy lives behind the
   client's card.
2. **Free daily backups can lose up to ~24h** (Pro = 7-day / Team = 14-day retention; one snapshot per
   night). **PITR** gives a **~2-minute RPO** (continuous WAL archiving) but is a **paid add-on
   (~$100+/mo per project + a required compute add-on)**, billed to the client, and *replaces* daily
   backups when on.
3. **Backups cover the Postgres database only** (which *includes* pgvector memory and `auth` user rows).
   **Supabase Storage buckets are NOT backed up.** In v1, Storage is used for exactly one thing —
   `Supabase Storage for file exports (offboarding)` (design-doc `L97`) — a transient, regenerable
   output, not source-of-truth knowledge.
4. **The Supabase Management API can read backup status** (`GET /v1/projects/{ref}/database/backups`,
   plus project status), so an operator can monitor backup health **remotely without touching any
   business data** — a clean fit for the ADR-001 management-plane boundary.
5. **Supabase makes no backup-verification claim.** "A backup exists" ≠ "a restore works"; there is no
   platform-side restore rehearsal. We must own that.
6. **No automatic failover on Pro/Team** (Enterprise only). DR for a silo is backup-restore-with-downtime,
   not hot failover — acceptable at the ≤~20-user / ≤~20-client scale (ADR-001), but stated, not assumed.

## Options considered

**Axis 1 — recovery point (RPO) per silo.**
- *A1 — Free daily backups only.* No extra cost; but a restore can lose up to a day of memory writes.
  For a knowledge system that is a direct hit on non-negotiable #1.
- *A2 — PITR on by default.* ~2-min RPO; ~$100+/mo per silo **on the client's card** (ADR-001 → opex is
  client-borne). Strongest fit for #1; modest against a retainer. **Chosen.**
- *A3 — Tiered by client.* PITR for high-value clients, daily for light ones. Rejected as the *default*
  posture: it lets invariant #1 silently vary by who's cheaper. Kept only as a logged downgrade exception.

**Axis 2 — independent off-platform copy, and where it lives.**
- *B1 — None (rely on in-project PITR + monitoring).* Simplest, but PITR lives inside the project that
  the deletion path destroys, so a single non-payment event is still a total-loss path. Fails #1.
- *B2 — Off-platform copy to a **client-owned** destination.* A scheduled logical dump (`pg_dump`) to a
  second location the client owns, in a different region, independent of the primary project's billing
  lifecycle. Survives a paused/deleted project. Keeps the operator **out of client-business-data
  custody** → preserves the ADR-001 boundary. **Chosen.**
- *B3 — Off-platform copy to an **operator-controlled** store.* Easiest for the operator to guarantee and
  restore from, but the operator would then **hold client business data**, erasing ADR-001's "no client
  business data crosses to the operator" line and importing data-processor liability for every client's
  brain. Rejected as default; kept as a documented fallback only where a client cannot provide a second
  destination (an explicit, logged per-client exception with its own data-handling terms).

**Axis 3 — who owns / who verifies.** Client owns the project + pays (it's their card, their plan, their
PITR add-on). Operator **operates and verifies** (configures PITR, runs the off-platform dump job, runs
restore rehearsals, monitors health). This is the only split consistent with ADR-001's hybrid ownership.

## Decision

**Defense-in-depth backup & DR per silo: PITR on by default + an independent client-owned off-platform
copy + operator-run verification + backup-health on the management-plane push.** Six binding parts:

1. **PITR on by default for every silo** (~2-minute RPO). Enabled at provisioning, billed to the client
   (ADR-001). PITR *replaces* daily backups (Supabase behaviour) and *is* the in-project backup mechanism.
   Running daily-backups-only is a **logged downgrade exception** per `change-control.md`, never a silent
   default — because it weakens non-negotiable #1.

2. **An independent off-platform logical backup to a client-owned destination.** A scheduled `pg_dump`
   (via CLI / Management-API-driven job) writes an encrypted copy to a **second location the client owns**
   (their own object store / account), **in a different region** where practical, on a defined cadence
   (≥ daily). This copy is **independent of the primary project's lifecycle** — it survives a paused or
   deleted project, which is the *only* defense against the billing-lapse → pause → deletion path. The
   operator orchestrates and monitors it but **never holds it** (preserves the ADR-001 data-custody
   boundary). Operator-held copies are a per-client exception only (Axis 2 / B3), logged with terms.

3. **Ownership split (ADR-001 hybrid, made explicit for backups):** **Client owns + pays** (project, plan,
   PITR add-on, the off-platform destination). **Operator operates + verifies** (enables PITR, runs the
   off-platform dump job, runs restore rehearsals, watches health). Captured in the provisioning runbook
   (ADR-005) and the retainer scope. Neither side can assume the other is doing it — it is named here.

4. **A tested restore is the only restore that counts.** The operator runs a **periodic restore rehearsal**:
   restore a recent backup (in-project PITR target and/or the off-platform dump) into a **throwaway
   project**, confirm the database — including **pgvector memory** and **`auth` rows** — comes back complete
   and queryable, and **log the result + timestamp**. Supabase verifies nothing; we do. ⚠️ AF-069.

5. **Backup-health joins the management-plane health push (ADR-001 §7).** Each deployment reports, as
   **operational metadata only** (no business data ever crosses): `pitr_enabled` + retention, last in-project
   backup timestamp, **project status (active / paused / billing-at-risk)**, last successful off-platform
   dump + timestamp, and last restore-rehearsal date + result. Read via the **Supabase Management API**
   (⚠️ AF-070). The Super Admin dashboard surfaces a **loud alert if any of these lapse or go stale** — so a
   client's lapsing backups (or an approaching pause → 90-day deletion window) are *seen* by the operator
   long before deletion. This protects non-negotiable #1 (catch the loss path early) and #3 (never fail
   silently).

6. **Supabase Storage buckets are out of scope for v1 backup** (→ OOS-013). v1 uses Storage solely for
   **regenerable offboarding export files** (`L97`), not source-of-truth knowledge; losing one means
   re-running an export, not losing knowledge. If a future component puts non-regenerable files in Storage,
   that re-opens this as its own decision (bucket-copy must join the off-platform job). Logged as a conscious
   exclusion, not a silent gap.

**Disaster-recovery posture (stated, not assumed):** a silo's DR is **backup-restore with downtime**, not
hot failover (Supabase auto-failover is Enterprise-only). Acceptable at ADR-001 scale (≤~20 clients,
≤~20 users each). Read replicas / HA failover are a per-client upsell, not a v1 default (see OOS-014).

## Consequences

**Becomes required (new requirements to write):**
- Provisioning (ADR-005) **must**: enable PITR on the client's project; create/connect the client-owned
  off-platform destination; schedule the `pg_dump` job + the restore-rehearsal job; register backup-health
  fields in the deployment's health reporter.
- The health-reporter job (ADR-001 §7) gains the **backup-health fields** in part 5; the management-plane
  ingest + Super Admin dashboard gain the **lapse/stale alerts** and a **project-pause / billing-at-risk
  warning** driven by Management-API project status.
- NFR-SEC: the off-platform dump is **encrypted**; the operator's job holds a **delegated credential**
  (PAT / service path) scoped to backup operations + status reads — not a broad grant.
- Data model / runbook: the restore-rehearsal procedure (throwaway project, what to assert, cadence).

**Ruled out / deferred:**
- Relying on in-project backups alone (B1) — the deletion path makes it a total-loss risk.
- Operator-controlled off-platform store as the default (B3) — breaks the ADR-001 data-custody boundary;
  kept as a logged per-client exception only.
- Storage-bucket backup in v1 (OOS-013); HA / read-replica failover as a default (OOS-014).

**Feeds other ADRs:**
- **ADR-003 (cost):** adds a **per-silo cost line** — PITR (~$100+/mo) + off-platform storage — to the
  client-borne envelope. Not operator P&L (ADR-001), but it belongs in the cost dashboard + viability model.
- **ADR-005 (provisioning):** the four provisioning additions above; the Google-verification-style schedule
  dependency now includes standing up the client's second backup destination.
- **Component 10 (offboarding):** the off-platform copy + clean Supabase deprovision strengthen the
  "airtight deletion evidence" story (ADR-001) — deprovision destroys both the project and, per the client's
  instruction, the off-platform copy.

**Must be tested (feasibility block I):**
- **AF-069 (SPIKE)** — a restore actually works end-to-end (DB + pgvector + auth rows come back complete and
  queryable within acceptable downtime). Part 4 rests on this.
- **AF-070 (SPIKE)** — the Supabase Management API exposes the backup-health fields part 5 needs
  (last-backup timestamp, `pitr_enabled` / retention, project status). Endpoint existence is verified; the
  exact payload is not — confirm against the live API.
- **AF-071 (DOCS / vendor confirmation)** — backup + off-platform region locality satisfies AU data
  residency (ap-southeast-2). Supabase primary docs do **not** pin where backups physically live; confirm
  before any residency claim.
- **AF-072 (LOAD)** — the off-platform `pg_dump` completes within its window, and restore time scales
  acceptably, for a large mature brain.
